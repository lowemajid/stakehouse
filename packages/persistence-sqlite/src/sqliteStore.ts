import { cents, leagueId, managerId, parseLeagueConfig } from '@stakehouse/domain';
import type {
  DraftState,
  LedgerEntry,
  LedgerKind,
  LeagueId,
  PlayerCard,
  Schedule,
  SeasonResult,
  WeekResult,
} from '@stakehouse/domain';
import type {
  DraftRepository,
  LedgerRepository,
  LeagueRecord,
  LeagueRepository,
  ManagerRecord,
  ManagerRepository,
  PlayerRepository,
  SeasonRepository,
  StakehouseStore,
} from '@stakehouse/persistence';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

export interface SqliteStoreOptions {
  /**
   * Path to the database file; ':memory:' keeps everything in-process
   * (tests). The adapter runs pending migrations on construction, so opening
   * an existing file always lands on the current schema.
   */
  readonly file: string;
}

export interface SqliteStore extends StakehouseStore {
  /**
   * The engine handle. The adapter owns the only SQL in the system; tests use
   * this to assert storage-level guarantees (append-only triggers, INTEGER
   * money columns) that no repository method can reach.
   */
  readonly database: SqliteDatabase;
}

/** better-sqlite3 annotates its errors with a SQLite result code. */
function sqliteErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function migrate(db: SqliteDatabase): void {
  db.exec(
    'create table if not exists _migrations (id integer primary key, name text not null unique)',
  );
  const applied = new Set(
    (db.prepare('select id from _migrations').all() as { id: number }[]).map((row) => row.id),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('insert into _migrations (id, name) values (?, ?)').run(
        migration.id,
        migration.name,
      );
    })();
  }
}

interface LeagueRow {
  id: string;
  config_json: string;
  schedule_json: string | null;
  created_at: string;
}

interface ManagerRow {
  id: string;
  league_id: string;
  display_name: string;
  is_ai: number;
  joined_at: string;
}

interface LedgerRow {
  id: string;
  league_id: string;
  kind: string;
  manager_id: string | null;
  amount_cents: number;
  memo: string;
  at: string;
}

interface PlayerRow {
  id: string;
  name: string;
  position: string;
  projection_json: string;
  variance: number;
}

export function createSqliteStore(options: SqliteStoreOptions): SqliteStore {
  const db = new Database(options.file);
  // WAL: readers never block the writer, and committed state survives restarts.
  db.pragma('journal_mode = WAL');
  // Foreign keys on: every child row (managers, ledger, drafts, weeks,
  // seasons) points at a real league — referential integrity is the storage
  // layer's job, not the caller's.
  db.pragma('foreign_keys = ON');
  migrate(db);

  const leagueExists = db.prepare('select 1 from leagues where id = ?');
  const insertLeague = db.prepare(
    'insert into leagues (id, config_json, schedule_json, created_at) values (?, ?, ?, ?)',
  );
  const selectLeague = db.prepare('select * from leagues where id = ?');
  const selectLeagues = db.prepare('select * from leagues order by rowid');

  const requireLeague = (id: LeagueId, verb: string): void => {
    if (leagueExists.get(String(id)) == null) {
      throw new Error(`cannot store ${verb} for unknown league ${String(id)}`);
    }
  };

  const rowToLeague = (row: LeagueRow): LeagueRecord => ({
    id: leagueId(row.id),
    // Configs were zod-validated at creation; parsing again on read makes a
    // tampered file fail loudly instead of feeding garbage to the domain.
    config: parseLeagueConfig(JSON.parse(row.config_json) as unknown),
    // JSON documents written only by this adapter from engine-produced data —
    // the cast re-claims the type at the trust boundary.
    schedule: row.schedule_json === null ? null : (JSON.parse(row.schedule_json) as Schedule),
    createdAt: row.created_at,
  });

  const leaguesRepo: LeagueRepository = {
    create(record) {
      try {
        insertLeague.run(
          String(record.id),
          JSON.stringify(record.config),
          record.schedule === null ? null : JSON.stringify(record.schedule),
          record.createdAt,
        );
      } catch (error) {
        if (sqliteErrorCode(error) === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
          throw new Error(`league ${String(record.id)} already exists`);
        }
        throw error;
      }
    },
    get(id) {
      const row = selectLeague.get(String(id)) as LeagueRow | undefined;
      return row ? rowToLeague(row) : null;
    },
    list() {
      return (selectLeagues.all() as LeagueRow[]).map(rowToLeague);
    },
  };

  const insertManager = db.prepare(
    'insert into managers (id, league_id, display_name, is_ai, joined_at) values (?, ?, ?, ?, ?)',
  );
  const selectManagers = db.prepare('select * from managers where league_id = ? order by rowid');

  const rowToManager = (row: ManagerRow): ManagerRecord => ({
    id: managerId(row.id),
    leagueId: leagueId(row.league_id),
    displayName: row.display_name,
    isAi: row.is_ai === 1,
    joinedAt: row.joined_at,
  });

  const managersRepo: ManagerRepository = {
    add(record) {
      requireLeague(record.leagueId, 'a manager');
      try {
        insertManager.run(
          String(record.id),
          String(record.leagueId),
          record.displayName,
          record.isAi ? 1 : 0,
          record.joinedAt,
        );
      } catch (error) {
        if (sqliteErrorCode(error) === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
          throw new Error(
            `manager ${String(record.id)} already exists in league ${String(record.leagueId)}`,
          );
        }
        throw error;
      }
    },
    list(leagueId) {
      return (selectManagers.all(String(leagueId)) as ManagerRow[]).map(rowToManager);
    },
  };

  const insertEntry = db.prepare(
    'insert into ledger_entries (id, league_id, kind, manager_id, amount_cents, memo, at) values (?, ?, ?, ?, ?, ?, ?)',
  );
  const selectEntries = db.prepare('select * from ledger_entries where league_id = ? order by seq');

  const rowToEntry = (row: LedgerRow): LedgerEntry => ({
    id: row.id,
    leagueId: leagueId(row.league_id),
    kind: row.kind as LedgerKind, // guarded by the kind check constraint
    managerId: row.manager_id === null ? null : managerId(row.manager_id),
    amountCents: cents(row.amount_cents), // re-asserts integer cents on read
    memo: row.memo,
    at: row.at,
  });

  // One transaction per append: a batch lands whole or not at all — the
  // ledger never shows a partial write.
  const appendTxn = db.transaction((lg: string, newEntries: readonly LedgerEntry[]) => {
    for (const candidate of newEntries) {
      insertEntry.run(
        candidate.id,
        lg,
        candidate.kind,
        candidate.managerId === null ? null : String(candidate.managerId),
        candidate.amountCents,
        candidate.memo,
        candidate.at,
      );
    }
  });

  const ledgerRepo: LedgerRepository = {
    append(leagueId, newEntries) {
      requireLeague(leagueId, 'ledger entries');
      try {
        appendTxn(String(leagueId), newEntries);
      } catch (error) {
        if (sqliteErrorCode(error) === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error(`ledger entry already exists in ${String(leagueId)}`);
        }
        throw error;
      }
    },
    list(leagueId) {
      return (selectEntries.all(String(leagueId)) as LedgerRow[]).map(rowToEntry);
    },
  };

  const upsertDraft = db.prepare(
    `insert into draft_states (league_id, state_json) values (?, ?)
     on conflict(league_id) do update set state_json = excluded.state_json`,
  );
  const selectDraft = db.prepare('select state_json from draft_states where league_id = ?');

  const draftsRepo: DraftRepository = {
    save(leagueId, state) {
      requireLeague(leagueId, 'a draft');
      upsertDraft.run(String(leagueId), JSON.stringify(state));
    },
    get(leagueId) {
      const row = selectDraft.get(String(leagueId)) as { state_json: string } | undefined;
      return row ? (JSON.parse(row.state_json) as DraftState) : null;
    },
  };

  const upsertPlayer = db.prepare(
    `insert into players (id, name, position, projection_json, variance) values (?, ?, ?, ?, ?)
     on conflict(id) do update set
       name = excluded.name,
       position = excluded.position,
       projection_json = excluded.projection_json,
       variance = excluded.variance`,
  );
  const selectPlayer = db.prepare('select * from players where id = ?');
  const selectPlayers = db.prepare('select * from players order by rowid');

  const rowToPlayer = (row: PlayerRow): PlayerCard => ({
    id: row.id,
    name: row.name,
    position: row.position as PlayerCard['position'], // guarded by the check constraint
    projection: JSON.parse(row.projection_json) as PlayerCard['projection'],
    variance: row.variance,
  });

  const playersRepo: PlayerRepository = {
    upsert(player) {
      upsertPlayer.run(
        player.id,
        player.name,
        player.position,
        JSON.stringify(player.projection),
        player.variance,
      );
    },
    get(id) {
      const row = selectPlayer.get(id) as PlayerRow | undefined;
      return row ? rowToPlayer(row) : null;
    },
    all() {
      return (selectPlayers.all() as PlayerRow[]).map(rowToPlayer);
    },
  };

  const upsertWeek = db.prepare(
    `insert into week_results (league_id, week, result_json) values (?, ?, ?)
     on conflict(league_id, week) do update set result_json = excluded.result_json`,
  );
  const selectWeeks = db.prepare(
    'select week, result_json from week_results where league_id = ? order by week',
  );
  const upsertSeason = db.prepare(
    `insert into season_results (league_id, result_json) values (?, ?)
     on conflict(league_id) do update set result_json = excluded.result_json`,
  );
  const selectSeason = db.prepare('select result_json from season_results where league_id = ?');

  const seasonsRepo: SeasonRepository = {
    saveWeek(leagueId, result) {
      requireLeague(leagueId, 'a week result');
      upsertWeek.run(String(leagueId), result.week, JSON.stringify(result));
    },
    listWeeks(leagueId) {
      return (selectWeeks.all(String(leagueId)) as { result_json: string }[]).map(
        (row) => JSON.parse(row.result_json) as WeekResult,
      );
    },
    saveSeason(leagueId, result) {
      requireLeague(leagueId, 'a season result');
      upsertSeason.run(String(leagueId), JSON.stringify(result));
    },
    getSeason(leagueId) {
      const row = selectSeason.get(String(leagueId)) as { result_json: string } | undefined;
      return row ? (JSON.parse(row.result_json) as SeasonResult) : null;
    },
  };

  let closed = false;
  return {
    leagues: leaguesRepo,
    managers: managersRepo,
    ledger: ledgerRepo,
    drafts: draftsRepo,
    players: playersRepo,
    seasons: seasonsRepo,
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
    database: db,
  };
}
