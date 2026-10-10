import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { SANDBOX_LEAGUE_ID, seedIfEmpty } from '@stakehouse/seeder';
import { createSqliteStore } from '@stakehouse/persistence-sqlite';
import type { StakehouseStore } from '@stakehouse/persistence';
import { createInMemoryOpsStore } from './opsStore';
import type { LeagueOpsStore } from './opsStore';

/**
 * The production store seam: SQLite at STAKEHOUSE_DB (default: data/stakehouse.db
 * inside apps/web, anchored to this module so the cwd never moves it), migrations
 * on open, and the seeder's first-boot contract — a virgin database gains the
 * player universe and the played sandbox league, so no screen is ever empty on
 * first visit (spec §Persistence).
 */
export function bootStore(): StakehouseStore {
  const file =
    process.env.STAKEHOUSE_DB ??
    fileURLToPath(new URL('../../data/stakehouse.db', import.meta.url));
  mkdirSync(dirname(file), { recursive: true });
  const store = createSqliteStore({ file });
  const seed = seedIfEmpty(store);
  if (seed.seeded) {
    console.log(`first boot — seeded sandbox league, ${seed.players} players`);
  }
  return store;
}

/**
 * The demo commissioner. The seeded sandbox league has no commissioner of
 * record (seeding predates sign-in), and the commissioner's money desk —
 * distribute, credit, refund, cancel — would be dead on arrival. First boot
 * gives the house the key under a demo identity; real leagues set their
 * commissioner at creation.
 */
export const SANDBOX_COMMISSIONER_EMAIL = 'commissioner@stakehouse.test';

export function bootOps(store: StakehouseStore): LeagueOpsStore {
  const ops = createInMemoryOpsStore();
  const sandbox = store.leagues.get(SANDBOX_LEAGUE_ID);
  if (sandbox && !ops.commissioners.get(SANDBOX_LEAGUE_ID)) {
    ops.commissioners.set(SANDBOX_LEAGUE_ID, SANDBOX_COMMISSIONER_EMAIL);
  }
  return ops;
}
