import { vi } from 'vitest';
import type { StakehouseApi } from '@stakehouse/api-client';
import { SANDBOX_LEAGUE_VIEW } from './fixtures';

/**
 * A full StakehouseApi double for route-level tests. Every method is a vi.fn
 * returning sensible seed data; tests override the methods they care about.
 */
export function makeFakeApi(
  overrides: Partial<Record<keyof StakehouseApi, unknown>> = {},
): StakehouseApi {
  const base: Record<keyof StakehouseApi, unknown> = {
    createSession: vi.fn().mockResolvedValue({
      displayName: 'Marge Kowalski',
      email: 'marge@example.com',
    }),
    listLeagues: vi.fn().mockResolvedValue([SANDBOX_LEAGUE_VIEW]),
    createLeague: vi.fn().mockResolvedValue(SANDBOX_LEAGUE_VIEW),
    joinLeague: vi.fn().mockResolvedValue({
      id: 'mgr-marge',
      displayName: 'Marge Kowalski',
      isAi: false,
      joinedAt: '2026-10-01T12:00:00.000Z',
    }),
    payBuyIn: vi.fn().mockResolvedValue({
      simulated: true,
      entry: {
        id: 'led-1',
        kind: 'buy-in',
        managerId: 'mgr-marge',
        amountCents: 2500,
        memo: 'simulated buy-in — demo checkout, no real money changes hands',
        at: '2026-10-01T12:00:00.000Z',
      },
      poolCents: 22500,
    }),
    getLedger: vi.fn().mockResolvedValue({ entries: [], poolCents: 20000 }),
  };
  for (const [key, value] of Object.entries(overrides)) {
    base[key as keyof StakehouseApi] = value;
  }
  return base as unknown as StakehouseApi;
}

/** Convenience: an api whose listLeagues rejects with the given error. */
export function apiFailingOnList(error: unknown): StakehouseApi {
  return makeFakeApi({ listLeagues: vi.fn().mockRejectedValue(error) });
}
