import type { DraftPickView, DraftSeatView, DraftView } from '@stakehouse/api-client';
import { describe, expect, it, vi } from 'vitest';
import { clockSkew } from './draftClock';
import {
  createDraftFeed,
  newPicksSince,
  pickToast,
  shouldApplyView,
  type DraftFeedDeps,
  type FeedEvent,
} from './draftFeed';

/**
 * Feed orchestration tests: the stream is the fast path, polling the
 * fallback, the server deadline the only clock. The client, timers, and
 * stream are fakes — no network, no real time.
 */

const BASE = 1_000_000;

function seat(id: string, displayName: string, isAi: boolean): DraftSeatView {
  return { id, displayName, isAi };
}

function view(overrides: Partial<DraftView> = {}): DraftView {
  return {
    status: 'live',
    order: ['mgr-ava', 'mgr-marge'],
    picks: [],
    pickSeconds: 30,
    board: [{ playerId: 'pl-1', position: 'QB', name: 'Dov Amado', projectedPoints: 21.4 }],
    clock: { overall: 1, managerId: 'mgr-ava', deadline: null },
    rosters: { 'mgr-ava': [], 'mgr-marge': [] },
    queues: {
      'mgr-ava': { queue: [], autopick: true },
      'mgr-marge': { queue: [], autopick: true },
    },
    seats: [seat('mgr-ava', 'Ava Whitfield', false), seat('mgr-marge', 'Marge Kowalski', true)],
    ...overrides,
  };
}

function pick(overall: number, playerId: string, managerId = 'mgr-ava'): DraftPickView {
  return { overall, managerId, playerId, at: new Date(BASE).toISOString() };
}

interface FakeClient {
  getDraftCalls: number;
  autopickCalls: number;
  draftQueue: DraftView[];
  autopickQueue: Array<
    { ok: true; body: { autopicked: DraftPickView; draft: DraftView } } | { ok: false }
  >;
}

function fakeClient(): FakeClient {
  return { getDraftCalls: 0, autopickCalls: 0, draftQueue: [], autopickQueue: [] };
}

function makeDeps(
  client: FakeClient,
  now: () => number,
): {
  deps: DraftFeedDeps;
  events: FeedEvent[];
  streamCount(): number;
  lastHandlers(): {
    onDraft(view: DraftView): void;
    onClock(at: number): void;
    onDown(reason: 'error' | 'ended'): void;
  };
} {
  const events: FeedEvent[] = [];
  let streams = 0;
  let lastStreamHandlers!: {
    onDraft(view: DraftView): void;
    onClock(at: number): void;
    onDown(reason: 'error' | 'ended'): void;
  };
  const deps: DraftFeedDeps = {
    client: {
      getDraft: async () => {
        client.getDraftCalls += 1;
        const next = client.draftQueue.shift();
        if (!next) throw new Error('test bug: no queued draft response');
        return next;
      },
      postAutopick: async () => {
        client.autopickCalls += 1;
        const next = client.autopickQueue.shift();
        if (!next) throw new Error('test bug: no queued autopick response');
        if (!next.ok) {
          const error = new Error('the pick clock has not expired yet');
          (error as { code?: string }).code = 'clock-live';
          throw error;
        }
        return next.body;
      },
    } as unknown as DraftFeedDeps['client'],
    leagueId: 'lg-1',
    now,
    pollMs: 1_000,
    graceMs: 250,
    openStream: (_leagueId, handlers) => {
      streams += 1;
      lastStreamHandlers = handlers;
      return { close: vi.fn() };
    },
    onEvent: (event) => events.push(event),
  };
  return {
    deps,
    events,
    streamCount: () => streams,
    lastHandlers: () => {
      if (!lastStreamHandlers) throw new Error('test bug: stream never opened');
      return lastStreamHandlers;
    },
  };
}

describe('clockSkew', () => {
  it('measures how far the server clock runs ahead of the local one', () => {
    expect(clockSkew(1_000_000, 999_500)).toBe(500);
    expect(clockSkew(1_000_000, 1_000_000)).toBe(0);
    expect(clockSkew(999_000, 1_000_000)).toBe(-1_000);
  });
});

describe('shouldApplyView', () => {
  it('accepts the first view and any status transition', () => {
    expect(shouldApplyView(null, view())).toBe(true);
    expect(shouldApplyView(view({ status: 'pending' }), view({ status: 'live' }))).toBe(true);
  });

  it('rejects a stale view that would roll picks back', () => {
    const ahead = view({ picks: [pick(1, 'pl-1')] });
    expect(shouldApplyView(ahead, view())).toBe(false);
    expect(shouldApplyView(ahead, ahead)).toBe(true);
  });
});

describe('newPicksSince', () => {
  it('returns only the picks the previous view did not have', () => {
    const previous = view({ picks: [pick(1, 'pl-1')] });
    const next = view({ picks: [pick(1, 'pl-1'), pick(2, 'pl-2', 'mgr-marge')] });
    expect(newPicksSince(previous, next).map((entry) => entry.overall)).toStrictEqual([2]);
    expect(newPicksSince(null, next)).toHaveLength(2);
  });
});

describe('pickToast', () => {
  it('names the seat and the player for other managers', () => {
    const toast = pickToast({
      pick: pick(2, 'pl-2', 'mgr-marge'),
      view: view(),
      myManagerId: 'mgr-ava',
      playerName: 'Silas Brummell',
    });
    expect(toast).toMatchObject({ kind: 'pick', title: 'Marge Kowalski drafted Silas Brummell' });
  });

  it('stays quiet about my own picks and falls back to ids', () => {
    expect(
      pickToast({
        pick: pick(1, 'pl-1'),
        view: view(),
        myManagerId: 'mgr-ava',
        playerName: 'Dov Amado',
      }),
    ).toBeNull();
    const unnamed = pickToast({
      pick: pick(2, 'pl-9', 'mgr-marge'),
      view: view(),
      myManagerId: 'mgr-ava',
    });
    expect(unnamed?.title).toContain('pl-9');
  });
});

describe('createDraftFeed', () => {
  it('starts by reading the board, then opens the stream', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      const { deps } = makeDeps(client, () => BASE);
      client.draftQueue.push(view());
      const feed = createDraftFeed(deps);
      await feed.start();
      expect(feed.view()).not.toBeNull();
      expect(feed.status()).toBe('streaming');
      feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies stream events and records the clock skew', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      let localNow = BASE;
      const { deps, lastHandlers } = makeDeps(client, () => localNow);
      client.draftQueue.push(view());
      const feed = createDraftFeed(deps);
      await feed.start();

      lastHandlers().onClock(BASE + 750);
      expect(feed.skewMs()).toBe(750);

      localNow = BASE + 5_000;
      lastHandlers().onDraft(view({ picks: [pick(1, 'pl-1')] }));
      expect(feed.view()?.picks).toHaveLength(1);
      feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to polling when the stream dies, and applies polled views', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      const { deps, events, lastHandlers } = makeDeps(client, () => BASE);
      client.draftQueue.push(view());
      const feed = createDraftFeed(deps);
      await feed.start();

      lastHandlers().onDown('error');
      expect(feed.status()).toBe('polling');
      expect(events.some((event) => event.type === 'stream-down')).toBe(true);

      client.draftQueue.push(view({ picks: [pick(1, 'pl-1'), pick(2, 'pl-2', 'mgr-marge')] }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(feed.view()?.picks).toHaveLength(2);

      // A stale poll response never rolls the board back.
      client.draftQueue.push(view());
      await vi.advanceTimersByTimeAsync(1_000);
      expect(feed.view()?.picks).toHaveLength(2);
      feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drives the autopick past the deadline plus grace, once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    try {
      const client = fakeClient();
      const { deps, events } = makeDeps(client, () => Date.now());
      client.draftQueue.push(
        view({ clock: { overall: 1, managerId: 'mgr-ava', deadline: BASE + 1_000 } }),
      );
      const feed = createDraftFeed(deps);
      await feed.start();

      client.autopickQueue.push({
        ok: true,
        body: { autopicked: pick(1, 'pl-1'), draft: view({ picks: [pick(1, 'pl-1')] }) },
      });
      await vi.advanceTimersByTimeAsync(1_500);
      expect(client.autopickCalls).toBe(1);
      expect(events.some((event) => event.type === 'autopick-resolved')).toBe(true);
      expect(feed.view()?.picks).toHaveLength(1);
      feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a clock-live rejection and refreshes instead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    try {
      const client = fakeClient();
      const { deps } = makeDeps(client, () => Date.now());
      client.draftQueue.push(
        view({ clock: { overall: 1, managerId: 'mgr-ava', deadline: BASE + 1_000 } }),
      );
      const feed = createDraftFeed(deps);
      await feed.start();

      client.autopickQueue.push({ ok: false });
      client.draftQueue.push(view({ picks: [pick(1, 'pl-1')] }));
      await vi.advanceTimersByTimeAsync(1_500);
      expect(client.autopickCalls).toBe(1);
      expect(feed.view()?.picks).toHaveLength(1);
      feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fires the driver without a deadline or outside a live draft', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      const { deps } = makeDeps(client, () => BASE);
      client.draftQueue.push(view({ clock: { overall: null, managerId: null, deadline: null } }));
      const feed = createDraftFeed(deps);
      await feed.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(client.autopickCalls).toBe(0);
      feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resync reopens the stream and re-reads the board', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      const { deps, streamCount, lastHandlers } = makeDeps(client, () => BASE);
      client.draftQueue.push(view());
      const feed = createDraftFeed(deps);
      await feed.start();
      lastHandlers().onDown('error');
      expect(feed.status()).toBe('polling');

      client.draftQueue.push(view({ picks: [pick(1, 'pl-1')] }));
      await feed.resync();
      expect(streamCount()).toBe(2);
      expect(feed.view()?.picks).toHaveLength(1);
      feed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('close stops polls and the driver for good', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      const { deps } = makeDeps(client, () => BASE);
      client.draftQueue.push(view());
      const feed = createDraftFeed(deps);
      await feed.start();
      feed.close();
      expect(feed.status()).toBe('closed');
      const reads = client.getDraftCalls;
      const picks = client.autopickCalls;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.getDraftCalls).toBe(reads);
      expect(client.autopickCalls).toBe(picks);
    } finally {
      vi.useRealTimers();
    }
  });
});
