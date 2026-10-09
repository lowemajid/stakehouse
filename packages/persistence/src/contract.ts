import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPick,
  cents,
  createDraft,
  leagueId,
  managerId,
  poolBalance,
  startDraft,
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
 * be a StakehouseStore. The in-memory fakes satisfy it, the better-sqlite3
 * adapter satisfies it, and any future JSON-file fallback satisfies it — so a
 * backend swap never changes what the domain and server can rely on.
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

const LG = leagueId('lg-contract');
const T0 = '2026-10-01T12:00:00.000Z';

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

function manager(league: string, id: string, isAi = false): ManagerRecord {
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
function draftState(): DraftState {
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

function playerCard(id: string, position: Position = 'QB'): PlayerCard {
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

function weekResult(week: number): WeekResult {
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
              stats: playerCard('p-1').projection,
              points: 18.2,
            },
          ],
        },
        awayBox: { managerId: managerId('mgr-2'), total: 87.01, lines: [] },
      },
    ],
  };
}

function seasonResult(): SeasonResult {
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
function seedEverything(store: StakehouseStore): void {
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

export function runRepositoryContract(factory: StoreFactory): void {
  describe(`repository contract — ${factory.name}`, () => {
    let store: StakehouseStore;
    beforeEach(() => {
      store = factory.create();
    });
    afterEach(() => {
      store?.close();
    });

    describe('league repository', () => {
      it('round-trips a league record exactly — config, schedule, creation instant', () => {
        const record = leagueRecord('lg-a', {
          config: config({ entryFeeCents: cents(123_457) }),
        });
        store.leagues.create(record);
        expect(store.leagues.get(record.id)).toStrictEqual(record);
      });

      it('returns null for an unknown league id', () => {
        expect(store.leagues.get(leagueId('lg-nope'))).toBeNull();
      });

      it('lists leagues in creation order', () => {
        store.leagues.create(leagueRecord('lg-b'));
        store.leagues.create(leagueRecord('lg-a'));
        expect(store.leagues.list().map((record) => record.id)).toStrictEqual([
          leagueId('lg-b'),
          leagueId('lg-a'),
        ]);
      });

      it('rejects a duplicate league id', () => {
        store.leagues.create(leagueRecord('lg-dup'));
        expect(() => store.leagues.create(leagueRecord('lg-dup'))).toThrow(/already exists/);
      });
    });

    describe('manager repository', () => {
      it('seats managers in join order, human and AI alike', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        store.managers.add(manager('lg-contract', 'mgr-2', true));
        store.managers.add(manager('lg-contract', 'mgr-1'));
        expect(store.managers.list(LG)).toStrictEqual([
          manager('lg-contract', 'mgr-2', true),
          manager('lg-contract', 'mgr-1'),
        ]);
      });

      it('keeps manager lists isolated per league', () => {
        store.leagues.create(leagueRecord('lg-a'));
        store.leagues.create(leagueRecord('lg-b'));
        store.managers.add(manager('lg-a', 'mgr-1'));
        store.managers.add(manager('lg-b', 'mgr-1'));
        expect(store.managers.list(leagueId('lg-a')).map((m) => m.leagueId)).toStrictEqual([
          leagueId('lg-a'),
        ]);
        expect(store.managers.list(leagueId('lg-b')).map((m) => m.leagueId)).toStrictEqual([
          leagueId('lg-b'),
        ]);
      });

      it('rejects a duplicate seat within a league but allows it across leagues', () => {
        store.leagues.create(leagueRecord('lg-a'));
        store.leagues.create(leagueRecord('lg-b'));
        store.managers.add(manager('lg-a', 'mgr-1'));
        expect(() => store.managers.add(manager('lg-a', 'mgr-1'))).toThrow(/already exists/);
        store.managers.add(manager('lg-b', 'mgr-1'));
        expect(store.managers.list(leagueId('lg-b'))).toHaveLength(1);
      });

      it('rejects a manager for an unknown league', () => {
        expect(() => store.managers.add(manager('lg-none', 'mgr-1'))).toThrow(/unknown league/);
      });
    });

    describe('ledger repository', () => {
      it('appends and lists entries in order, exact to the cent', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        store.ledger.append(LG, LEDGER_SEED);
        expect(store.ledger.list(LG)).toStrictEqual(LEDGER_SEED);
      });

      it('derives the pool balance from reloaded entries', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        store.ledger.append(LG, LEDGER_SEED);
        // 2500 + 2501 + 500 − 4501 = 1000 — the balance is derived, never stored.
        expect(poolBalance(store.ledger.list(LG))).toBe(cents(10_00));
      });

      it('appends are additive — history is never rewritten', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        store.ledger.append(LG, [LEDGER_SEED[0]!]);
        store.ledger.append(LG, [ledgerEntry('entry-1', 'refund', managerId('mgr-1'), -25_00)]);
        const list = store.ledger.list(LG);
        expect(list.map((e) => e.id)).toStrictEqual(['entry-0', 'entry-1']);
        expect(list[0]!.amountCents).toBe(cents(25_00));
      });

      it('rejects a duplicate entry id within a league', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        store.ledger.append(LG, [LEDGER_SEED[0]!]);
        expect(() => store.ledger.append(LG, [LEDGER_SEED[0]!])).toThrow(/already exists/);
      });

      it('rejects entries for an unknown league', () => {
        expect(() => store.ledger.append(leagueId('lg-none'), LEDGER_SEED)).toThrow(
          /unknown league/,
        );
      });
    });

    describe('draft repository', () => {
      it('round-trips draft state bit-for-bit', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        const state = draftState();
        store.drafts.save(LG, state);
        const reloaded = store.drafts.get(LG)!;
        expect(reloaded).toStrictEqual(state);
        expect(JSON.stringify(reloaded)).toStrictEqual(JSON.stringify(state));
      });

      it('returns null before any draft exists', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        expect(store.drafts.get(LG)).toBeNull();
      });

      it('keeps the latest save — a progressing draft overwrites', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        const state = draftState();
        store.drafts.save(LG, state);
        const result = applyPick(state, { managerId: managerId('mgr-2'), playerId: 'p-2' }, 3_000);
        if (!result.ok) throw new Error('fixture draft pick must succeed');
        store.drafts.save(LG, result.next);
        expect(store.drafts.get(LG)!.picks).toHaveLength(2);
      });

      it('snapshots at save — later caller mutations do not leak into storage', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        const state = draftState();
        store.drafts.save(LG, state);
        state.picks.push({ overall: 99, managerId: managerId('mgr-x'), playerId: 'p-9', at: T0 });
        expect(store.drafts.get(LG)!.picks).toHaveLength(1);
      });

      it('rejects a draft for an unknown league', () => {
        expect(() => store.drafts.save(leagueId('lg-none'), draftState())).toThrow(
          /unknown league/,
        );
      });
    });

    describe('player repository', () => {
      it('upserts and lists the player universe', () => {
        store.players.upsert(playerCard('p-1'));
        store.players.upsert(playerCard('p-5', 'WR'));
        expect(store.players.all()).toStrictEqual([playerCard('p-1'), playerCard('p-5', 'WR')]);
        expect(store.players.get('p-5')).toStrictEqual(playerCard('p-5', 'WR'));
      });

      it('overwrites on upsert and returns null for unknown ids', () => {
        store.players.upsert(playerCard('p-1', 'QB'));
        store.players.upsert(playerCard('p-1', 'RB'));
        expect(store.players.get('p-1')!.position).toBe('RB');
        expect(store.players.get('p-nope')).toBeNull();
      });
    });

    describe('season repository', () => {
      it('stores weeks and lists them in ascending order regardless of save order', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        store.seasons.saveWeek(LG, weekResult(2));
        store.seasons.saveWeek(LG, weekResult(1));
        expect(store.seasons.listWeeks(LG).map((w) => w.week)).toStrictEqual([1, 2]);
      });

      it('replaces a re-saved week', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        store.seasons.saveWeek(LG, weekResult(1));
        const revised = weekResult(1);
        revised.games[0]!.homeBox.total = 99.5;
        store.seasons.saveWeek(LG, revised);
        const weeks = store.seasons.listWeeks(LG);
        expect(weeks).toHaveLength(1);
        expect(weeks[0]).toStrictEqual(revised);
      });

      it('round-trips the season result and returns null when none exists', () => {
        store.leagues.create(leagueRecord('lg-contract'));
        expect(store.seasons.getSeason(LG)).toBeNull();
        const result = seasonResult();
        store.seasons.saveSeason(LG, result);
        expect(store.seasons.getSeason(LG)).toStrictEqual(result);
      });

      it('rejects results for an unknown league', () => {
        expect(() => store.seasons.saveWeek(leagueId('lg-none'), weekResult(1))).toThrow(
          /unknown league/,
        );
        expect(() => store.seasons.saveSeason(leagueId('lg-none'), seasonResult())).toThrow(
          /unknown league/,
        );
      });
    });

    if (factory.reopen) {
      const reopen = factory.reopen;
      describe('restart durability — close then reopen', () => {
        it('survives an adapter restart with identical state', () => {
          seedEverything(store);
          const snapshot = {
            league: store.leagues.get(LG)!,
            managers: store.managers.list(LG),
            ledger: store.ledger.list(LG),
            draft: store.drafts.get(LG)!,
            player: store.players.get('p-1')!,
            weeks: store.seasons.listWeeks(LG),
            season: store.seasons.getSeason(LG)!,
          };
          store.close();
          const reopened = reopen(store);
          store = reopened;
          expect(reopened.leagues.get(LG)).toStrictEqual(snapshot.league);
          expect(reopened.managers.list(LG)).toStrictEqual(snapshot.managers);
          expect(reopened.ledger.list(LG)).toStrictEqual(snapshot.ledger);
          expect(reopened.drafts.get(LG)).toStrictEqual(snapshot.draft);
          expect(reopened.players.get('p-1')).toStrictEqual(snapshot.player);
          expect(reopened.seasons.listWeeks(LG)).toStrictEqual(snapshot.weeks);
          expect(reopened.seasons.getSeason(LG)).toStrictEqual(snapshot.season);
          expect(poolBalance(reopened.ledger.list(LG))).toBe(cents(10_00));
        });
      });
    }
  });
}
