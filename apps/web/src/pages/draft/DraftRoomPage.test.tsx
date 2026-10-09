// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@stakehouse/api-client';
import App from '../../App';
import { makeFakeApi } from '../../test/api';
import { draftViewFixture, liveAfterOnePick } from '../../test/draft';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

function renderDraft(path: string, api = makeFakeApi()) {
  window.localStorage.setItem(
    'sh.session',
    JSON.stringify({ displayName: 'Marge Kowalski', email: 'marge@example.com' }),
  );
  window.history.replaceState(null, '', path);
  return render(<App api={api} />);
}

describe('DraftRoomPage — server-first room', () => {
  it('opens with the server view: seats, board, and who is on the clock', async () => {
    renderDraft('/leagues/lg-sandbox/draft');
    expect(
      await screen.findByRole('heading', { name: 'The Stakehouse Sandbox' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/is on the clock/i)).toBeInTheDocument(); // named
    expect(screen.getByText(/your pick/i)).toBeInTheDocument(); // it's my seat
    expect(screen.getByRole('table', { name: /available players/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft dov amado/i })).toBeEnabled();
  });

  it('a spectator sees the room but arms no pick buttons', async () => {
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue({ draft: draftViewFixture(), you: null }),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    expect(await screen.findByRole('table', { name: /available players/i })).toBeInTheDocument();
    expect(screen.queryByText(/your pick/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft dov amado/i })).toBeDisabled();
  });

  it('the pending room shows the order and a start CTA that posts the intent', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      getDraft: vi
        .fn()
        .mockResolvedValue({ draft: draftViewFixture({ status: 'pending' }), you: 'mgr-marge' }),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    expect(await screen.findByText(/the draft has not started/i)).toBeInTheDocument();
    expect(screen.getByText(/marge kowalski → chester royales/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start the draft/i }));
    await waitFor(() => expect(api.startDraft).toHaveBeenCalledWith('lg-sandbox'));
    expect(await screen.findByRole('table', { name: /available players/i })).toBeInTheDocument();
  });

  it('an AI pick lands through a POST response without a page reload', async () => {
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue({ draft: liveAfterOnePick(), you: null }),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    // AI seat is on the clock and visibly thinking.
    expect(await screen.findByText(/thinking…/i)).toBeInTheDocument();
    // Spectator queue panel: sign-in door, not a dead control.
    expect(screen.getByText(/sign in and take a seat/i)).toBeInTheDocument();
    expect(api.getDraft).toHaveBeenCalledWith('lg-sandbox');
  });

  it('a rejected pick surfaces the server reason, not a blank screen', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      draftPick: vi
        .fn()
        .mockRejectedValue(new ApiError(409, 'clock-expired', 'your pick clock has expired')),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    await user.click(await screen.findByRole('button', { name: /draft dov amado/i }));
    await waitFor(() => expect(api.draftPick).toHaveBeenCalledWith('lg-sandbox', 'p-1'));
    expect(await screen.findByText(/your pick clock has expired/i)).toBeInTheDocument();
  });

  it('queueing from the board appends to my server queue', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderDraft('/leagues/lg-sandbox/draft', api);
    await user.click(await screen.findByRole('button', { name: /queue dov amado/i }));
    await waitFor(() => expect(api.setDraftQueue).toHaveBeenCalledWith('lg-sandbox', ['p-1']));
  });

  it('the autopick toggle is my preference and it persists', async () => {
    const user = userEvent.setup();
    renderDraft('/leagues/lg-sandbox/draft');
    const toggle = await screen.findByRole('checkbox');
    expect(toggle).toBeChecked(); // default ON
    await user.click(toggle);
    expect(window.localStorage.getItem('sh-autopick:mgr-marge')).toBe('off');
  });

  it('a failed GET offers a retry instead of a dead screen', async () => {
    const user = userEvent.setup();
    const getDraft = vi.fn().mockRejectedValue(new ApiError(500, 'boom', 'the room is flooded'));
    const api = makeFakeApi({ getDraft });
    renderDraft('/leagues/lg-sandbox/draft', api);
    expect(await screen.findByText(/the room is flooded/i)).toBeInTheDocument();
    getDraft.mockResolvedValue({ draft: draftViewFixture(), you: 'mgr-marge' });
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/your pick/i)).toBeInTheDocument();
  });
});
