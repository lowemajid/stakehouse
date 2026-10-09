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

function renderCreate(api = makeFakeApi()) {
  window.localStorage.setItem(
    'sh.session',
    JSON.stringify({ displayName: 'Marge Kowalski', email: 'marge@example.com' }),
  );
  window.history.replaceState(null, '', '/leagues/new');
  return render(<App api={api} />);
}

describe('CreateLeaguePage', () => {
  it('renders the commissioner form with house defaults', async () => {
    renderCreate();
    expect(await screen.findByRole('heading', { name: 'Create a league' })).toBeInTheDocument();
    expect(screen.getByLabelText('League name')).toHaveValue('');
    expect(screen.getByLabelText('Entry fee (USD)')).toHaveValue(25);
    expect(screen.getByLabelText('League size')).toHaveValue('8');
    expect(screen.getByLabelText('Scoring preset')).toHaveValue('standard');
    expect(screen.getByText(/split total: 100%/i)).toBeInTheDocument();
  });

  it('blocks an empty name client-side without calling the API', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderCreate(api);
    await user.click(await screen.findByRole('button', { name: /open the league/i }));
    expect(await screen.findByText('league name is required')).toBeInTheDocument();
    expect(api.createLeague).not.toHaveBeenCalled();
  });

  it('surfaces the split sum in-form before any submission', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderCreate(api);
    const first = screen.getByLabelText('1st place %');
    await user.clear(first);
    await user.type(first, '70');
    expect(await screen.findByText(/split total: 120%/i)).toBeInTheDocument();
    expect(screen.getByText('the payout split must total exactly 100%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open the league/i }));
    expect(api.createLeague).not.toHaveBeenCalled();
  });

  it('creates the league and opens it on success', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderCreate(api);
    await user.type(await screen.findByLabelText('League name'), 'Tuesday Night Kitchen League');
    await user.click(screen.getByRole('button', { name: /open the league/i }));
    await waitFor(() => expect(api.createLeague).toHaveBeenCalledTimes(1));
    expect(api.createLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Tuesday Night Kitchen League',
        entryFeeCents: 2500,
        size: 8,
        payoutSplitPct: [50, 30, 20],
        regularSeasonWeeks: 10,
        playoffTeams: 4,
      }),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/leagues/lg-open'));
    expect(
      await screen.findByRole('heading', { name: 'Tuesday Night Kitchen League' }),
    ).toBeInTheDocument();
  });

  it('renders a half-PPR preset choice in the submitted config', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderCreate(api);
    await user.type(await screen.findByLabelText('League name'), 'Half PPR House');
    await user.selectOptions(screen.getByLabelText('Scoring preset'), 'half');
    await user.click(screen.getByRole('button', { name: /open the league/i }));
    await waitFor(() => expect(api.createLeague).toHaveBeenCalledTimes(1));
    const config = (vi.mocked(api.createLeague).mock.calls[0]?.[0] ?? {}) as {
      scoring?: { reception?: number };
    };
    expect(config.scoring?.reception).toBe(0.5);
  });

  it('renders server validation errors on the offending field', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      createLeague: vi
        .fn()
        .mockRejectedValue(
          new ApiError(400, 'validation-error', 'the league config was rejected', [
            { path: 'payoutSplitPct', message: 'must total exactly 100' },
          ]),
        ),
    });
    renderCreate(api);
    await user.type(await screen.findByLabelText('League name'), 'Server Rejects This');
    await user.click(screen.getByRole('button', { name: /open the league/i }));
    expect(await screen.findByText('must total exactly 100')).toBeInTheDocument();
  });
});
