import { Router } from 'express';
import { z } from 'zod';
import type { ApiContext } from '../context';
import { HttpError } from '../http';
import { fitsRoster, totalSlots, buildDraftView } from '../draftView';
import { requireCommissioner, requireLeague, requireSeat } from '../guards';
import { requireSession } from '../sessions';

/**
 * Waiver and trade routes. Waivers enforce the same rules the engine's
 * guarded pick does — no taken players, no drops you do not own, the same
 * FLEX eligibility — so a waiver can never create a roster state the draft
 * itself could not. Trades are stored state (the AI-manager module lands in a
 * parallel PR and proposes through the same repository).
 */

const waiverSchema = z.object({
  addPlayerId: z.string().min(1),
  dropPlayerId: z.string().min(1).optional(),
});

export function opsRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.post('/leagues/:id/waivers', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    const seat = requireSeat(ctx, league, session);
    const draft = ctx.store.drafts.get(league.id);
    if (!draft || draft.status !== 'complete') {
      throw new HttpError(409, 'draft-not-complete', 'waivers open when the draft completes');
    }
    const body = waiverSchema.parse(req.body);
    const universe = new Map(ctx.store.players.all().map((player) => [player.id, player]));
    const addPlayer = universe.get(body.addPlayerId);
    if (!addPlayer) {
      throw new HttpError(404, 'unknown-player', 'no such player in the universe');
    }
    // Ownership = draft picks + waiver history, i.e. exactly the rosters the
    // draft view derives. Check the add before the drop: adding a taken
    // player is the graver error and the matrix asserts that precedence.
    const view = buildDraftView(ctx.store, ctx.ops, league);
    const ownerOf = new Map<string, string>();
    for (const [managerId, slots] of Object.entries(view.rosters)) {
      for (const slot of slots) ownerOf.set(slot.playerId, managerId);
    }
    const owner = ownerOf.get(body.addPlayerId);
    if (owner !== undefined) {
      throw new HttpError(409, 'player-taken', 'that player is already on a roster');
    }
    const mine = view.rosters[String(seat.id)] ?? [];
    if (body.dropPlayerId !== undefined) {
      if (!mine.some((slot) => slot.playerId === body.dropPlayerId)) {
        throw new HttpError(409, 'player-not-owned', 'you do not own that player');
      }
    } else if (mine.length >= totalSlots(league.config.roster)) {
      throw new HttpError(409, 'roster-full', 'drop a player before adding to a full roster');
    }
    const kept = mine
      .filter((slot) => slot.playerId !== body.dropPlayerId)
      .map((slot) => ({ playerId: slot.playerId, position: slot.position }));
    if (!fitsRoster(kept, league.config.roster, addPlayer.position)) {
      throw new HttpError(
        409,
        'roster-slot-conflict',
        'that player does not fit any open roster slot',
      );
    }
    const list = ctx.ops.waivers.list(String(league.id));
    const waiver = {
      id: `wv-${list.length}`,
      leagueId: String(league.id),
      managerId: String(seat.id),
      addPlayerId: body.addPlayerId,
      dropPlayerId: body.dropPlayerId ?? null,
      at: new Date(ctx.now()).toISOString(),
    };
    ctx.ops.waivers.save(waiver);
    res.status(201).json({ waiver });
  });

  router.get('/leagues/:id/trades', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    res.json({ trades: ctx.ops.trades.list(String(league.id)) });
  });

  router.post('/leagues/:id/trades/:tid/veto', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    requireCommissioner(ctx, league, session);
    const trade = ctx.ops.trades
      .list(String(league.id))
      .find((candidate) => candidate.id === req.params.tid);
    if (!trade) {
      throw new HttpError(404, 'unknown-trade', 'no such trade in this league');
    }
    if (trade.status !== 'proposed') {
      throw new HttpError(409, 'trade-processed', 'this trade has already been processed');
    }
    const vetoed = {
      ...trade,
      status: 'vetoed' as const,
      processedAt: new Date(ctx.now()).toISOString(),
    };
    ctx.ops.trades.save(vetoed);
    res.json({ trade: vetoed });
  });

  return router;
}
