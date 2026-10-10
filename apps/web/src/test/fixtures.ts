import { cents } from '@stakehouse/domain';
import type { LeagueView, StakehouseClient } from '@stakehouse/api-client';

/** Wire-shape fixtures matching the seeder's sandbox league, for UI tests. */

export const SANDBOX_LEAGUE_VIEW: LeagueView = {
  id: 'lg-sandbox',
  name: 'The Stakehouse Sandbox',
  createdAt: '2026-08-30T12:00:00.000Z',
  commissionerEmail: null, // seeded, not created through the API — no commissioner at runtime
  cancelledAt: null,
  config: {
    name: 'The Stakehouse Sandbox',
    entryFeeCents: cents(2500),
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

type LedgerView = Awaited<ReturnType<StakehouseClient['getLedger']>>;

export const SANDBOX_LEDGER_VIEW: LedgerView = {
  entries: [
    {
      id: 'led-1',
      kind: 'buy-in',
      managerId: 'mgr-marge',
      amountCents: 2500,
      memo: 'simulated buy-in — demo checkout, no real money changes hands',
      at: '2026-10-01T12:00:00.000Z',
      balanceAfterCents: 2500,
    },
  ],
  poolCents: 2500,
  seats: [
    { id: 'mgr-marge', displayName: 'Marge Kowalski', paidCents: 2500 },
    { id: 'mgr-norm', displayName: 'Norm Grimsby', paidCents: 0 },
  ],
};

/** A second fixture league with an open seat, for join/pay flows. */
export const OPEN_LEAGUE_VIEW: LeagueView = {
  id: 'lg-open',
  name: 'Tuesday Night Kitchen League',
  createdAt: '2026-10-02T12:00:00.000Z',
  commissionerEmail: 'marge@example.com', // the test session's email — the desk is theirs
  cancelledAt: null,
  config: {
    name: 'Tuesday Night Kitchen League',
    entryFeeCents: cents(5000), // distinct from the sandbox card so lobby assertions stay unambiguous
    size: 8,
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    scoring: {
      passYards: 0.04,
      passTd: 4,
      interception: -2,
      rushYards: 0.1,
      rushTd: 6,
      reception: 0,
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
  seatsFilled: 1,
  poolCents: 0,
};
