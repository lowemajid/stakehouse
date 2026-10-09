import type { ManagerId } from './brand';
import { DomainError } from './errors';
import type { LeagueConfig } from './leagueConfig';
import type { Schedule } from './schedule';
import type { SimGame, SimLeague, SimMatchup, WeekResult } from './simulation';
import { simulateWeek } from './simulation';
import { computeStandings } from './standings';
import type { StandingRow } from './standings';

/** Bracket rounds occupy this many weeks at the end of the season. */
export function playoffWeeks(playoffTeams: 0 | 2 | 4): 0 | 1 | 2 {
  return playoffTeams === 4 ? 2 : playoffTeams === 2 ? 1 : 0;
}

export interface BracketMatchup {
  week: number;
  home: ManagerId;
  away: ManagerId;
  label: 'semifinal' | 'final';
  /** Original regular-season seed numbers of the two participants, better seed first. */
  seeds: [number, number];
}

export interface BracketResult {
  matchup: BracketMatchup;
  winner: ManagerId;
}

export interface SeasonResult {
  /** Every simulated week in order — regular season first, then bracket rounds. */
  weeks: WeekResult[];
  /** Final regular-season standings — the bracket is seeded from exactly these. */
  standings: StandingRow[];
  bracket: BracketMatchup[];
  results: BracketResult[];
  champion: ManagerId;
}

/**
 * Seat the first playoff round over the final weeks of the season. A 4-team
 * bracket plays the semifinals 1v4 / 2v3 in week N−1 and derives the final in
 * week N from the winners; a 2-team bracket seats the final alone in week N;
 * no playoffs means no bracket. The later rounds cannot be seeded in advance —
 * they are derived by `simulateSeason` as results land.
 */
export function seedBracket(
  config: LeagueConfig,
  standings: readonly StandingRow[],
): BracketMatchup[] {
  if (config.playoffTeams === 0) return [];
  if (standings.length < config.playoffTeams) {
    throw new DomainError(
      'invalid-bracket',
      `a ${config.playoffTeams}-team bracket needs at least ${config.playoffTeams} ranked managers, got ${standings.length}`,
    );
  }
  const week = config.regularSeasonWeeks;
  if (config.playoffTeams === 2) {
    return [
      {
        week,
        home: standings[0]!.managerId,
        away: standings[1]!.managerId,
        label: 'final',
        seeds: [1, 2],
      },
    ];
  }
  return [
    {
      week: week - 1,
      home: standings[0]!.managerId,
      away: standings[3]!.managerId,
      label: 'semifinal',
      seeds: [1, 4],
    },
    {
      week: week - 1,
      home: standings[1]!.managerId,
      away: standings[2]!.managerId,
      label: 'semifinal',
      seeds: [2, 3],
    },
  ];
}

/** In a knockout game a tie goes to the host — who is always the better seed. */
function winnerOf(matchup: BracketMatchup, game: SimGame): ManagerId {
  return game.homeBox.total >= game.awayBox.total ? matchup.home : matchup.away;
}

/** Original seed of a matchup's winner. */
function winningSeed(matchup: BracketMatchup, winner: ManagerId): number {
  return winner === matchup.home ? matchup.seeds[0]! : matchup.seeds[1]!;
}

function toMatchup(bracket: BracketMatchup): SimMatchup {
  return { home: bracket.home, away: bracket.away };
}

function playWeek(league: SimLeague, matchups: readonly SimMatchup[], week: number): WeekResult {
  return simulateWeek({ ...league, pairings: matchups }, week);
}

/**
 * Simulate a full season: the schedule's regular weeks, standings from their
 * results, then the bracket seeded from those standings and played out over
 * the final weeks. Pure and deterministic — the same league and schedule
 * always replay to byte-identical results, bracket and champion included.
 */
export function simulateSeason(league: SimLeague, schedule: Schedule): SeasonResult {
  const { config } = league;
  const regularWeeks = config.regularSeasonWeeks - playoffWeeks(config.playoffTeams);
  if (schedule.weeks.length !== regularWeeks) {
    throw new DomainError(
      'invalid-schedule',
      `the schedule covers ${schedule.weeks.length} weeks but the regular season is exactly ${regularWeeks}`,
    );
  }

  const weeks: WeekResult[] = [];
  for (const scheduleWeek of schedule.weeks) {
    weeks.push(playWeek(league, scheduleWeek.matchups, scheduleWeek.week));
  }

  const standings = computeStandings(weeks);
  const bracket: BracketMatchup[] = [];
  const results: BracketResult[] = [];

  if (config.playoffTeams > 0) {
    const firstRound = seedBracket(config, standings);
    const firstRoundWeek = firstRound[0]!.week;
    const firstRoundGames = playWeek(league, firstRound.map(toMatchup), firstRoundWeek);
    weeks.push(firstRoundGames);
    for (let i = 0; i < firstRound.length; i++) {
      const matchup = firstRound[i]!;
      const game = firstRoundGames.games[i]!;
      bracket.push(matchup);
      results.push({ matchup, winner: winnerOf(matchup, game) });
    }

    if (firstRound.length === 2) {
      // 4-team bracket: the final pairs the semifinal winners, better seed hosting.
      const finalists = firstRound
        .map((matchup, i) => {
          const winner = results[i]!.winner;
          return { winner, seed: winningSeed(matchup, winner) };
        })
        .sort((a, b) => a.seed - b.seed);
      const finalMatchup: BracketMatchup = {
        week: config.regularSeasonWeeks,
        home: finalists[0]!.winner,
        away: finalists[1]!.winner,
        label: 'final',
        seeds: [finalists[0]!.seed, finalists[1]!.seed],
      };
      const finalGames = playWeek(league, [toMatchup(finalMatchup)], finalMatchup.week);
      weeks.push(finalGames);
      bracket.push(finalMatchup);
      results.push({
        matchup: finalMatchup,
        winner: winnerOf(finalMatchup, finalGames.games[0]!),
      });
    }
  }

  const champion =
    results.length > 0 ? results[results.length - 1]!.winner : standings[0]!.managerId;
  return { weeks, standings, bracket, results, champion };
}

/**
 * Map the season outcome onto the three payout places: the champion first,
 * the runner-up second, and the best remaining regular-season finish third.
 * Without a bracket the standings top-3 places the payouts.
 */
export function seasonPayoutRecipients(result: SeasonResult): [ManagerId, ManagerId, ManagerId] {
  if (result.results.length === 0) {
    const top = result.standings.slice(0, 3);
    if (top.length < 3) {
      throw new DomainError(
        'invalid-bracket',
        'payouts need at least three ranked managers in the standings',
      );
    }
    return [top[0]!.managerId, top[1]!.managerId, top[2]!.managerId];
  }
  const finalResult = result.results[result.results.length - 1]!;
  const runnerUp =
    finalResult.matchup.home === result.champion
      ? finalResult.matchup.away
      : finalResult.matchup.home;
  const finalists = new Set([finalResult.matchup.home, finalResult.matchup.away]);
  const third = result.standings.find((row) => !finalists.has(row.managerId));
  if (!third) {
    throw new DomainError('invalid-bracket', 'no third-place finisher is available for payouts');
  }
  return [result.champion, runnerUp, third.managerId];
}
