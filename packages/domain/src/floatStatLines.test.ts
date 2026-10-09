import { describe, expect, it } from 'vitest';
import { leagueId, managerId } from './brand';
import type { ManagerId } from './brand';
import { DomainError } from './errors';
import { roundRobinSchedule } from './schedule';
// RED on main: the integer contract is not yet exported. The engine draws
// stat lines internally today, but nothing names the guarantee that a drawn
// line is integer-clean before the strict scorer validates it.
import { COUNTER_FIELDS, integerStatLine, pointsAllowedBonusScaled, scoreLineScaled } from './scoring';
import type { Position, StatLine } from './scoring';
import type { LeagueConfig, ScoringRules } from './leagueConfig';
import { cents } from './money';
import { computeStandings } from './standings';
import { drawStatLine, simulateWeek } from './simulation';
import type { LineupSlot, PlayerCard, SimLeague, SlotPosition } from './simulation';
import { playoffWeeks, simulateSeason } from './season';

/**
 * Regression tests for float projections: the seeder's player universe
 * carries two-decimal projections (301.66 passYards, 0.87 interceptions),
 * and week simulation draws each stat from projection plus noise. Yards,
 * receptions, touchdowns, and kicks are counts — the engine must never emit
 * a line its own validator rejects with invalid-stat-line, and the draw
 * must replay byte-identically under the identity-seeded RNG.
 */

const rules: ScoringRules = {
  passYards: 0.04,
  passTd: 4,
  interception: -2,
  rushYards: 0.1,
  rushTd: 6,
  reception: 1,
  fumbleLost: -2,
  kicking: {
    fg: { '0-19': 3, '20-29': 3, '30-39': 3, '40-49': 4, '50-59': 5, '60+': 6 },
    extraPoint: 1,
  },
  defense: {
    sack: 1,
    takeaway: 2,
    td: 6,
    pointsAllowedBands: [
      [0, 10],
      [10, 7],
      [20, 3],
      [30, 1],
      [40, 0],
    ],
  },
};

const ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };

/** Seeder-style projections: two-decimal floats on every modeled counter. */
const FLOAT_PROJECTIONS: Record<Position, StatLine> = {
  QB: {
    passYards: 301.66, // the value from the reported sandbox failure
    passTd: 2.31,
    interceptions: 0.87,
    rushYards: 18.42,
    rushTd: 0.29,
    receptions: 0,
    fumblesLost: 0.11,
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
    rushYards: 64.19,
    rushTd: 0.62,
    receptions: 3.47,
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
    rushYards: 4.12,
    rushTd: 0.05,
    receptions: 5.83,
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
    rushYards: 1.03,
    rushTd: 0.02,
    receptions: 3.91,
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
    fgMade: { '20-29': 0.83, '30-39': 1.17, '40-49': 0.64, '50-59': 0.21 },
    extraPointsMade: 1.59,
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
    sacks: 1.34,
    takeaways: 1.09,
    defensiveTd: 0.13,
    pointsAllowed: 21.46,
  },
};

const STARTER_PLAN: Array<[SlotPosition, number]> = [
  ['QB', ROSTER.QB],
  ['RB', ROSTER.RB],
  ['WR', ROSTER.WR],
  ['TE', ROSTER.TE],
  ['FLEX', ROSTER.FLEX],
  ['K', ROSTER.K],
  ['DEF', ROSTER.DEF],
];

const config: LeagueConfig = {
  name: 'Float Projection League',
  entryFeeCents: cents(2500),
  size: 10,
  roster: ROSTER,
  scoring: rules,
  regularSeasonWeeks: 10,
  playoffTeams: 4,
  payoutSplitPct: [70, 20, 10],
};

/** A 10-team league whose every player projects in the seeder's float style. */
function makeFloatLeague(): { league: SimLeague; managers: ManagerId[] } {
  const managers = Array.from({ length: 10 }, (_, i) => managerId(`mgr-${i + 1}`));
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
          projection: structuredClone(FLOAT_PROJECTIONS[position]!),
          variance: 0.15,
        };
        slots.push({ slot, playerId: id });
      }
    }
    starters[mgr] = slots;
  });
  return {
    league: { id: leagueId('lg_float-demo'), config, pairings: [], starters, players },
    managers,
  };
}

/** Every stat slot in a box score line — counter fields plus each FG band. */
function expectIntegerLine(line: StatLine, where: string): void {
  for (const field of COUNTER_FIELDS) {
    const value = line[field];
    expect(Number.isInteger(value), `${where}.${field} = ${value} must be an integer`).toBe(true);
    expect(value >= 0, `${where}.${field} = ${value} must be non-negative`).toBe(true);
  }
  for (const [band, made] of Object.entries(line.fgMade)) {
    expect(
      Number.isInteger(made),
      `${where}.fgMade.${band} = ${made} must be an integer`,
    ).toBe(true);
  }
}

describe('integerStatLine — the engine-side integer contract', () => {
  it('rounds every counter field to a clamped-at-zero integer', () => {
    const raw: StatLine = {
      passYards: 301.66,
      passTd: 1.5,
      interceptions: 0.49,
      rushYards: 64.19,
      rushTd: 0.5,
      receptions: 6.5,
      fumblesLost: 0.1,
      fgMade: { '20-29': 0.83, '50-59': 0.5 },
      extraPointsMade: 1.59,
      sacks: 1.34,
      takeaways: 1.09,
      defensiveTd: 0.13,
      pointsAllowed: 21.46,
    };
    const clean = integerStatLine(raw);
    for (const field of COUNTER_FIELDS) {
      expect(Number.isInteger(clean[field])).toBe(true);
    }
    expect(clean.passYards).toBe(302); // Math.round, halves up, pinned
    expect(clean.passTd).toBe(2);
    expect(clean.interceptions).toBe(0); // below one-half rounds down
    expect(clean.receptions).toBe(7);
    expect(clean.fgMade).toEqual({ '20-29': 1, '50-59': 1 });
  });

  it('clamps negatives to zero — the draw never emits a negative count', () => {
    const raw = { ...structuredClone(FLOAT_PROJECTIONS.QB), passYards: -3.2, passTd: -0.5 };
    const clean = integerStatLine(raw);
    expect(clean.passYards).toBe(0);
    expect(clean.passTd).toBe(0);
  });

  it('is idempotent — an already-clean line round-trips unchanged', () => {
    const once = integerStatLine(FLOAT_PROJECTIONS.QB);
    const twice = integerStatLine(once);
    expect(twice).toEqual(once);
    // And a hand-built integer line passes through untouched.
    const integer: StatLine = {
      ...FLOAT_PROJECTIONS.QB,
      passYards: 302,
      passTd: 2,
      interceptions: 1,
      rushYards: 18,
      rushTd: 1,
      fumblesLost: 0,
    };
    expect(integerStatLine(integer)).toEqual(integer);
  });

  it('sorts fgMade band keys so the output bytes cannot depend on input order', () => {
    const clean = integerStatLine({ ...FLOAT_PROJECTIONS.K, fgMade: { '50-59': 0.2, '20-29': 0.8 } });
    expect(Object.keys(clean.fgMade)).toEqual(['20-29', '50-59']);
  });
});

describe('drawStatLine under float projections', () => {
  it('emits only integer stats the strict validator accepts', () => {
    const card: PlayerCard = {
      id: 'p-hostile',
      name: 'Hostile Floats',
      position: 'QB',
      projection: {
        ...structuredClone(FLOAT_PROJECTIONS.QB),
        passYards: 999999.99, // huge
        rushYards: 0.0001, // tiny
        receptions: 6.5, // exact half
      },
      variance: 0.35,
    };
    const drawn = drawStatLine(card, 'lg_float-demo', 6);
    for (const field of COUNTER_FIELDS) {
      expect(Number.isInteger(drawn[field]), `${field} = ${drawn[field]}`).toBe(true);
    }
    // The strict scorer validates every counter field and must accept the
    // engine's own output — this throws invalid-stat-line if it does not.
    expect(() => scoreLineScaled(drawn, rules)).not.toThrow();
    expect(() => pointsAllowedBonusScaled(drawn.pointsAllowed, rules)).not.toThrow();
  });

  it('still rejects a non-finite or negative variance — the validator is not loosened', () => {
    const nanVariance: PlayerCard = {
      ...structuredClone(FLOAT_PROJECTIONS.QB),
      id: 'p-nan-variance',
      name: 'NaN Variance',
      variance: Number.NaN,
    };
    expect(() => drawStatLine(nanVariance, 'lg_float-demo', 6)).toThrowError(DomainError);
    const negative: PlayerCard = {
      ...structuredClone(FLOAT_PROJECTIONS.QB),
      id: 'p-neg-variance',
      name: 'Negative Variance',
      variance: -0.1,
    };
    expect(() => drawStatLine(negative, 'lg_float-demo', 6)).toThrowError(DomainError);
  });

  it('replays byte-identically for the same identity-seeded draw', () => {
    const card: PlayerCard = {
      id: 'p-replay',
      name: 'Replay',
      position: 'QB',
      variance: 0.15,
      projection: structuredClone(FLOAT_PROJECTIONS.QB),
    };
    const first = drawStatLine(card, 'lg_float-demo', 6);
    const second = drawStatLine(card, 'lg_float-demo', 6);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('week simulation from float projections — 10 teams', () => {
  it('simulates a full week with no invalid-stat-line and integer box scores', () => {
    const { league, managers } = makeFloatLeague();
    const week = 6;
    const simulated: SimLeague = {
      ...league,
      pairings: managers.slice(0, 5).map((home, i) => ({ home, away: managers[9 - i]! })),
    };
    const result = simulateWeek(simulated, week);
    result.games.forEach((game) => {
      game.homeBox.lines.forEach((entry) => expectIntegerLine(entry.stats, `week ${week} home`));
      game.awayBox.lines.forEach((entry) => expectIntegerLine(entry.stats, `week ${week} away`));
    });
  });

  it('replays the same week byte-identically', () => {
    const { league, managers } = makeFloatLeague();
    const simulated: SimLeague = {
      ...league,
      pairings: managers.slice(0, 5).map((home, i) => ({ home, away: managers[9 - i]! })),
    };
    const first = simulateWeek(simulated, 6);
    const second = simulateWeek(simulated, 6);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('full season simulation from float projections — 10 teams', () => {
  const { league, managers } = makeFloatLeague();
  const schedule = roundRobinSchedule(managers, 10 - playoffWeeks(4), league.id);

  it('simulates the regular season and the bracket with no invalid-stat-line', () => {
    const season = simulateSeason(league, schedule);
    expect(season.weeks.length).toBe(10); // 8 regular + 2 bracket weeks
    season.weeks.forEach((week) =>
      week.games.forEach((game) => {
        game.homeBox.lines.forEach((entry) =>
          expectIntegerLine(entry.stats, `week ${week.week} home`),
        );
        game.awayBox.lines.forEach((entry) =>
          expectIntegerLine(entry.stats, `week ${week.week} away`),
        );
      }),
    );
    // Standings derive from the stored weeks and must rank cleanly.
    expect(computeStandings(season.weeks.slice(0, 8)).length).toBe(10);
    expect(season.champion).toBeDefined();
  });

  it('replays the whole season byte-identically across runs', () => {
    const first = simulateSeason(league, schedule);
    const second = simulateSeason(league, schedule);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
