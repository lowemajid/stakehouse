import type { LedgerEntryView } from '@stakehouse/api-client';
import { formatCents } from '@stakehouse/domain';

/**
 * Client-side mirror of the server's managerIdForEmail: lowercase local part,
 * non-alphanumerics stripped, `mgr-` prefix. Only used to recognize our own
 * ledger rows before the API exposes membership — never for authorization.
 */
export function deriveManagerId(email: string): string {
  const local = email.split('@')[0] ?? '';
  const slug = local.toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug ? `mgr-${slug}` : 'mgr-manager';
}

/** True only when the ledger shows a buy-in entry for this manager. */
export function hasPaidBuyIn(entries: LedgerEntryView[], managerId: string): boolean {
  return entries.some((entry) => entry.kind === 'buy-in' && entry.managerId === managerId);
}

/** Signed ledger text: credits lead with +, debits with −, brass vs blood. */
export type MoneyTone = 'money' | 'danger';

export function formatSignedCents(amountCents: number): { text: string; tone: MoneyTone } {
  if (!Number.isSafeInteger(amountCents)) {
    return { text: String(amountCents), tone: amountCents >= 0 ? 'money' : 'danger' };
  }
  const sign = amountCents < 0 ? '-' : '+';
  return {
    text: `${sign}${formatCents(Math.abs(amountCents) as never)}`,
    tone: amountCents < 0 ? 'danger' : 'money',
  };
}

/**
 * The seat's paid state, derived from the only honest evidence available:
 * the ledger. A local join flag covers the window between the join POST and
 * the ledger read; ledger evidence always wins.
 */
export type SeatState = 'paid' | 'joinedUnpaid' | 'notJoined';

export function seatState(
  entries: LedgerEntryView[],
  myManagerId: string | null,
  locallyJoined: boolean,
): SeatState {
  if (myManagerId !== null && hasPaidBuyIn(entries, myManagerId)) return 'paid';
  if (locallyJoined) return 'joinedUnpaid';
  return 'notJoined';
}
