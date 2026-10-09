import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { leagueId } from '@stakehouse/domain';
import type { Cents } from '@stakehouse/domain';
import {
  draftedLeague,
  expectApiError,
  freeAgents,
  LEAGUE_REQUEST,
  makeApp,
  paidLeague,
  ownedPlayers,
  seedPlayers,
  signIn,
  simulatedLeague,
  USER,
} from './testSupport';

/**
 * The route contract: every response shape, status, and error code the spec's
 * §API surface promises. These tests ran RED before any route existed —
 * they are the binding contract, not a snapshot of the implementation.
 */

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('POST /api/session', () => {
  it('signs in and sets a signed session cookie', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/session').send(USER(0));
    expect(res.status).toBe(200);
    expect(res.body.user).toStrictEqual(USER(0));
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('sh_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects a sign-in without an email', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/session').send({ displayName: 'Manager 0' });
    expectApiError(res, 400, 'validation-error');
  });

  it('rejects a malformed email', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/session')
      .send({ displayName: 'Manager 0', email: 'not-an-email' });
    expectApiError(res, 400, 'validation-error');
  });

  it('rejects a tampered session cookie', async () => {
    const { app } = await paidLeague(0);
    const res = await request(app)
      .post('/api/leagues/lg-some/join')
      .set('Cookie', 'sh_session=eyJ0YXA=.dGFwZXJzaWduYXR1cmU=');
    expectApiError(res, 401, 'unauthorized');
  });

  it('rejects a request with no session cookie at all', async () => {
    const { app } = await paidLeague(0);
    const res = await request(app).post('/api/leagues/lg-some/join');
    expectApiError(res, 401, 'unauthorized');
  });
});

describe('GET/POST /api/leagues', () => {
  it('lists an empty lobby before any league exists', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/leagues');
    expect(res.status).toBe(200);
    expect(res.body.leagues).toStrictEqual([]);
  });

  it('creates a league from a validated config', async () => {
    const { app } = await paidLeague(0);
    const res = await request(app).post('/api/leagues').send(LEAGUE_REQUEST);
    expect(res.status).toBe(201);
    const league = res.body.league;
    expect(league.id).toMatch(/^lg-/);
    expect(league.name).toBe(LEAGUE_REQUEST.name);
    expect(league.seatsFilled).toBe(0);
    expect(league.poolCents).toBe(0);
    expect(league.createdAt).toMatch(ISO);
    expect(league.config.entryFeeCents).toBe(25_00);
    expect(league.config.payoutSplitPct).toStrictEqual([50, 30, 20]);
  });

  it('rejects a payout split that does not total 100', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/leagues')
      .send({ ...LEAGUE_REQUEST, payoutSplitPct: [50, 30, 21] });
    expectApiError(res, 400, 'validation-error');
    expect(JSON.stringify(res.body.error.details)).toContain('100');
  });

  it('rejects a non-integer entry fee — money is integer cents', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/leagues')
      .send({ ...LEAGUE_REQUEST, entryFeeCents: 25.5 });
    expectApiError(res, 400, 'validation-error');
  });

  it('rejects a playoff shape that cannot seat inside the season', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/leagues')
      .send({ ...LEAGUE_REQUEST, playoffTeams: 4, regularSeasonWeeks: 1 });
    expectApiError(res, 400, 'validation-error');
  });

  it('answers 404 for routes into an unknown league', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/leagues/lg-nope/ledger');
    expectApiError(res, 404, 'unknown-league');
  });
});

describe('POST /api/leagues/:id/join', () => {
  it('seats the signed-in manager and echoes the seat', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/leagues').send(LEAGUE_REQUEST);
    const league = created.body.league.id;
    const session = await signIn(app, 0);
    const res = await session.post(`/api/leagues/${league}/join`);
    expect(res.status).toBe(201);
    expect(res.body.manager).toStrictEqual({
      id: 'mgr-mgr0',
      displayName: 'Manager 0',
      isAi: false,
      joinedAt: expect.stringMatching(ISO),
    });
  });

  it('answers 404 when the league is unknown', async () => {
    const { app } = makeApp();
    const session = await signIn(app, 0);
    const res = await session.post('/api/leagues/lg-nope/join');
    expectApiError(res, 404, 'unknown-league');
  });

  it('refuses a second seat for the same manager', async () => {
    const { app } = await paidLeague(0);
    const created = await request(app).post('/api/leagues').send(LEAGUE_REQUEST);
    const league = created.body.league.id;
    const session = await signIn(app, 0);
    await session.post(`/api/leagues/${league}/join`);
    const res = await session.post(`/api/leagues/${league}/join`);
    expectApiError(res, 409, 'already-joined');
  });

  it('refuses a seat when the league is full', async () => {
    const { app, leagueId } = await paidLeague();
    const fifth = await signIn(app, 4);
    const res = await fifth.post(`/api/leagues/${leagueId}/join`);
    expectApiError(res, 409, 'league-full');
  });
});

describe('POST /api/leagues/:id/pay', () => {
  it('refuses payment from a manager who has not joined', async () => {
    const { app } = await paidLeague(0);
    const created = await request(app).post('/api/leagues').send(LEAGUE_REQUEST);
    const league = created.body.league.id;
    const session = await signIn(app, 1);
    const res = await session.post(`/api/leagues/${league}/pay`);
    expectApiError(res, 404, 'unknown-manager');
  });

  it('records the simulated buy-in and moves the pool', async () => {
    const { app } = await paidLeague(0);
    const created = await request(app).post('/api/leagues').send(LEAGUE_REQUEST);
    const league = created.body.league.id;
    const session = await signIn(app, 0);
    await session.post(`/api/leagues/${league}/join`);
    const res = await session.post(`/api/leagues/${league}/pay`);
    expect(res.status).toBe(201);
    expect(res.body.simulated).toBe(true);
    expect(res.body.entry).toStrictEqual({
      id: 'entry-0',
      kind: 'buy-in',
      managerId: 'mgr-mgr0',
      amountCents: 25_00,
      memo: expect.stringContaining('simulated'),
      at: expect.stringMatching(ISO),
    });
    expect(res.body.poolCents).toBe(25_00);
  });

  it('refuses a double payment', async () => {
    const { app } = await paidLeague(0);
    const created = await request(app).post('/api/leagues').send(LEAGUE_REQUEST);
    const league = created.body.league.id;
    const session = await signIn(app, 0);
    await session.post(`/api/leagues/${league}/join`);
    await session.post(`/api/leagues/${league}/pay`);
    const res = await session.post(`/api/leagues/${league}/pay`);
    expectApiError(res, 409, 'already-paid');
  });

  it('shows seats and pool on the league list', async () => {
    const { app, leagueId } = await paidLeague(1);
    const res = await request(app).get('/api/leagues');
    const league = res.body.leagues.find((l: { id: string }) => l.id === leagueId);
    expect(league.seatsFilled).toBe(1);
    expect(league.poolCents).toBe(25_00);
  });
});

describe('GET /api/leagues/:id/ledger', () => {
  it('serves the full history and the derived balance', async () => {
    const { app, leagueId } = await paidLeague(2);
    const res = await request(app).get(`/api/leagues/${leagueId}/ledger`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries.map((e: { id: string }) => e.id)).toStrictEqual(['entry-0', 'entry-1']);
    expect(res.body.poolCents).toBe(50_00);
    expect(res.body.entries[0].kind).toBe('buy-in');
  });

  it('derives the balance from every entry kind', async () => {
    const world = await paidLeague(1);
    // A commissioner credit lands directly in the store — the route must derive
    // the balance from whatever the ledger holds, not from a cached total.
    world.store.ledger.append(leagueId(world.leagueId), [
      {
        id: 'entry-1',
        leagueId: leagueId(world.leagueId),
        kind: 'commissioner-credit',
        managerId: null,
        amountCents: 5_00 as Cents,
        memo: 'promo credit',
        at: '2026-10-01T12:00:00.000Z',
      },
    ]);
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/ledger`);
    expect(res.body.poolCents).toBe(30_00);
  });

  it('pairs every entry with the balance after it, ending at the pool', async () => {
    const { app, leagueId } = await paidLeague(2);
    const res = await request(app).get(`/api/leagues/${leagueId}/ledger`);
    expect(res.body.entries.map((e: { balanceAfterCents: number }) => e.balanceAfterCents)).toEqual(
      [25_00, 50_00],
    );
    expect(res.body.entries[1].balanceAfterCents).toBe(res.body.poolCents);
  });

  it('serves the seats with display names and net paid, so the books can name who moved money', async () => {
    const { app, leagueId } = await paidLeague(2);
    const res = await request(app).get(`/api/leagues/${leagueId}/ledger`);
    expect(res.body.seats).toStrictEqual([
      { id: 'mgr-mgr0', displayName: 'Manager 0', paidCents: 25_00 },
      { id: 'mgr-mgr1', displayName: 'Manager 1', paidCents: 25_00 },
    ]);
  });
});

describe('GET /api/players', () => {
  it('returns the whole universe unfiltered', async () => {
    const world = makeApp();
    seedPlayers(world.store);
    const res = await request(world.app).get('/api/players');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(50);
    expect(res.body.players).toHaveLength(50);
  });

  it('searches by name fragment', async () => {
    const world = makeApp();
    seedPlayers(world.store);
    const res = await request(world.app).get('/api/players').query({ q: 'Player 4' });
    expect(res.body.total).toBe(11); // Player 4, Player 40..49
  });

  it('filters by position', async () => {
    const world = makeApp();
    seedPlayers(world.store);
    const res = await request(world.app).get('/api/players').query({ pos: 'QB' });
    expect(res.body.total).toBe(8);
    expect(res.body.players.every((p: { position: string }) => p.position === 'QB')).toBe(true);
  });

  it('combines search and position filters', async () => {
    const world = makeApp();
    seedPlayers(world.store);
    const res = await request(world.app).get('/api/players').query({ q: 'Player 4', pos: 'QB' });
    expect(res.body.total).toBe(1); // Player 4 is a QB; Player 40..49 are K/DEF
  });

  it('rejects an invalid position filter', async () => {
    const world = makeApp();
    seedPlayers(world.store);
    const res = await request(world.app).get('/api/players').query({ pos: 'XX' });
    expectApiError(res, 400, 'validation-error');
  });

  it('carries the projection in every card', async () => {
    const world = makeApp();
    seedPlayers(world.store);
    const res = await request(world.app).get('/api/players').query({ q: 'Player 0' });
    expect(res.body.players[0]).toStrictEqual({
      id: 'p-0',
      name: 'Player 0',
      position: 'QB',
      projection: expect.objectContaining({ passYards: 220.79 }),
      variance: 0.12,
    });
  });
});

describe('POST /api/leagues/:id/simulate', () => {
  it('requires the commissioner', async () => {
    const world = await draftedLeague();
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/simulate`);
    expectApiError(res, 403, 'not-commissioner');
  });

  it('requires a session', async () => {
    const world = await draftedLeague();
    const res = await request(world.app).post(`/api/leagues/${world.leagueId}/simulate`);
    expectApiError(res, 401, 'unauthorized');
  });

  it('refuses to simulate before the draft completes', async () => {
    const world = await paidLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/simulate`);
    expectApiError(res, 409, 'draft-not-complete');
  });

  it('simulates the next week and serves its box scores', async () => {
    const world = await draftedLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/simulate`);
    expect(res.status).toBe(200);
    expect(res.body.week).toBe(1);
    expect(res.body.seasonComplete).toBe(false);
    expect(res.body.result.games).toHaveLength(2); // 4 managers → 2 matchups
    for (const game of res.body.result.games) {
      expect(typeof game.homeBox.total).toBe('number');
      expect(game.homeBox.lines.length).toBeGreaterThan(0);
    }
  });

  it('marks the season complete on the final week', async () => {
    const world = await draftedLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/simulate`);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/simulate`);
    expect(res.status).toBe(200);
    expect(res.body.week).toBe(2);
    expect(res.body.seasonComplete).toBe(true);
  });

  it('refuses a simulate past the season end', async () => {
    const world = await simulatedLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/simulate`);
    expectApiError(res, 409, 'season-complete');
  });
});

describe('GET /api/leagues/:id/matchups', () => {
  it('serves an empty slate before any week is simulated', async () => {
    const world = await draftedLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/matchups`);
    expect(res.status).toBe(200);
    expect(res.body.weeks).toStrictEqual([]);
  });

  it('serves simulated weeks', async () => {
    const world = await draftedLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/simulate`);
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/matchups`);
    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(1);
    expect(res.body.weeks[0].week).toBe(1);
    expect(res.body.weeks[0].games).toHaveLength(2);
  });

  it('filters to a single week', async () => {
    const world = await simulatedLeague();
    const res = await request(world.app)
      .get(`/api/leagues/${world.leagueId}/matchups`)
      .query({ week: 2 });
    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(1);
    expect(res.body.weeks[0].week).toBe(2);
  });

  it('answers 404 for an unsimulated week', async () => {
    const world = await draftedLeague();
    const res = await request(world.app)
      .get(`/api/leagues/${world.leagueId}/matchups`)
      .query({ week: 2 });
    expectApiError(res, 404, 'week-not-simulated');
  });
});

describe('GET /api/leagues/:id/standings', () => {
  it('serves an empty table before any week is played', async () => {
    const world = await draftedLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/standings`);
    expect(res.status).toBe(200);
    expect(res.body.standings).toStrictEqual([]);
  });

  it('ranks managers by record after weeks are played', async () => {
    const world = await simulatedLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/standings`);
    expect(res.status).toBe(200);
    expect(res.body.standings).toHaveLength(4);
    for (const [index, row] of res.body.standings.entries()) {
      expect(row.rank).toBe(index + 1);
      expect(row.wins + row.losses + row.ties).toBe(2); // two weeks played
      expect(typeof row.pointsFor).toBe('number');
      expect(row.displayName).toBe(`Manager ${world.managerIds.indexOf(row.managerId)}`);
    }
  });
});

describe('POST /api/leagues/:id/ledger/payouts/distribute', () => {
  it('requires the commissioner', async () => {
    const world = await simulatedLeague();
    const res = await world.agents[1]!.post(
      `/api/leagues/${world.leagueId}/ledger/payouts/distribute`,
    );
    expectApiError(res, 403, 'not-commissioner');
  });

  it('refuses payouts before the season completes', async () => {
    const world = await draftedLeague();
    const res = await world.agents[0]!.post(
      `/api/leagues/${world.leagueId}/ledger/payouts/distribute`,
    );
    expectApiError(res, 409, 'season-not-complete');
  });

  it('distributes the pot exactly and empties the pool', async () => {
    const world = await simulatedLeague();
    const res = await world.agents[0]!.post(
      `/api/leagues/${world.leagueId}/ledger/payouts/distribute`,
    );
    expect(res.status).toBe(201);
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries.map((e: { kind: string }) => e.kind)).toStrictEqual([
      'payout',
      'payout',
      'payout',
    ]);
    const sum = res.body.entries.reduce(
      (acc: number, e: { amountCents: number }) => acc + e.amountCents,
      0,
    );
    expect(sum).toBe(-100_00); // four 2500-cent buy-ins, signed out of the pool
    expect(res.body.poolCents).toBe(0);
    expect(res.body.entries[0].memo).toContain('1st');
  });

  it('refuses a second distribution — the pool is empty', async () => {
    const world = await simulatedLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/payouts/distribute`);
    const res = await world.agents[0]!.post(
      `/api/leagues/${world.leagueId}/ledger/payouts/distribute`,
    );
    expectApiError(res, 409, 'empty-pool');
  });

  it('leaves the full history intact after distribution', async () => {
    const world = await simulatedLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/payouts/distribute`);
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/ledger`);
    expect(res.body.entries).toHaveLength(4 + 3); // four buy-ins, three payouts
    expect(res.body.poolCents).toBe(0);
  });
});

describe('POST /api/leagues/:id/waivers', () => {
  it('refuses waivers before the draft completes', async () => {
    const world = await paidLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: 'p-0',
      dropPlayerId: 'p-1',
    });
    expectApiError(res, 409, 'draft-not-complete');
  });

  it('requires a session', async () => {
    const world = await draftedLeague();
    const res = await request(world.app).post(`/api/leagues/${world.leagueId}/waivers`).send({});
    expectApiError(res, 401, 'unauthorized');
  });

  it('records a valid add-drop', async () => {
    const world = await draftedLeague();
    const [freeWr] = await freeAgents(world, 'WR');
    const owned = await ownedPlayers(world, 0);
    const dropped = owned.find((p) => p.position === 'WR')!;
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: freeWr,
      dropPlayerId: dropped.playerId,
    });
    expect(res.status).toBe(201);
    expect(res.body.waiver).toStrictEqual({
      id: 'wv-0',
      leagueId: world.leagueId,
      managerId: world.managerIds[0],
      addPlayerId: freeWr,
      dropPlayerId: dropped.playerId,
      at: expect.stringMatching(ISO),
    });
  });

  it('refuses adding a player another manager owns', async () => {
    const world = await draftedLeague();
    const ownedElsewhere = await ownedPlayers(world, 1);
    const owned = await ownedPlayers(world, 0);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: ownedElsewhere[0]!.playerId,
      dropPlayerId: owned.find((p) => p.position === 'WR')!.playerId,
    });
    expectApiError(res, 409, 'player-taken');
  });

  it('refuses dropping a player you do not own', async () => {
    const world = await draftedLeague();
    const [freeWr] = await freeAgents(world, 'WR');
    const ownedElsewhere = await ownedPlayers(world, 1);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: freeWr,
      dropPlayerId: ownedElsewhere[0]!.playerId,
    });
    expectApiError(res, 409, 'player-not-owned');
  });

  it('refuses an add with no drop on a full roster', async () => {
    const world = await draftedLeague();
    const [freeWr] = await freeAgents(world, 'WR');
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: freeWr,
    });
    expectApiError(res, 409, 'roster-full');
  });

  it('refuses an add that cannot fit the roster slots', async () => {
    const world = await draftedLeague();
    const [freeQb] = await freeAgents(world, 'QB');
    const owned = await ownedPlayers(world, 0);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: freeQb,
      dropPlayerId: owned.find((p) => p.position === 'WR')!.playerId,
    });
    // Dropping a WR frees a WR slot; a QB cannot fill it and the FLEX is taken.
    expectApiError(res, 409, 'roster-slot-conflict');
  });

  it('refuses a player off the universe board', async () => {
    const world = await draftedLeague();
    const owned = await ownedPlayers(world, 0);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: 'p-999',
      dropPlayerId: owned[0]!.playerId,
    });
    expectApiError(res, 404, 'unknown-player');
  });

  it('refuses a waiver with nothing to add or drop', async () => {
    const world = await draftedLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({});
    expectApiError(res, 400, 'validation-error');
  });

  it('moves ownership — the added player shows in your lineup', async () => {
    const world = await draftedLeague();
    const [freeWr] = await freeAgents(world, 'WR');
    const owned = await ownedPlayers(world, 0);
    const dropped = owned.find((p) => p.position === 'WR')!;
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/waivers`).send({
      addPlayerId: freeWr,
      dropPlayerId: dropped.playerId,
    });
    const nowOwned = await ownedPlayers(world, 0);
    expect(nowOwned.map((p) => p.playerId)).toContain(freeWr);
    expect(nowOwned.map((p) => p.playerId)).not.toContain(dropped.playerId);
  });
});

describe('GET /api/leagues/:id/trades and POST …/trades/:tid/veto', () => {
  async function leagueWithProposal() {
    const world = await draftedLeague();
    world.ops.trades.save({
      id: 'tr-1',
      leagueId: world.leagueId,
      fromManagerId: world.managerIds[1]!,
      toManagerId: world.managerIds[2]!,
      gives: ['p-8'],
      wants: ['p-20'],
      reason: 'valuation gap — RB scarcity favors the proposer',
      status: 'proposed',
      createdAt: '2026-10-01T12:00:00.000Z',
      processedAt: null,
    });
    return world;
  }

  it('serves stored trade proposals', async () => {
    const world = await leagueWithProposal();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/trades`);
    expect(res.status).toBe(200);
    expect(res.body.trades).toHaveLength(1);
    expect(res.body.trades[0]).toStrictEqual({
      id: 'tr-1',
      leagueId: world.leagueId,
      fromManagerId: world.managerIds[1],
      toManagerId: world.managerIds[2],
      gives: ['p-8'],
      wants: ['p-20'],
      reason: 'valuation gap — RB scarcity favors the proposer',
      status: 'proposed',
      createdAt: '2026-10-01T12:00:00.000Z',
      processedAt: null,
    });
  });

  it('serves an empty list before any proposal is stored', async () => {
    const world = await draftedLeague();
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/trades`);
    expect(res.status).toBe(200);
    expect(res.body.trades).toStrictEqual([]);
  });

  it('lets the commissioner veto a proposed trade', async () => {
    const world = await leagueWithProposal();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/trades/tr-1/veto`);
    expect(res.status).toBe(200);
    expect(res.body.trade.status).toBe('vetoed');
    expect(res.body.trade.processedAt).toMatch(ISO);
  });

  it('restricts the veto to the commissioner', async () => {
    const world = await leagueWithProposal();
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/trades/tr-1/veto`);
    expectApiError(res, 403, 'not-commissioner');
  });

  it('answers 404 for an unknown trade id', async () => {
    const world = await leagueWithProposal();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/trades/tr-nope/veto`);
    expectApiError(res, 404, 'unknown-trade');
  });

  it('refuses vetoing an already-processed trade', async () => {
    const world = await leagueWithProposal();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/trades/tr-1/veto`);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/trades/tr-1/veto`);
    expectApiError(res, 409, 'trade-processed');
  });
});

describe('GET /api/health', () => {
  it('keeps answering', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/leagues/:id/ledger/credit', () => {
  it('requires the commissioner', async () => {
    const world = await paidLeague();
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/ledger/credit`).send({
      amountCents: 500,
      memo: 'commissioner promo',
    });
    expectApiError(res, 403, 'not-commissioner');
  });

  it('records a pool-level credit exactly and grows the derived pool', async () => {
    const world = await paidLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/credit`).send({
      amountCents: 500,
      memo: 'commissioner promo — season-opening credit',
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.kind).toBe('commissioner-credit');
    expect(res.body.entry.managerId).toBeNull();
    expect(res.body.entry.amountCents).toBe(500);
    expect(res.body.entry.memo).toContain('commissioner promo');
    expect(res.body.poolCents).toBe(10_500); // four 2500-cent buy-ins plus the credit
  });

  it('rejects zero, negative, and fractional amounts', async () => {
    const world = await paidLeague();
    for (const amountCents of [0, -500, 500.5]) {
      const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/credit`).send({
        amountCents,
        memo: 'no',
      });
      expectApiError(res, 400, 'validation-error');
    }
  });
});

describe('POST /api/leagues/:id/ledger/refund', () => {
  it('requires the commissioner', async () => {
    const world = await paidLeague();
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/ledger/refund`).send({
      managerId: world.managerIds[0],
    });
    expectApiError(res, 403, 'not-commissioner');
  });

  it("returns the seat's remaining net to the cent", async () => {
    const world = await paidLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/refund`).send({
      managerId: world.managerIds[1],
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.kind).toBe('refund');
    expect(res.body.entry.managerId).toBe(world.managerIds[1]);
    expect(res.body.entry.amountCents).toBe(-2500); // exactly what that seat paid
    expect(res.body.poolCents).toBe(7500);
  });

  it("refuses a second refund — the seat's net is already zero", async () => {
    const world = await paidLeague();
    const seat = world.managerIds[1]!;
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/refund`).send({
      managerId: seat,
    });
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/refund`).send({
      managerId: seat,
    });
    expectApiError(res, 409, 'nothing-to-refund');
  });

  it('refuses an unknown seat', async () => {
    const world = await paidLeague();
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/refund`).send({
      managerId: 'mgr-nobody',
    });
    expectApiError(res, 404, 'unknown-seat');
  });
});

describe('POST /api/leagues/:id/cancel', () => {
  it('requires the commissioner', async () => {
    const world = await paidLeague(3);
    const res = await world.agents[1]!.post(`/api/leagues/${world.leagueId}/cancel`);
    expectApiError(res, 403, 'not-commissioner');
  });

  it('refunds every paid seat to the cent and marks the league voided', async () => {
    const world = await paidLeague(3);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/cancel`);
    expect(res.status).toBe(201);
    expect(res.body.refunds).toHaveLength(3);
    const returned = res.body.refunds.reduce(
      (acc: number, r: { amountCents: number }) => acc + r.amountCents,
      0,
    );
    expect(returned).toBe(-7500); // three 2500-cent buy-ins, back to the cent
    expect(res.body.poolCents).toBe(0);
    expect(typeof res.body.cancelledAt).toBe('string');

    // The league view carries the cancellation — the lobby and the books can see it.
    const view = await request(world.app).get('/api/leagues');
    const league = view.body.leagues.find((l: { id: string }) => l.id === world.leagueId);
    expect(league.cancelledAt).toBe(res.body.cancelledAt);
  });

  it('keeps the books readable after cancellation', async () => {
    const world = await paidLeague(3);
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/cancel`);
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/ledger`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(3 + 3); // three buy-ins, three refunds
    expect(res.body.poolCents).toBe(0);
    expect(res.body.seats.map((s: { paidCents: number }) => s.paidCents)).toStrictEqual([0, 0, 0]);
  });

  it('honours an earlier partial refund — only remaining nets go back', async () => {
    const world = await paidLeague(3);
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/ledger/refund`).send({
      managerId: world.managerIds[1],
    });
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/cancel`);
    expect(res.status).toBe(201);
    expect(res.body.refunds).toHaveLength(2); // the refunded seat's net is already zero
    const returned = res.body.refunds.reduce(
      (acc: number, r: { amountCents: number }) => acc + r.amountCents,
      0,
    );
    expect(returned).toBe(-5000);
  });

  it('refuses a second cancellation', async () => {
    const world = await paidLeague(3);
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/cancel`);
    const res = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/cancel`);
    expectApiError(res, 409, 'already-cancelled');
  });

  it('refuses joins and payments on a voided league', async () => {
    const world = await paidLeague(3);
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/cancel`);
    const newcomer = await signIn(world.app, 9);
    const join = await newcomer.post(`/api/leagues/${world.leagueId}/join`);
    expectApiError(join, 409, 'league-cancelled');
    const pay = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/pay`);
    expectApiError(pay, 409, 'league-cancelled');
  });
});
