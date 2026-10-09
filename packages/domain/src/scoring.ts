import { DomainError } from './errors';
import type { ScoringRules } from './leagueConfig';

/**
 * The player universe's position vocabulary. The lineup-slot vocabulary
 * (which adds FLEX) lives in simulation.ts.
 */
export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

/**
 * One player's counting stats for a single week. Every field is a
 * non-negative integer; `scoreLine` rejects anything else. `pointsAllowed`
 * scores only on a defense line — combine `scoreLine` with
 * `pointsAllowedBonus` for the DEF slot, which keeps the scorer itself
 * position-agnostic (a quarterback's 0 points allowed must never earn a
 * shutout bonus).
 */
export interface StatLine {
  passYards: number;
  passTd: number;
  interceptions: number;
  rushYards: number;
  rushTd: number;
  receptions: number;
  fumblesLost: number;
  fgMade: Record<string, number>; // made field goals per distance band
  extraPointsMade: number;
  sacks: number;
  takeaways: number;
  defensiveTd: number;
  pointsAllowed: number;
}

export function zeroStatLine(): StatLine {
  return {
    passYards: 0,
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
  };
}

/**
 * Points are decimal (0.04 per passing yard) but floating arithmetic drifts:
 * 39 × 0.1 is 3.9000000000000004 in binary, and naive category sums land on
 * 7.380000000000001. Every rate is therefore converted once into integer
 * milli-points and all summation happens there; the public `scoreLine`
 * divides exactly once at the end. Rates finer than one milli-point cannot
 * be represented exactly and are rejected rather than silently rounded.
 */
export const POINTS_SCALE = 1000;

const COUNTER_FIELDS = [
  'passYards',
  'passTd',
  'interceptions',
  'rushYards',
  'rushTd',
  'receptions',
  'fumblesLost',
  'extraPointsMade',
  'sacks',
  'takeaways',
  'defensiveTd',
  'pointsAllowed',
] as const;

function scaledRate(rate: number, label: string): number {
  if (!Number.isFinite(rate)) {
    throw new DomainError('invalid-scoring-rules', `scoring rate ${label} must be finite`);
  }
  const milli = rate * POINTS_SCALE;
  const rounded = Math.round(milli);
  if (Math.abs(milli - rounded) > 1e-6) {
    throw new DomainError(
      'invalid-scoring-rules',
      `scoring rate ${label}=${rate} must be a multiple of 0.001 points`,
    );
  }
  return rounded;
}

function assertCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError(
      'invalid-stat-line',
      `stat ${label} must be a non-negative integer, got ${value}`,
    );
  }
  return value;
}

/** Exact line total in integer milli-points — the sum other code can trust. */
export function scoreLineScaled(stats: StatLine, rules: ScoringRules): number {
  for (const field of COUNTER_FIELDS) {
    assertCount(stats[field], field);
  }
  for (const [band, made] of Object.entries(stats.fgMade)) {
    assertCount(made, `fgMade.${band}`);
  }
  let total = 0;
  total += scaledRate(rules.passYards, 'passYards') * stats.passYards;
  total += scaledRate(rules.passTd, 'passTd') * stats.passTd;
  total += scaledRate(rules.interception, 'interception') * stats.interceptions;
  total += scaledRate(rules.rushYards, 'rushYards') * stats.rushYards;
  total += scaledRate(rules.rushTd, 'rushTd') * stats.rushTd;
  total += scaledRate(rules.reception, 'reception') * stats.receptions;
  total += scaledRate(rules.fumbleLost, 'fumbleLost') * stats.fumblesLost;
  for (const [band, made] of Object.entries(stats.fgMade)) {
    const rate = rules.kicking.fg[band];
    if (rate === undefined) {
      throw new DomainError(
        'unknown-scoring-band',
        `field-goal band "${band}" is not defined in the league's scoring rules`,
      );
    }
    total += scaledRate(rate, `kicking.fg.${band}`) * made;
  }
  total += scaledRate(rules.kicking.extraPoint, 'kicking.extraPoint') * stats.extraPointsMade;
  total += scaledRate(rules.defense.sack, 'defense.sack') * stats.sacks;
  total += scaledRate(rules.defense.takeaway, 'defense.takeaway') * stats.takeaways;
  total += scaledRate(rules.defense.td, 'defense.td') * stats.defensiveTd;
  return total;
}

/** Points scored by one player's stat line under the league's rules. */
export function scoreLine(stats: StatLine, rules: ScoringRules): number {
  return scoreLineScaled(stats, rules) / POINTS_SCALE;
}

/**
 * Team-defense bonus from points allowed. Bands are `[lowerBound, points]`
 * pairs — the band with the greatest lower bound ≤ points allowed wins, no
 * matter the order they appear in the config; points allowed beyond the last
 * band earns nothing. This slice is the first consumer of
 * `pointsAllowedBands`, so the semantics are defined (and pinned) here.
 */
export function pointsAllowedBonusScaled(pointsAllowed: number, rules: ScoringRules): number {
  assertCount(pointsAllowed, 'pointsAllowed');
  const bands = [...rules.defense.pointsAllowedBands].sort((a, b) => a[0] - b[0]);
  for (let i = bands.length - 1; i >= 0; i--) {
    const band = bands[i];
    if (band && pointsAllowed >= band[0]) {
      return scaledRate(band[1], `defense.pointsAllowedBands[${band[0]}]`);
    }
  }
  return 0;
}

/** Points-allowed bonus in points (see `pointsAllowedBonusScaled`). */
export function pointsAllowedBonus(pointsAllowed: number, rules: ScoringRules): number {
  return pointsAllowedBonusScaled(pointsAllowed, rules) / POINTS_SCALE;
}
