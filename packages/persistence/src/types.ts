import type {
  DraftState,
  LedgerEntry,
  LeagueConfig,
  LeagueId,
  ManagerId,
  PlayerCard,
  Schedule,
  SeasonResult,
  WeekResult,
} from '@stakehouse/domain';

/**
 * Persistence contracts — interfaces first, per the spec's §Persistence: the
 * SQLite adapter is the only code that knows SQL, and domain tests keep
 * running against in-memory fakes. Storage never reads a clock: every record
 * carries caller-supplied instants, so a stored league is reproducible
 * byte-for-byte.
 *
 * All operations are synchronous by design — both concrete backends
 * (better-sqlite3, the JSON-file fallback) are synchronous, and an async
 * facade here would be ceremony, not abstraction.
 */

/** A stored league: validated configuration plus its drawn schedule, if any. */
export interface LeagueRecord {
  id: LeagueId;
  config: LeagueConfig;
  /** The round-robin schedule once drawn; null until the season is set up. */
  schedule: Schedule | null;
  /** Caller-supplied ISO instant of league creation. */
  createdAt: string;
}

/** One seat in a league — human or AI; the record never distinguishes behavior. */
export interface ManagerRecord {
  id: ManagerId;
  leagueId: LeagueId;
  displayName: string;
  isAi: boolean;
  /** Caller-supplied ISO instant of joining. */
  joinedAt: string;
}

export interface LeagueRepository {
  /** Stores a new league; rejects a duplicate id. */
  create(record: LeagueRecord): void;
  /** The league record, or null when the id is unknown. */
  get(id: LeagueId): LeagueRecord | null;
  /** Every league, oldest first. */
  list(): LeagueRecord[];
}

export interface ManagerRepository {
  /** Seats a manager in a league; rejects duplicates and unknown leagues. */
  add(record: ManagerRecord): void;
  /** The league's seats in join order. */
  list(leagueId: LeagueId): ManagerRecord[];
}

export interface LedgerRepository {
  /**
   * Appends entries in order. There is deliberately no update and no delete —
   * the ledger is append-only at the interface level, and the SQLite adapter
   * enforces the same guarantee one layer further down with triggers.
   */
  append(leagueId: LeagueId, entries: readonly LedgerEntry[]): void;
  /** The full history for a league, in append order. */
  list(leagueId: LeagueId): LedgerEntry[];
}

export interface DraftRepository {
  /** Stores the draft's current state; the latest save wins. */
  save(leagueId: LeagueId, state: DraftState): void;
  /** The stored draft state, or null when the league has none. */
  get(leagueId: LeagueId): DraftState | null;
}

export interface PlayerRepository {
  /** The fictional player universe — league-independent. */
  upsert(player: PlayerCard): void;
  get(id: string): PlayerCard | null;
  all(): PlayerCard[];
}

export interface SeasonRepository {
  /** Stores one simulated week; re-saving a week replaces it. */
  saveWeek(leagueId: LeagueId, result: WeekResult): void;
  /** Simulated weeks in ascending week order. */
  listWeeks(leagueId: LeagueId): WeekResult[];
  /** Stores the season's final result; the latest save wins. */
  saveSeason(leagueId: LeagueId, result: SeasonResult): void;
  /** The season result, or null when the season hasn't run. */
  getSeason(leagueId: LeagueId): SeasonResult | null;
}

/** One storage backend: every repository over a shared lifecycle. */
export interface StakehouseStore {
  readonly leagues: LeagueRepository;
  readonly managers: ManagerRepository;
  readonly ledger: LedgerRepository;
  readonly drafts: DraftRepository;
  readonly players: PlayerRepository;
  readonly seasons: SeasonRepository;
  /** Releases the backend's resources; safe to call twice. */
  close(): void;
}
