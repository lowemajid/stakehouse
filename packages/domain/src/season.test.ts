import { describe, expect, it } from 'vitest';
import { leagueId, managerId } from './brand';
import type { ManagerId } from './brand';
import { cents } from './money';
import type { LeagueConfig, ScoringRules } from './leagueConfig';
import { roundRobinSchedule } from './schedule';
import type { Position, StatLine } from './scoring';
import type { LineupSlot, PlayerCard, SimLeague, SlotPosition } from './simulation';
import { playoffWeeks, seedBracket, seasonPayoutRecipients, simulateSeason } from './season';
import type { BracketMatchup } from './season';
import { computeStandings } from './standings';
import type { StandingRow } from './standings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const lg = leagueId('lg-cold-open');

const rules: ScoringRules = {
  passYards: 0.04,
  passTd: 4,
  interception: -2,
  rushYards: 0.1,
  rushTd: 6,
  reception: 0.5,
  fumbleLost: -2,
  kicking: { fg: { '30-39': 3 }, extraPoint: 1 },
  defense: { sack: 1, takeaway: 2, td: 6, pointsAllowedBands: [[0, 10]] },
};

const ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };

const PROJECTIONS: Record<Position, StatLine> = {
  QB: {
    passYards: 265,
    passTd: 1.8,
    interceptions: 0.7,
    rushYards: 22,
    rushTd: 0.3,
    receptions: 0,
    fumblesLost: 0.2,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  RB: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 58,
    rushTd: 0.55,
    receptions: 3.2,
    fumblesLost: 0.15,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  WR: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 4,
    rushTd: 0.05,
    receptions: 5.1,
    fumblesLost: 0.1,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  TE: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 1,
    rushTd: 0.02,
    receptions: 3.8,
    fumblesLost: 0.08,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  K: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 0,
    rushTd: 0,
    receptions: 0,
    fumblesLost: 0,
    fgMade: { '30-39': 1.5 },
    extraPointsMade: 1.8,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  DEF: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 0,
    rushTd: 0,
    receptions: 0,
    fumblesLost: 0,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 1.5,
    takeaways: 1,
    defensiveTd: 0.08,
    pointsAllowed: 21,
  },
};

/** Starter slots in field order; the FLEX is filled by an RB so slot eligibility holds. */
const STARTER_PLAN: Array<[SlotPosition, number]> = [
  ['QB', ROSTER.QB],
  ['RB', ROSTER.RB],
  ['WR', ROSTER.WR],
  ['TE', ROSTER.TE],
  ['FLEX', ROSTER.FLEX],
  ['K', ROSTER.K],
  ['DEF', ROSTER.DEF],
];

function buildSeasonFixture(
  seasonWeeks: number,
  playoffTeams: 0 | 2 | 4,
  teamCount: number,
): { league: SimLeague; managers: ManagerId[] } {
  const managers = Array.from({ length: teamCount }, (_, i) => managerId(`mgr-${i + 1}`));
  const config: LeagueConfig = {
    name: 'Cold Open League',
    entryFeeCents: cents(10000),
    size: 10,
    roster: ROSTER,
    scoring: rules,
    regularSeasonWeeks: seasonWeeks,
    playoffTeams,
    payoutSplitPct: [70, 20, 10],
  };
  const players: Record<string, PlayerCard> = {};
  const starters: Record<ManagerId, readonly LineupSlot[]> = {};
  managers.forEach((mgr, i) => {
    const slots: LineupSlot[] = [];
    let n = 0; // per-manager running counter — player ids must never collide
    for (const [slot, count] of STARTER_PLAN) {
      const position: Position = slot === 'FLEX' ? 'RB' : slot;
      for (let k = 0; k < count; k++) {
        const id = `p${i + 1}-${position}-${n++}`;
        players[id] = {
          id,
          name: `Player ${id}`,
          position,
          projection: PROJECTIONS[position]!,
          variance: 0.15,
        };
        slots.push({ slot, playerId: id });
      }
    }
    starters[mgr] = slots;
  });
  return { league: { id: lg, config, pairings: [], starters, players }, managers };
}

/** A standings board with strictly separated records — s1 best, sN worst. */
function seededRows(count: number): StandingRow[] {
  return Array.from({ length: count }, (_, i) => ({
    managerId: managerId(`s${i + 1}`),
    wins: 9 - i,
    losses: i,
    ties: 0,
    pointsFor: 1000 - i * 10,
    pointsAgainst: 900 + i * 10,
  }));
}

const config = (playoffTeams: 0 | 2 | 4, weeks: number): LeagueConfig => ({
  name: 'Seeding League',
  entryFeeCents: cents(10000),
  size: 10,
  roster: ROSTER,
  scoring: rules,
  regularSeasonWeeks: weeks,
  playoffTeams,
  payoutSplitPct: [70, 20, 10],
});

describe('playoffWeeks', () => {
  it('maps 0/2/4 playoff teams to 0/1/2 bracket weeks', () => {
    expect(playoffWeeks(0)).toBe(0);
    expect(playoffWeeks(2)).toBe(1);
    expect(playoffWeeks(4)).toBe(2);
  });
});

describe('seedBracket — the first round, seeded over the final weeks', () => {
  it('seats the 4-team semifinals 1v4 / 2v3 in week N−1, higher seed at home', () => {
    const bracket = seedBracket(config(4, 10), seededRows(6));
    expect(bracket.map((m) => [m.week, m.label, m.seeds[0], m.seeds[1]])).toEqual([
      [9, 'semifinal', 1, 4],
      [9, 'semifinal', 2, 3],
    ]);
    expect(bracket[0]!.home).toBe(managerId('s1'));
    expect(bracket[0]!.away).toBe(managerId('s4'));
    expect(bracket[1]!.home).toBe(managerId('s2'));
    expect(bracket[1]!.away).toBe(managerId('s3'));
  });

  it('seats a 2-team final in the last week', () => {
    const bracket = seedBracket(config(2, 10), seededRows(4));
    expect(bracket).toHaveLength(1);
    expect(bracket[0]).toMatchObject({ week: 10, label: 'final', seeds: [1, 2] });
    expect(bracket[0]!.home).toBe(managerId('s1'));
    expect(bracket[0]!.away).toBe(managerId('s2'));
  });

  it('produces no bracket without playoffs', () => {
    expect(seedBracket(config(0, 10), seededRows(4))).toEqual([]);
  });

  it('refuses a bracket wider than the standings provide', () => {
    expect(() => seedBracket(config(4, 10), seededRows(3))).toThrowError(/bracket/i);
  });
});

describe('simulateSeason — a 10-team league replays deterministically', () => {
  const { league, managers } = buildSeasonFixture(10, 4, 10);
  const schedule = roundRobinSchedule(managers, 10 - playoffWeeks(4), lg);
  const season = simulateSeason(league, schedule);

  it('plays 8 regular weeks then the seeded bracket in weeks 9 and 10', () => {
    expect(season.weeks).toHaveLength(10);
    expect(season.weeks.slice(0, 8).every((w) => w.games.length === 5)).toBe(true);
    expect(season.weeks[8]!.games).toHaveLength(2); // semifinals
    expect(season.weeks[9]!.games).toHaveLength(1); // final
    // the bracket is seeded from the week-8 standings
    expect(season.bracket[0]).toMatchObject({ week: 9, label: 'semifinal', seeds: [1, 4] });
    expect(season.bracket[1]).toMatchObject({ week: 9, label: 'semifinal', seeds: [2, 3] });
    expect(season.bracket[0]!.home).toBe(season.standings[0]!.managerId);
    expect(season.bracket[0]!.away).toBe(season.standings[3]!.managerId);
    expect(season.bracket[1]!.home).toBe(season.standings[1]!.managerId);
    expect(season.bracket[1]!.away).toBe(season.standings[2]!.managerId);
  });

  it('derives the final from the semifinal winners, better seed hosting', () => {
    const final = season.bracket[2]!;
    expect(final.week).toBe(10);
    expect(final.label).toBe('final');
    const [semiOne, semiTwo] = season.bracket;
    const winnerOf = (matchup: BracketMatchup) => {
      const result = season.results.find((r) => r.matchup === matchup)!;
      return result.winner;
    };
    const finalists = [winnerOf(semiOne!), winnerOf(semiTwo!)];
    expect(finalists).toContain(final.home);
    expect(finalists).toContain(final.away);
    // seeds on the final are the finalists' original regular-season seeds, better first
    expect(final.seeds[0]).toBeLessThan(final.seeds[1]);
    expect(season.champion).toBe(season.results[2]!.winner);
  });

  it('gives every manager 8 regular-season games and never double-books a week', () => {
    const played = new Map<string, number>();
    for (const week of season.weeks.slice(0, 8)) {
      const seats = new Set<string>();
      for (const g of week.games) {
        for (const m of [g.home, g.away]) {
          expect(seats.has(String(m))).toBe(false);
          seats.add(String(m));
          played.set(String(m), (played.get(String(m)) ?? 0) + 1);
        }
      }
    }
    expect(played.size).toBe(10);
    for (const count of played.values()) expect(count).toBe(8);
    expect(season.standings).toHaveLength(10);
  });

  it('replays byte-identically across independent runs', () => {
    const replay = simulateSeason(league, schedule);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(season));
  });

  it('rejects a schedule that does not cover exactly the regular weeks', () => {
    const wrong = roundRobinSchedule(managers, 10, lg);
    expect(() => simulateSeason(league, wrong)).toThrowError(/schedule/i);
  });
});

describe('seasonPayoutRecipients — season outcome to payout places', () => {
  it('pays the champion, the runner-up, then the best remaining regular-season finish', () => {
    const { league, managers } = buildSeasonFixture(10, 4, 10);
    const schedule = roundRobinSchedule(managers, 8, lg);
    const season = simulateSeason(league, schedule);
    const [first, second, third] = seasonPayoutRecipients(season);
    expect(first).toBe(season.champion);
    const finalMatchup = season.results[2]!.matchup;
    const finalLoser =
      finalMatchup.home === season.champion ? finalMatchup.away : finalMatchup.home;
    expect(second).toBe(finalLoser);
    // third place never played the final — the best non-finalist in the standings
    const finalists = new Set([finalMatchup.home, finalMatchup.away]);
    expect(finalists.has(third)).toBe(false);
    const expectedThird = season.standings.find((r) => !finalists.has(r.managerId))!.managerId;
    expect(third).toBe(expectedThird);
  });

  it('pays the standings top-3 when there is no bracket', () => {
    const { league, managers } = buildSeasonFixture(10, 0, 10);
    const schedule = roundRobinSchedule(managers, 10, lg);
    const season = simulateSeason(league, schedule);
    expect(season.champion).toBe(season.standings[0]!.managerId);
    expect(seasonPayoutRecipients(season)).toEqual([
      season.standings[0]!.managerId,
      season.standings[1]!.managerId,
      season.standings[2]!.managerId,
    ]);
  });

  it('names the same third-place recipient on every replay', () => {
    const { league, managers } = buildSeasonFixture(10, 4, 10);
    const schedule = roundRobinSchedule(managers, 8, lg);
    const season = simulateSeason(league, schedule);
    expect(JSON.stringify(seasonPayoutRecipients(season))).toBe(
      JSON.stringify(seasonPayoutRecipients(simulateSeason(league, schedule))),
    );
  });
});

describe('computeStandings — integration with the season', () => {
  it('ranks the final regular-season standings from the simulated weeks alone', () => {
    const { league, managers } = buildSeasonFixture(10, 4, 10);
    const schedule = roundRobinSchedule(managers, 8, lg);
    const season = simulateSeason(league, schedule);
    const regular = computeStandings(season.weeks.slice(0, 8));
    expect(JSON.stringify(regular.map((r) => r.managerId))).toBe(
      JSON.stringify(season.standings.map((r) => r.managerId)),
    );
  });
});
