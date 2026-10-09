import { Router } from 'express';
import { applyPick, createDraft, resolveDeadline, startDraft } from '@stakehouse/domain';
import type { DraftState } from '@stakehouse/domain';
import type { LeagueRecord } from '@stakehouse/persistence';
import { z } from 'zod';
import type { ApiContext } from '../context';
import { HttpError } from '../http';
import { rejectDraft } from '../errorMapping';
import { requireCommissioner, requireLeague, requireSeat, seatForEmail } from '../guards';
import { requireSession, sessionOf } from '../sessions';
import { buildDraftView } from '../draftView';

/**
 * Draft routes: server-authoritative board. The stored DraftState is the only
 * truth; the view is derived per request, every mutation goes through the
 * domain's guarded transition, and every mutation publishes the refreshed
 * view to the league's SSE subscribers.
 */

const pickSchema = z.object({ playerId: z.string().min(1) });

const queueSchema = z.object({
  queue: z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length, {
    message: 'queue entries must be unique',
  }),
});

/** Human reasons for each guarded rejection live in the single error-mapping
 * table — routes raise them through `rejectDraft`. */

export function draftRoutes(ctx: ApiContext): Router {
  const router = Router();

  const view = (league: LeagueRecord, req?: Request) => {
    // The caller's own seat, if any — the one fact the room needs to say
    // "YOUR PICK" without guessing the server's id rules. SSE broadcasts
    // call this without a request, so they stay seat-agnostic; only the
    // per-caller responses answer per session.
    const session = req ? sessionOf(req, ctx.cookieSecret) : null;
    const seat = session ? seatForEmail(ctx, league, session.email) : null;
    return buildDraftView(ctx.store, ctx.ops, league, seat ? String(seat.id) : null);
  };
  // SSE events carry the same payload as the GET /draft response so one
  // client parser serves both.
  const publishView = (league: LeagueRecord): { draft: ReturnType<typeof view> } => ({
    draft: view(league),
  });

  const storedState = (league: LeagueRecord): DraftState => {
    const state = ctx.store.drafts.get(league.id);
    if (!state) {
      throw new HttpError(409, 'not-your-turn', 'the draft has not started');
    }
    return state;
  };

  router.get('/leagues/:id/draft', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    res.json({ draft: view(league, req) });
  });

  // Live draft stream. A late joiner receives the current snapshot first,
  // then every published event — refreshed views and clock ticks.
  router.get('/leagues/:id/draft/stream', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    requireSession(req, ctx.cookieSecret);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // The draft's completion ends the stream — the board is final and the
      // client moves to the season screen.
      const view = data as { draft?: { status?: string } };
      if (event === 'draft' && view.draft?.status === 'complete') res.end();
    };
    send('draft', publishView(league));
    const unsubscribe = ctx.broadcaster.subscribe(String(league.id), send);
    req.on('close', unsubscribe);
  });

  router.post('/leagues/:id/draft/start', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    requireCommissioner(ctx, league, session);
    const seats = ctx.store.managers.list(league.id);
    const entries = ctx.store.ledger.list(league.id);
    const paid = (seatId: string) =>
      entries.some((entry) => entry.kind === 'buy-in' && String(entry.managerId) === seatId);
    const full = seats.length === league.config.size;
    const allPaid = seats.length > 0 && seats.every((seat) => paid(String(seat.id)));
    if (!full || !allPaid) {
      throw new HttpError(
        409,
        'draft-not-paid',
        'every seat must be filled and paid before the draft starts',
      );
    }
    let state = ctx.store.drafts.get(league.id);
    if (state && state.status !== 'pending') {
      rejectDraft('draft-already-complete');
    }
    if (!state) {
      const universe = ctx.store.players.all();
      state = createDraft({
        order: seats.map((seat) => seat.id),
        slots: league.config.roster,
        pickSeconds: 30,
        board: universe.map((player) => ({ playerId: player.id, position: player.position })),
      });
    }
    const started = startDraft(state, ctx.now());
    ctx.store.drafts.save(league.id, started);
    ctx.broadcaster.publish(String(league.id), 'draft', publishView(league));
    res.json({ draft: view(league, req) });
  });

  router.post('/leagues/:id/draft/pick', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    const seat = requireSeat(ctx, league, session);
    const body = pickSchema.parse(req.body);
    const state = storedState(league);
    if (state.status === 'complete') {
      rejectDraft('draft-already-complete');
    }
    const result = applyPick(state, { managerId: seat.id, playerId: body.playerId }, ctx.now());
    if (!result.ok) {
      rejectDraft(result.reason);
    }
    ctx.store.drafts.save(league.id, result.next);
    ctx.broadcaster.publish(String(league.id), 'draft', publishView(league));
    res.status(201).json({
      pick: result.next.picks[result.next.picks.length - 1],
      draft: view(league, req),
    });
  });

  router.put('/leagues/:id/draft/queue', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    const seat = requireSeat(ctx, league, session);
    const body = queueSchema.parse(req.body);
    ctx.ops.queues.set(String(league.id), {
      ...ctx.ops.queues.get(String(league.id)),
      [String(seat.id)]: body.queue,
    });
    res.json({ queue: body.queue });
  });

  router.post('/leagues/:id/draft/autopick', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    requireSeat(ctx, league, session);
    const state = storedState(league);
    const next = resolveDeadline(state, ctx.ops.queues.get(String(league.id)), ctx.now());
    // resolveDeadline returns the same reference while the clock is still
    // running — that identity is the guard against forcing an autopick early.
    if (next === state) {
      throw new HttpError(409, 'clock-live', 'the pick clock has not expired yet');
    }
    ctx.store.drafts.save(league.id, next);
    ctx.broadcaster.publish(String(league.id), 'draft', publishView(league));
    res.json({
      autopicked: next.picks[next.picks.length - 1],
      draft: view(league, req),
    });
  });

  router.post('/leagues/:id/draft/fast-forward', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    requireCommissioner(ctx, league, session);
    const state = storedState(league);
    if (state.status === 'pending') {
      throw new HttpError(409, 'draft-not-paid', 'the draft has not started');
    }
    // Resolve deadline picks in fast-forward: step the clock past each
    // deadline so resolveDeadline commits the autopick, until the snake fills
    // every roster slot. (no-autopick-available would surface as 409 if the
    // board ever ran dry — impossible while the universe holds every slot.)
    let current = state;
    let clock = Math.max(ctx.now(), (state.deadline ?? ctx.now()) + 1);
    let forwarded = 0;
    while (current.status === 'live') {
      current = resolveDeadline(current, ctx.ops.queues.get(String(league.id)), clock);
      forwarded += 1;
      clock += state.pickSeconds * 1000 + 1;
    }
    ctx.store.drafts.save(league.id, current);
    ctx.broadcaster.publish(String(league.id), 'draft', publishView(league));
    res.json({ fastForwarded: forwarded, draft: view(league, req) });
  });

  return router;
}
