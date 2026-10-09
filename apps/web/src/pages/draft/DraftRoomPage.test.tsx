// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@stakehouse/api-client';
import App from '../../App';
import { makeFakeApi } from '../../test/api';
import {
  DRAFT_SEAT_IDS,
  FakeEventSource,
  draftViewFixture,
  installFakeEventSource,
  liveAfterOnePick,
} from '../../test/draft';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

function renderDraft(path: string, api = makeFakeApi()) {
  installFakeEventSource();
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
      getDraft: vi.fn().mockResolvedValue(draftViewFixture({ you: null })),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    expect(await screen.findByRole('table', { name: /available players/i })).toBeInTheDocument();
    expect(screen.queryByText(/your pick/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft dov amado/i })).toBeDisabled();
  });

  it('the pending room shows the order and a start CTA that posts the intent', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue(draftViewFixture({ status: 'pending' })),
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
      getDraft: vi.fn().mockResolvedValue({ ...liveAfterOnePick(), you: null }),
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
      postPick: vi
        .fn()
        .mockRejectedValue(new ApiError(409, 'clock-expired', 'your pick clock has expired')),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    await user.click(await screen.findByRole('button', { name: /draft dov amado/i }));
    await waitFor(() => expect(api.postPick).toHaveBeenCalledWith('lg-sandbox', 'p-1'));
    expect(await screen.findByText(/your pick clock has expired/i)).toBeInTheDocument();
  });

  it('queueing from the board appends to my server queue', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi();
    renderDraft('/leagues/lg-sandbox/draft', api);
    await user.click(await screen.findByRole('button', { name: /queue dov amado/i }));
    await waitFor(() => expect(api.putQueue).toHaveBeenCalledWith('lg-sandbox', ['p-1']));
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
    getDraft.mockResolvedValue(draftViewFixture());
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/your pick/i)).toBeInTheDocument();
  });
});

describe('DraftRoomPage — the live stream', () => {
  it('an SSE draft event updates the board without a reload', async () => {
    renderDraft('/leagues/lg-sandbox/draft');
    expect(await screen.findByRole('button', { name: /draft dov amado/i })).toBeEnabled();
    const source = FakeEventSource.instances[0]!;
    source.emit('draft', { draft: liveAfterOnePick() });
    // The picked player left the board; the AI seat is now on the clock.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /draft dov amado/i })).not.toBeInTheDocument(),
    );
    const where = screen.getByText(/is on the clock/i);
    expect(where.textContent).toContain('Chester Royales');
    expect(screen.getByText(/thinking…/i)).toBeInTheDocument();
  });

  it('the countdown shows time remaining and turns urgent inside ten seconds', async () => {
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue(
        draftViewFixture({
          clock: { overall: 1, managerId: DRAFT_SEAT_IDS[0], deadline: Date.now() + 8_000 },
        }),
      ),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    const clock = await screen.findByRole('timer');
    await waitFor(() => expect(clock.textContent).toMatch(/0:0[0-8]/));
    expect(clock).toHaveAttribute('data-urgent', 'true'); // 8s ≤ 10s
  });

  it('a relaxed clock is not urgent', async () => {
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue(
        draftViewFixture({
          clock: { overall: 1, managerId: DRAFT_SEAT_IDS[0], deadline: Date.now() + 45_000 },
        }),
      ),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    const clock = await screen.findByRole('timer');
    await waitFor(() => expect(clock.textContent).toMatch(/0:4[0-9]/));
    expect(clock).toHaveAttribute('data-urgent', 'false');
  });

  it('an expired AI clock fires the room autopick and toasts who landed', async () => {
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue(
        draftViewFixture({
          clock: { overall: 1, managerId: DRAFT_SEAT_IDS[1], deadline: Date.now() - 5 },
        }),
      ),
      postAutopick: vi.fn().mockResolvedValue({
        autopicked: {
          overall: 1,
          managerId: DRAFT_SEAT_IDS[1],
          playerId: 'p-1',
          at: '2026-10-09T12:00:00Z',
        },
        draft: liveAfterOnePick(),
      }),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    await waitFor(() => expect(api.postAutopick).toHaveBeenCalledWith('lg-sandbox'));
    expect(
      await screen.findByText(/clock expired — chester royales autopicked dov amado/i),
    ).toBeInTheDocument();
  });

  it('my own expired clock fires the room autopick even with my preference off', async () => {
    // The server has no timer; a tab must carry the expiry or the room freezes
    // at 0:00 forever (single-tab room). The toggle is a preference — the
    // server's resolveDeadline answers from the queue or best available.
    window.localStorage.setItem('sh-autopick:mgr-marge', 'off');
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue(
        draftViewFixture({
          clock: { overall: 1, managerId: DRAFT_SEAT_IDS[0], deadline: Date.now() - 5 },
        }),
      ),
      postAutopick: vi.fn().mockResolvedValue({
        autopicked: {
          overall: 1,
          managerId: DRAFT_SEAT_IDS[0],
          playerId: 'p-1',
          at: '2026-10-09T12:00:00Z',
        },
        draft: liveAfterOnePick(),
      }),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    await waitFor(() => expect(api.postAutopick).toHaveBeenCalledWith('lg-sandbox'));
    expect(await screen.findByText(/clock expired —.*autopicked/i)).toBeInTheDocument();
  });
});

describe('DraftRoomPage — fast-forward and recap', () => {
  function completeView() {
    return draftViewFixture({
      status: 'complete',
      picks: [
        { overall: 1, managerId: DRAFT_SEAT_IDS[0], playerId: 'p-1', at: '2026-10-09T12:01:00Z' },
        { overall: 2, managerId: DRAFT_SEAT_IDS[1], playerId: 'p-2', at: '2026-10-09T12:01:30Z' },
      ],
      board: [],
      clock: { overall: null, managerId: null, deadline: null },
      rosters: {
        [DRAFT_SEAT_IDS[0]]: [{ playerId: 'p-1', position: 'QB', slot: 'QB' }],
        [DRAFT_SEAT_IDS[1]]: [{ playerId: 'p-2', position: 'RB', slot: 'RB' }],
        [DRAFT_SEAT_IDS[2]]: [],
      },
    });
  }

  it('the commissioner gets a confirm before fast-forwarding the rest of the draft', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      postFastForward: vi.fn().mockResolvedValue({ fastForwarded: 34, draft: completeView() }),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    await user.click(await screen.findByRole('button', { name: /fast-forward/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/no take-backs/i);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.postFastForward).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /fast-forward/i }));
    await user.click(screen.getByRole('button', { name: /resolve every pick/i }));
    await waitFor(() => expect(api.postFastForward).toHaveBeenCalledWith('lg-sandbox'));
    expect(await screen.findByRole('table', { name: /draft recap/i })).toBeInTheDocument();
  });

  it('a non-commissioner sees no fast-forward control', async () => {
    const api = makeFakeApi({
      getDraft: vi
        .fn()
        .mockResolvedValue(draftViewFixture({ commissionerSeatId: DRAFT_SEAT_IDS[1] })),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    expect(await screen.findByRole('button', { name: /draft dov amado/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /fast-forward/i })).not.toBeInTheDocument();
  });

  it('the recap lists every pick in snake order with seat and player names', async () => {
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue(completeView()),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    const recap = await screen.findByRole('table', { name: /draft recap/i });
    const rows = recap.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Marge Kowalski');
    expect(rows[0]!.textContent).toContain('Dov Amado');
    expect(rows[1]!.textContent).toContain('Chester Royales');
    expect(rows[1]!.textContent).toContain('Silas Brummell');
  });

  it('the commissioner hands the league to the season engine', async () => {
    const user = userEvent.setup();
    const api = makeFakeApi({
      getDraft: vi.fn().mockResolvedValue(completeView()),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    await user.click(await screen.findByRole('button', { name: /start week 1/i }));
    await waitFor(() => expect(api.simulateNextWeek).toHaveBeenCalledWith('lg-sandbox'));
    await waitFor(() => expect(window.location.pathname).toBe(`/leagues/${'lg-sandbox'}`));
  });

  it('a non-commissioner waits for the week-1 handoff', async () => {
    const api = makeFakeApi({
      getDraft: vi
        .fn()
        .mockResolvedValue(
          draftViewFixture({ status: 'complete', commissionerSeatId: DRAFT_SEAT_IDS[1] }),
        ),
      postFastForward: vi.fn(),
    });
    renderDraft('/leagues/lg-sandbox/draft', api);
    expect(await screen.findByText(/waiting for the commissioner/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start week 1/i })).not.toBeInTheDocument();
  });
});
