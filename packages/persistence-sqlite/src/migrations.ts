export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * The schema history, applied in order and tracked in `_migrations`. Each
 * migration runs once, inside its own transaction — a migration either lands
 * whole or not at all. The adapter is the only code in the system that knows
 * SQL; these strings are its whole vocabulary.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial-schema',
    sql: `
      create table leagues (
        id text primary key,
        config_json text not null,
        schedule_json text,
        created_at text not null
      );

      create table managers (
        id text not null,
        league_id text not null references leagues(id),
        display_name text not null,
        is_ai integer not null check (is_ai in (0, 1)),
        joined_at text not null,
        primary key (league_id, id)
      );

      create table ledger_entries (
        seq integer primary key autoincrement,
        id text not null,
        league_id text not null references leagues(id),
        kind text not null check (kind in ('buy-in', 'refund', 'payout', 'commissioner-credit')),
        manager_id text,
        amount_cents integer not null,
        memo text not null,
        at text not null,
        unique (league_id, id)
      );

      -- The money guarantee, enforced below the repository layer: no code
      -- path, present or future, can rewrite or remove history.
      create trigger ledger_entries_no_update
        before update on ledger_entries
      begin
        select raise(abort, 'ledger entries are append-only: UPDATE rejected');
      end;

      create trigger ledger_entries_no_delete
        before delete on ledger_entries
      begin
        select raise(abort, 'ledger entries are append-only: DELETE rejected');
      end;

      create table draft_states (
        league_id text primary key references leagues(id),
        state_json text not null
      );

      create table players (
        id text primary key,
        name text not null,
        position text not null check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')),
        projection_json text not null,
        variance real not null
      );

      create table week_results (
        league_id text not null references leagues(id),
        week integer not null,
        result_json text not null,
        primary key (league_id, week)
      );

      create table season_results (
        league_id text primary key references leagues(id),
        result_json text not null
      );
    `,
  },
];
