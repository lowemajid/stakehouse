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
  // Route tests override what they care about; these defaults only need to be
  // structurally honest for methods no current test exercises.
  const draftView = {
    status: 'complete',
    order: ['mgr-marge'],
    picks: [],
    pickSeconds: 30,
    board: [],
    clock: { overall: 0, managerId: null, deadline: null },
    rosters: {},
    queues: {},
    seats: [],
  };
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
    getDraft: vi.fn().mockResolvedValue(draftView),
    startDraft: vi.fn().mockResolvedValue(draftView),
    postPick: vi.fn().mockResolvedValue({
      pick: {
        overall: 1,
        managerId: 'mgr-marge',
        playerId: 'p-01',
        at: '2026-10-02T12:00:00.000Z',
      },
      draft: draftView,
    }),
    putQueue: vi
      .fn()
      .mockImplementation((_leagueId: string, queue: string[]) => Promise.resolve({ queue })),
    postAutopick: vi.fn().mockResolvedValue({
      autopicked: {
        overall: 1,
        managerId: 'mgr-marge',
        playerId: 'p-01',
        at: '2026-10-02T12:00:00.000Z',
      },
      draft: draftView,
    }),
    postFastForward: vi.fn().mockResolvedValue({ fastForwarded: 0, draft: draftView }),
    listPlayers: vi.fn().mockResolvedValue([]),
    simulateNextWeek: vi.fn().mockResolvedValue({ week: 1, seasonComplete: false }),
    openDraftStream: vi.fn().mockReturnValue({ close: vi.fn() }),
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
