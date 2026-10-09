import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { leagueId, managerId } from '@stakehouse/domain';
import { ledgerEntry, leagueRecord, runRepositoryContract } from '@stakehouse/persistence';
import { createSqliteStore } from './sqliteStore';

// One contract suite, second subject: the better-sqlite3 adapter. Every
// behavioral guarantee the fakes pass must pass here too, plus the durability
// gate the fakes cannot run (reopen against the same file).
const dir = mkdtempSync(join(tmpdir(), 'stakehouse-sqlite-'));
let counter = 0;
let currentFile = '';

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

runRepositoryContract({
  name: 'better-sqlite3 adapter',
  create: () => {
    currentFile = join(dir, `sh-${counter++}.db`);
    return createSqliteStore({ file: currentFile });
  },
  reopen: () => createSqliteStore({ file: currentFile }),
});

describe('sqlite storage guarantees', () => {
  it('rejects ledger rewrites at the storage level — no UPDATE, no DELETE', () => {
    const store = createSqliteStore({ file: join(dir, `guard-${counter++}.db`) });
    try {
      const lg = leagueId('lg-guard');
      store.leagues.create(leagueRecord('lg-guard'));
      store.ledger.append(lg, [ledgerEntry('entry-0', 'buy-in', managerId('mgr-1'), 25_00)]);
      expect(() =>
        store.database.prepare('update ledger_entries set amount_cents = 0').run(),
      ).toThrow(/append-only/);
      expect(() => store.database.prepare('delete from ledger_entries').run()).toThrow(
        /append-only/,
      );
      expect(store.ledger.list(lg)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('stores cents as sqlite INTEGER — the column never sees a float', () => {
    const store = createSqliteStore({ file: join(dir, `int-${counter++}.db`) });
    try {
      const lg = leagueId('lg-int');
      store.leagues.create(leagueRecord('lg-int'));
      store.ledger.append(lg, [
        ledgerEntry('entry-0', 'buy-in', managerId('mgr-1'), 12_345_678_901, 'whale buy-in'),
      ]);
      const row = store.database
        .prepare('select typeof(amount_cents) as t, amount_cents as v from ledger_entries')
        .get() as { t: string; v: number };
      expect(row.t).toBe('integer');
      expect(row.v).toBe(12_345_678_901);
    } finally {
      store.close();
    }
  });

  it('re-running migrations is a no-op — reopen never rewrites applied schema', () => {
    const file = join(dir, `migrate-${counter++}.db`);
    const first = createSqliteStore({ file });
    first.close();
    const second = createSqliteStore({ file });
    try {
      const applied = second.database.prepare('select count(*) as n from _migrations').get() as {
        n: number;
      };
      expect(applied.n).toBe(1);
      second.leagues.create(leagueRecord('lg-after-reopen'));
      expect(second.leagues.get(leagueId('lg-after-reopen'))).not.toBeNull();
    } finally {
      second.close();
    }
  });
});
