import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '@stakehouse/theme';
import type { DraftView, PlayerCardView } from '@stakehouse/api-client';
import { apiErrorMessage } from '../lib/apiErrors';
import { deriveManagerId } from '../lib/ledgerLogic';
import { BOARD_PAGE, filterBoard, type PositionFilter } from '../lib/draft/boardFilter';
import { pickRejectionMessage } from '../lib/draft/pickMessages';
import { addToQueue, moveInQueue, removeFromQueue } from '../lib/draft/queueLogic';
import { useApi } from '../state/apiContext';
import { Button, ErrorBox, Input, Loading, Screen, styles } from '../ui/primitives';

type LoadState =
  { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; view: DraftView };

const POSITION_CHIPS: PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const STATUS_LABEL: Record<DraftView['status'], string> = {
  pending: 'Lobby',
  live: 'Live',
  complete: 'Complete',
};

/**
 * The draft room (spec §Draft room states). The server owns the draft: this
 * screen renders its draftView, posts intents (pick, queue, autopick,
 * fast-forward), and never computes league state locally. The live stream and
 * ticking clock arrive with the feed slice; until then every action refreshes
 * from the server's response.
 */
export function DraftRoomScreen({
  leagueId,
  onBack,
}: {
  leagueId: string;
  onBack(): void;
}): ReactElement {
  const { client, user } = useApi();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [players, setPlayers] = useState<PlayerCardView[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [queueDirty, setQueueDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<PositionFilter>('ALL');
  const [page, setPage] = useState(1);
  const [confirmingFastForward, setConfirmingFastForward] = useState(false);

  const myManagerId = useMemo(() => (user ? deriveManagerId(user.email) : null), [user]);

  const load = useCallback(async (): Promise<void> => {
    setState({ phase: 'loading' });
    try {
      const [draftView, universe] = await Promise.all([
        client.getDraft(leagueId),
        client.listPlayers(),
      ]);
      setPlayers(universe);
      setState({ phase: 'ready', view: draftView });
    } catch (caught) {
      setState({ phase: 'error', message: apiErrorMessage(caught) });
    }
  }, [client, leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = state.phase === 'ready' ? state.view : null;

  // Server queue is truth; local edits ride ahead of the PUT and yield to the
  // next server view until touched again.
  const serverQueue = useMemo(
    () => (view && myManagerId ? (view.queues[myManagerId]?.queue ?? []) : []),
    [view, myManagerId],
  );
  useEffect(() => {
    if (!queueDirty) setQueue(serverQueue);
  }, [queueDirty, serverQueue]);

  const nameById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);

  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setActionError(pickRejectionMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function pickPlayer(playerId: string): void {
    void run(async () => {
      const result = await client.postPick(leagueId, playerId);
      setState({ phase: 'ready', view: result.draft });
    });
  }

  function startDraft(): void {
    void run(async () => {
      const next = await client.startDraft(leagueId);
      setState({ phase: 'ready', view: next });
    });
  }

  function resolveAutopick(): void {
    void run(async () => {
      const result = await client.postAutopick(leagueId);
      setState({ phase: 'ready', view: result.draft });
    });
  }

  function fastForward(): void {
    setConfirmingFastForward(false);
    void run(async () => {
      const result = await client.postFastForward(leagueId);
      setState({ phase: 'ready', view: result.draft });
    });
  }

  function updateQueue(next: string[]): void {
    setQueue(next);
    setQueueDirty(true);
    void run(async () => {
      await client.putQueue(leagueId, next);
      setQueueDirty(false);
    });
  }

  return (
    <Screen>
      <View style={local.header}>
        <Button label="← League" onPress={onBack} variant="quiet" />
        <Text style={local.headerTitle}>Draft room</Text>
        <Text style={[styles.lede, local.headerStatus]}>
          {view ? STATUS_LABEL[view.status] : '…'}
        </Text>
      </View>

      {state.phase === 'loading' ? <Loading label="Setting the board…" /> : null}
      {state.phase === 'error' ? (
        <ErrorBox message={state.message} onRetry={() => void load()} />
      ) : null}

      {view ? (
        <ScrollView contentContainerStyle={local.body}>
          {actionError ? <ErrorBox message={actionError} /> : null}

          {view.status === 'pending' ? (
            <LobbyCard view={view} myManagerId={myManagerId} busy={busy} onStart={startDraft} />
          ) : null}

          {view.status === 'live' ? (
            <>
              <ClockCard view={view} myManagerId={myManagerId} />
              <SeatListCard view={view} myManagerId={myManagerId} />
              {myManagerId ? (
                <QueueCard
                  queue={queue}
                  boardNames={nameById}
                  busy={busy}
                  onAdd={(playerId) => updateQueue(addToQueue(queue, playerId).queue)}
                  onRemove={(playerId) => updateQueue(removeFromQueue(queue, playerId))}
                  onMove={(playerId, direction) =>
                    updateQueue(moveInQueue(queue, playerId, direction))
                  }
                />
              ) : null}
              <BoardCard
                view={view}
                myManagerId={myManagerId}
                query={query}
                position={position}
                page={page}
                busy={busy}
                onQuery={(next) => {
                  setQuery(next);
                  setPage(1);
                }}
                onPosition={(next) => {
                  setPosition(next);
                  setPage(1);
                }}
                onPick={pickPlayer}
                onMore={() => setPage((current) => current + 1)}
              />
              <RecentPicksCard view={view} nameById={nameById} />
              <View style={{ gap: 8 }}>
                <Button
                  label="Fast-forward the rest of the draft"
                  onPress={() => setConfirmingFastForward(true)}
                  variant="quiet"
                />
                <Text style={styles.emptyText}>
                  Autopick resolves an expired clock from the queue — best available if it is empty.
                  Use fast-forward only to finish the draft in one step.
                </Text>
                <Button
                  label="Resolve autopick now"
                  onPress={resolveAutopick}
                  variant="quiet"
                  busy={busy}
                />
              </View>
            </>
          ) : null}

          {view.status === 'complete' ? <RecapCard view={view} nameById={nameById} /> : null}
        </ScrollView>
      ) : null}

      <Modal
        visible={confirmingFastForward}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmingFastForward(false)}
      >
        <View style={local.backdrop}>
          <View style={local.modalCard}>
            <Text style={styles.cardTitle}>Fast-forward the draft?</Text>
            <Text style={styles.lede}>
              Every remaining pick resolves instantly — queues first, then best available. This
              cannot be undone.
            </Text>
            <View style={local.modalButtons}>
              <Button
                label="Cancel"
                onPress={() => setConfirmingFastForward(false)}
                variant="quiet"
              />
              <Button label="Fast-forward" onPress={fastForward} busy={busy} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** Lobby: draft order and the start handoff (spec: Pending state). */
function LobbyCard({
  view,
  myManagerId,
  busy,
  onStart,
}: {
  view: DraftView;
  myManagerId: string | null;
  busy: boolean;
  onStart(): void;
}): ReactElement {
  const seatById = new Map(view.seats.map((seat) => [seat.id, seat]));
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Draft lobby</Text>
      <Text style={styles.lede}>
        The order runs snake — round two flips. Buy-ins must clear before the first pick.
      </Text>
      {view.order.map((seatId, index) => {
        const seat = seatById.get(seatId);
        return (
          <View key={seatId} style={styles.rowBetween}>
            <Text style={styles.lede}>
              {index + 1}. {seat?.displayName ?? seatId}
              {seat?.isAi ? ' · AI' : ''}
              {seatId === myManagerId ? ' (you)' : ''}
            </Text>
          </View>
        );
      })}
      <Button label="Start the draft" onPress={onStart} busy={busy} />
    </View>
  );
}

/** Who is on the clock. The live countdown rides the feed slice. */
function ClockCard({
  view,
  myManagerId,
}: {
  view: DraftView;
  myManagerId: string | null;
}): ReactElement {
  const onClock = view.clock.managerId;
  const seat = view.seats.find((candidate) => candidate.id === onClock);
  const mine = onClock !== null && onClock === myManagerId;
  return (
    <View style={[styles.card, mine && local.clockMine]}>
      <Text style={styles.cardTitle}>
        {mine ? 'YOUR PICK' : 'ON THE CLOCK'} — pick {view.clock.overall ?? '—'}
      </Text>
      <Text style={styles.lede}>
        {seat ? seat.displayName : 'Waiting for the server…'}
        {seat?.isAi && !mine ? ' — thinking…' : mine ? ' — the board is yours.' : ''}
      </Text>
    </View>
  );
}

/** Seat strip with picks-drafted counts and the AI thinking marker. */
function SeatListCard({
  view,
  myManagerId,
}: {
  view: DraftView;
  myManagerId: string | null;
}): ReactElement {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Seats</Text>
      {view.order.map((seatId) => {
        const seat = view.seats.find((candidate) => candidate.id === seatId);
        const onClock = view.clock.managerId === seatId;
        return (
          <View key={seatId} style={styles.rowBetween}>
            <Text style={[styles.lede, onClock && local.onClockText]}>
              {seat?.displayName ?? seatId}
              {seat?.isAi ? ' · AI' : ''}
              {seatId === myManagerId ? ' (you)' : ''}
              {onClock ? ' · on the clock' : ''}
            </Text>
            <Text style={styles.lede}>{(view.rosters[seatId] ?? []).length} picked</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Personal queue — the autopick reads it top-down at expiry. */
function QueueCard({
  queue,
  boardNames,
  busy,
  onAdd,
  onRemove,
  onMove,
}: {
  queue: string[];
  boardNames: Map<string, PlayerCardView>;
  busy: boolean;
  onAdd(playerId: string): void;
  onRemove(playerId: string): void;
  onMove(playerId: string, direction: 'up' | 'down'): void;
}): ReactElement {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Your queue — autopick ON</Text>
      {queue.length === 0 ? (
        <Text style={styles.emptyText}>
          Empty. At expiry the server drafts best available — queue the players you actually want.
        </Text>
      ) : (
        queue.map((playerId, index) => {
          const player = boardNames.get(playerId);
          return (
            <View key={playerId} style={styles.rowBetween}>
              <Text style={styles.lede}>
                {index + 1}. {player?.name ?? playerId} · {player?.position ?? ''}
              </Text>
              <View style={local.queueButtons}>
                <Button
                  label="↑"
                  onPress={() => onMove(playerId, 'up')}
                  variant="quiet"
                  disabled={busy}
                />
                <Button
                  label="↓"
                  onPress={() => onMove(playerId, 'down')}
                  variant="quiet"
                  disabled={busy}
                />
                <Button
                  label="✕"
                  onPress={() => onRemove(playerId)}
                  variant="quiet"
                  disabled={busy}
                />
              </View>
            </View>
          );
        })
      )}
      <AddToQueueRow busy={busy} onDraft={onAdd} />
    </View>
  );
}

/** A name field over the universe for queue additions. */
function AddToQueueRow({
  busy,
  onDraft,
}: {
  busy: boolean;
  onDraft(playerId: string): void;
}): ReactElement {
  const { client } = useApi();
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  return (
    <View style={{ gap: 6 }}>
      <Input
        placeholder="Search the universe to queue…"
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
      />
      {hint ? <Text style={styles.fieldError}>{hint}</Text> : null}
      <Button
        label="Queue top match"
        variant="quiet"
        busy={busy}
        onPress={() => {
          void (async () => {
            setHint(null);
            const found = await client.listPlayers({ q: text });
            const match = found[0];
            if (!match) {
              setHint('No player by that name.');
              return;
            }
            onDraft(match.id);
            setText('');
          })();
        }}
      />
    </View>
  );
}

/** The live board: search, position chips, paged rows, and the DRAFT action. */
function BoardCard({
  view,
  myManagerId,
  query,
  position,
  page,
  busy,
  onQuery,
  onPosition,
  onPick,
  onMore,
}: {
  view: DraftView;
  myManagerId: string | null;
  query: string;
  position: PositionFilter;
  page: number;
  busy: boolean;
  onQuery(next: string): void;
  onPosition(next: PositionFilter): void;
  onPick(playerId: string): void;
  onMore(): void;
}): ReactElement {
  const filtered = useMemo(
    () => filterBoard(view.board, query, position),
    [view.board, query, position],
  );
  const visible = filtered.slice(0, page * BOARD_PAGE);
  const picked = new Set(view.picks.map((pick) => pick.playerId));
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Board — {filtered.length} available</Text>
      <Input
        placeholder="Search players…"
        value={query}
        onChangeText={onQuery}
        autoCapitalize="none"
      />
      <View style={local.chipRow}>
        {POSITION_CHIPS.map((chip) => (
          <Button
            key={chip}
            label={chip === position ? `• ${chip}` : chip}
            onPress={() => onPosition(chip)}
            variant="quiet"
          />
        ))}
      </View>
      {visible.length === 0 ? (
        <Text style={styles.emptyText}>No match — the board is dry under that filter.</Text>
      ) : (
        visible.map((entry) => (
          <View key={entry.playerId} style={styles.rowBetween}>
            <Text style={styles.lede}>
              {entry.name} · {entry.position} · proj {entry.projectedPoints.toFixed(1)}
            </Text>
            {myManagerId ? (
              <Button
                label="DRAFT"
                onPress={() => onPick(entry.playerId)}
                busy={busy}
                disabled={picked.has(entry.playerId)}
              />
            ) : null}
          </View>
        ))
      )}
      {visible.length < filtered.length ? (
        <Button
          label={`Show more (${filtered.length - visible.length} hidden)`}
          onPress={onMore}
          variant="quiet"
        />
      ) : null}
    </View>
  );
}

/** The last few picks, most recent first. */
function RecentPicksCard({
  view,
  nameById,
}: {
  view: DraftView;
  nameById: Map<string, PlayerCardView>;
}): ReactElement {
  const recent = view.picks.slice(-5).reverse();
  if (recent.length === 0) return <View />;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Recent picks</Text>
      {recent.map((pick) => {
        const seat = view.seats.find((candidate) => candidate.id === pick.managerId);
        const player = nameById.get(pick.playerId);
        return (
          <View key={pick.overall} style={styles.rowBetween}>
            <Text style={styles.lede}>
              #{pick.overall} {seat?.displayName ?? pick.managerId}
              {seat?.isAi ? ' · AI' : ''}
            </Text>
            <Text style={styles.lede}>
              {player ? `${player.name} · ${player.position}` : pick.playerId}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Recap board: the whole draft in snake order (spec: Complete state). */
function RecapCard({
  view,
  nameById,
}: {
  view: DraftView;
  nameById: Map<string, PlayerCardView>;
}): ReactElement {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Draft complete — {view.picks.length} picks, recap</Text>
      {view.picks.map((pick) => {
        const seat = view.seats.find((candidate) => candidate.id === pick.managerId);
        const player = nameById.get(pick.playerId);
        return (
          <View key={pick.overall} style={styles.rowBetween}>
            <Text style={styles.lede}>
              #{pick.overall} {seat?.displayName ?? pick.managerId}
            </Text>
            <Text style={styles.lede}>
              {player ? `${player.name} · ${player.position}` : pick.playerId}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const local = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  headerTitle: {
    color: colors.cream,
    flex: 1,
    fontFamily: 'Fraunces-Bold',
    fontSize: 20,
  },
  headerStatus: {
    color: colors.brass,
  },
  body: {
    gap: 12,
    paddingBottom: 32,
  },
  clockMine: {
    borderColor: colors.brass,
  },
  onClockText: {
    color: colors.brass,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  queueButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 14, 11, 0.86)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.felt900,
    borderColor: colors.felt700,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 18,
    width: '100%',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
});
