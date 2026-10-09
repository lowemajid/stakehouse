import { describe, expect, it } from 'vitest';
import {
  SANDBOX_LEAGUE_ID,
  SANDBOX_SEAT_COUNT,
  SANDBOX_WEEKS_SIMULATED,
  seedIfEmpty,
} from '@stakehouse/seeder';
import { computeStandings, poolBalance } from '@stakehouse/domain';
import { createFakeStore } from '@stakehouse/persistence';
import type { StakehouseStore } from '@stakehouse/persistence';

/**
 * The whole point of the seeder, stated as tests: an empty database boots
 * into a fully populated sandbox league — rostered, five weeks simulated,
 * money on the ledger — and a populated database is never touched again.
 */

/** Canonical JSON of everything a store holds, in repository contract order. */
function snapshotStore(store: StakehouseStore): string {
  return JSON.stringify({
    players: store.players.all(),
    leagues: store.leagues.list(),
    managers: store.managers.list(SANDBOX_LEAGUE_ID),
    ledger: store.ledger.list(SANDBOX_LEAGUE_ID),
    draft: store.drafts.get(SANDBOX_LEAGUE_ID),
    weeks: store.seasons.listWeeks(SANDBOX_LEAGUE_ID),
    season: store.seasons.getSeason(SANDBOX_LEAGUE_ID),
  });
}

function seededStore(): StakehouseStore {
  const store = createFakeStore();
  const result = seedIfEmpty(store);
  if (!result.seeded) throw new Error('fixture store must seed');
  return store;
}

describe('sandbox league seeder', () => {
  it('seeds an empty store and reports what it built', () => {
    const store = createFakeStore();
    expect(seedIfEmpty(store)).toStrictEqual({
      seeded: true,
      leagueId: SANDBOX_LEAGUE_ID,
      players: 300,
    });
    expect(store.leagues.get(SANDBOX_LEAGUE_ID)).not.toBeNull();
  });

  it('changes nothing on the second boot — idempotence', () => {
    const store = seededStore();
    const before = snapshotStore(store);
    expect(seedIfEmpty(store).seeded).toBe(false);
    expect(snapshotStore(store)).toBe(before);
  });

  it('replays byte-identically from two independent empty boots', () => {
    const first = snapshotStore(seededStore());
    const second = snapshotStore(seededStore());
    expect(second).toBe(first);
  });

  it('treats a store with any prior content as populated', () => {
    // Either half populated — players or leagues — means "not mine to touch".
    const withPlayer = createFakeStore();
    withPlayer.players.upsert({
      id: 'p-someone',
      name: 'Someone Existing',
      position: 'QB',
      projection: {
        passYards: 1,
        passTd: 0,
        interceptions: 0,
        rushYards: 0,
        rushTd: 0,
        receptions: 0,
        fumblesLost: 0,
        fgMade: {},
        extraPointsMade: 0,
        sacks: 0,
        takeaways: 0,
        defensiveTd: 0,
        pointsAllowed: 0,
      },
      variance: 0.1,
    });
    expect(seedIfEmpty(withPlayer).seeded).toBe(false);
    expect(withPlayer.leagues.list()).toHaveLength(0);
  });

  it('seats eight managers — human placeholders and AI alike', () => {
    const managers = seededStore().managers.list(SANDBOX_LEAGUE_ID);
    expect(managers).toHaveLength(SANDBOX_SEAT_COUNT);
    expect(managers.filter((m) => m.isAi).length).toBe(6);
    expect(managers.filter((m) => !m.isAi).length).toBe(2);
    for (const manager of managers) {
      expect(manager.displayName.length).toBeGreaterThan(0);
      expect(manager.joinedAt).toMatch(/^2026-/);
    }
  });

  it('drafts complete rosters through the draft engine', () => {
    const store = seededStore();
    const draft = store.drafts.get(SANDBOX_LEAGUE_ID);
    if (!draft) throw new Error('sandbox draft must exist');
    expect(draft.status).toBe('complete');
    expect(draft.picks).toHaveLength(SANDBOX_SEAT_COUNT * 9);
    // Every seat holds exactly one full roster, and no player appears twice —
    // the engine's guarded transitions are the only way picks exist.
    const owners = new Map<string, string>();
    for (const seat of store.managers.list(SANDBOX_LEAGUE_ID)) {
      const mine = draft.picks.filter((pick) => pick.managerId === seat.id);
      expect(mine).toHaveLength(9);
      for (const pick of mine) {
        expect(owners.has(pick.playerId), `player ${pick.playerId} drafted twice`).toBe(false);
        owners.set(pick.playerId, String(seat.id));
      }
    }
    expect(draft.order).toHaveLength(SANDBOX_SEAT_COUNT);
  });

  it('simulates weeks 1–5 with populated box scores and standings', () => {
    const store = seededStore();
    const weeks = store.seasons.listWeeks(SANDBOX_LEAGUE_ID);
    expect(weeks.map((week) => week.week)).toStrictEqual([1, 2, 3, 4, 5]);
    for (const week of weeks) {
      expect(week.games).toHaveLength(SANDBOX_SEAT_COUNT / 2);
      for (const game of week.games) {
        expect(game.homeBox.lines).toHaveLength(9);
        expect(game.awayBox.lines).toHaveLength(9);
        expect(game.homeBox.total).toBeGreaterThan(0);
        expect(game.awayBox.total).toBeGreaterThan(0);
      }
    }
    // Standings derive from exactly these weeks — eight ranked rows, five
    // games apiece.
    const standings = computeStandings(weeks);
    expect(standings).toHaveLength(SANDBOX_SEAT_COUNT);
    for (const row of standings) {
      expect(row.wins + row.losses + row.ties).toBe(SANDBOX_WEEKS_SIMULATED);
      expect(row.pointsFor).toBeGreaterThan(0);
    }
    expect(new Set(standings.map((row) => row.pointsFor)).size).toBeGreaterThan(1);
  });

  it('leaves the league mid-season at week 6, schedule ready', () => {
    const store = seededStore();
    const league = store.leagues.get(SANDBOX_LEAGUE_ID);
    if (!league) throw new Error('sandbox league must exist');
    expect(league.schedule).not.toBeNull();
    const scheduleWeeks = league.schedule?.weeks ?? [];
    expect(scheduleWeeks).toHaveLength(8); // 10-week season minus the 2 playoff weeks
    expect(scheduleWeeks[5]?.matchups).toHaveLength(SANDBOX_SEAT_COUNT / 2);
    expect(store.seasons.getSeason(SANDBOX_LEAGUE_ID)).toBeNull(); // no season result yet
    expect(store.seasons.listWeeks(SANDBOX_LEAGUE_ID).map((w) => w.week)).not.toContain(6);
  });

  it('carries the eight buy-ins and a commissioner credit with a derived balance', () => {
    const store = seededStore();
    const config = store.leagues.get(SANDBOX_LEAGUE_ID)?.config;
    if (!config) throw new Error('sandbox league must exist');
    const entries = store.ledger.list(SANDBOX_LEAGUE_ID);
    const buyIns = entries.filter((entry) => entry.kind === 'buy-in');
    expect(buyIns).toHaveLength(SANDBOX_SEAT_COUNT);
    for (const entry of buyIns) {
      expect(entry.amountCents).toBe(config.entryFeeCents);
      expect(entry.managerId).not.toBeNull();
    }
    expect(
      entries.filter((entry) => entry.kind === 'commissioner-credit').length,
    ).toBeGreaterThanOrEqual(1);
    // The balance is never stored — derived from exactly these entries.
    expect(poolBalance(entries)).toBe(8 * config.entryFeeCents + 500);
  });
});
