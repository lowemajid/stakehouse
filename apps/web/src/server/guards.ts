import { leagueId } from '@stakehouse/domain';
import type { LedgerEntry, LeagueId } from '@stakehouse/domain';
import type { LeagueRecord, ManagerRecord } from '@stakehouse/persistence';
import { HttpError } from './http';
import type { ApiContext } from './context';
import { managerIdForEmail } from './sessions';
import type { SessionPayload } from './sessions';

/**
 * Guards and lookups shared by every route module. Each guard throws the
 * documented envelope error on failure — never a bare status.
 */

export function toLeagueId(raw: string): LeagueId {
  return leagueId(raw);
}

export function requireLeague(ctx: ApiContext, rawId: string): LeagueRecord {
  const league = ctx.store.leagues.get(toLeagueId(rawId));
  if (!league) {
    throw new HttpError(404, 'unknown-league', `league "${rawId}" does not exist`);
  }
  return league;
}

export function requireCommissioner(
  ctx: ApiContext,
  league: LeagueRecord,
  session: SessionPayload,
): void {
  const commissioner = ctx.ops.commissioners.get(String(league.id));
  if (commissioner !== session.email) {
    throw new HttpError(403, 'not-commissioner', 'only the league commissioner may do that');
  }
}

export function seatForEmail(
  ctx: ApiContext,
  league: LeagueRecord,
  email: string,
): ManagerRecord | null {
  const seatId = managerIdForEmail(email);
  return (
    ctx.store.managers.list(league.id).find((manager) => String(manager.id) === seatId) ?? null
  );
}

export function requireSeat(
  ctx: ApiContext,
  league: LeagueRecord,
  session: SessionPayload,
): ManagerRecord {
  const seat = seatForEmail(ctx, league, session.email);
  if (!seat) {
    throw new HttpError(403, 'not-a-manager', 'you do not hold a seat in this league');
  }
  return seat;
}

/** Paying demands an existing seat: the seat — not the action — is what the
 * request addresses, so an unseated session reads 404 unknown-manager. */
export function requirePayingSeat(
  ctx: ApiContext,
  league: LeagueRecord,
  session: SessionPayload,
): ManagerRecord {
  const seat = seatForEmail(ctx, league, session.email);
  if (!seat) {
    throw new HttpError(404, 'unknown-manager', 'you do not hold a seat in this league');
  }
  return seat;
}

/** The public ledger entry: the URL already carries the league, so the
 * persisted leagueId column stays internal. */
export function publicEntry(entry: LedgerEntry): {
  id: string;
  kind: string;
  managerId: string | null;
  amountCents: number;
  memo: string;
  at: string;
} {
  return {
    id: entry.id,
    kind: entry.kind,
    managerId: entry.managerId === null ? null : String(entry.managerId),
    amountCents: entry.amountCents,
    memo: entry.memo,
    at: entry.at,
  };
}

/** The lobby card for one league — record plus its live seat count and pool. */
export function leagueView(
  ctx: ApiContext,
  league: LeagueRecord,
  seatsFilled: number,
): {
  id: string;
  name: string;
  createdAt: string;
  config: LeagueRecord['config'];
  seatsFilled: number;
  poolCents: number;
} {
  const entries = ctx.store.ledger.list(league.id);
  const poolCents = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  return {
    id: String(league.id),
    name: league.config.name,
    createdAt: league.createdAt,
    config: league.config,
    seatsFilled,
    poolCents,
  };
}
