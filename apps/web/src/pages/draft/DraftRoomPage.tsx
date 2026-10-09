import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@stakehouse/api-client';
import type { DraftView } from '@stakehouse/api-client';
import { Badge, Button, Clock, Panel } from '../../components/ui';
import { useApi } from '../../state/ApiContext';
import { useLeagues } from '../../state/LeaguesContext';
import { ShellLink } from '../../shell/AppShell';
import { DraftBoard } from './DraftBoard';
import { FastForward } from './FastForward';
import { QueuePanel } from './QueuePanel';
import { RecapBoard } from './RecapBoard';
import { SeatRosters } from './SeatRosters';
import { pickInRound, roundOf, secondsRemaining, shouldAutopick } from './draftClock';
import { subscribeDraft } from './draftStream';
import { navigateTo } from '../../router/route';
import './draft.css';

type RoomState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; draft: DraftView; you: string | null };

interface Toast {
  id: number;
  message: string;
}

/** Local re-render/evaluation cadence; the server still owns time. */
const TICK_MS = 250;

/**
 * The draft room. The server is the only authority: this page renders what
 * GET /draft and the SSE stream last said, and posts intents (pick, queue,
 * autopick). It never computes league state — even the countdown derives
 * from server timestamps, offset-corrected by the clock heartbeats. Reload
 * resyncs: the GET is the whole truth again.
 */
export function DraftRoomPage({ leagueId }: { leagueId: string }) {
  const api = useApi();
  const { leagues } = useLeagues();
  const [state, setState] = useState<RoomState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [, setTick] = useState(0);
  const [autopickOn, setAutopickOn] = useState(true);

  // Latest-value refs for the expiry engine (it runs on an interval and must
  // always see the current room without resubscribing), the derived server
  // clock offset, and the pick the expiry autopick last fired for.
  const stateRef = useRef<RoomState>(state);
  const autopickRef = useRef(autopickOn);
  const offsetRef = useRef(0);
  const lastOverallRef = useRef<number | null>(null);
  const firedForOverallRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
    autopickRef.current = autopickOn;
  });

  useEffect(() => {
    let alive = true;
    api
      .getDraft(leagueId)
      .then((result) => {
        if (alive) setState({ kind: 'ready', draft: result.draft, you: result.you });
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'the draft room would not open',
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [api, leagueId, reloadKey]);

  // The live stream: snapshot on connect, refreshed view on every mutation,
  // clock heartbeats for the offset. Subscribed once per league.
  useEffect(() => {
    const close = subscribeDraft(leagueId, {
      onDraft: (draft) => {
        // A new pick on the clock re-arms the expiry guard for that pick.
        if (draft.clock.overall !== lastOverallRef.current) {
          lastOverallRef.current = draft.clock.overall;
          firedForOverallRef.current = null;
        }
        setState((current) => (current.kind === 'ready' ? { ...current, draft } : current));
      },
      onClock: (serverNow) => {
        offsetRef.current = serverNow - Date.now();
      },
    });
    return close;
  }, [leagueId]);

  // Autopick preference follows the seat; default ON (AI-style coverage).
  // The ref syncs HERE, not just in the render-sync effect: the ticker
  // effect's first evaluation runs in this same commit, and it must see the
  // persisted preference, not the stale default.
  useEffect(() => {
    if (state.kind !== 'ready' || !state.you) return;
    const stored = window.localStorage.getItem(`sh-autopick:${state.you}`) !== 'off';
    autopickRef.current = stored;
    setAutopickOn(stored);
    // Deliberate deps: re-runs only when readiness or the seat changes.
  }, [state.kind, state.kind === 'ready' ? state.you : null]);

  const applyView = useCallback((draft: DraftView) => {
    setState((current) => (current.kind === 'ready' ? { ...current, draft } : current));
  }, []);

  const draftStatus = state.kind === 'ready' ? state.draft.status : 'none';

  const fireAutopick = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.kind !== 'ready' || current.draft.clock.overall === null) return;
    const overall = current.draft.clock.overall;
    firedForOverallRef.current = overall;
    try {
      const result = await api.draftAutopick(leagueId);
      applyView(result.draft);
      const seatName =
        result.draft.managers[result.autopicked.managerId]?.displayName ??
        result.autopicked.managerId;
      const pickedName =
        result.draft.players[result.autopicked.playerId]?.name ?? result.autopicked.playerId;
      const queued =
        current.you !== null &&
        (result.draft.queues[current.you]?.queue ?? []).includes(result.autopicked.playerId);
      setToast({
        id: Date.now(),
        message: `Clock expired — ${seatName} autopicked ${pickedName} ${
          queued ? 'off the queue' : '(best available)'
        }.`,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'clock-live') {
        // The server's clock disagrees — it is the authority. Unmark and let
        // the next evaluation decide again.
        firedForOverallRef.current = null;
      } else if (error instanceof ApiError) {
        setToast({ id: Date.now(), message: error.message });
      } else {
        throw error;
      }
    }
  }, [api, applyView, leagueId]);

  // The live tick: moves the countdown and evaluates the expiry autopick
  // decision every 250ms against the latest room state.
  useEffect(() => {
    if (draftStatus !== 'live') return;
    const evaluate = (): void => {
      const current = stateRef.current;
      if (current.kind !== 'ready') return;
      const { draft, you } = current;
      if (draft.clock.deadline === null) return;
      const secondsLeft = secondsRemaining(draft.clock.deadline, Date.now(), offsetRef.current);
      if (
        !shouldAutopick({
          status: draft.status,
          deadline: draft.clock.deadline,
          secondsLeft,
          onClockOverall: draft.clock.overall,
          alreadyFiredFor: firedForOverallRef.current,
          mySeatId: you,
          onClockManagerId: draft.clock.managerId,
          autopickOn: autopickRef.current,
        })
      ) {
        return;
      }
      void fireAutopick();
    };
    evaluate();
    const id = window.setInterval(() => {
      setTick((value) => value + 1);
      evaluate();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [draftStatus, fireAutopick]);

  // Toasts retire themselves; the expiry story never lingers on screen.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function pick(playerId: string): Promise<void> {
    if (state.kind !== 'ready') return;
    try {
      const result = await api.draftPick(leagueId, playerId);
      applyView(result.draft);
    } catch (error) {
      if (error instanceof ApiError) {
        // The rejection reason is the product: out-of-turn, taken, expired.
        setNote(error.message);
      } else {
        throw error;
      }
    }
  }

  const saveQueue = useCallback(
    async (queue: string[]): Promise<void> => {
      await api.setDraftQueue(leagueId, queue);
    },
    [api, leagueId],
  );

  /** Board "Queue" button: append to my queue (a no-op for duplicates). */
  const queuePlayer = useCallback(
    (playerId: string): void => {
      if (state.kind !== 'ready' || !state.you) return;
      const current = state.draft.queues[state.you]?.queue ?? [];
      if (current.includes(playerId)) return;
      void saveQueue([...current, playerId]);
    },
    [saveQueue, state],
  );

  function changeAutopick(next: boolean): void {
    setAutopickOn(next);
    if (state.kind === 'ready' && state.you) {
      window.localStorage.setItem(`sh-autopick:${state.you}`, next ? 'on' : 'off');
    }
  }

  async function start(): Promise<void> {
    try {
      const result = await api.startDraft(leagueId);
      applyView(result.draft);
    } catch (error) {
      if (error instanceof ApiError) setNote(error.message);
      else throw error;
    }
  }

  /** Commissioner fast-forward: the engine resolves every remaining pick.
   * ApiError propagates — the confirm modal shows the server's reason. */
  async function fastForward(): Promise<void> {
    const result = await api.draftFastForward(leagueId);
    applyView(result.draft);
    setToast({
      id: Date.now(),
      message: `${result.fastForwarded} picks resolved — the draft is complete.`,
    });
  }

  /** The handoff: week 1 belongs to the season engine now. */
  async function startWeek1(): Promise<void> {
    await api.simulateNextWeek(leagueId);
    navigateTo({ name: 'league', leagueId, tab: 'overview' });
  }

  const league =
    leagues.state === 'ready' ? leagues.value.find((l) => l.id === leagueId) : undefined;

  if (state.kind === 'loading') {
    return (
      <div className="sh-page">
        <p className="sh-muted" aria-live="polite">
          Opening the draft room…
        </p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="sh-page">
        <Panel>
          <p className="sh-form__error">{state.message}</p>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </Button>
        </Panel>
      </div>
    );
  }

  const { draft, you } = state;
  const seats = draft.order.length;
  const onClockOverall = draft.clock.overall;
  const isCommissioner = you !== null && draft.commissionerSeatId === you;
  const myTurn = draft.status === 'live' && you !== null && draft.clock.managerId === you;
  const onClockName =
    draft.clock.managerId !== null
      ? (draft.managers[draft.clock.managerId]?.displayName ?? null)
      : null;

  return (
    <div className="sh-page sh-draft">
      <div className="sh-draft__head">
        <h1 className="sh-page__title">{league ? league.name : 'Draft room'}</h1>
        {draft.status === 'live' && onClockOverall !== null ? (
          <p className="sh-draft__where" aria-live="polite">
            Round {roundOf(onClockOverall, seats)} · Pick {pickInRound(onClockOverall, seats)} of{' '}
            {seats} — <strong>{onClockName ?? 'unknown seat'}</strong> is on the clock
            {myTurn ? <Badge tone="active">YOUR PICK</Badge> : null}
            {draft.clock.deadline !== null ? (
              <Clock
                secondsRemaining={secondsRemaining(
                  draft.clock.deadline,
                  Date.now(),
                  offsetRef.current,
                )}
                className="sh-draft__clock"
              />
            ) : null}
          </p>
        ) : null}
        {draft.status === 'live' && isCommissioner ? (
          <div className="sh-draft__commissioner">
            <FastForward onConfirm={() => fastForward()} />
          </div>
        ) : null}
      </div>

      {note ? (
        <p className="sh-draft__note" role="status" aria-live="polite">
          {note}
        </p>
      ) : null}

      {toast ? (
        <p className="sh-draft__toast" role="status" aria-live="polite">
          {toast.message}
        </p>
      ) : null}

      {draft.status === 'pending' ? (
        <Panel title="The draft has not started">
          <p className="sh-muted">
            Draft order {draft.order.map((id) => draft.managers[id]?.displayName ?? id).join(' → ')}
          </p>
          <p className="sh-muted">
            Every seat keeps an autopick queue — when a clock runs out, the queue speaks.
          </p>
          {you ? (
            <Button onClick={() => void start()}>Start the draft</Button>
          ) : (
            <p className="sh-muted">Waiting for the commissioner to start the draft.</p>
          )}
        </Panel>
      ) : null}

      {draft.status === 'live' ? (
        <div className="sh-draft__grid">
          <div className="sh-draft__board">
            <DraftBoard
              draft={draft}
              myTurn={myTurn}
              onPick={(id) => void pick(id)}
              onQueue={queuePlayer}
            />
          </div>
          <div className="sh-draft__side">
            <QueuePanel
              draft={draft}
              mySeatId={you}
              autopickOn={autopickOn}
              onAutopickChange={changeAutopick}
              onSave={saveQueue}
            />
            <SeatRosters draft={draft} />
          </div>
        </div>
      ) : null}

      {draft.status === 'complete' ? (
        <RecapBoard draft={draft} isCommissioner={isCommissioner} onStartWeek={startWeek1} />
      ) : null}

      <p className="sh-draft__back">
        <ShellLink href={`/leagues/${leagueId}`}>Back to the league</ShellLink>
      </p>
    </div>
  );
}
