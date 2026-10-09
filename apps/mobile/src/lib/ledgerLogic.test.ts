import type { LedgerEntryView } from '@stakehouse/api-client';
import { describe, expect, it } from 'vitest';
import { deriveManagerId, formatSignedCents, hasPaidBuyIn, seatState } from './ledgerLogic';

function entry(overrides: Partial<LedgerEntryView> = {}): LedgerEntryView {
  return {
    id: 'le-1',
    kind: 'buy-in',
    managerId: 'mgr-majid',
    amountCents: 2500,
    memo: 'simulated buy-in — demo checkout, no real money changes hands',
    at: '2026-10-09T12:00:00.000Z',
    ...overrides,
  };
}

describe('deriveManagerId', () => {
  it('mirrors the server rule: lowercase local part, non-alphanumerics stripped', () => {
    expect(deriveManagerId('Majid@Example.com')).toBe('mgr-majid');
    expect(deriveManagerId('a+b@stakehouse.test')).toBe('mgr-ab');
  });

  it('falls back to the placeholder seat when nothing survives', () => {
    expect(deriveManagerId('@stakehouse.test')).toBe('mgr-manager');
  });
});

describe('hasPaidBuyIn', () => {
  it('is true only for a buy-in entry belonging to the manager', () => {
    const ledger = [
      entry(),
      entry({ id: 'le-2', kind: 'commissioner-credit', managerId: null, amountCents: 500 }),
      entry({ id: 'le-3', kind: 'buy-in', managerId: 'mgr-someone-else' }),
    ];
    expect(hasPaidBuyIn(ledger, 'mgr-majid')).toBe(true);
    expect(hasPaidBuyIn(ledger, 'mgr-nobody')).toBe(false);
  });
});

describe('formatSignedCents', () => {
  it('formats credits with the money tone', () => {
    expect(formatSignedCents(2500)).toEqual({ text: '+$25.00', tone: 'money' });
    expect(formatSignedCents(0)).toEqual({ text: '+$0.00', tone: 'money' });
  });

  it('formats debits with the danger tone', () => {
    expect(formatSignedCents(-1200)).toEqual({ text: '-$12.00', tone: 'danger' });
  });

  it('never crashes on an out-of-range integer — it degrades to raw text', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(formatSignedCents(unsafe)).toEqual({ text: String(unsafe), tone: 'money' });
  });
});

describe('seatState', () => {
  const myId = 'mgr-majid';

  it('is paid once a buy-in entry exists for the manager', () => {
    expect(seatState([entry()], myId, false)).toBe('paid');
  });

  it('is joined-unpaid after a local join with no ledger entry yet', () => {
    expect(seatState([], myId, true)).toBe('joinedUnpaid');
  });

  it('is not-joined before any evidence of a seat', () => {
    expect(seatState([], myId, false)).toBe('notJoined');
  });

  it('treats an unknown manager id with a local join as joined-unpaid', () => {
    expect(seatState([entry({ managerId: 'mgr-someone-else' })], null, true)).toBe('joinedUnpaid');
  });

  it('prefers ledger evidence over the local join flag', () => {
    expect(seatState([entry()], myId, true)).toBe('paid');
  });
});
