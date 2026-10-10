import { cents, leagueConfigSchema } from '@stakehouse/domain';
import type { LeagueConfig } from '@stakehouse/domain';
import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import { ApiError, createClient } from './index';
import type { ClientOptions } from './index';

/**
 * Contract tests: every method's URL, method, body, and response schema is
 * pinned against the shapes the server actually sends (apps/web/src/server).
 * The fetch implementation is injected, so these run without a server —
 * they guard the boundary, not the transport.
 */

interface RecordedCall {
  url: string;
  init: RequestInit;
}

interface QueuedResponse {
  status: number;
  body: unknown;
}

function clientWithResponses(
  responses: QueuedResponse[],
  options: ClientOptions = {},
): {
  client: ReturnType<typeof createClient>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('test bug: no queued response for this call');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { client: createClient({ ...options, fetchImpl }), calls };
}

function ok(body: unknown): QueuedResponse {
  return { status: 200, body };
}

function validConfig(): LeagueConfig {
  return leagueConfigSchema.parse({
    name: 'Tuesday Seats',
    entryFeeCents: 2500,
    size: 8,
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    scoring: {
      passYards: 0.04,
      passTd: 4,
      interception: -2,
      rushYards: 0.1,
      rushTd: 6,
      reception: 0.5,
      fumbleLost: -2,
      kicking: {
        fg: { '0-19': 3, '20-29': 3, '30-39': 4, '40-49': 5, '50+': 6 },
        extraPoint: 1,
      },
      defense: {
        sack: 1,
        takeaway: 2,
        td: 6,
        pointsAllowedBands: [
          [0, 12],
          [6, 7],
          [13, 4],
          [20, 1],
          [27, 0],
          [34, -1],
        ],
      },
    },
    regularSeasonWeeks: 10,
    playoffTeams: 4,
    payoutSplitPct: [50, 30, 20],
  });
}

function leagueViewFixture(config: LeagueConfig): object {
  return {
    id: 'lg-1',
    name: 'Tuesday Seats',
    createdAt: '2026-10-09T12:00:00.000Z',
    config,
    seatsFilled: 3,
    poolCents: 7500,
    commissionerEmail: 'majid@stakehouse.test',
    cancelledAt: null,
  };
}

const entryFixture = {
  id: 'le-1',
  kind: 'buy-in',
  managerId: 'mgr-majid',
  amountCents: 2500,
  memo: 'simulated buy-in — demo checkout, no real money changes hands',
  at: '2026-10-09T12:00:00.000Z',
};

describe('signIn', () => {
  it('posts trimmed credentials to /api/session with cookies included', async () => {
    const { client, calls } = clientWithResponses([
      ok({ user: { displayName: 'Majid', email: 'majid@stakehouse.test' } }),
    ]);
    const user = await client.signIn({ displayName: '  Majid  ', email: 'majid@stakehouse.test' });
    expect(user).toEqual({ displayName: 'Majid', email: 'majid@stakehouse.test' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/session');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('include');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      displayName: 'Majid',
      email: 'majid@stakehouse.test',
    });
  });

  it('rejects input the server would reject before any network call', async () => {
    const { client, calls } = clientWithResponses([]);
    await expect(client.signIn({ displayName: '', email: 'not-an-email' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('listLeagues', () => {
  it('parses the lobby view', async () => {
    const config = validConfig();
    const { client } = clientWithResponses([ok({ leagues: [leagueViewFixture(config)] })]);
    const leagues = await client.listLeagues();
    expect(leagues).toHaveLength(1);
    expect(leagues[0]).toMatchObject({ id: 'lg-1', seatsFilled: 3, poolCents: 7500 });
    expect(leagues[0]!.config.payoutSplitPct).toEqual([50, 30, 20]);
  });
});

describe('createLeague', () => {
  it('posts the config and parses the created league', async () => {
    const config = validConfig();
    const { client, calls } = clientWithResponses([
      { status: 201, body: { league: leagueViewFixture(config) } },
    ]);
    const league = await client.createLeague(config);
    expect(league.id).toBe('lg-1');
    expect(calls[0]!.url).toBe('/api/leagues');
    expect(JSON.parse(String(calls[0]!.init.body)).entryFeeCents).toBe(2500);
  });

  it('validates the config locally and never touches the network on garbage', async () => {
    const { client, calls } = clientWithResponses([]);
    const bad = { ...validConfig(), payoutSplitPct: [60, 60, 20] } as LeagueConfig;
    await expect(client.createLeague(bad)).rejects.toBeInstanceOf(ZodError);
    expect(calls).toHaveLength(0);
  });
});

describe('joinLeague', () => {
  it('posts to the join route and returns the manager', async () => {
    const { client, calls } = clientWithResponses([
      {
        status: 201,
        body: {
          manager: {
            id: 'mgr-majid',
            displayName: 'Majid',
            isAi: false,
            joinedAt: '2026-10-09T12:00:00.000Z',
          },
        },
      },
    ]);
    const manager = await client.joinLeague('lg-1');
    expect(manager.id).toBe('mgr-majid');
    expect(manager.isAi).toBe(false);
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/join');
    expect(calls[0]!.init.method).toBe('POST');
  });
});

describe('payBuyIn', () => {
  it('returns the simulated receipt and the new pool', async () => {
    const { client, calls } = clientWithResponses([
      { status: 201, body: { simulated: true, entry: entryFixture, poolCents: 5000 } },
    ]);
    const result = await client.payBuyIn('lg-1');
    expect(result.simulated).toBe(true);
    expect(result.entry.amountCents).toBe(2500);
    expect(result.poolCents).toBe(5000);
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/pay');
  });

  it('refuses a response that stops admitting the checkout is simulated', async () => {
    const { client } = clientWithResponses([
      { status: 201, body: { simulated: false, entry: entryFixture, poolCents: 5000 } },
    ]);
    await expect(client.payBuyIn('lg-1')).rejects.toMatchObject({ code: 'invalid-response' });
  });
});

describe('getLedger', () => {
  it('parses entries, the derived pool, and the seats', async () => {
    const { client, calls } = clientWithResponses([
      ok({
        entries: [{ ...entryFixture, balanceAfterCents: 2500 }],
        poolCents: 2500,
        seats: [{ id: 'mgr-majid', displayName: 'Majid', paidCents: 2500 }],
      }),
    ]);
    const ledger = await client.getLedger('lg-1');
    expect(ledger.poolCents).toBe(2500);
    expect(ledger.entries[0]!.kind).toBe('buy-in');
    expect(ledger.entries[0]!.balanceAfterCents).toBe(2500);
    expect(ledger.seats).toEqual([{ id: 'mgr-majid', displayName: 'Majid', paidCents: 2500 }]);
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/ledger');
  });
});

describe('creditPool', () => {
  it('posts the amount and memo, returning the entry and the new pool', async () => {
    const { client, calls } = clientWithResponses([
      {
        status: 201,
        body: {
          entry: {
            ...entryFixture,
            kind: 'commissioner-credit',
            managerId: null,
            amountCents: 500,
          },
          poolCents: 10_500,
        },
      },
    ]);
    const result = await client.creditPool('lg-1', {
      amountCents: 500,
      memo: 'commissioner promo',
    });
    expect(result.entry.kind).toBe('commissioner-credit');
    expect(result.entry.managerId).toBeNull();
    expect(result.poolCents).toBe(10_500);
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/ledger/credit');
    expect(JSON.parse(String(calls[0]!.init.body))).toStrictEqual({
      amountCents: 500,
      memo: 'commissioner promo',
    });
  });

  it('rejects non-positive amounts locally — no request is made', async () => {
    const { client, calls } = clientWithResponses([]);
    await expect(client.creditPool('lg-1', { amountCents: 0 })).rejects.toBeInstanceOf(ZodError);
    expect(calls).toHaveLength(0);
  });
});

describe('refundSeat', () => {
  it('posts the seat id, returning the negative entry and the new pool', async () => {
    const { client, calls } = clientWithResponses([
      {
        status: 201,
        body: {
          entry: { ...entryFixture, kind: 'refund', managerId: 'mgr-majid', amountCents: -2500 },
          poolCents: 7500,
        },
      },
    ]);
    const result = await client.refundSeat('lg-1', 'mgr-majid');
    expect(result.entry.kind).toBe('refund');
    expect(result.entry.amountCents).toBe(-2500);
    expect(result.poolCents).toBe(7500);
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/ledger/refund');
    expect(JSON.parse(String(calls[0]!.init.body))).toStrictEqual({ managerId: 'mgr-majid' });
  });
});

describe('cancelLeague', () => {
  it('posts the cancellation, returning refunds, the emptied pool, and the timestamp', async () => {
    const { client, calls } = clientWithResponses([
      {
        status: 201,
        body: {
          refunds: [
            { ...entryFixture, kind: 'refund', managerId: 'mgr-majid', amountCents: -2500 },
          ],
          poolCents: 0,
          cancelledAt: '2026-10-09T12:00:00.000Z',
        },
      },
    ]);
    const result = await client.cancelLeague('lg-1');
    expect(result.refunds).toHaveLength(1);
    expect(result.poolCents).toBe(0);
    expect(result.cancelledAt).toBe('2026-10-09T12:00:00.000Z');
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/cancel');
    expect(calls[0]!.init.method).toBe('POST');
  });
});

describe('distributePayouts', () => {
  it('posts the distribution, returning the payout entries and the emptied pool', async () => {
    const { client, calls } = clientWithResponses([
      {
        status: 201,
        body: {
          entries: [
            {
              ...entryFixture,
              kind: 'payout',
              managerId: 'mgr-majid',
              amountCents: -1250,
              memo: 'season payout — 1st place',
            },
            {
              ...entryFixture,
              kind: 'payout',
              managerId: 'mgr-norm',
              amountCents: -750,
              memo: 'season payout — 2nd place',
            },
            {
              ...entryFixture,
              kind: 'payout',
              managerId: 'mgr-doris',
              amountCents: -500,
              memo: 'season payout — 3rd place',
            },
          ],
          poolCents: 0,
        },
      },
    ]);
    const result = await client.distributePayouts('lg-1');
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]!.kind).toBe('payout');
    expect(result.poolCents).toBe(0);
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/ledger/payouts/distribute');
    expect(calls[0]!.init.method).toBe('POST');
  });
});

describe('error handling', () => {
  it('maps the server error envelope onto ApiError with code and status', async () => {
    const { client } = clientWithResponses([
      {
        status: 401,
        body: { error: { code: 'unauthorized', message: 'sign in before calling this route' } },
      },
    ]);
    const error = await client.listLeagues().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('carries validation details through', async () => {
    const { client } = clientWithResponses([
      {
        status: 400,
        body: {
          error: {
            code: 'validation-error',
            message: 'request failed schema validation',
            details: [{ path: 'payoutSplitPct', message: 'must total exactly 100' }],
          },
        },
      },
    ]);
    const error = await client.listLeagues().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details).toEqual([
      { path: 'payoutSplitPct', message: 'must total exactly 100' },
    ]);
  });

  it('wraps network failures as ApiError network-error', async () => {
    const failing = (async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = createClient({ fetchImpl: failing });
    const error = await client.listLeagues().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'network-error' });
  });
});

describe('baseUrl', () => {
  it('prepends the configured base to every path', async () => {
    const { client, calls } = clientWithResponses([ok({ leagues: [] })], {
      baseUrl: 'http://localhost:3000',
    });
    await client.listLeagues();
    expect(calls[0]!.url).toBe('http://localhost:3000/api/leagues');
  });
});

describe('money stays integer cents', () => {
  it('round-trips a cents value through the client without float drift', async () => {
    const config = validConfig();
    const view = { ...leagueViewFixture(config), poolCents: cents(1042) };
    const { client } = clientWithResponses([ok({ leagues: [view] })]);
    const [league] = await client.listLeagues();
    expect(league!.poolCents).toBe(1042);
  });
});

/** A live draft view in the exact shape the server's buildDraftView emits. */
function draftViewFixture(status: 'pending' | 'live' | 'complete'): object {
  return {
    status,
    order: ['mgr-marge', 'mgr-ai-1'],
    picks:
      status === 'pending'
        ? []
        : [
            {
              overall: 1,
              managerId: 'mgr-marge',
              playerId: 'p-0',
              at: '2026-10-09T12:01:00.000Z',
            },
          ],
    pickSeconds: 30,
    board: [
      { playerId: 'p-1', position: 'QB', name: 'Dov Amado', projectedPoints: 312.4 },
      { playerId: 'p-2', position: 'RB', name: 'Silas Brummell', projectedPoints: 244.1 },
    ],
    clock:
      status === 'live'
        ? { overall: 2, managerId: 'mgr-ai-1', deadline: 1_791_230_430_000 }
        : { overall: null, managerId: null, deadline: null },
    commissionerSeatId: 'mgr-marge',
    rosters: {
      'mgr-marge': [{ playerId: 'p-0', position: 'QB', slot: 'QB' }],
      'mgr-ai-1': [],
    },
    queues: {
      'mgr-marge': { queue: ['p-1'], autopick: true },
      'mgr-ai-1': { queue: [], autopick: true },
    },
    seats: [
      { id: 'mgr-marge', displayName: 'Marge Kowalski', isAi: false },
      { id: 'mgr-ai-1', displayName: 'Chester Royales', isAi: true },
    ],
    managers: {
      'mgr-marge': { displayName: 'Marge Kowalski', isAi: false },
      'mgr-ai-1': { displayName: 'Chester Royales', isAi: true },
    },
    players: {
      'p-0': { name: 'Marcus Idowu', position: 'QB', projectedPoints: 318.2 },
      'p-1': { name: 'Dov Amado', position: 'QB', projectedPoints: 312.4 },
      'p-2': { name: 'Silas Brummell', position: 'RB', projectedPoints: 244.1 },
    },
    you: 'mgr-marge',
  };
}

describe('draft operations', () => {
  it('getDraft parses the view — the caller seat rides inside it', async () => {
    const { client, calls } = clientWithResponses([ok({ draft: draftViewFixture('live') })]);
    const result = await client.getDraft('lg-1');
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/draft');
    expect(calls[0]!.init.method).toBe('GET');
    expect(result.you).toBe('mgr-marge');
    expect(result.commissionerSeatId).toBe('mgr-marge');
    expect(result.clock.deadline).toBe(1_791_230_430_000);
    expect(result.managers['mgr-ai-1']).toEqual({
      displayName: 'Chester Royales',
      isAi: true,
    });
    expect(result.players['p-0']).toEqual({
      name: 'Marcus Idowu',
      position: 'QB',
      projectedPoints: 318.2,
    });
  });

  it('startDraft posts to /start and parses the refreshed view', async () => {
    const { client, calls } = clientWithResponses([ok({ draft: draftViewFixture('live') })]);
    const result = await client.startDraft('lg-1');
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/draft/start');
    expect(calls[0]!.init.method).toBe('POST');
    expect(result.status).toBe('live');
  });

  it('postPick posts the playerId and parses the pick plus view', async () => {
    const { client, calls } = clientWithResponses([
      ok({
        pick: {
          overall: 1,
          managerId: 'mgr-marge',
          playerId: 'p-0',
          at: '2026-10-09T12:01:00.000Z',
        },
        draft: draftViewFixture('live'),
      }),
    ]);
    const result = await client.postPick('lg-1', 'p-0');
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/draft/pick');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ playerId: 'p-0' });
    expect(result.pick.playerId).toBe('p-0');
  });

  it('putQueue puts the ordered ids', async () => {
    const { client, calls } = clientWithResponses([ok({ queue: ['p-1', 'p-2'] })]);
    const result = await client.putQueue('lg-1', ['p-1', 'p-2']);
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/draft/queue');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ queue: ['p-1', 'p-2'] });
    expect(result.queue).toEqual(['p-1', 'p-2']);
  });

  it('postAutopick parses the forced pick', async () => {
    const { client, calls } = clientWithResponses([
      ok({
        autopicked: {
          overall: 2,
          managerId: 'mgr-ai-1',
          playerId: 'p-1',
          at: '2026-10-09T12:01:30.000Z',
        },
        draft: draftViewFixture('live'),
      }),
    ]);
    const result = await client.postAutopick('lg-1');
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/draft/autopick');
    expect(calls[0]!.init.method).toBe('POST');
    expect(result.autopicked.playerId).toBe('p-1');
  });

  it('postFastForward parses the cascade count', async () => {
    const { client, calls } = clientWithResponses([
      ok({ fastForwarded: 34, draft: draftViewFixture('complete') }),
    ]);
    const result = await client.postFastForward('lg-1');
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/draft/fast-forward');
    expect(calls[0]!.init.method).toBe('POST');
    expect(result.fastForwarded).toBe(34);
    expect(result.draft.status).toBe('complete');
  });

  it('simulateNextWeek posts to /simulate and parses the week label', async () => {
    const { client, calls } = clientWithResponses([
      ok({ week: 1, seasonComplete: false, result: { week: 1 } }),
    ]);
    const result = await client.simulateNextWeek('lg-1');
    expect(calls[0]!.url).toBe('/api/leagues/lg-1/simulate');
    expect(calls[0]!.init.method).toBe('POST');
    expect(result.week).toBe(1);
    expect(result.seasonComplete).toBe(false);
  });

  it('rejects a draft view missing the managers map — the board cannot render seats without it', async () => {
    const view = draftViewFixture('pending') as Record<string, unknown>;
    delete view.managers;
    const { client } = clientWithResponses([ok({ draft: view, you: null })]);
    await expect(client.getDraft('lg-1')).rejects.toThrow(ApiError);
  });
});
