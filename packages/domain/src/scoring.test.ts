import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import type { DomainErrorCode } from './errors';
import type { ScoringRules } from './leagueConfig';
import {
  pointsAllowedBonus,
  projectedPoints,
  scoreLine,
  scoreLineScaled,
  zeroStatLine,
} from './scoring';
import type { Projection, StatLine } from './scoring';

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

const halfPpr: ScoringRules = { ...rules, reception: 0.5 };
const standardPpr: ScoringRules = { ...rules, reception: 0 };

function expectDomainError(fn: () => unknown, code: DomainErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof DomainError)) {
    throw new Error(`expected DomainError[${code}], got ${String(caught)}`);
  }
  expect(caught.code).toBe(code);
}

describe('scoreLine golden vectors', () => {
  it('pins the full-PPR total for a receiving back, hand-computed', () => {
    // 84 rush yards ×0.1 = 8.4, 1 rush TD ×6, 6 receptions ×1, 1 fumble ×−2
    const line: StatLine = {
      ...zeroStatLine(),
      rushYards: 84,
      rushTd: 1,
      receptions: 6,
      fumblesLost: 1,
    };
    expect(scoreLineScaled(line, rules)).toBe(18400);
    expect(scoreLine(line, rules)).toBe(18.4);
  });

  it('pins the half-PPR total for the same line', () => {
    const line: StatLine = {
      ...zeroStatLine(),
      rushYards: 84,
      rushTd: 1,
      receptions: 6,
      fumblesLost: 1,
    };
    expect(scoreLineScaled(line, halfPpr)).toBe(15400);
    expect(scoreLine(line, halfPpr)).toBe(15.4);
  });

  it('pins the standard-PPR total for the same line', () => {
    const line: StatLine = {
      ...zeroStatLine(),
      rushYards: 84,
      rushTd: 1,
      receptions: 6,
      fumblesLost: 1,
    };
    expect(scoreLineScaled(line, standardPpr)).toBe(12400);
    expect(scoreLine(line, standardPpr)).toBe(12.4);
  });

  it('pins a dual-threat quarterback total under every PPR setting', () => {
    // 312 pass yards ×0.04 = 12.48, 3 pass TDs ×4, 1 interception ×−2,
    // 15 rush yards ×0.1 = 1.5 → 23.98. Receptions never move a QB line.
    const line: StatLine = {
      ...zeroStatLine(),
      passYards: 312,
      passTd: 3,
      interceptions: 1,
      rushYards: 15,
    };
    const expectedMilli = 312 * 40 + 3 * 4000 - 1 * 2000 + 15 * 100;
    expect(expectedMilli).toBe(23980);
    for (const variant of [rules, halfPpr, standardPpr]) {
      expect(scoreLineScaled(line, variant)).toBe(23980);
      expect(scoreLine(line, variant)).toBe(23.98);
    }
  });

  it('pins receiver-only production under all three PPR settings', () => {
    const line: StatLine = { ...zeroStatLine(), receptions: 11 };
    expect(scoreLine(line, standardPpr)).toBe(0);
    expect(scoreLineScaled(line, halfPpr)).toBe(5500);
    expect(scoreLine(line, halfPpr)).toBe(5.5);
    expect(scoreLine(line, rules)).toBe(11);
  });

  it('scores made field goals by distance band and extra points', () => {
    // 2×4 (40-49) + 1×5 (50-59) + 3×1 XPs = 16
    const line: StatLine = {
      ...zeroStatLine(),
      fgMade: { '40-49': 2, '50-59': 1 },
      extraPointsMade: 3,
    };
    expect(scoreLine(line, rules)).toBe(16);
  });

  it('scores defensive counters without the points-allowed bonus', () => {
    // 2 sacks ×1 + 3 takeaways ×2 + 1 defensive TD ×6 = 14; the points-allowed
    // bands are scored separately via pointsAllowedBonus.
    const line: StatLine = {
      ...zeroStatLine(),
      sacks: 2,
      takeaways: 3,
      defensiveTd: 1,
      pointsAllowed: 13,
    };
    expect(scoreLine(line, rules)).toBe(14);
  });

  it('returns exactly zero for an empty stat line', () => {
    expect(scoreLineScaled(zeroStatLine(), rules)).toBe(0);
    expect(scoreLine(zeroStatLine(), rules)).toBe(0);
  });
});

describe('float-exactness contract', () => {
  it('avoids binary-float drift that naive multiplication introduces', () => {
    // 39 × 0.1 evaluates to 3.9000000000000004 in binary floats and the naive
    // two-category sum lands on 7.380000000000001 — not the decimal total.
    // Scaled-integer milli-points hit 7.38 exactly, and the pin is toBe.
    const line: StatLine = { ...zeroStatLine(), passYards: 87, rushYards: 39 };
    expect(scoreLineScaled(line, rules)).toBe(7380);
    expect(scoreLine(line, rules)).toBe(7.38);
  });

  it('rejects scoring rates finer than one thousandth of a point', () => {
    const badRules: ScoringRules = { ...rules, passYards: 0.0004 };
    expectDomainError(() => scoreLine(zeroStatLine(), badRules), 'invalid-scoring-rules');
  });
});

describe('pointsAllowedBonus', () => {
  it('picks the band with the greatest lower bound at or below points allowed', () => {
    // Bands are [lowerBound, points]: 0→10, 10→7, 20→3, 30→1, 40→0.
    expect(pointsAllowedBonus(0, rules)).toBe(10);
    expect(pointsAllowedBonus(9, rules)).toBe(10);
    expect(pointsAllowedBonus(10, rules)).toBe(7);
    expect(pointsAllowedBonus(13, rules)).toBe(7);
    expect(pointsAllowedBonus(20, rules)).toBe(3);
    expect(pointsAllowedBonus(39, rules)).toBe(1);
    expect(pointsAllowedBonus(40, rules)).toBe(0);
    expect(pointsAllowedBonus(55, rules)).toBe(0); // beyond the last band → no bonus
  });

  it('is independent of band ordering in the rules', () => {
    const shuffled: ScoringRules = {
      ...rules,
      defense: {
        ...rules.defense,
        pointsAllowedBands: [
          [30, 1],
          [0, 10],
          [40, 0],
          [10, 7],
          [20, 3],
        ],
      },
    };
    expect(pointsAllowedBonus(13, shuffled)).toBe(7);
    expect(pointsAllowedBonus(55, shuffled)).toBe(0);
  });

  it('rejects negative or fractional points allowed', () => {
    expectDomainError(() => pointsAllowedBonus(-1, rules), 'invalid-stat-line');
    expectDomainError(() => pointsAllowedBonus(13.5, rules), 'invalid-stat-line');
  });
});

describe('stat line validation', () => {
  it('rejects negative or fractional counters', () => {
    expectDomainError(
      () => scoreLine({ ...zeroStatLine(), rushYards: -5 }, rules),
      'invalid-stat-line',
    );
    expectDomainError(
      () => scoreLine({ ...zeroStatLine(), receptions: 2.5 }, rules),
      'invalid-stat-line',
    );
    expectDomainError(
      () => scoreLine({ ...zeroStatLine(), fgMade: { '40-49': -1 } }, rules),
      'invalid-stat-line',
    );
  });

  it('rejects field goals from bands the rules do not define', () => {
    const line: StatLine = { ...zeroStatLine(), fgMade: { '70+': 1 } };
    expectDomainError(() => scoreLine(line, rules), 'unknown-scoring-band');
  });
});

describe('projectedPoints', () => {
  it('scores a fractional projection as its rounded stat line', () => {
    const projection: Projection = {
      ...zeroStatLine(),
      passYards: 220.79,
      passTd: 1.26,
      rushYards: 5.77,
      receptions: 3.2,
    };
    const rounded: StatLine = {
      ...zeroStatLine(),
      passYards: 221,
      passTd: 1,
      rushYards: 6,
      receptions: 3,
    };
    expect(projectedPoints(projection, rules)).toBe(scoreLine(rounded, rules));
  });

  it('rounds fractional field-goal means per band before scoring', () => {
    const projection: Projection = {
      ...zeroStatLine(),
      fgMade: { '0-19': 0.11, '30-39': 1.6 },
    };
    const rounded: StatLine = {
      ...zeroStatLine(),
      fgMade: { '0-19': 0, '30-39': 2 },
    };
    expect(projectedPoints(projection, rules)).toBe(scoreLine(rounded, rules));
  });

  it('rejects negative field-goal means', () => {
    const projection: Projection = { ...zeroStatLine(), fgMade: { '0-19': -0.5 } };
    expectDomainError(() => projectedPoints(projection, rules), 'invalid-stat-line');
  });

  it('rejects negative or non-finite projection counters', () => {
    expectDomainError(
      () => projectedPoints({ ...zeroStatLine(), rushYards: -5 }, rules),
      'invalid-stat-line',
    );
    expectDomainError(
      () => projectedPoints({ ...zeroStatLine(), passYards: Number.NaN }, rules),
      'invalid-stat-line',
    );
  });
});
