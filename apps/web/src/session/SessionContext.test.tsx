// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StakehouseApi } from '@stakehouse/api-client';
import { ApiProvider } from '../state/ApiContext';
import { makeFakeApi } from '../test/api';
import { SessionProvider, useSession } from './SessionContext';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/** A probe that renders the session state and both mutations. */
function Probe() {
  const session = useSession();
  return (
    <div>
      <div>status:{session.status}</div>
      <div>user:{session.user?.displayName ?? 'none'}</div>
      <button
        type="button"
        onClick={() =>
          void session.signIn({ displayName: 'Marge Kowalski', email: 'marge@example.com' })
        }
      >
        probe-sign-in
      </button>
      <button type="button" onClick={() => session.switchManager()}>
        probe-switch
      </button>
    </div>
  );
}

function renderSession(api: StakehouseApi) {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </ApiProvider>,
  );
}

describe('SessionProvider', () => {
  it('starts signed out when no identity is stored', async () => {
    const api = makeFakeApi();
    renderSession(api);
    expect(await screen.findByText('status:signedOut')).toBeInTheDocument();
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('restores a stored identity by re-signing on boot', async () => {
    window.localStorage.setItem(
      'sh.session',
      JSON.stringify({ displayName: 'Marge Kowalski', email: 'marge@example.com' }),
    );
    const api = makeFakeApi();
    renderSession(api);
    expect(await screen.findByText('status:signedIn')).toBeInTheDocument();
    expect(await screen.findByText('user:Marge Kowalski')).toBeInTheDocument();
    expect(api.createSession).toHaveBeenCalledWith({
      displayName: 'Marge Kowalski',
      email: 'marge@example.com',
    });
  });

  it('falls back to signed out when the stored identity fails to sign', async () => {
    window.localStorage.setItem(
      'sh.session',
      JSON.stringify({ displayName: 'Marge Kowalski', email: 'marge@example.com' }),
    );
    const api = makeFakeApi({
      createSession: vi.fn().mockRejectedValue(new Error('network down')),
    });
    renderSession(api);
    expect(await screen.findByText('status:signedOut')).toBeInTheDocument();
  });

  it('persists a successful sign-in and clears it on switch', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderSession(api);
    await user.click(screen.getByText('probe-sign-in'));
    expect(await screen.findByText('status:signedIn')).toBeInTheDocument();
    expect(window.localStorage.getItem('sh.session')).toContain('Marge Kowalski');
    await user.click(screen.getByText('probe-switch'));
    await waitFor(() => expect(screen.getByText('status:signedOut')).toBeInTheDocument());
    expect(window.localStorage.getItem('sh.session')).toBeNull();
  });
});
