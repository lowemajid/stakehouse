/**
 * Evidence-world setup (test scaffolding, never committed):
 *   tsx .evidence-seed.ts <db-file> players-only        — the 300-player universe
 *   tsx .evidence-seed.ts <db-file> ai-seats <leagueId> — fill remaining seats with
 *     AI managers and record their buy-ins (full+paid precondition for the draft).
 *     Idempotent: seated managers are kept, unpaid seats get their buy-in.
 */
import { createSqliteStore } from '@stakehouse/persistence-sqlite';
import { generatePlayerUniverse } from '@stakehouse/seeder';
import { leagueId, managerId, record } from '@stakehouse/domain';
import type { LedgerEntry } from '@stakehouse/domain';

const [file, mode, rawLeagueId] = process.argv.slice(2);
if (!file || !mode) throw new Error('usage: tsx .evidence-seed.ts <db-file> <players-only|ai-seats> [leagueId]');

const store = createSqliteStore({ file });

if (mode === 'players-only') {
  for (const player of generatePlayerUniverse()) store.players.upsert(player);
  console.log(`universe loaded: ${store.players.all().length} players`);
} else if (mode === 'ai-seats') {
  if (!rawLeagueId) throw new Error('ai-seats needs a league id');
  const lg = leagueId(rawLeagueId);
  const league = store.leagues.get(lg);
  if (!league) throw new Error(`unknown league ${rawLeagueId}`);
  const fee = league.config.entryFeeCents;
  const aiSeats: [string, string][] = [
    ['mgr-dmitri', 'Dmitri "The Ledger" Volkov'],
    ['mgr-wes', 'Coach Wes Halloway'],
    ['mgr-greta', 'Greta "Full Pot" Emerson'],
  ];
  const managers = store.managers.list(lg);
  const seated = new Set(managers.map((m) => String(m.id)));
  const paid = new Set(
    store.ledger
      .list(lg)
      .filter((entry) => entry.kind === 'buy-in' && entry.managerId !== null)
      .map((entry) => String(entry.managerId)),
  );
  let newSeats = league.config.size - managers.length;
  // Continue the ledger chain from the stored history — entry ids are
  // deterministic on position, so start from the full existing list.
  let entries: LedgerEntry[] = store.ledger.list(lg);
  const startLength = entries.length;
  for (const [id, displayName] of aiSeats) {
    if (seated.has(id) && paid.has(id)) continue;
    if (!seated.has(id)) {
      if (newSeats <= 0) continue; // no capacity left — cannot seat more
      store.managers.add({
        id: managerId(id),
        leagueId: lg,
        displayName,
        isAi: true,
        joinedAt: new Date().toISOString(),
      });
      seated.add(id);
      newSeats -= 1;
    }
    if (!paid.has(id)) {
      entries = record(entries, {
        leagueId: lg,
        kind: 'buy-in',
        managerId: managerId(id),
        amountCents: fee,
        memo: 'simulated buy-in — demo checkout, no real money changes hands',
        at: new Date().toISOString(),
      });
      paid.add(id);
    }
  }
  if (entries.length > startLength) store.ledger.append(lg, entries.slice(startLength));
  const all = store.managers.list(lg);
  console.log(
    `ai seats settled: ${all.length}/${league.config.size} seated, ${store.ledger.list(lg).length} ledger entries`,
  );
} else {
  throw new Error(`unknown mode ${mode}`);
}
store.close();
