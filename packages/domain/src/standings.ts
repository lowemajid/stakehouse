import type { ManagerId } from './brand';
import { DomainError } from './errors';
import type { WeekResult } from './simulation';

/**
 * One manager's regular-season line: record and points. Points ride the
 * simulation's milli-scaled totals, so equal records compare on exact values.
 */
export interface StandingRow {
  managerId: ManagerId;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

/**
 * The stated tiebreaker chain — a total order, so the board is always
 * deterministic and every rank is explainable in league chat:
 *
 *   1. more wins;
 *   2. more points for;
 *   3. fewer points against;
 *   4. managerId ascending (lexicographic) — never a coin flip.
 */
function compareRows(a: StandingRow, b: StandingRow): number {
  return (
    b.wins - a.wins ||
    b.pointsFor - a.pointsFor ||
    a.pointsAgainst - b.pointsAgainst ||
    (String(a.managerId) < String(b.managerId) ? -1 : 1)
  );
}

/**
 * Fold week results into ranked standings. Results may arrive in any order —
 * weeks are consumed in ascending order and games in a canonical order so the
 * accumulation (and its floating-point sums) is reproducible. Two results for
 * the same week are a caller bug and rejected.
 */
export function computeStandings(results: readonly WeekResult[]): StandingRow[] {
  const byWeek = new Map<number, WeekResult>();
  for (const result of results) {
    if (byWeek.has(result.week)) {
      throw new DomainError('invalid-week-result', `week ${result.week} appears in two results`);
    }
    byWeek.set(result.week, result);
  }

  const rows = new Map<string, StandingRow>();
  const rowFor = (id: ManagerId): StandingRow => {
    const existing = rows.get(String(id));
    if (existing) return existing;
    const row: StandingRow = {
      managerId: id,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
    rows.set(String(id), row);
    return row;
  };
  const accumulate = (id: ManagerId, scored: number, allowed: number): void => {
    const row = rowFor(id);
    row.pointsFor += scored;
    row.pointsAgainst += allowed;
    if (scored > allowed) row.wins += 1;
    else if (scored < allowed) row.losses += 1;
    else row.ties += 1;
  };

  const weekNumbers = [...byWeek.keys()].sort((a, b) => a - b);
  for (const weekNumber of weekNumbers) {
    const result = byWeek.get(weekNumber)!;
    const games = [...result.games].sort(
      (a, b) =>
        (String(a.home) < String(b.home) ? -1 : String(a.home) > String(b.home) ? 1 : 0) ||
        (String(a.away) < String(b.away) ? -1 : String(a.away) > String(b.away) ? 1 : 0),
    );
    for (const game of games) {
      accumulate(game.homeBox.managerId, game.homeBox.total, game.awayBox.total);
      accumulate(game.awayBox.managerId, game.awayBox.total, game.homeBox.total);
    }
  }

  return [...rows.values()].sort(compareRows);
}
