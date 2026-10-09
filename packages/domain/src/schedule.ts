import type { LeagueId, ManagerId } from './brand';
import { DomainError } from './errors';
import { hash32, mulberry32 } from './rng';
import type { Rng } from './rng';
import type { SimMatchup } from './simulation';

/**
 * The regular-season schedule: head-to-head pairings week by week. The
 * schedule is pure data — the simulation consumes it one week at a time.
 */
export interface ScheduleWeek {
  /** 1-based week number. */
  week: number;
  matchups: SimMatchup[];
}

export interface Schedule {
  weeks: ScheduleWeek[];
}

/** Fisher–Yates over a copy — a deterministic shuffle under a seeded rng. */
function seededShuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

/**
 * Round-robin schedule (circle method) for an even number of managers over
 * `weeks` weeks.
 *
 * Guarantees:
 * - no manager is seated twice in one week — every week pairs all managers;
 * - within the first `size − 1` weeks no pairing repeats; later weeks cycle
 *   back through the same rounds with home and away flipped, so rematches
 *   swap venues and home/away balances across a full cycle;
 * - the pairing order derives from a shuffle seeded by league identity —
 *   the same league always replays to the same schedule, and the order the
 *   managers arrive in never matters (inputs are canonically sorted first).
 */
export function roundRobinSchedule(
  managers: readonly ManagerId[],
  weeks: number,
  league: LeagueId,
): Schedule {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new DomainError('invalid-schedule', `weeks must be a positive integer, got ${weeks}`);
  }
  if (new Set(managers.map(String)).size !== managers.length) {
    throw new DomainError('invalid-schedule', 'duplicate manager ids cannot share a schedule');
  }
  if (managers.length < 2 || managers.length % 2 !== 0) {
    throw new DomainError(
      'invalid-schedule',
      `an even number of managers (at least 2) is required, got ${managers.length}`,
    );
  }

  // Identity-seeded rotation order: deterministic per league, independent of
  // the order managers arrive in.
  const rng = mulberry32(hash32(`${league}:schedule`));
  const rotation = seededShuffle([...managers].sort(), rng);
  const size = rotation.length;
  // Each manager's slot in the seeded rotation — stable across rounds and the
  // basis of the venue rule below.
  const baseIndex = new Map<string, number>(rotation.map((m, index) => [String(m), index]));

  const weekFor = (week: number): ScheduleWeek => {
    const round = (week - 1) % (size - 1); // position within one round-robin cycle
    const cycle = Math.floor((week - 1) / (size - 1)); // which pass through the cycle
    const rotated = [rotation[0]!, ...rotation.slice(1 + round), ...rotation.slice(1, 1 + round)];
    const matchups: SimMatchup[] = [];
    for (let i = 0; i < size / 2; i++) {
      const first = rotated[i]!;
      const second = rotated[size - 1 - i]!;
      // Venue rule: a manager hosts when (baseSlot + round) is even. The two
      // members of any pair always sit in slots of opposite parity, so exactly
      // one of them hosts — and over a full cycle every manager's home count
      // differs from its away count by at most one. Repeat cycles flip every
      // venue, so rematches swap hosts.
      const homeIsFirst = ((baseIndex.get(String(first))! + round) % 2 === 0) !== (cycle % 2 === 1);
      matchups.push(homeIsFirst ? { home: first, away: second } : { home: second, away: first });
    }
    // Canonical output order: the schedule must not depend on shuffle-visible
    // iteration order within a week.
    matchups.sort((a, b) => (a.home < b.home ? -1 : a.home > b.home ? 1 : 0));
    return { week, matchups };
  };

  return { weeks: Array.from({ length: weeks }, (_, i) => weekFor(i + 1)) };
}
