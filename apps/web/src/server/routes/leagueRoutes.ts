import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  leagueId,
  managerId,
  parseLeagueConfig,
  payoutEntries,
  poolBalance,
  record,
  seasonPayoutRecipients,
} from '@stakehouse/domain';
import type { LedgerEntry } from '@stakehouse/domain';
import type { LeagueRecord, ManagerRecord } from '@stakehouse/persistence';
import type { ApiContext } from '../context';
import { HttpError } from '../http';
import {
  leagueView,
  publicEntry,
  requireCommissioner,
  requireLeague,
  requirePayingSeat,
  seatForEmail,
} from '../guards';
import { managerIdForEmail, requireSession, sessionOf } from '../sessions';

/**
 * The lobby and the money: league list/create, join, the simulated buy-in,
 * the ledger history, and payout distribution. Every money movement here is a
 * ledger entry built by the domain's `record` — the API never invents ids or
 * signs, so a bad entry cannot exist and the balance always derives.
 */
export function leagueRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.get('/leagues', (_req, res) => {
    const leagues = ctx.store.leagues
      .list()
      .map((league) => leagueView(ctx, league, ctx.store.managers.list(league.id).length));
    res.json({ leagues });
  });

  router.post('/leagues', (req, res) => {
    // parseLeagueConfig throws ZodError on any invalid config — including a
    // payout split that does not total exactly 100 — and the error middleware
    // renders that as 400 validation-error with field details.
    const config = parseLeagueConfig(req.body);
    const session = sessionOf(req, ctx.cookieSecret);
    const created: LeagueRecord = {
      id: leagueId(`lg-${randomUUID().slice(0, 8)}`),
      config,
      schedule: null,
      createdAt: new Date(ctx.now()).toISOString(),
    };
    ctx.store.leagues.create(created);
    // A signed-in creator is the commissioner; an anonymous create simply has
    // no commissioner yet, and commissioner-only routes stay closed (403).
    if (session) ctx.ops.commissioners.set(String(created.id), session.email);
    res.status(201).json({ league: leagueView(ctx, created, 0) });
  });

  router.post('/leagues/:id/join', (req, res) => {
    // Authentication precedes resource lookup — a signed-out request reads
    // 401 even when the league id is also wrong.
    const session = requireSession(req, ctx.cookieSecret);
    const league = requireLeague(ctx, req.params.id!);
    if (seatForEmail(ctx, league, session.email)) {
      throw new HttpError(409, 'already-joined', 'you already hold a seat in this league');
    }
    const seats = ctx.store.managers.list(league.id);
    if (seats.length >= league.config.size) {
      throw new HttpError(409, 'league-full', 'every seat in this league is taken');
    }
    const manager: ManagerRecord = {
      id: managerId(managerIdForEmail(session.email)),
      leagueId: league.id,
      displayName: session.displayName,
      isAi: false,
      joinedAt: new Date(ctx.now()).toISOString(),
    };
    ctx.store.managers.add(manager);
    res.status(201).json({
      manager: {
        id: String(manager.id),
        displayName: manager.displayName,
        isAi: manager.isAi,
        joinedAt: manager.joinedAt,
      },
    });
  });

  router.post('/leagues/:id/pay', (req, res) => {
    const session = requireSession(req, ctx.cookieSecret);
    const league = requireLeague(ctx, req.params.id!);
    const seat = requirePayingSeat(ctx, league, session);
    const entries = ctx.store.ledger.list(league.id);
    if (
      entries.some(
        (entry) => entry.kind === 'buy-in' && String(entry.managerId) === String(seat.id),
      )
    ) {
      throw new HttpError(409, 'already-paid', 'this seat has already paid its buy-in');
    }
    // The domain's record() validates the entry (sign rules, requires a
    // manager) and assigns the deterministic id — the API only supplies the
    // money facts.
    const recorded = record(entries, {
      leagueId: league.id,
      kind: 'buy-in',
      managerId: seat.id,
      amountCents: league.config.entryFeeCents,
      memo: 'simulated buy-in — demo checkout, no real money changes hands',
      at: new Date(ctx.now()).toISOString(),
    });
    const entry = recorded[recorded.length - 1]!;
    ctx.store.ledger.append(league.id, [entry]);
    res
      .status(201)
      .json({ simulated: true, entry: publicEntry(entry), poolCents: poolBalance(recorded) });
  });

  router.get('/leagues/:id/ledger', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const entries = ctx.store.ledger.list(league.id);
    res.json({ entries: entries.map(publicEntry), poolCents: poolBalance(entries) });
  });

  router.post('/leagues/:id/ledger/payouts/distribute', (req, res) => {
    const league = requireLeague(ctx, req.params.id!);
    const session = requireSession(req, ctx.cookieSecret);
    requireCommissioner(ctx, league, session);
    const season = ctx.store.seasons.getSeason(league.id);
    if (!season) {
      throw new HttpError(
        409,
        'season-not-complete',
        'the season must complete before payouts distribute',
      );
    }
    const entries = ctx.store.ledger.list(league.id);
    // payoutEntries derives the pool from the entries, rejects an empty pool
    // (DomainError → 409), and splits it exactly under the league's split;
    // seasonPayoutRecipients maps champion → 1st, runner-up → 2nd, best
    // remaining regular-season finish → 3rd.
    const planned = payoutEntries(
      league.id,
      entries,
      league.config.payoutSplitPct,
      seasonPayoutRecipients(season),
      new Date(ctx.now()).toISOString(),
    );
    let all = entries;
    const created: LedgerEntry[] = [];
    for (const entry of planned) {
      all = record(all, entry);
      created.push(all[all.length - 1]!);
    }
    ctx.store.ledger.append(league.id, created);
    res.status(201).json({ entries: created.map(publicEntry), poolCents: poolBalance(all) });
  });

  return router;
}
