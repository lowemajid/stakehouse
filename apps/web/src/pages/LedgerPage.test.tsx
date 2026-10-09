// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntryView, SeatView } from '@stakehouse/api-client';
import App from '../App';
import { makeFakeApi } from '../test/api';
import { OPEN_LEAGUE_VIEW, SANDBOX_LEAGUE_VIEW } from '../test/fixtures';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

/** Renders the app on a books path, optionally with a stored session. */
function renderBooks(path: string, api = makeFakeApi(), signedIn = true) {
  if (signedIn) {
    window.localStorage.setItem(
      'sh.session',
      JSON.stringify({ displayName: 'Marge Kowalski', email: 'marge@example.com' }),
    );
  }
  window.history.replaceState(null, '', path);
  return render(<App api={api} />);
}

const SEATS: SeatView[] = [
  { id: 'mgr-marge', displayName: 'Marge Kowalski', paidCents: 2500 },
  { id: 'mgr-norm', displayName: 'Norm Grimsby', paidCents: 2500 },
];

function entry(overrides: Partial<LedgerEntryView> & { id: string }): LedgerEntryView {
  return {
    kind: 'buy-in',
    managerId: 'mgr-marge',
    amountCents: 2500,
    memo: 'simulated buy-in — demo checkout, no real money changes hands',
    at: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * A ledger that has seen a season: a buy-in, a commissioner credit, and a
 * payout — balances 2500 → 3000 → 250, the payout walking the pool back down.
 */
const RICH_LEDGER = {
  entries: [
    entry({ id: 'led-1', balanceAfterCents: 2500 }),
    entry({
      id: 'led-2',
      kind: 'commissioner-credit',
      managerId: null,
      amountCents: 500,
      memo: 'commissioner promo — season-opening credit',
      at: '2026-10-02T12:00:00.000Z',
      balanceAfterCents: 3000,
    }),
    entry({
      id: 'led-3',
      kind: 'payout',
      managerId: 'mgr-norm',
      amountCents: -2750,
      memo: 'season payout — 1st place',
      at: '2026-10-03T12:00:00.000Z',
      balanceAfterCents: 250,
    }),
  ],
  poolCents: 250,
  seats: SEATS,
};

describe('The books — full transaction history', () => {
  it('renders every entry with its running balance, ending at the pool total', async () => {
    const api = makeFakeApi({
      listLeagues: vi.fn().mockResolvedValue([OPEN_LEAGUE_VIEW, SANDBOX_LEAGUE_VIEW]),
      getLedger: vi.fn().mockResolvedValue(RICH_LEDGER),
    });
    renderBooks('/leagues/lg-open/ledger', api);

    expect(await screen.findByRole('heading', { name: 'The books' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(5); // header + three entries + pool total
    expect(within(rows[1]!).getAllByText('$25.00')).toHaveLength(2); // amount and balance
    expect(within(rows[2]!).getByText('$5.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('$30.00')).toBeInTheDocument();
    // the payout walks the balance back down, signed out of the pool
    expect(within(rows[3]!).getByText('-$27.50')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('$2.50')).toBeInTheDocument();
    // the pool total is the server's derived balance, not a client sum
    expect(within(rows[4]!).getByText('Pool total')).toBeInTheDocument();
    expect(within(rows[4]!).getByText('$2.50')).toBeInTheDocument();
  });

  it('names who moved the money, and the house for pool-level events', async () => {
    const api = makeFakeApi({
      listLeagues: vi.fn().mockResolvedValue([OPEN_LEAGUE_VIEW, SANDBOX_LEAGUE_VIEW]),
      getLedger: vi.fn().mockResolvedValue(RICH_LEDGER),
    });
    renderBooks('/leagues/lg-open/ledger', api);

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]!).getByText('Marge Kowalski')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('the house')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Norm Grimsby')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Buy-in')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Commissioner credit')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Payout')).toBeInTheDocument();
  });

  it('reads the balance column as a running ledger even across refunds', async () => {
    const api = makeFakeApi({
      listLeagues: vi.fn().mockResolvedValue([OPEN_LEAGUE_VIEW, SANDBOX_LEAGUE_VIEW]),
      getLedger: vi.fn().mockResolvedValue({
        entries: [
          entry({ id: 'led-1', balanceAfterCents: 2500 }),
          entry({ id: 'led-2', managerId: 'mgr-norm', balanceAfterCents: 5000 }),
          entry({
            id: 'led-3',
            kind: 'refund',
            managerId: 'mgr-norm',
            amountCents: -2500,
            memo: 'cancellation refund — buy-ins returned',
            at: '2026-10-04T12:00:00.000Z',
            balanceAfterCents: 2500,
          }),
        ],
        poolCents: 2500,
        seats: SEATS,
      }),
    });
    renderBooks('/leagues/lg-open/ledger', api);

    const rows = await screen.findAllByRole('row');
    expect(within(rows[2]!).getByText('$50.00')).toBeInTheDocument(); // second buy-in lands
    expect(within(rows[3]!).getByText('Refund')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('-$25.00')).toBeInTheDocument(); // exactly the buy-in
    expect(within(rows[3]!).getByText('$25.00')).toBeInTheDocument(); // pool back to one seat
  });
});
