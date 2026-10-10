// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
function renderBooks(
  path: string,
  api = makeFakeApi(),
  signedIn = true,
  email = 'marge@example.com',
) {
  if (signedIn) {
    window.localStorage.setItem(
      'sh.session',
      JSON.stringify({ displayName: 'Marge Kowalski', email }),
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

/**
 * The money desk: the commissioner's controls over the pot. Everything the
 * desk does goes through the API client and refetches the books — the ledger
 * stays the only source of truth, and new rows stagger in from the refetch.
 */
const COMMISSIONER_BOOKS_API = (ledger: unknown, overrides: Record<string, unknown> = {}) =>
  makeFakeApi({
    listLeagues: vi.fn().mockResolvedValue([OPEN_LEAGUE_VIEW, SANDBOX_LEAGUE_VIEW]),
    getLedger: vi.fn().mockResolvedValue(ledger),
    ...overrides,
  });

describe('The money desk — who sees it', () => {
  it("shows the desk to the league's commissioner", async () => {
    renderBooks('/leagues/lg-open/ledger', COMMISSIONER_BOOKS_API(RICH_LEDGER));
    expect(await screen.findByRole('heading', { name: 'The money desk' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Empty the pot — pay the winners' }),
    ).toBeInTheDocument();
  });

  it('hides the desk from everyone who is not the commissioner', async () => {
    renderBooks(
      '/leagues/lg-open/ledger',
      COMMISSIONER_BOOKS_API(RICH_LEDGER),
      true,
      'norm@example.com',
    );
    expect(await screen.findByRole('heading', { name: 'The books' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The money desk' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Empty the pot — pay the winners' }),
    ).not.toBeInTheDocument();
  });
});

describe('The money desk — payout distribution', () => {
  it('distributes the pot, refetches, and staggers the payout rows in', async () => {
    const user = userEvent.setup();
    const AFTER = {
      entries: [
        ...RICH_LEDGER.entries,
        entry({
          id: 'led-4',
          kind: 'payout',
          managerId: 'mgr-norm',
          amountCents: -150,
          memo: 'season payout — 1st place',
          at: '2026-10-04T12:00:00.000Z',
          balanceAfterCents: 100,
        }),
        entry({
          id: 'led-5',
          kind: 'payout',
          managerId: 'mgr-marge',
          amountCents: -100,
          memo: 'season payout — 2nd place',
          at: '2026-10-04T12:00:00.000Z',
          balanceAfterCents: 0,
        }),
      ],
      poolCents: 0,
      seats: SEATS,
    };
    const getLedger = vi.fn().mockResolvedValueOnce(RICH_LEDGER).mockResolvedValue(AFTER);
    const distributePayouts = vi
      .fn()
      .mockResolvedValue({ entries: AFTER.entries.slice(3), poolCents: 0 });
    renderBooks(
      '/leagues/lg-open/ledger',
      COMMISSIONER_BOOKS_API(RICH_LEDGER, { getLedger, distributePayouts }),
    );

    await screen.findByRole('heading', { name: 'The money desk' });
    await user.click(screen.getByRole('button', { name: 'Empty the pot — pay the winners' }));
    expect(distributePayouts).toHaveBeenCalledWith('lg-open');
    expect(await screen.findByText('The pot is empty — winners paid in full.')).toBeInTheDocument();
    expect(getLedger).toHaveBeenCalledTimes(2);
    const rows = screen.getAllByRole('row');
    const lastPayoutRow = rows[rows.length - 2]!;
    expect(within(lastPayoutRow).getByText('Payout')).toBeInTheDocument();
    expect(lastPayoutRow.className).toContain('sh-ledger__row--enter');
    expect(within(rows[rows.length - 1]!).getByText('$0.00')).toBeInTheDocument();
  });

  it('previews the configured split before anything is distributed', async () => {
    renderBooks('/leagues/lg-open/ledger', COMMISSIONER_BOOKS_API(RICH_LEDGER));
    expect(await screen.findByRole('heading', { name: 'The money desk' })).toBeInTheDocument();
    expect(screen.getByText(/1st.*\$1\.25/)).toBeInTheDocument();
    expect(screen.getByText(/2nd.*\$0\.75/)).toBeInTheDocument();
    expect(screen.getByText(/3rd.*\$0\.50/)).toBeInTheDocument();
  });
});

describe('The money desk — credit and refunds', () => {
  it('credits the pool from a dollar amount, converted to cents', async () => {
    const user = userEvent.setup();
    const creditPool = vi.fn().mockResolvedValue({
      entry: entry({ id: 'led-new', kind: 'commissioner-credit' }),
      poolCents: 750,
    });
    const AFTER = {
      entries: [
        ...RICH_LEDGER.entries,
        entry({
          id: 'led-new',
          kind: 'commissioner-credit',
          managerId: null,
          amountCents: 500,
          memo: 'season-opening promo',
          at: '2026-10-04T12:00:00.000Z',
          balanceAfterCents: 750,
        }),
      ],
      poolCents: 750,
      seats: SEATS,
    };
    const getLedger = vi.fn().mockResolvedValueOnce(RICH_LEDGER).mockResolvedValue(AFTER);
    renderBooks(
      '/leagues/lg-open/ledger',
      COMMISSIONER_BOOKS_API(RICH_LEDGER, { getLedger, creditPool }),
    );

    await screen.findByRole('heading', { name: 'The money desk' });
    await user.type(screen.getByLabelText('Credit amount (dollars)'), '5');
    await user.type(screen.getByLabelText('Memo (optional)'), 'season-opening promo');
    await user.click(screen.getByRole('button', { name: 'Credit the pool' }));
    expect(creditPool).toHaveBeenCalledWith('lg-open', {
      amountCents: 500,
      memo: 'season-opening promo',
    });
    // the pool grew — the total and the new row's balance both show $7.50
    expect((await screen.findAllByText('$7.50')).length).toBeGreaterThan(0);
    expect(getLedger).toHaveBeenCalledTimes(2);
  });

  it('refuses an empty or non-positive credit locally — nothing is sent', async () => {
    const user = userEvent.setup();
    const creditPool = vi.fn();
    renderBooks('/leagues/lg-open/ledger', COMMISSIONER_BOOKS_API(RICH_LEDGER, { creditPool }));

    await screen.findByRole('heading', { name: 'The money desk' });
    await user.click(screen.getByRole('button', { name: 'Credit the pool' }));
    expect(creditPool).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a positive amount.')).toBeInTheDocument();
  });

  it("returns a seat's remaining net on demand", async () => {
    const user = userEvent.setup();
    const refundSeat = vi.fn().mockResolvedValue({
      entry: entry({ id: 'led-back', kind: 'refund' }),
      poolCents: 0,
    });
    renderBooks('/leagues/lg-open/ledger', COMMISSIONER_BOOKS_API(RICH_LEDGER, { refundSeat }));

    await screen.findByRole('heading', { name: 'The money desk' });
    await user.click(screen.getByRole('button', { name: /Return Marge Kowalski/ }));
    expect(refundSeat).toHaveBeenCalledWith('lg-open', 'mgr-marge');
  });

  it('offers no return where nothing is owed', async () => {
    const SEATS_WITH_ZERO = [
      { id: 'mgr-marge', displayName: 'Marge Kowalski', paidCents: 2500 },
      { id: 'mgr-norm', displayName: 'Norm Grimsby', paidCents: 0 },
    ];
    renderBooks(
      '/leagues/lg-open/ledger',
      COMMISSIONER_BOOKS_API({ ...RICH_LEDGER, seats: SEATS_WITH_ZERO }),
    );

    await screen.findByRole('heading', { name: 'The money desk' });
    expect(screen.queryByRole('button', { name: /Return Norm Grimsby/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Return Marge Kowalski/ })).toBeInTheDocument();
  });
});

describe('The money desk — cancellation', () => {
  it('voids the league only after confirmation, then shows the refunds', async () => {
    const user = userEvent.setup();
    const cancelLeague = vi.fn().mockResolvedValue({
      refunds: [
        {
          ...entry({ id: 'led-back-1', kind: 'refund' }),
          amountCents: -2500,
          memo: 'cancellation refund — net returned',
        },
      ],
      poolCents: 0,
      cancelledAt: '2026-10-04T12:00:00.000Z',
    });
    renderBooks('/leagues/lg-open/ledger', COMMISSIONER_BOOKS_API(RICH_LEDGER, { cancelLeague }));

    await screen.findByRole('heading', { name: 'The money desk' });
    await user.click(screen.getByRole('button', { name: 'Void the league' }));
    expect(cancelLeague).not.toHaveBeenCalled(); // confirmation stands between
    await user.click(screen.getByRole('button', { name: 'Yes — void it and refund everyone' }));
    expect(cancelLeague).toHaveBeenCalledWith('lg-open');
    expect(await screen.findByText(/voided/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Empty the pot — pay the winners' }),
    ).not.toBeInTheDocument();
  });

  it('reads a voided league as settled — banner up, controls gone, books open', async () => {
    const VOIDED = { ...OPEN_LEAGUE_VIEW, cancelledAt: '2026-10-04T12:00:00.000Z' };
    renderBooks(
      '/leagues/lg-open/ledger',
      COMMISSIONER_BOOKS_API(RICH_LEDGER, {
        listLeagues: vi.fn().mockResolvedValue([VOIDED, SANDBOX_LEAGUE_VIEW]),
      }),
    );

    expect(await screen.findByText(/voided/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Empty the pot — pay the winners' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void the league' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'The books' })).toBeInTheDocument();
  });
});
