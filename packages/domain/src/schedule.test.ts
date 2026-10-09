import { describe, expect, it } from 'vitest';
import { leagueId, managerId } from './brand';
import type { ManagerId } from './brand';
import { DomainError } from './errors';
import { roundRobinSchedule } from './schedule';
import type { Schedule } from './schedule';

const lg = leagueId('lg-autumn-veil');

function managers(count: number): ManagerId[] {
  return Array.from({ length: count }, (_, i) => managerId(`mgr-${i + 1}`));
}

function unorderedPair(matchup: { home: ManagerId; away: ManagerId }): string {
  const [a, b] = [matchup.home, matchup.away].sort();
  return `${String(a)}|${String(b)}`;
}

describe('roundRobinSchedule — shape', () => {
  for (const size of [4, 6, 8, 10, 12] as const) {
    it(`seats all ${size} teams exactly once per week for 10 weeks`, () => {
      const roster = managers(size);
      const schedule = roundRobinSchedule(roster, 10, lg);
      expect(schedule.weeks).toHaveLength(10);
      schedule.weeks.forEach((week, index) => {
        expect(week.week).toBe(index + 1);
        expect(week.matchups).toHaveLength(size / 2);
        const seats = week.matchups.flatMap((m) => [m.home, m.away]).sort();
        expect(seats).toHaveLength(size);
        expect(new Set(seats.map(String)).size).toBe(size); // no team plays twice in a week
      });
    });
  }

  it('plays every pairing exactly once before a cycle repeats (weeks ≤ size−1)', () => {
    const size = 10;
    const schedule = roundRobinSchedule(managers(size), size - 1, lg);
    const pairs = schedule.weeks.flatMap((week) => week.matchups.map(unorderedPair));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('balances home and away across a full round-robin cycle', () => {
    const size = 12;
    const schedule = roundRobinSchedule(managers(size), size - 1, lg);
    const home = new Map<string, number>();
    const away = new Map<string, number>();
    for (const week of schedule.weeks) {
      for (const m of week.matchups) {
        home.set(String(m.home), (home.get(String(m.home)) ?? 0) + 1);
        away.set(String(m.away), (away.get(String(m.away)) ?? 0) + 1);
      }
    }
    for (const m of managers(size)) {
      const h = home.get(String(m)) ?? 0;
      const a = away.get(String(m)) ?? 0;
      expect(Math.abs(h - a)).toBeLessThanOrEqual(1); // an odd number of games splits as evenly as possible
    }
  });
});

describe('roundRobinSchedule — determinism', () => {
  it('replays identically across runs for the same league and managers', () => {
    const roster = managers(10);
    const first = roundRobinSchedule(roster, 10, lg);
    const second = roundRobinSchedule(roster, 10, lg);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('ignores the order managers arrive in — seeds derive from identity, not array order', () => {
    const roster = managers(8);
    const straight = roundRobinSchedule(roster, 10, lg);
    const reversed = roundRobinSchedule([...roster].reverse(), 10, lg);
    expect(JSON.stringify(straight)).toBe(JSON.stringify(reversed));
  });

  it('gives two different leagues different-but-stable schedules', () => {
    const roster = managers(6);
    const a = roundRobinSchedule(roster, 10, leagueId('lg-one'));
    const b = roundRobinSchedule(roster, 10, leagueId('lg-two'));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(
      JSON.stringify(roundRobinSchedule(roster, 10, leagueId('lg-one'))),
    );
  });
});

describe('roundRobinSchedule — repeat cycles flip venues', () => {
  it('rematches the same pairings with home and away swapped on the second cycle', () => {
    const schedule: Schedule = roundRobinSchedule(managers(4), 6, lg);
    const week1 = schedule.weeks[0]!;
    const week4 = schedule.weeks[3]!;
    const week1Pairs = new Map(week1.matchups.map((m) => [unorderedPair(m), m]));
    for (const rematch of week4.matchups) {
      const original = week1Pairs.get(unorderedPair(rematch));
      expect(original, 'week 4 must rematch week 1 pairings').toBeDefined();
      expect(rematch.home).toBe(original!.away);
      expect(rematch.away).toBe(original!.home);
    }
  });
});

describe('roundRobinSchedule — rejections', () => {
  const cases: Array<[string, ManagerId[], number]> = [
    ['an odd number of managers cannot pair cleanly', managers(5), 4],
    ['a single manager has no opponent', managers(1), 2],
    ['duplicate manager ids would double-book a seat', [...managers(4), managers(4)[3]!], 4],
    ['zero weeks schedules nothing meaningful', managers(4), 0],
    ['negative weeks are nonsense', managers(4), -2],
  ];
  for (const [story, roster, weeks] of cases) {
    it(`rejects ${story} with 'invalid-schedule'`, () => {
      expect(() => roundRobinSchedule(roster, weeks, lg)).toThrowError(DomainError);
      expect(() => roundRobinSchedule(roster, weeks, lg)).toThrowError(/invalid-schedule|schedule/);
    });
  }
});
