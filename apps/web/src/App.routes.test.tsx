// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@stakehouse/api-client';
import App from './App';
import { apiFailingOnList, makeFakeApi } from './test/api';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

/** Land on a path the way a reload would, then render the app. */
function renderAt(path: string, api = makeFakeApi()) {
  window.history.replaceState(null, '', path);
  return render(<App api={api} />);
}

describe('App routes', () => {
  it('renders the lobby with the sandbox league from the real API shape', async () => {
    const api = makeFakeApi();
    renderAt('/', api);
    expect(
      await screen.findByRole('heading', { name: 'The Stakehouse Sandbox' }),
    ).toBeInTheDocument();
    expect(screen.getByText('$205.00')).toBeInTheDocument(); // pool — brass, from the server
    expect(screen.getByText('$25.00')).toBeInTheDocument(); // entry fee
    expect(screen.getByText('8 / 8 seats')).toBeInTheDocument();
    expect(api.listLeagues).toHaveBeenCalledTimes(1);
  });

  it('carries the shell: wordmark, nav, league switcher, and the demo-money notice', async () => {
    renderAt('/');
    expect(await screen.findByText('Stakehouse')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leagues' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'New league' })).toHaveAttribute(
      'href',
      '/leagues/new',
    );
    expect(screen.getByRole('combobox', { name: 'League switcher' })).toBeInTheDocument();
    expect(screen.getByText(/demo money only/i)).toBeInTheDocument();
  });

  it('shows an empty lobby that offers league creation', async () => {
    const api = makeFakeApi({ listLeagues: vi.fn().mockResolvedValue([]) });
    renderAt('/', api);
    expect(await screen.findByText(/no leagues yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create the first league/i })).toHaveAttribute(
      'href',
      '/leagues/new',
    );
  });

  it('surfaces a failed league load with a retry that recovers', async () => {
    const api = apiFailingOnList(new ApiError(500, 'internal-error', 'unexpected server error'));
    renderAt('/', api);
    expect(await screen.findByText(/couldn't load the leagues/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('signs in from the sign-in screen and reflects it in the shell', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderAt('/signin', api);
    await user.type(await screen.findByLabelText('Display name'), 'Marge Kowalski');
    await user.type(screen.getByLabelText('Email'), 'marge@example.com');
    await user.click(screen.getByRole('button', { name: /take my seat/i }));
    expect(await screen.findByText(/signed in as marge kowalski/i)).toBeInTheDocument();
  });

  it('offers sign-in from the shell when signed out', async () => {
    renderAt('/');
    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/signin',
    );
  });

  it('renders unknown paths as a way home, never a blank screen', async () => {
    renderAt('/nowhere');
    expect(await screen.findByText(/that page doesn't exist/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the lobby/i })).toHaveAttribute('href', '/');
  });

  it('navigates client-side and honors popstate back', async () => {
    const user = userEvent.setup();
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: 'The Stakehouse Sandbox' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'New league' }));
    expect(await screen.findByRole('heading', { name: 'Create a league' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/leagues/new'));
    window.history.back();
    expect(
      await screen.findByRole('heading', { name: 'The Stakehouse Sandbox' }),
    ).toBeInTheDocument();
  });
});
