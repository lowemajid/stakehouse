// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@stakehouse/api-client';
import App from '../App';
import { makeFakeApi } from '../test/api';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

/** Renders the app at a league path, optionally with a stored session. */
function renderLeague(path: string, api = makeFakeApi(), signedIn = true) {
  if (signedIn) {
    window.localStorage.setItem(
      'sh.session',
      JSON.stringify({ displayName: 'Marge Kowalski', email: 'marge@example.com' }),
    );
  }
  window.history.replaceState(null, '', path);
  return render(<App api={api} />);
}

describe('LeaguePage — overview tab', () => {
  it('shows the league, its pot, and its seats from the server', async () => {
    renderLeague('/leagues/lg-open');
    expect(
      await screen.findByRole('heading', { name: 'Tuesday Night Kitchen League' }),
    ).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument(); // empty pot, brass when it fills
    expect(screen.getByText('1 / 8 seats')).toBeInTheDocument();
  });

  it('joins a league with an open seat and refetches the truth', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderLeague('/leagues/lg-open', api);
    await user.click(await screen.findByRole('button', { name: /join this league/i }));
    await waitFor(() => expect(api.joinLeague).toHaveBeenCalledWith('lg-open'));
    expect(await screen.findByText(/you hold a seat in this league/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(api.listLeagues).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it('treats an already-joined rejection as seated, not as an error', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      joinLeague: vi
        .fn()
        .mockRejectedValue(
          new ApiError(409, 'already-joined', 'you already hold a seat in this league'),
        ),
    });
    renderLeague('/leagues/lg-open', api);
    await user.click(await screen.findByRole('button', { name: /join this league/i }));
    expect(await screen.findByText(/you hold a seat in this league/i)).toBeInTheDocument();
  });

  it('pays through the demo checkout and shows the pool move', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderLeague('/leagues/lg-open', api);
    await user.click(await screen.findByRole('button', { name: /pay the buy-in/i }));
    // The checkout is unmistakably simulated.
    expect(screen.getByText(/no real money/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /record simulated buy-in/i }));
    await waitFor(() => expect(api.payBuyIn).toHaveBeenCalledWith('lg-open'));
    expect(await screen.findByText(/buy-in recorded/i)).toBeInTheDocument();
    // The server-computed pool comes back on the pay result and lands in the note.
    expect(await screen.findByText(/the pool stands at \$25\.00/i)).toBeInTheDocument();
    // The acceptance contract: the pool has moved on the ledger screen.
    await user.click(screen.getByRole('link', { name: 'The books' }));
    expect(await screen.findByRole('heading', { name: 'The books' })).toBeInTheDocument();
    expect(await screen.findByText(/simulated buy-in/i)).toBeInTheDocument();
    expect(screen.getByText('Pool total')).toBeInTheDocument();
    // Both the buy-in row and the pool total read $25.00 — the money is on the books.
    expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0);
  });

  it('shows the server’s already-paid message on a second buy-in', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      payBuyIn: vi
        .fn()
        .mockRejectedValue(
          new ApiError(409, 'already-paid', 'this seat has already paid its buy-in'),
        ),
    });
    renderLeague('/leagues/lg-open', api);
    await user.click(await screen.findByRole('button', { name: /pay the buy-in/i }));
    await user.click(screen.getByRole('button', { name: /record simulated buy-in/i }));
    expect(await screen.findByText(/this seat has already paid/i)).toBeInTheDocument();
  });

  it('a full league offers no join control', async () => {
    renderLeague('/leagues/lg-sandbox');
    expect(
      await screen.findByRole('heading', { name: 'The Stakehouse Sandbox' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join this league/i })).not.toBeInTheDocument();
    expect(screen.getByText(/every seat is taken/i)).toBeInTheDocument();
  });

  it('a signed-out visitor gets the door, not dead buttons', async () => {
    renderLeague('/leagues/lg-open', makeFakeApi(), false);
    expect(await screen.findByRole('link', { name: /sign in to join or pay/i })).toHaveAttribute(
      'href',
      '/signin',
    );
    expect(screen.queryByRole('button', { name: /join this league/i })).not.toBeInTheDocument();
  });

  it('an unknown league shows a way back, never a blank screen', async () => {
    renderLeague('/leagues/lg-nope');
    expect(await screen.findByText(/couldn't find that league/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the lobby/i })).toHaveAttribute('href', '/');
  });
});

describe('LeaguePage — ledger tab', () => {
  it('renders every entry and the running pool from the server', async () => {
    renderLeague('/leagues/lg-sandbox/ledger');
    expect(await screen.findByRole('heading', { name: 'The books' })).toBeInTheDocument();
    expect(await screen.findByText(/simulated buy-in/i)).toBeInTheDocument();
    expect(screen.getByText('Pool total')).toBeInTheDocument();
    expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0);
    expect(
      await screen.findByRole('option', { name: 'The Stakehouse Sandbox' }),
    ).toBeInTheDocument(); // switcher carries the league
  });

  it('an empty ledger says so instead of rendering nothing', async () => {
    renderLeague(
      '/leagues/lg-open/ledger',
      makeFakeApi({ getLedger: vi.fn().mockResolvedValue({ entries: [], poolCents: 0 }) }),
    );
    expect(await screen.findByText(/the books are empty/i)).toBeInTheDocument();
  });
});
