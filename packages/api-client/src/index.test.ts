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
