import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { StakehouseStore } from '@stakehouse/persistence';

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

export function createSqliteStore(_options: SqliteStoreOptions): SqliteStore {
  // Red commit: types exist, behavior does not. The contract suite fails here
  // until the adapter is implemented.
  throw new Error('sqlite adapter not implemented (red commit)');
}
