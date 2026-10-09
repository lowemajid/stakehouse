import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { leagueId, managerId } from './brand';
import { cents } from './money';
import { payoutPlan, poolBalance, record, refundEntries } from './ledger';
import type { LedgerEntry, NewEntry } from './ledger';

const lg = leagueId('lg-frozen-rope');
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

function entry(overrides: Partial<NewEntry> = {}): NewEntry {
  return { ...buyIn('mgr-1', 10000), ...overrides };
}

/** A cast on purpose: simulates persistence handing back a float the typechecker never saw. */
const forgedCents = (value: number) => value as LedgerEntry['amountCents'];

describe('record — append-only ledger', () => {
  it('appends without mutating the original array and assigns the next sequential id', () => {
    const first = entry();
    const ledger = record([], first);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ id: 'entry-0', kind: 'buy-in', amountCents: 10000 });

    const grew = record(ledger, buyIn('mgr-2', 10000));
    expect(grew).toHaveLength(2);
    expect(grew[1]).toMatchObject({ id: 'entry-1' });
    // the input ledger is untouched — append-only means callers never see mutation
    expect(ledger).toHaveLength(1);
    expect(grew[0]).toEqual(ledger[0]);
  });

  it('enforces the pool-perspective sign convention per kind', () => {
    const rejections: Array<[NewEntry, string]> = [
      [entry({ kind: 'buy-in', amountCents: cents(-5) }), 'buy-in must be positive'],
      [entry({ kind: 'buy-in', amountCents: cents(0) }), 'buy-in must be positive'],
      [entry({ kind: 'payout', amountCents: cents(100) }), 'payout must be negative'],
      [entry({ kind: 'payout', amountCents: cents(0) }), 'payout must be negative'],
      [entry({ kind: 'refund', amountCents: cents(100) }), 'refund must be negative'],
      [entry({ kind: 'commissioner-credit', amountCents: cents(-100) }), 'credit must be positive'],
      [entry({ kind: 'commissioner-credit', amountCents: cents(0) }), 'credit must be positive'],
      [entry({ kind: 'buy-in', managerId: null }), 'buy-in names a manager'],
      [entry({ kind: 'refund', managerId: null }), 'refund names a manager'],
      [entry({ kind: 'payout', managerId: null }), 'payout names a manager'],
      [
        entry({ kind: 'commissioner-credit', managerId: managerId('mgr-1') }),
        'credit is pool-level',
      ],
    ];
    for (const [bad, why] of rejections) {
      try {
        record([], bad);
        expect.unreachable(`should have rejected: ${why}`);
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('invalid-ledger-entry');
        expect((err as DomainError).message).toBeTruthy();
      }
    }
  });

  it('rejects unparseable timestamps', () => {
    try {
      record([], entry({ at: 'not-a-date' }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DomainError).code).toBe('invalid-timestamp');
    }
  });

  it('rejects non-integer amounts even when the typechecker was bypassed', () => {
    try {
      record([], entry({ amountCents: forgedCents(100.5) }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DomainError).code).toBe('not-an-integer');
    }
  });
});

describe('poolBalance — always derived, never stored', () => {
  it('is zero for an empty ledger', () => {
    expect(poolBalance([])).toBe(0);
  });

  it('equals the exact sum of its entries', () => {
    const entries: NewEntry[] = [
      buyIn('mgr-1', 10000),
      buyIn('mgr-2', 10000),
      buyIn('mgr-3', 10000),
      buyIn('mgr-4', 10000),
      entry({ kind: 'commissioner-credit', managerId: null, amountCents: cents(500) }),
      entry({ kind: 'payout', amountCents: cents(-27000), memo: 'weekly prize' }),
      entry({ kind: 'refund', amountCents: cents(-10000), memo: 'league cancelled' }),
    ];
    const ledger = entries.reduce((acc, next) => record(acc, next), [] as LedgerEntry[]);
    // 40000 + 500 - 27000 - 10000 = 3500 — no float drift allowed
    expect(poolBalance(ledger)).toBe(3500);
  });

  it('rejects non-integer entries sneaking in from persistence', () => {
    const poisoned: LedgerEntry[] = [
      record([], buyIn('mgr-1', 10000))[0] as LedgerEntry,
      { ...record([], buyIn('mgr-2', 10000))[0]!, amountCents: forgedCents(0.1) },
    ];
    expect(() => poolBalance(poisoned)).toThrow(DomainError);
  });
});

describe('payoutPlan — the pool distributes exactly', () => {
  it('splits exact multiples cleanly', () => {
    expect(shares(cents(10000), [50, 30, 20])).toEqual([5000, 3000, 2000]);
    expect(shares(cents(0), [50, 30, 20])).toEqual([0, 0, 0]);
    expect(shares(cents(1), [100, 0, 0])).toEqual([1, 0, 0]);
  });

  it('distributes rounding remainders by largest fractional share, ties to the better place', () => {
    // 9999: floors 4999/2999/1999 leave 2 cents; fractions .50/.70/.80 hand them to 3rd then 2nd
    expect(shares(cents(9999), [50, 30, 20])).toEqual([4999, 3000, 2000]);
    // 3 cents at 50/25/25: floors 1/0/0 leave 2 cents; fractions .50/.75/.75 → ties go 2nd, 3rd
    expect(shares(cents(3), [50, 25, 25])).toEqual([1, 1, 1]);
  });

  it('never leaves a cent behind and never overpays, across pools and splits', () => {
    const splits: Array<[number, number, number]> = [
      [50, 30, 20],
      [60, 25, 15],
      [100, 0, 0],
      [34, 33, 33],
      [40, 40, 20],
    ];
    for (let pool = 0; pool <= 250; pool++) {
      for (const split of splits) {
        const parts = shares(cents(pool), split);
        const total = parts.reduce((sum, value) => sum + value, 0);
        expect(total).toBe(pool); // Σ payout === pool, to the cent
        for (const share of parts) {
          expect(share).toBeGreaterThanOrEqual(0);
        }
        // each share deviates from its ideal by less than one cent
        for (let place = 0; place < 3; place++) {
          const ideal = (pool * split[place]!) / 100;
          expect(Math.abs(parts[place]! - ideal)).toBeLessThan(1);
        }
      }
    }
  });

  it('rejects splits that are not three non-negative percentages summing to 100', () => {
    for (const split of [
      [50, 30, 19],
      [50, 30, 20.5],
      [50, -20, 70],
      [150, -25, -25],
      [0, 0, 0],
    ] as Array<[number, number, number]>) {
      try {
        payoutPlan(cents(100), split);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as DomainError).code).toBe('invalid-payout-split');
      }
    }
  });
});

describe('refundEntries — cancellation returns each paid buy-in exactly', () => {
  it('refunds every manager the exact sum of their buy-ins, and nothing for others', () => {
    const ledger = record(
      record(
        record(record([], buyIn('mgr-1', 10000)), buyIn('mgr-2', 10000)),
        buyIn('mgr-2', 5000), // a top-up buy-in counts too
      ),
      entry({ kind: 'commissioner-credit', managerId: null, amountCents: cents(500) }),
    );
    const refunds = refundEntries(lg, ledger, AT);

    expect(refunds).toHaveLength(2); // mgr-1 and mgr-2; a credit is not a buy-in
    expect(refunds[0]).toMatchObject({
      kind: 'refund',
      managerId: managerId('mgr-1'),
      amountCents: cents(-10000),
      leagueId: lg,
    });
    expect(refunds[1]).toMatchObject({
      kind: 'refund',
      managerId: managerId('mgr-2'),
      amountCents: cents(-15000),
    });
  });

  it('lands the pool back at zero once refunds are recorded', () => {
    const ledger = record(
      record(record([], buyIn('mgr-1', 10000)), buyIn('mgr-2', 10000)),
      buyIn('mgr-3', 5000),
    );
    const refunded = refundEntries(lg, ledger, AT).reduce(
      (acc, refund) => record(acc, refund),
      ledger,
    );
    expect(poolBalance(refunded)).toBe(0);
  });

  it('is deterministic and empty when nobody has bought in', () => {
    expect(refundEntries(lg, [], AT)).toEqual([]);
    const creditOnly = record(
      [],
      entry({ kind: 'commissioner-credit', managerId: null, amountCents: cents(500) }),
    );
    expect(refundEntries(lg, creditOnly, AT)).toEqual([]);
  });

  it('produces entries the ledger itself accepts', () => {
    const ledger = record([], buyIn('mgr-1', 10000));
    const [refund] = refundEntries(lg, ledger, AT);
    expect(() => record(ledger, refund!)).not.toThrow();
  });
});

/** Helper: run payoutPlan and return just the cents per place for vector comparisons. */
function shares(pool: ReturnType<typeof cents>, split: [number, number, number]) {
  return payoutPlan(pool, split).map((payout) => payout.amountCents);
}
