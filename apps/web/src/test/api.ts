import { vi } from 'vitest';
import type { StakehouseClient } from '@stakehouse/api-client';
import { OPEN_LEAGUE_VIEW, SANDBOX_LEAGUE_VIEW, SANDBOX_LEDGER_VIEW } from './fixtures';

/**
 * A full StakehouseClient double for route-level tests. Every method is a vi.fn
 * returning sensible seed data; tests override the methods they care about.
 */
export function makeFakeApi(
  overrides: Partial<Record<keyof StakehouseClient, unknown>> = {},
): StakehouseClient {
  const base: Record<keyof StakehouseClient, unknown> = {
    signIn: vi.fn().mockResolvedValue({
      displayName: 'Marge Kowalski',
      email: 'marge@example.com',
    }),
    listLeagues: vi.fn().mockResolvedValue([SANDBOX_LEAGUE_VIEW, OPEN_LEAGUE_VIEW]),
    createLeague: vi.fn().mockResolvedValue(OPEN_LEAGUE_VIEW),
    joinLeague: vi.fn().mockResolvedValue({
      id: 'mgr-marge',
      displayName: 'Marge Kowalski',
      isAi: false,
      joinedAt: '2026-10-01T12:00:00.000Z',
    }),
    payBuyIn: vi.fn().mockResolvedValue({
      simulated: true,
      entry: {
        id: 'led-new',
        kind: 'buy-in',
        managerId: 'mgr-marge',
        amountCents: 2500,
        memo: 'simulated buy-in — demo checkout, no real money changes hands',
        at: '2026-10-02T12:00:00.000Z',
      },
      poolCents: 2500,
    }),
    getLedger: vi.fn().mockResolvedValue(SANDBOX_LEDGER_VIEW),
  };
  for (const [key, value] of Object.entries(overrides)) {
    base[key as keyof StakehouseClient] = value;
  }
  return base as unknown as StakehouseClient;
}

/** Convenience: an api whose listLeagues rejects with the given error. */
export function apiFailingOnList(error: unknown): StakehouseClient {
  return makeFakeApi({ listLeagues: vi.fn().mockRejectedValue(error) });
}
