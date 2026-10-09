import { describe, expect, it } from 'vitest';
import { leagueId, managerId } from './brand';
import type { ManagerId } from './brand';
import { DomainError } from './errors';
import { poolBalance, record, refundEntries } from './ledger';
import type { LedgerEntry, NewEntry } from './ledger';
import { cents } from './money';
import type { PayoutSplit } from './money';
import { payoutEntries } from './distribution';

const lg = leagueId('lg-final-table');
const AT = '2026-10-01T12:00:00.000Z';

function buyIn(manager: string, amountCents: number, at: string = AT): NewEntry {
  return {
    leagueId: lg,
    kind: 'buy-in',
    managerId: managerId(manager),
    amountCents: cents(amountCents),
    memo: `buy-in ${manager}`,
    at,
  };
}

function payIn(managers: Array<[string, number]>): LedgerEntry[] {
  let ledger: LedgerEntry[] = [];
  for (const [mgr, amount] of managers) ledger = record(ledger, buyIn(mgr, amount));
  return ledger;
}

describe('payoutEntries — pool to payoutPlan to ledger entries', () => {
  const recipients = (): [ManagerId, ManagerId, ManagerId] => [
    managerId('mgr-champ'),
    managerId('mgr-runner'),
    managerId('mgr-third'),
  ];

  it('wires the derived pool through payoutPlan into signed payout entries', () => {
    const ledger = payIn([
      ['mgr-1', 10000],
      ['mgr-2', 10000],
      ['mgr-3', 10000],
      ['mgr-4', 10000],
    ]);
    const payouts = payoutEntries(lg, ledger, [70, 20, 10], recipients(), AT);
    expect(payouts).toHaveLength(3);
    expect(payouts.map((p) => p.amountCents)).toEqual([
      cents(-70000),
      cents(-20000),
      cents(-10000),
    ]);
    expect(payouts.map((p) => p.kind)).toEqual(['payout', 'payout', 'payout']);
    expect(payouts.map((p) => p.managerId)).toEqual(recipients());
    expect(payouts.every((p) => p.leagueId === lg)).toBe(true);
  });

  it('empties the pool exactly when the payouts are recorded', () => {
    const ledger = payIn([
      ['mgr-1', 10000],
      ['mgr-2', 10000],
      ['mgr-3', 10000],
      ['mgr-4', 10000],
    ]);
    let finalLedger = ledger;
    for (const payout of payoutEntries(lg, ledger, [70, 20, 10], recipients(), AT)) {
      finalLedger = record(finalLedger, payout);
    }
    expect(poolBalance(finalLedger)).toBe(0); // Σ payout === pool — the pool cannot drift
  });

  it('distributes an odd pool to the cent via the largest-remainder plan', () => {
    const ledger = payIn([
      ['mgr-1', 99999],
      ['mgr-2', 99999],
      ['mgr-3', 99999],
      ['mgr-4', 99999],
      ['mgr-5', 99999],
    ]);
    let finalLedger = ledger;
    for (const payout of payoutEntries(lg, ledger, [50, 30, 20], recipients(), AT)) {
      finalLedger = record(finalLedger, payout);
    }
    const distributed = -poolBalance(finalLedger);
    expect(distributed).toBe(5 * 99999); // every cent of the odd pool lands somewhere
  });

  it('refuses an empty or zero pool', () => {
    expect(() => payoutEntries(lg, [], [70, 20, 10], recipients(), AT)).toThrowError(/pool/i);
    expect(() => payoutEntries(lg, payIn([]), [70, 20, 10], recipients(), AT)).toThrowError(
      /pool/i,
    );
  });

  it('refuses duplicate recipients — one manager cannot take two places', () => {
    const ledger = payIn([
      ['mgr-1', 10000],
      ['mgr-2', 10000],
      ['mgr-3', 10000],
      ['mgr-4', 10000],
    ]);
    const duplicated: [ManagerId, ManagerId, ManagerId] = [
      managerId('mgr-1'),
      managerId('mgr-1'),
      managerId('mgr-2'),
    ];
    expect(() => payoutEntries(lg, ledger, [70, 20, 10], duplicated, AT)).toThrowError(
      /recipient/i,
    );
  });

  it('rejects a malformed split through payoutPlan', () => {
    const ledger = payIn([
      ['mgr-1', 10000],
      ['mgr-2', 10000],
      ['mgr-3', 10000],
      ['mgr-4', 10000],
    ]);
    const bad: PayoutSplit = [70, 20, 15];
    expect(() => payoutEntries(lg, ledger, bad, recipients(), AT)).toThrowError(DomainError);
  });
});

describe('cancellation refunds — each buy-in returned to the cent', () => {
  it('refunds every manager exactly what they paid, emptying the pool', () => {
    // mgr-2 tops up a second buy-in — the refund must cover both payments.
    const ledger = payIn([
      ['mgr-1', 10000],
      ['mgr-2', 10000],
      ['mgr-3', 7500],
      ['mgr-4', 10000],
      ['mgr-2', 2500],
    ]);
    const refunds = refundEntries(lg, ledger, AT);
    expect(refunds).toHaveLength(4);
    let refunded = ledger;
    for (const refund of refunds) refunded = record(refunded, refund);
    expect(poolBalance(refunded)).toBe(0);

    const byManager = new Map(refunds.map((r) => [String(r.managerId), r.amountCents]));
    expect(byManager.get('mgr-1')).toBe(-10000);
    expect(byManager.get('mgr-2')).toBe(-12500); // both buy-ins, to the cent
    expect(byManager.get('mgr-3')).toBe(-7500);
    expect(byManager.get('mgr-4')).toBe(-10000);
  });

  it('leaves commissioner credits out of the refund math', () => {
    let ledger = payIn([
      ['mgr-1', 10000],
      ['mgr-2', 10000],
    ]);
    ledger = record(ledger, {
      leagueId: lg,
      kind: 'commissioner-credit',
      managerId: null,
      amountCents: cents(500),
      memo: 'goodwill credit',
      at: AT,
    });
    const refunds = refundEntries(lg, ledger, AT);
    expect(refunds.map((r) => r.amountCents)).toEqual([cents(-10000), cents(-10000)]);
  });
});
