import { DomainError } from './errors';
import type { LeagueId, ManagerId } from './brand';
import { addCents, cents, sumCents, ZERO_CENTS } from './money';
import type { Cents } from './money';

/**
 * The ledger: append-only entries and a balance that is always derived (never
 * stored — there is no cached total to drift). This module orchestrates;
 * every arithmetic operation lives in money.ts, enforced by the lint guard
 * in eslint.config.js. Amounts are signed from the pool's perspective:
 * positive flows in (buy-ins, credits), negative flows out (payouts, refunds).
 */
export type LedgerKind = 'buy-in' | 'refund' | 'payout' | 'commissioner-credit';

export interface LedgerEntry {
  id: string;
  leagueId: LeagueId;
  kind: LedgerKind;
  managerId: ManagerId | null; // null → pool-level event
  amountCents: Cents;
  memo: string;
  at: string; // caller-supplied ISO timestamp — the domain never reads a clock
}

export type NewEntry = Omit<LedgerEntry, 'id'>;

const SIGN_RULES: Record<LedgerKind, { inflow: boolean; requiresManager: boolean }> = {
  'buy-in': { inflow: true, requiresManager: true },
  refund: { inflow: false, requiresManager: true },
  payout: { inflow: false, requiresManager: true },
  'commissioner-credit': { inflow: true, requiresManager: false },
};

function assertValidEntry(entry: NewEntry): void {
  if (!Number.isInteger(entry.amountCents)) {
    throw new DomainError(
      'not-an-integer',
      `ledger amount must be integer cents, got ${entry.amountCents}`,
    );
  }
  if (!Number.isSafeInteger(entry.amountCents)) {
    throw new DomainError(
      'unsafe-integer',
      `ledger amount ${entry.amountCents} exceeds the safe integer range`,
    );
  }
  if (Number.isNaN(Date.parse(entry.at))) {
    throw new DomainError(
      'invalid-timestamp',
      `ledger entry timestamp "${entry.at}" is not a parseable date`,
    );
  }
  const rule = SIGN_RULES[entry.kind];
  if (rule.inflow && entry.amountCents <= 0) {
    throw new DomainError(
      'invalid-ledger-entry',
      `a ${entry.kind} flows into the pool and must be a positive amount, got ${entry.amountCents}`,
    );
  }
  if (!rule.inflow && entry.amountCents >= 0) {
    throw new DomainError(
      'invalid-ledger-entry',
      `a ${entry.kind} flows out of the pool and must be a negative amount, got ${entry.amountCents}`,
    );
  }
  if (rule.requiresManager && entry.managerId === null) {
    throw new DomainError(
      'invalid-ledger-entry',
      `a ${entry.kind} must name the manager it belongs to`,
    );
  }
  if (!rule.requiresManager && entry.managerId !== null) {
    throw new DomainError(
      'invalid-ledger-entry',
      `a ${entry.kind} is a pool-level event and must not name a manager`,
    );
  }
}

export function record(entries: readonly LedgerEntry[], entry: NewEntry): LedgerEntry[] {
  assertValidEntry(entry);
  // Append-only: a fresh array, the input untouched; sequential ids are
  // deterministic so a persisted ledger reloads with the same identity.
  return [...entries, { ...entry, id: `entry-${entries.length}` }];
}

export function poolBalance(entries: readonly LedgerEntry[]): Cents {
  return sumCents(
    entries.map((entry) => {
      if (!Number.isInteger(entry.amountCents)) {
        throw new DomainError(
          'not-an-integer',
          `ledger entry ${entry.id} carries a non-integer amount`,
        );
      }
      return entry.amountCents;
    }),
  );
}

export function refundEntries(
  league: LeagueId,
  entries: readonly LedgerEntry[],
  at: string,
): NewEntry[] {
  const paid = new Map<ManagerId, Cents>();
  for (const entry of entries) {
    if (entry.kind !== 'buy-in' || entry.managerId === null) continue;
    const soFar = paid.get(entry.managerId) ?? ZERO_CENTS;
    paid.set(entry.managerId, addCents(soFar, entry.amountCents));
  }
  return [...paid.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([manager, paidCents]) => ({
      leagueId: league,
      kind: 'refund' as const,
      managerId: manager,
      amountCents: cents(-paidCents),
      memo: 'cancellation refund — buy-ins returned',
      at,
    }));
}
