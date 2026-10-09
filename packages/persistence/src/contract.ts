import {
  cents,
  createDraft,
  leagueId,
  managerId,
  applyPick,
  startDraft,
  zeroStatLine,
} from '@stakehouse/domain';
import type {
  DraftState,
  LedgerEntry,
  LedgerKind,
  LeagueConfig,
  Position,
  PlayerCard,
  ScoringRules,
  SeasonResult,
  WeekResult,
} from '@stakehouse/domain';
import type { LeagueRecord, ManagerRecord, StakehouseStore } from './types';

/**
 * The repository contract: ONE suite, run against every backend that claims to
 * be a StakehouseStore (see repositoryContract.ts — kept out of this module so
 * importing @stakehouse/persistence in production never loads vitest). The
 * in-memory fakes satisfy it, the better-sqlite3 adapter satisfies it, and any
 * future JSON-file fallback satisfies it — so a backend swap never changes
 * what the domain and server can rely on.
 *
 * Error semantics are part of the contract, expressed as message classes:
 * duplicate identity throws /already exists/, dangling references throw
 * /unknown league/. Storage never reads a clock — fixtures supply instants.
 */
export interface StoreFactory {
  /** Human label for test output — e.g. "in-memory fakes", "better-sqlite3 adapter". */
  readonly name: string;
  /** A fresh, empty store backed by its own space (map, file, schema). */
  create(): StakehouseStore;
  /**
   * Open the SAME backing storage after `closed.close()`. The durability gate:
   * when a factory cannot survive a restart (pure in-memory), it omits this
   * and the contract skips the restart block.
   */
  reopen?(closed: StakehouseStore): StakehouseStore;
}

export const LG = leagueId('lg-contract');
export const T0 = '2026-10-01T12:00:00.000Z';

const SCORING: ScoringRules = {
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

function config(overrides: Partial<LeagueConfig> = {}): LeagueConfig {
  return {
    name: 'Contract League',
    entryFeeCents: cents(25_00),
    size: 4,
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    scoring: SCORING,
    regularSeasonWeeks: 10,
    playoffTeams: 4,
    payoutSplitPct: [50, 30, 20],
    ...overrides,
  };
}

/** Fixtures shared with backend-specific test files, so guarantee tests build
 * records the same way the contract itself does. */
export function leagueRecord(id: string, overrides: Partial<LeagueRecord> = {}): LeagueRecord {
  return {
    id: leagueId(id),
    config: config(),
    schedule: {
      weeks: [{ week: 1, matchups: [{ home: managerId('mgr-1'), away: managerId('mgr-2') }] }],
    },
    createdAt: T0,
    ...overrides,
  };
}

export function manager(league: string, id: string, isAi = false): ManagerRecord {
  return {
    id: managerId(id),
    leagueId: leagueId(league),
    displayName: id,
    isAi,
    joinedAt: T0,
  };
}

const SLOTS = { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 1, K: 0, DEF: 0 } as const;

const BOARD = [
  { playerId: 'p-1', position: 'QB' },
  { playerId: 'p-2', position: 'QB' },
  { playerId: 'p-3', position: 'RB' },
  { playerId: 'p-4', position: 'RB' },
  { playerId: 'p-5', position: 'WR' },
  { playerId: 'p-6', position: 'WR' },
  { playerId: 'p-7', position: 'TE' },
  { playerId: 'p-8', position: 'K' },
  { playerId: 'p-9', position: 'DEF' },
  { playerId: 'p-10', position: 'RB' },
] as const;

/** A live, one-pick-in draft state — built by the real engine, not by hand. */
export function draftState(): DraftState {
  const started = startDraft(
    createDraft({
      order: [managerId('mgr-1'), managerId('mgr-2')],
      slots: SLOTS,
      pickSeconds: 60,
      board: BOARD,
    }),
    1_000,
  );
  const result = applyPick(started, { managerId: managerId('mgr-1'), playerId: 'p-1' }, 2_000);
  if (!result.ok) throw new Error('fixture draft pick must succeed');
  return result.next;
}

export function playerCard(id: string, position: Position = 'QB'): PlayerCard {
  return {
    id,
    name: `Player ${id}`,
    position,
    projection: {
      passYards: 250,
      passTd: 2,
      interceptions: 1,
      rushYards: 10,
      rushTd: 0,
      receptions: 0,
      fumblesLost: 0,
      fgMade: {},
      extraPointsMade: 0,
      sacks: 0,
      takeaways: 0,
      defensiveTd: 0,
      pointsAllowed: 24,
    },
    variance: 0.12,
  };
}

export function ledgerEntry(
  id: string,
  kind: LedgerKind,
  managerIdOrNull: ManagerRecord['id'] | null,
  amount: number,
  memo: string = kind,
): LedgerEntry {
  return {
    id,
    leagueId: LG,
    kind,
    managerId: managerIdOrNull,
    amountCents: cents(amount),
    memo,
    at: T0,
  };
}

const LEDGER_SEED: readonly LedgerEntry[] = [
  ledgerEntry('entry-0', 'buy-in', managerId('mgr-1'), 25_00, 'buy-in mgr-1'),
  ledgerEntry('entry-1', 'buy-in', managerId('mgr-2'), 25_01, 'buy-in mgr-2'),
  ledgerEntry('entry-2', 'commissioner-credit', null, 5_00, 'promo credit'),
  ledgerEntry('entry-3', 'payout', managerId('mgr-2'), -45_01, 'first place'),
];

export { LEDGER_SEED };

export function weekResult(week: number): WeekResult {
  return {
    week,
    games: [
      {
        home: managerId('mgr-1'),
        away: managerId('mgr-2'),
        homeBox: {
          managerId: managerId('mgr-1'),
          total: 92.34,
          lines: [
            {
              playerId: 'p-1',
              name: 'Player p-1',
              position: 'QB',
              slot: 'QB',
              stats: {
                ...zeroStatLine(),
                passYards: 250,
                passTd: 2,
                interceptions: 1,
                rushYards: 10,
                pointsAllowed: 24,
              },
              points: 18.2,
            },
          ],
        },
        awayBox: { managerId: managerId('mgr-2'), total: 87.01, lines: [] },
      },
    ],
  };
}

export function seasonResult(): SeasonResult {
  return {
    weeks: [weekResult(1), weekResult(2)],
    standings: [
      {
        managerId: managerId('mgr-1'),
        wins: 2,
        losses: 0,
        ties: 0,
        pointsFor: 184.68,
        pointsAgainst: 174.02,
      },
    ],
    bracket: [],
    results: [],
    champion: managerId('mgr-1'),
  };
}

/** One of everything, for the restart-durability gate. */
export function seedEverything(store: StakehouseStore): void {
  store.leagues.create(leagueRecord('lg-contract'));
  store.managers.add(manager('lg-contract', 'mgr-1'));
  store.managers.add(manager('lg-contract', 'mgr-2', true));
  store.ledger.append(LG, LEDGER_SEED);
  store.drafts.save(LG, draftState());
  store.players.upsert(playerCard('p-1'));
  store.players.upsert(playerCard('p-5', 'WR'));
  store.seasons.saveWeek(LG, weekResult(1));
  store.seasons.saveWeek(LG, weekResult(2));
  store.seasons.saveSeason(LG, seasonResult());
}
