import type { LeagueView, LedgerView } from '@stakehouse/api-client';

/** Wire-shape fixtures matching the seeder's sandbox league, for UI tests. */

export const SANDBOX_LEAGUE_VIEW: LeagueView = {
  id: 'lg-sandbox',
  name: 'The Stakehouse Sandbox',
  createdAt: '2026-08-30T12:00:00.000Z',
  config: {
    name: 'The Stakehouse Sandbox',
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
      kicking: { fg: { '0-19': 3, '20-29': 3, '30-39': 4, '40-49': 5, '50+': 6 }, extraPoint: 1 },
      defense: {
        sack: 1,
        takeaway: 2,
        td: 6,
        pointsAllowedBands: [
          [0, 12],
          [6, 7],
          [13, 4],
          [20, 1],
        ],
      },
    },
    regularSeasonWeeks: 10,
    playoffTeams: 4,
    payoutSplitPct: [50, 30, 20],
  },
  seatsFilled: 8,
  poolCents: 20500,
};

export const SANDBOX_LEDGER_VIEW: LedgerView = {
  entries: [
    {
      id: 'led-1',
      kind: 'buy-in',
      managerId: 'mgr-marge',
      amountCents: 2500,
      memo: 'simulated buy-in — demo checkout, no real money changes hands',
      at: '2026-10-01T12:00:00.000Z',
    },
  ],
  poolCents: 2500,
};
