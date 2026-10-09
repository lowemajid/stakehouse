import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@stakehouse/api-client';
import type { DraftView } from '@stakehouse/api-client';
import { Badge, Button, Panel } from '../../components/ui';
import { useApi } from '../../state/ApiContext';
import { useLeagues } from '../../state/LeaguesContext';
import { ShellLink } from '../../shell/AppShell';
import { DraftBoard } from './DraftBoard';
import { QueuePanel } from './QueuePanel';
import { SeatRosters } from './SeatRosters';
import { pickInRound, roundOf } from './draftClock';
import './draft.css';

type RoomState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; draft: DraftView; you: string | null };

/**
 * The draft room. The server is the only authority: this page renders what
 * GET /draft and the SSE stream last said, and posts intents (pick, queue,
 * start). It never computes league state — even the countdown derives from
 * server timestamps. Reload resyncs: the GET is the whole truth again.
 */
export function DraftRoomPage({ leagueId }: { leagueId: string }) {
  const api = useApi();
  const { leagues } = useLeagues();
  const [state, setState] = useState<RoomState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);

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

  const applyView = useCallback((draft: DraftView) => {
    setState((current) => (current.kind === 'ready' ? { ...current, draft } : current));
  }, []);

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

  async function start(): Promise<void> {
    try {
      const result = await api.startDraft(leagueId);
      applyView(result.draft);
    } catch (error) {
      if (error instanceof ApiError) setNote(error.message);
      else throw error;
    }
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
          </p>
        ) : null}
      </div>

      {note ? (
        <p className="sh-draft__note" role="status" aria-live="polite">
          {note}
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
            <QueuePanel draft={draft} mySeatId={you} onSave={saveQueue} />
            <SeatRosters draft={draft} />
          </div>
        </div>
      ) : null}

      {draft.status === 'complete' ? (
        <Panel title="Draft complete">
          <p className="sh-muted">
            {draft.picks.length} picks on the books. The recap and week 1 live here next.
          </p>
        </Panel>
      ) : null}

      <p className="sh-draft__back">
        <ShellLink href={`/leagues/${leagueId}`}>Back to the league</ShellLink>
      </p>
    </div>
  );
}
