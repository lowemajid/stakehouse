import { Router } from 'express';
import {
  computeStandings,
  roundRobinSchedule,
  simulateSeason,
  simulateWeek,
} from '@stakehouse/domain';
import type { PlayerCard, SimLeague, SlotPosition } from '@stakehouse/domain';
import type { LeagueRecord } from '@stakehouse/persistence';
import { z } from 'zod';
import type { ApiContext } from '../context';
import { HttpError } from '../http';
import { requireCommissioner, requireLeague } from '../guards';
import { requireSession } from '../sessions';
import { buildDraftView } from '../draftView';

/**
 * Season routes: the commissioner advances weeks, everyone reads box scores
 * and standings. The schedule derives on demand (roundRobinSchedule is seeded
 * by league id, so every call draws the same pairings — the league repository
 * has no update operation to persist one).
 */

const matchupsQuery = z.object({
  week: z.coerce.number().int().min(1).optional(),
});

/** Weeks played before the playoff bracket, given the configured format. */
function regularWeeks(league: LeagueRecord): number {
  const { regularSeasonWeeks, playoffTeams } = league.config;
  return playoffTeams === 0 ? regularSeasonWeeks : regularSeasonWeeks - 2;
}

export function seasonRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.post('/leagues/:id/simulate', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    requireCommissioner(ctx, league, session);
    const draft = ctx.store.drafts.get(league.id);
    if (!draft || draft.status !== 'complete') {
      throw new HttpError(
        409,
        'draft-not-complete',
        'the draft must complete before weeks simulate',
      );
    }
    const weeks = ctx.store.seasons.listWeeks(league.id);
    const week = weeks.length + 1;
    const maxWeek = regularWeeks(league);
    if (week > maxWeek) {
      throw new HttpError(409, 'season-complete', 'the regular season is complete');
    }
    const seats = ctx.store.managers.list(league.id);
    const schedule = roundRobinSchedule(
      seats.map((seat) => seat.id),
      maxWeek,
      league.id,
    );
    const universe = new Map(ctx.store.players.all().map((player) => [player.id, player]));
    const rosters = buildDraftView(ctx.store, ctx.ops, league).rosters;
    const simLeague: SimLeague = {
      id: league.id,
      config: league.config,
      pairings: schedule.weeks[week - 1]!.matchups,
      starters: Object.fromEntries(
        seats.map((seat) => [
          String(seat.id),
          (rosters[String(seat.id)] ?? []).map((slot) => ({
            slot: slot.slot as SlotPosition,
            playerId: slot.playerId,
          })),
        ]),
      ),
      players: Object.fromEntries(universe) as Record<string, PlayerCard>,
    };
    const result = simulateWeek(simLeague, week);
    ctx.store.seasons.saveWeek(league.id, result);
    let seasonComplete = false;
    if (week === maxWeek) {
      ctx.store.seasons.saveSeason(league.id, simulateSeason(simLeague, schedule));
      seasonComplete = true;
    }
    res.json({ week, seasonComplete, result });
  });

  router.get('/leagues/:id/matchups', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const { week } = matchupsQuery.parse(req.query);
    const weeks = ctx.store.seasons.listWeeks(league.id);
    if (week === undefined) {
      res.json({ weeks });
      return;
    }
    const found = weeks.find((simulated) => simulated.week === week);
    if (!found) {
      throw new HttpError(404, 'week-not-simulated', `week ${week} has not been simulated`);
    }
    res.json({ weeks: [found] });
  });

  router.get('/leagues/:id/standings', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const weeks = ctx.store.seasons.listWeeks(league.id);
    const rows = computeStandings(weeks).map((row, index) => ({
      rank: index + 1,
      ...row,
      displayName:
        ctx.store.managers.list(league.id).find((seat) => String(seat.id) === String(row.managerId))
          ?.displayName ?? 'Unknown',
    }));
    res.json({ standings: rows });
  });

  return router;
}
