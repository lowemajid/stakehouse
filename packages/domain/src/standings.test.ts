import { describe, expect, it } from 'vitest';
import { managerId } from './brand';
import type { ManagerId } from './brand';
import { DomainError } from './errors';
import { computeStandings } from './standings';
import type { StandingRow } from './standings';
import type { BoxScore, SimGame, WeekResult } from './simulation';

const mgr = (raw: string): ManagerId => managerId(raw);

// Standings read only box totals — an empty lines array is the honest minimal fixture.
function box(manager: ManagerId, total: number): BoxScore {
  return { managerId: manager, total, lines: [] };
}

function game(
  week: number,
  home: ManagerId,
  homeTotal: number,
  away: ManagerId,
  awayTotal: number,
): SimGame {
  return {
    home,
    away,
    homeBox: box(home, homeTotal),
    awayBox: box(away, awayTotal),
  };
}

function week(week: number, ...games: SimGame[]): WeekResult {
  return { week, games };
}

/**
 * Fixture: four managers, two weeks.
 *   week 1 — A 120 : 100 B   |   C 90 : 95 D
 *   week 2 — A 80 : 80 C (tie) |   B 70 : 60 D
 * Records: A 1-0-1 · B 1-1-0 · C 0-1-1 · D 1-1-0
 */
const A = mgr('mgr-a');
const B = mgr('mgr-b');
const C = mgr('mgr-c');
const D = mgr('mgr-d');

function fixture(): WeekResult[] {
  return [
    week(1, game(1, A, 120, B, 100), game(1, C, 90, D, 95)),
    week(2, game(2, A, 80, C, 80), game(2, B, 70, D, 60)),
  ];
}

describe('computeStandings — records and points', () => {
  it('accumulates wins, losses, ties, points for, and points against', () => {
    const rows = computeStandings(fixture());
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.managerId === A)).toMatchObject({
      wins: 1,
      losses: 0,
      ties: 1,
      pointsFor: 200,
      pointsAgainst: 180,
    });
    expect(rows.find((r) => r.managerId === B)).toMatchObject({
      wins: 1,
      losses: 1,
      ties: 0,
      pointsFor: 170,
      pointsAgainst: 160,
    });
    expect(rows.find((r) => r.managerId === C)).toMatchObject({
      wins: 0,
      losses: 1,
      ties: 1,
      pointsFor: 170,
      pointsAgainst: 175,
    });
    expect(rows.find((r) => r.managerId === D)).toMatchObject({
      wins: 1,
      losses: 1,
      ties: 0,
      pointsFor: 155,
      pointsAgainst: 155,
    });
  });

  it('ranks by the stated tiebreaker chain: wins ↓, pointsFor ↓, pointsAgainst ↑, managerId ↑', () => {
    const rows = computeStandings(fixture());
    // A 1-0-1 beats the 1-1-0 crowd; B and D split on pointsFor (170 > 155); C 0-1-1 is last.
    expect(rows.map((r: StandingRow) => r.managerId)).toEqual([A, B, D, C]);
  });

  it('breaks equal records on points for, then points against, then id — a total order', () => {
    // All four end 1-1-0; PF separates a/b, PA separates c/d (equal PF), id breaks the rest.
    const w = week(
      1,
      game(1, A, 150, B, 100),
      game(1, C, 120, D, 110),
      game(1, D, 200, A, 90),
      game(1, B, 120, C, 118),
    );
    const rows = computeStandings([w]);
    // All 1-1-0; pointsFor alone separates them: D 310 > A 240 > C 238 > B 220.
    expect(rows.map((r) => r.managerId)).toEqual([D, A, C, B]);
  });

  it('never reorders on equal breakers — the chain ends at a deterministic id comparison', () => {
    const w1 = week(1, game(1, A, 100, B, 100));
    const w2 = week(2, game(2, C, 100, D, 100));
    const rows = computeStandings([w1, w2]);
    expect(rows.map((r) => r.managerId)).toEqual([A, B, C, D]);
  });
});

describe('computeStandings — determinism and validation', () => {
  it('is independent of the order week results arrive in', () => {
    const straight = computeStandings(fixture());
    const shuffled = computeStandings([...fixture()].reverse());
    expect(JSON.stringify(straight)).toBe(JSON.stringify(shuffled));
  });

  it('sums fractional (milli-scaled) totals without drift', () => {
    const w = week(1, game(1, A, 92.345, B, 92.345));
    const rows = computeStandings([w]);
    expect(rows[0]!.pointsFor).toBe(92.345);
    expect(rows[0]!.pointsAgainst).toBe(92.345);
    expect(rows[0]!.ties).toBe(1);
  });

  it('rejects two results for the same week', () => {
    expect(() => computeStandings([...fixture(), week(1)])).toThrowError(DomainError);
  });

  it('returns an empty board for an empty season', () => {
    expect(computeStandings([])).toEqual([]);
  });
});
