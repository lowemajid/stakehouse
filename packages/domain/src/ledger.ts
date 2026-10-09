import { DomainError } from './errors';
import type { LeagueId, ManagerId } from './brand';
import { addCents, cents, sumCents, ZERO_CENTS } from './money';
import type { Cents } from './money';
import { payoutSplitSchema } from './leagueConfig';

/**
 * The ledger: append-only entries, a balance that is always derived (never
 * stored — there is no cached total to drift), and payout/refund plans that
 * move money exactly. Amounts are signed from the pool's perspective:
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

export interface Payout {
  place: 1 | 2 | 3;
  amountCents: Cents;
}

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

export function payoutPlan(pool: Cents, split: [number, number, number]): Payout[] {
  const parsed = payoutSplitSchema.safeParse(split);
  if (!parsed.success) {
    throw new DomainError(
      'invalid-payout-split',
      `payout split must be three percentages summing to exactly 100, got [${split.join(', ')}]`,
    );
  }
  // Largest-remainder distribution in integer arithmetic: floor each share,
  // then hand the leftover cents to the largest fractional remainders, ties
  // resolved toward the better place. Guarantees Σ payout === pool exactly.
  const shares = split.map((pct) => Math.floor((pool * pct) / 100));
  let leftover = pool - shares.reduce((sum, share) => sum + share, 0);
  const order = split
    .map((pct, index) => ({ index, remainder: (pool * pct) % 100 }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (leftover === 0) break;
    shares[index] = shares[index]! + 1;
    leftover = leftover - 1;
  }
  const PLACES = [1, 2, 3] as const;
  return PLACES.map((place, index) => ({ place, amountCents: cents(shares[index]!) }));
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
