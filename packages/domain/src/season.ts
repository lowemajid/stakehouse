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

/**
 * The matchup a finished round produces: after both semifinals, the final
 * pairs the winners with the better original seed hosting; after a final,
 * the bracket is done. Pure — the bracket's shape falls out of the results.
 */
export function nextMatchup(
  round: readonly BracketMatchup[],
  results: readonly BracketResult[],
  finalWeek: number,
): BracketMatchup | null {
  if (round.length === 1) return null;
  if (round.length !== 2 || results.length !== 2) {
    throw new DomainError(
      'invalid-bracket',
      `cannot advance a bracket round of ${round.length} matchups and ${results.length} results`,
    );
  }
  const finalists = round
    .map((matchup, i) => {
      const winner = results[i]!.winner;
      return { winner, seed: winningSeed(matchup, winner) };
    })
    .sort((a, b) => a.seed - b.seed);
  return {
    week: finalWeek,
    home: finalists[0]!.winner,
    away: finalists[1]!.winner,
    label: 'final',
    seeds: [finalists[0]!.seed, finalists[1]!.seed],
  };
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

  // Every week — regular season and bracket rounds — iterates the same way:
  // play the matchups, keep the WeekResult, record the winners. The bracket
  // advances round by round until nextMatchup runs out.
  if (config.playoffTeams > 0) {
    let round = seedBracket(config, standings);
    while (round.length > 0) {
      const games = playWeek(league, round.map(toMatchup), round[0]!.week);
      weeks.push(games);
      const roundResults: BracketResult[] = [];
      for (let i = 0; i < round.length; i++) {
        const matchup = round[i]!;
        bracket.push(matchup);
        roundResults.push({ matchup, winner: winnerOf(matchup, games.games[i]!) });
      }
      results.push(...roundResults);
      const next = nextMatchup(round, roundResults, config.regularSeasonWeeks);
      round = next ? [next] : [];
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
