import type { LeagueId, PlayerCard, Schedule } from '@stakehouse/domain';
import { simulateWeek } from '@stakehouse/domain';
import type { StakehouseStore } from '@stakehouse/persistence';
import { generatePlayerUniverse, rankBoard } from './playerUniverse';
import {
  SANDBOX_CREATED_AT,
  SANDBOX_LEAGUE_ID,
  SANDBOX_WEEKS_SIMULATED,
  runSandboxDraft,
  sandboxLedgerEntries,
  sandboxLeagueConfig,
  sandboxManagers,
  sandboxSchedule,
  startersFromDraft,
} from './sandboxLeague';

/**
 * First-boot seeding: a virgin store gains the fictional player universe and
 * the sandbox league, fully played — draft in the books, weeks 1–5 scored,
 * ledger funded. Nothing here invents state: the draft runs through the
 * draft engine, the weeks through `simulateWeek`, the ledger through
 * `record`, all at fixed instants so any empty store seeds byte-for-byte
 * identically.
 *
 * The guard is deliberately broad: ANY prior content — even one player or
 * one league — means the store is not the seeder's to touch. The seeder
 * claims only virgin stores, so a populated database (real leagues included)
 * is never rewritten. The tradeoff: a crash mid-seed leaves a partial
 * sandbox that a later boot will not finish — accepted, because seeding is a
 * single synchronous burst at boot on a local database, and the alternative
 * (deleting prior content to redo) is exactly what the guard exists to
 * forbid.
 */

export interface SeedResult {
  seeded: boolean;
  /** The sandbox league id when seeding ran; omitted when skipped. */
  leagueId?: LeagueId;
  players: number;
}

const SKIPPED: SeedResult = { seeded: false, players: 0 };

export function seedIfEmpty(store: StakehouseStore): SeedResult {
  if (store.players.all().length > 0 || store.leagues.list().length > 0) {
    return SKIPPED;
  }
  return seedSandbox(store);
}

function seedSandbox(store: StakehouseStore): SeedResult {
  const config = sandboxLeagueConfig();
  const schedule: Schedule = sandboxSchedule(config);

  const players: PlayerCard[] = generatePlayerUniverse();
  const byId: Record<string, PlayerCard> = Object.fromEntries(players.map((c) => [c.id, c]));
  for (const card of players) {
    store.players.upsert(card);
  }

  // The league record first — every other write references its id.
  store.leagues.create({
    id: SANDBOX_LEAGUE_ID,
    config,
    schedule,
    createdAt: SANDBOX_CREATED_AT,
  });

  for (const manager of sandboxManagers()) {
    store.managers.add(manager);
  }

  store.ledger.append(SANDBOX_LEAGUE_ID, sandboxLedgerEntries(config));

  const draft = runSandboxDraft(config, rankBoard(players, config.scoring));
  store.drafts.save(SANDBOX_LEAGUE_ID, draft);

  const starters = startersFromDraft(draft, byId, config.roster);

  for (let week = 1; week <= SANDBOX_WEEKS_SIMULATED; week++) {
    const pairings = schedule.weeks[week - 1]?.matchups ?? [];
    if (pairings.length === 0) {
      throw new Error(`the sandbox schedule has no matchups for week ${week}`);
    }
    store.seasons.saveWeek(
      SANDBOX_LEAGUE_ID,
      simulateWeek({ id: SANDBOX_LEAGUE_ID, config, pairings, starters, players: byId }, week),
    );
  }

  return { seeded: true, leagueId: SANDBOX_LEAGUE_ID, players: players.length };
}
