import type {
  DraftPickView,
  DraftStreamHandlers,
  DraftView,
  StakehouseClient,
} from '@stakehouse/api-client';
import { clockSkew, isAutopickDue } from './draftClock';

/**
 * The draft feed: the server-owned stream of draft truth, with a polling
 * fallback and a clock-expiry driver. Framework-free — React subscribes via
 * the thin hook. The deadline from the server is the ONLY clock anchor; this
 * module never accumulates elapsed time locally, which is what RN timers
 * drift on.
 */

export type FeedStatus = 'connecting' | 'streaming' | 'polling' | 'closed';

export type FeedToast =
  { kind: 'autopick'; title: string; body: string } | { kind: 'pick'; title: string; body: string };

export type FeedEvent =
  | { type: 'view-applied'; view: DraftView; newPicks: DraftPickView[] }
  | { type: 'autopick-resolved'; pick: DraftPickView; view: DraftView }
  | { type: 'stream-down'; reason: 'error' | 'ended' }
  | { type: 'stream-up' };

export interface StreamHandle {
  close(): void;
}

export interface DraftFeedDeps {
  client: Pick<StakehouseClient, 'getDraft' | 'postAutopick'>;
  leagueId: string;
  /** Injectable wall clock for tests and for skew-corrected reads. */
  now(): number;
  pollMs?: number;
  /** How long past expiry the driver waits before asking the server. */
  graceMs?: number;
  openStream(leagueId: string, handlers: DraftStreamHandlers): StreamHandle;
  onEvent(event: FeedEvent): void;
}

export interface DraftFeed {
  status(): FeedStatus;
  view(): DraftView | null;
  /** How far the server clock runs ahead of the local one (ms). */
  skewMs(): number;
  subscribe(listener: () => void): () => void;
  /** Read the board, then open the stream. */
  start(): Promise<void>;
  /** Foreground/reload: re-read the board and reopen the stream. */
  resync(): Promise<void>;
  /** The screen pushes server-confirmed views (pick/queue responses) here. */
  applyView(next: DraftView): void;
  close(): void;
}

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_GRACE_MS = 250;
const DRIVER_TICK_MS = 250;

export function createDraftFeed(deps: DraftFeedDeps): DraftFeed {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;

  let status: FeedStatus = 'connecting';
  let current: DraftView | null = null;
  let skew = 0;
  let stream: StreamHandle | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let driverTimer: ReturnType<typeof setInterval> | null = null;
  let resolving = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function apply(next: DraftView): void {
    if (!shouldApplyView(current, next)) return;
    const fresh = newPicksSince(current, next);
    current = next;
    deps.onEvent({ type: 'view-applied', view: next, newPicks: fresh });
    emit();
  }

  function setStatus(next: FeedStatus): void {
    status = next;
    emit();
  }

  function openTheStream(): void {
    if (status === 'closed') return;
    stream = deps.openStream(deps.leagueId, {
      onDraft: (view) => apply(view),
      onClock: (at) => {
        skew = clockSkew(at, deps.now());
      },
      onDown: (reason) => {
        stream = null;
        if (status === 'closed') return;
        deps.onEvent({ type: 'stream-down', reason });
        // The fallback: keep the room honest at poll cadence until the
        // stream returns (on the next resync).
        if (pollTimer === null) {
          pollTimer = setInterval(() => {
            void refresh();
          }, pollMs);
        }
        setStatus('polling');
      },
    });
    deps.onEvent({ type: 'stream-up' });
    setStatus('streaming');
  }

  async function refresh(): Promise<void> {
    if (status === 'closed') return;
    try {
      const response = await deps.client.getDraft(deps.leagueId);
      apply(response);
    } catch {
      // A failed poll keeps the last view on screen; the next tick retries.
    }
  }

  async function resolveExpiredClock(): Promise<void> {
    const view = current;
    if (!view || view.status !== 'live' || resolving) return;
    if (view.clock.managerId === null) return;
    if (!isAutopickDue(view.clock.deadline, deps.now() + skew, graceMs)) return;
    resolving = true;
    try {
      const response = await deps.client.postAutopick(deps.leagueId);
      apply(response.draft);
      deps.onEvent({ type: 'autopick-resolved', pick: response.autopicked, view: response.draft });
    } catch (caught) {
      // Another resolver won (server said clock-live) or the request died —
      // refresh to server truth instead of surfacing an error toast.
      if (caught instanceof Error && 'code' in caught) {
        await refresh();
      }
    } finally {
      resolving = false;
    }
  }

  return {
    status: () => status,
    view: () => current,
    skewMs: () => skew,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      await refresh();
      openTheStream();
      driverTimer = setInterval(() => {
        void resolveExpiredClock();
      }, DRIVER_TICK_MS);
    },
    async resync() {
      if (status === 'closed') return;
      if (stream === null) openTheStream();
      await refresh();
    },
    applyView: (next) => apply(next),
    close() {
      status = 'closed';
      if (stream) {
        stream.close();
        stream = null;
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (driverTimer !== null) {
        clearInterval(driverTimer);
        driverTimer = null;
      }
      emit();
    },
  };
}

/**
 * Apply-guard: never let a stale snapshot roll the board back. A view is
 * acceptable when it is the first, a status transition, or at least as
 * far along in picks.
 */
export function shouldApplyView(previous: DraftView | null, next: DraftView): boolean {
  if (previous === null) return true;
  if (previous.status !== next.status) return true;
  return next.picks.length >= previous.picks.length;
}

/** The picks `next` gained over `previous`. */
export function newPicksSince(previous: DraftView | null, next: DraftView): DraftPickView[] {
  const count = previous?.picks.length ?? 0;
  return next.picks.slice(count);
}

/**
 * Toast for a pick landing from another seat — mine are already on screen.
 * Unknown names fall back to ids rather than blank copy.
 */
export function pickToast({
  pick,
  view,
  myManagerId,
  playerName,
}: {
  pick: DraftPickView;
  view: DraftView;
  myManagerId: string | null;
  playerName?: string;
}): FeedToast | null {
  if (pick.managerId === myManagerId) return null;
  const seat = view.seats.find((candidate) => candidate.id === pick.managerId);
  const who = seat?.displayName ?? pick.managerId;
  const what = playerName ?? pick.playerId;
  return {
    kind: 'pick',
    title: `${who} drafted ${what}`,
    body: `Pick #${pick.overall} of the snake.`,
  };
}

/** The clock-expired toast (spec §Draft room states: Clock expired). */
export function autopickToast({ pick, view }: { pick: DraftPickView; view: DraftView }): FeedToast {
  const seat = view.seats.find((candidate) => candidate.id === pick.managerId);
  const who = seat?.displayName ?? pick.managerId;
  return {
    kind: 'autopick',
    title: 'Clock expired — autopick resolved',
    body: `The queue's top player went to ${who}.`,
  };
}
