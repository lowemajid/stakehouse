import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { generatePlayerUniverse } from '@stakehouse/seeder';
import {
  draftedLeague,
  expectApiError,
  LEAGUE_REQUEST,
  makeApp,
  paidLeague,
  signIn,
  T0,
  USER,
} from './testSupport';
import { managerIdForEmail } from './sessions';

/**
 * The draft route contract: snake integrity, guarded transitions, the
 * queue, and the full reject-reason matrix for /pick. These ran RED first.
 * Time never comes from the request body — the server's injected clock is
 * the only authority, so tests advance `world`'s clock instead.
 */

const PICK_MS = 30_000; // the pick clock the served draft promises
const TOTAL_PICKS = 36; // 9 roster slots × 4 managers

async function startDraft(world: Awaited<ReturnType<typeof paidLeague>>) {
  const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
  expect(res.status).toBe(200);
  return res;
}

describe('GET /api/leagues/:id/draft', () => {
  it('serves a pending board before the draft starts', async () => {
    const world = await paidLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    expect(res.status).toBe(200);
    expect(res.body.draft.status).toBe('pending');
    expect(res.body.draft.picks).toStrictEqual([]);
    expect(res.body.draft.order).toStrictEqual(world.managerIds);
    expect(res.body.draft.pickSeconds).toBe(30);
    expect(res.body.draft.clock.deadline).toBeNull();
    expect(res.body.draft.rosters).toStrictEqual(
      Object.fromEntries(world.managerIds.map((id) => [id, []])),
    );
    expect(res.body.draft.board.length).toBe(50); // the whole seeded universe
  });

  it('answers 404 for an unknown league', async () => {
    const world = await paidLeague();
    const res = await request(world.app).get('/api/leagues/lg-nope/draft');
    expectApiError(res, 404, 'unknown-league');
  });

  it('names the seats so the room can say who is deciding', async () => {
    const world = await paidLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    expect(res.status).toBe(200);
    expect(res.body.draft.seats).toStrictEqual(
      world.managerIds.map((id: string, index: number) => ({
        id,
        displayName: `Manager ${index}`,
        isAi: false,
      })),
    );
  });

  it('exposes queues and a settled clock after completion', async () => {
    const world = await draftedLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    const draft = res.body.draft;
    expect(draft.queues).toStrictEqual(
      Object.fromEntries(world.managerIds.map((id) => [id, { queue: [], autopick: true }])),
    );
    expect(draft.clock.deadline).toBeNull(); // draft complete — no clock running
  });

  it('names the commissioner seat so the room gates commissioner actions', async () => {
    const world = await paidLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    expect(res.status).toBe(200);
    // The league's commissioner is agent 0 (the creator).
    expect(res.body.draft.commissionerSeatId).toBe(managerIdForEmail(USER(0).email));
  });

  it('boards the real seeder universe — fractional projections score, not crash', async () => {
    // generatePlayerUniverse stores expectation-valued projections (fractional
    // counters); the board must score them with the seeder's scaled arithmetic
    // — a direct scoreLine call rejects fractional counts and 500s the room.
    const world = makeApp();
    for (const card of generatePlayerUniverse()) world.store.players.upsert(card);
    const commissioner = await signIn(world.app, 0);
    const created = await commissioner.post('/api/leagues').send(LEAGUE_REQUEST);
    const leagueId: string = created.body.league.id;
    const res = await request(world.app).get(`/api/leagues/${leagueId}/draft`);
    expect(res.status).toBe(200);
    expect(res.body.draft.board).toHaveLength(300);
    for (const entry of res.body.draft.board) {
      expect(Number.isFinite(entry.projectedPoints)).toBe(true);
    }
  });
});

describe('GET /api/leagues/:id/draft — who and what the room renders', () => {
  it('carries the seat names and AI flags the board renders', async () => {
    const world = await paidLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    expect(res.status).toBe(200);
    expect(res.body.draft.managers).toStrictEqual(
      Object.fromEntries(
        world.managerIds.map((id, i) => [id, { displayName: `Manager ${i}`, isAi: false }]),
      ),
    );
  });

  it('carries the player map so picked players keep their names on the recap', async () => {
    const world = await draftedLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    const draft = res.body.draft;
    // Every pick resolves to a named, positioned, projected card.
    for (const pick of draft.picks) {
      expect(draft.players[pick.playerId]).toStrictEqual({
        name: expect.any(String),
        position: expect.any(String),
        projectedPoints: expect.any(Number),
      });
    }
    // And a player who left the live board still answers by id.
    const firstPicked = draft.picks[0]!.playerId;
    expect(draft.board.some((entry: { playerId: string }) => entry.playerId === firstPicked)).toBe(
      false,
    );
    expect(draft.players[firstPicked]!.name).toBe('Player 0');
  });

  it('tells the caller which seat is theirs — and null when they hold none', async () => {
    const world = await paidLeague();
    const mine = await world.agents[0]!.get(`/api/leagues/${world.leagueId}/draft`);
    expect(mine.body.draft.you).toBe(world.managerIds[0]);
    const theirs = await world.agents[1]!.get(`/api/leagues/${world.leagueId}/draft`);
    expect(theirs.body.draft.you).toBe(world.managerIds[1]);
    const anonymous = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    expect(anonymous.body.draft.you).toBeNull();
  });
});

describe('POST /api/leagues/:id/draft/start', () => {
  it('refuses a non-commissioner', async () => {
    const world = await paidLeague();
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    expectApiError(res, 403, 'not-commissioner');
  });

  it('requires a session', async () => {
    const world = await paidLeague();
    const res = await request(world.app).post(`/api/leagues/${world.leagueId}/draft/start`);
    expectApiError(res, 401, 'unauthorized');
  });

  it('goes live and puts the first manager on the clock', async () => {
    const world = await paidLeague();
    const res = await startDraft(world);
    expect(res.body.draft.status).toBe('live');
    expect(res.body.draft.clock.overall).toBe(1);
    expect(res.body.draft.clock.managerId).toBe(world.managerIds[0]);
    expect(res.body.draft.clock.deadline).toBe(T0 + PICK_MS);
  });

  it('refuses a draft with an unpaid manager', async () => {
    const world = await paidLeague(2);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    expectApiError(res, 409, 'draft-not-paid');
  });

  it('refuses starting twice', async () => {
    const world = await draftedLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    expectApiError(res, 409, 'draft-already-complete');
  });
});

describe('POST /api/leagues/:id/draft/pick — the reject-reason matrix', () => {
  it('requires a session', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const res = await request(world.app)
      .post(`/api/leagues/${world.leagueId}/draft/pick`)
      .send({ playerId: 'p-0' });
    expectApiError(res, 401, 'unauthorized');
  });

  it('accepts an in-turn pick and advances the clock', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    expect(res.status).toBe(201);
    expect(res.body.pick).toStrictEqual({
      overall: 1,
      managerId: world.managerIds[0],
      playerId: 'p-0',
      at: '2026-10-05T20:00:00.000Z', // the injected server clock, not a wall clock
    });
    expect(res.body.draft.clock.overall).toBe(2);
    expect(res.body.draft.clock.managerId).toBe(world.managerIds[1]);
    // The clock resets to now + PICK_MS from the pick's instant — the pick
    // landed at T0 (no clock advance), so the new deadline equals the old one.
    expect(res.body.draft.clock.deadline).toBe(T0 + PICK_MS);
  });

  it('rejects an out-of-turn pick — 409 not-your-turn', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    expectApiError(res, 409, 'not-your-turn');
  });

  it('rejects a taken player — 409 player-taken', async () => {
    const world = await paidLeague();
    await startDraft(world);
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    expectApiError(res, 409, 'player-taken');
  });

  it('rejects an expired clock — 409 clock-expired', async () => {
    const world = await paidLeague();
    await startDraft(world);
    world.advanceMs(PICK_MS + 1); // the injected clock passes the deadline
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    expectApiError(res, 409, 'clock-expired');
  });

  it('rejects a pick that cannot fit the roster — 409 duplicate-roster-slot', async () => {
    const world = await paidLeague();
    await startDraft(world);
    // Round 1: every seat takes a QB (p-0..p-3). Round 2 snakes back to
    // manager 3, whose QB slot is full — a fifth QB fits no slot (FLEX never
    // takes a QB), so the guard rejects it even though the player is untaken.
    for (let overall = 1; overall <= 4; overall += 1) {
      const picked = await world.agents[overall - 1]!.post(
        `/api/leagues/${world.leagueId}/draft/pick`,
      ).send({ playerId: `p-${overall - 1}` });
      expect(picked.status).toBe(201);
    }
    const res = await world.agents[3]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-4',
    });
    expectApiError(res, 409, 'duplicate-roster-slot');
  });

  it('rejects a player off the universe board — 404 unknown-player', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-999',
    });
    expectApiError(res, 404, 'unknown-player');
  });

  it('refuses picks once the draft is complete — 409 draft-already-complete', async () => {
    const world = await draftedLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    expectApiError(res, 409, 'draft-already-complete');
  });

  it('refuses a pick by a manager with no seat — 403 not-a-manager', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const outsider = await signIn(world.app, 4);
    const res = await outsider.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    expectApiError(res, 403, 'not-a-manager');
  });
});

describe('snake order and completion', () => {
  it('runs the full snake to completion — 1..N, N..1 — with zero timeouts', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const ids = world.managerIds;
    const forward = [ids[0]!, ids[1]!, ids[2]!, ids[3]!];
    const backward = [ids[3]!, ids[2]!, ids[1]!, ids[0]!];
    const expectedManagers: string[] = [];
    for (let round = 0; round < 9; round += 1) {
      expectedManagers.push(...(round % 2 === 0 ? forward : backward));
    }
    expect(expectedManagers).toHaveLength(TOTAL_PICKS);
    // Autopick on each expired clock resolves exactly one best-available pick —
    // the route must never stall and never mis-attribute the seat.
    let finalDraft: { status: string; picks: { managerId: string }[] } | undefined;
    for (let overall = 1; overall <= TOTAL_PICKS; overall += 1) {
      world.advanceMs(PICK_MS + 1);
      const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/autopick`);
      expect(res.status).toBe(200);
      finalDraft = res.body.draft;
      expect(res.body.autopicked.overall).toBe(overall);
      expect(res.body.autopicked.managerId).toBe(expectedManagers[overall - 1]);
    }
    expect(finalDraft!.status).toBe('complete');
    expect(finalDraft!.picks).toHaveLength(TOTAL_PICKS);
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft`);
    expect(res.body.draft.picks.map((p: { managerId: string }) => p.managerId)).toStrictEqual(
      expectedManagers,
    );
    expect(res.body.draft.clock.deadline).toBeNull();
  });
});

describe('queue and autopick', () => {
  it('saves and returns a manager queue', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const res = await world.agents[0]!.put(`/api/leagues/${world.leagueId}/draft/queue`).send({
      queue: ['p-0', 'p-1'],
    });
    expect(res.status).toBe(200);
    expect(res.body.queue).toStrictEqual(['p-0', 'p-1']);
  });

  it('rejects a queue with duplicates', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const res = await world.agents[0]!.put(`/api/leagues/${world.leagueId}/draft/queue`).send({
      queue: ['p-0', 'p-0'],
    });
    expectApiError(res, 400, 'validation-error');
  });

  it('autopicks from the queue when the clock expires', async () => {
    const world = await paidLeague();
    await startDraft(world);
    await world.agents[0]!.put(`/api/leagues/${world.leagueId}/draft/queue`).send({
      queue: ['p-0'],
    });
    world.advanceMs(PICK_MS + 1);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/autopick`);
    expect(res.status).toBe(200);
    expect(res.body.autopicked).toStrictEqual({
      overall: 1,
      managerId: world.managerIds[0],
      playerId: 'p-0',
      at: '2026-10-05T20:00:30.001Z', // deadline + 1ms under the injected clock
    });
    expect(res.body.draft.clock.overall).toBe(2);
  });

  it('autopicks best-available off an empty queue', async () => {
    const world = await paidLeague();
    await startDraft(world);
    world.advanceMs(PICK_MS + 1);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/autopick`);
    expect(res.status).toBe(200);
    expect(res.body.autopicked.playerId).toBe('p-0'); // first on the ranked board
    expect(res.body.autopicked.managerId).toBe(world.managerIds[0]);
  });

  it('refuses autopick while the clock is still live', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/autopick`);
    expectApiError(res, 409, 'clock-live');
  });

  it('fast-forwards through the remaining picks', async () => {
    const world = await paidLeague();
    await startDraft(world);
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/fast-forward`);
    expect(res.status).toBe(200);
    expect(res.body.draft.status).toBe('complete');
    expect(res.body.draft.picks).toHaveLength(TOTAL_PICKS);
    expect(res.body.fastForwarded).toBe(TOTAL_PICKS - 1);
    expect(res.body.draft.clock.deadline).toBeNull();
  });

  it('refuses a non-commissioner fast-forward', async () => {
    const world = await paidLeague();
    await startDraft(world);
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/draft/fast-forward`);
    expectApiError(res, 403, 'not-commissioner');
  });
});
