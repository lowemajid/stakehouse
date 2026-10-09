import type { LeagueId, ManagerId } from './brand';
import { DomainError } from './errors';
import { poolBalance } from './ledger';
import type { LedgerEntry, NewEntry } from './ledger';
import { cents, payoutPlan } from './money';
import type { PayoutSplit } from './money';

const ORDINALS: Record<1 | 2 | 3, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

/**
 * Wire the season's pot to the ledger: the pool is derived from the entries
 * (never stored), `payoutPlan` splits it exactly under the league's
 * percentages, and each place becomes a signed payout entry — negative from
 * the pool's perspective. The recorded payouts empty the pool to zero; an
 * empty pool or a duplicate recipient is a caller bug and rejected.
 */
export function payoutEntries(
  league: LeagueId,
  entries: readonly LedgerEntry[],
  split: PayoutSplit,
  recipients: readonly [ManagerId, ManagerId, ManagerId],
  at: string,
): NewEntry[] {
  if (new Set(recipients.map(String)).size !== 3) {
    throw new DomainError(
      'invalid-recipients',
      'payout recipients must be three distinct managers',
    );
  }
  const pool = poolBalance(entries);
  if (pool <= 0) {
    throw new DomainError('empty-pool', `cannot distribute payouts from a pool of ${pool} cents`);
  }
  return payoutPlan(pool, split).map((payout, index) => ({
    leagueId: league,
    kind: 'payout' as const,
    managerId: recipients[index]!,
    amountCents: cents(-payout.amountCents),
    memo: `season payout — ${ORDINALS[payout.place]} place`,
    at,
  }));
}
