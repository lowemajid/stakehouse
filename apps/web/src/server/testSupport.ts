import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { zeroStatLine } from '@stakehouse/domain';
import type { Position } from '@stakehouse/domain';
import { createFakeStore } from '@stakehouse/persistence';
import type { StakehouseStore } from '@stakehouse/persistence';
import { createApp } from './app';
import { createInMemoryOpsStore } from './opsStore';
import type { LeagueOpsStore } from './opsStore';

/**
 * Shared fixtures for the API contract tests. Every world is fully isolated:
 * its own store, ops store, and a fixed clock the test can advance — the
 * domain never reads a clock, so neither does the server under test.
 */

/** Fixed epoch — 2026-10-01T12:00:00Z. */
export const T0 = 1_791_230_400_000;

export const USER = (i: number) => ({ displayName: `Manager ${i}`, email: `mgr${i}@example.com` });

export const SCORING = {
  passYards: 0.04,
  passTd: 4,
  interception: -2,
  rushYards: 0.1,
  rushTd: 6,
  reception: 0.5,
  fumbleLost: -2,
  kicking: { fg: { '0-19': 3, '20-29': 3, '30-39': 4, '40-49': 5, '50+': 6 }, extraPoint: 1 },
  defense: {
    sack: 1,
    takeaway: 2,
    td: 6,
    pointsAllowedBands: [
      [0, 0],
      [1, 6],
      [7, 20],
      [21, 99],
    ],
  },
};

export const ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } as const;

export const LEAGUE_REQUEST = {
  name: 'League of Ordinary Gentlepeople',
  entryFeeCents: 25_00,
  size: 4,
  roster: ROSTER,
  scoring: SCORING,
  regularSeasonWeeks: 2,
  playoffTeams: 0,
  payoutSplitPct: [50, 30, 20],
};

export type Session = ReturnType<typeof request.agent>;

export interface World {
  app: Express;
  store: StakehouseStore;
  ops: LeagueOpsStore;
  advanceMs(ms: number): void;
}

export function makeApp(): World {
  let clock = T0;
  const store = createFakeStore();
  const ops = createInMemoryOpsStore();
  const app = createApp({ serveSpa: false, store, ops, now: () => clock, tickerMs: 0 });
  return {
    app,
    store,
    ops,
    advanceMs: (ms: number) => {
      clock += ms;
    },
  };
}

/**
 * The player universe: position bands at fixed id ranges so tests can reason
 * about free agents. With the default roster (9 slots × 4 managers = 36
 * picks) a full draft consumes QB p-0..3, RB p-8..19, WR p-20..27, TE
 * p-34..37, K p-40..44, DEF p-45..49 — leaving QBs p-4..7, WRs p-28..33, and
 * TEs p-38..39 on the wire.
 */
export function seedPlayers(store: StakehouseStore): void {
  const bands: readonly (readonly [Position, number])[] = [
    ['QB', 8],
    ['RB', 12],
    ['WR', 14],
    ['TE', 6],
    ['K', 5],
    ['DEF', 5],
  ];
  let index = 0;
  for (const [position, count] of bands) {
    for (let n = 0; n < count; n++) {
      // Float per-game means, mirroring the real seeder — the board must
      // score projections without treating them as drawn stat lines.
      const projection = zeroStatLine();
      projection.passYards = 220.79;
      projection.passTd = 1.26;
      projection.rushYards = 5.77;
      projection.receptions = 3.2;
      store.players.upsert({
        id: `p-${index}`,
        name: `Player ${index}`,
        position,
        projection,
        variance: 0.12,
      });
      index++;
    }
  }
}

export async function signIn(app: Express, i: number): Promise<Session> {
  const session = request.agent(app);
  const res = await session.post('/api/session').send(USER(i));
  expect(res.status).toBe(200);
  return session;
}

export interface PaidLeague extends World {
  leagueId: string;
  agents: Session[];
  managerIds: string[];
}

/**
 * A league at its entry fee, seated by `payers` paying managers (default: the
 * full league). The draft only exists when every seat is filled AND paid.
 */
export async function paidLeague(payers = 4): Promise<PaidLeague> {
  const world = makeApp();
  seedPlayers(world.store);
  const commissioner = await signIn(world.app, 0);
  const created = await commissioner.post('/api/leagues').send(LEAGUE_REQUEST);
  expect(created.status).toBe(201);
  const leagueId: string = created.body.league.id;

  const agents: Session[] = [];
  const managerIds: string[] = [];
  for (let i = 0; i < payers; i++) {
    const session = i === 0 ? commissioner : await signIn(world.app, i);
    agents.push(session);
    const joined = await session.post(`/api/leagues/${leagueId}/join`);
    expect(joined.status).toBe(201);
    managerIds.push(joined.body.manager.id);
    const paid = await session.post(`/api/leagues/${leagueId}/pay`);
    expect(paid.status).toBe(201);
  }
  return { ...world, leagueId, agents, managerIds };
}

/** A league whose draft is complete — 36 best-available picks cascaded. */
export async function draftedLeague(): Promise<PaidLeague> {
  const world = await paidLeague();
  const started = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
  expect(started.status).toBe(200);
  const forwarded = await world.agents[0]!.post(
    `/api/leagues/${world.leagueId}/draft/fast-forward`,
  );
  expect(forwarded.status).toBe(200);
  return world;
}

/** A league with the regular season fully simulated. */
export async function simulatedLeague(): Promise<PaidLeague> {
  const world = await draftedLeague();
  for (let week = 1; week <= 2; week++) {
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/simulate`);
    expect(res.status).toBe(200);
  }
  return world;
}

/** Players owned by a manager — the draft view's rosters fold waiver moves in. */
export async function ownedPlayers(
  world: PaidLeague,
  managerIndex: number,
): Promise<{ playerId: string; position: string }[]> {
  const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
  expect(res.status).toBe(200);
  const draft = res.body.draft;
  const roster = draft.rosters[world.managerIds[managerIndex]!];
  return (roster ?? []).map((slot: { playerId: string; position: string }) => ({
    playerId: slot.playerId,
    position: slot.position,
  }));
}

/** Player ids owned by nobody, derived from the served draft view. */
export async function freeAgents(world: PaidLeague, position: string): Promise<string[]> {
  const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
  expect(res.status).toBe(200);
  const draft = res.body.draft;
  const taken = new Set(
    Object.values(draft.rosters).flatMap((slots) =>
      (slots as { playerId: string }[]).map((slot) => slot.playerId),
    ),
  );
  return draft.board
    .filter(
      (ref: { playerId: string; position: string }) =>
        ref.position === position && !taken.has(ref.playerId),
    )
    .map((ref: { playerId: string }) => ref.playerId);
}

/** Asserts the documented error envelope: `{ error: { code, message } }`. */
export function expectApiError(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): void {
  expect(res.status).toBe(status);
  const body = res.body as { error?: { code?: string; message?: string } };
  expect(body.error?.code).toBe(code);
  expect(typeof body.error?.message).toBe('string');
  expect(body.error?.message?.length).toBeGreaterThan(0);
}
