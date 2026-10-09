import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamilies } from '@stakehouse/theme';
import type { DraftView, PlayerCardView } from '@stakehouse/api-client';
import { deriveManagerId } from '../lib/ledgerLogic';
import { BOARD_PAGE, filterBoard, type PositionFilter } from '../lib/draft/boardFilter';
import { formatCountdown, readClock } from '../lib/draft/draftClock';
import { pickRejectionMessage } from '../lib/draft/pickMessages';
import { addToQueue, moveInQueue, removeFromQueue } from '../lib/draft/queueLogic';
import { useDraftFeed } from '../lib/useDraftFeed';
import { useNow } from '../lib/useNow';
import { useApi } from '../state/apiContext';
import { Button, ErrorBox, Input, Loading, Screen, styles } from '../ui/primitives';

const POSITION_CHIPS: PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const STATUS_LABEL: Record<DraftView['status'], string> = {
  pending: 'Lobby',
  live: 'Live',
  complete: 'Complete',
};

/**
 * The draft room (spec §Draft room states). The server owns the draft: this
 * screen renders the feed's draftView, posts intents (pick, queue, autopick,
 * fast-forward), and never computes league state locally. Live truth rides
 * SSE with a polling fallback; the clock resyncs from the server deadline on
 * foreground, reload, and every server event.
 */
export function DraftRoomScreen({
  leagueId,
  onBack,
}: {
  leagueId: string;
  onBack(): void;
}): ReactElement {
  const { client, user } = useApi();
  const [players, setPlayers] = useState<PlayerCardView[]>([]);
  const [playersFailed, setPlayersFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [queueDirty, setQueueDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<PositionFilter>('ALL');
  const [page, setPage] = useState(1);
  const [confirmingFastForward, setConfirmingFastForward] = useState(false);

  const myManagerId = useMemo(() => (user ? deriveManagerId(user.email) : null), [user]);
  const nameById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);

  const feed = useDraftFeed({ client, leagueId, myManagerId, nameById });
  const view = feed.view;
  const now = useNow(250);

  const loadPlayers = useCallback((): void => {
    setPlayersFailed(false);
    void (async () => {
      try {
        setPlayers(await client.listPlayers());
      } catch {
        setPlayersFailed(true);
      }
    })();
  }, [client]);

  // The player universe names the board and the toasts; the draft itself
  // rides the feed.
  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  // Server queue is truth; local edits ride ahead of the PUT and yield to the
  // next server view until touched again.
  const serverQueue = useMemo(
    () => (view && myManagerId ? (view.queues[myManagerId]?.queue ?? []) : []),
    [view, myManagerId],
  );
  useEffect(() => {
    if (!queueDirty) setQueue(serverQueue);
  }, [queueDirty, serverQueue]);

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
      feed.applyView(result.draft);
    });
  }

  function startDraft(): void {
    void run(async () => {
      const next = await client.startDraft(leagueId);
      feed.applyView(next);
    });
  }

  function resolveAutopick(): void {
    void run(async () => {
      const result = await client.postAutopick(leagueId);
      feed.applyView(result.draft);
    });
  }

  function fastForward(): void {
    setConfirmingFastForward(false);
    void run(async () => {
      const result = await client.postFastForward(leagueId);
      feed.applyView(result.draft);
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

      {view === null ? (
        feed.loadFailed ? (
          <ErrorBox
            message="The draft board could not be read."
            onRetry={() => void feed.resync()}
          />
        ) : (
          <Loading label="Setting the board…" />
        )
      ) : (
        <ScrollView contentContainerStyle={local.body}>
          {feed.status === 'polling' ? (
            <Text style={local.fallbackChip}>Live updates lost — polling every 5s</Text>
          ) : null}
          {actionError ? <ErrorBox message={actionError} /> : null}
          {playersFailed ? (
            <ErrorBox message="Player names could not be loaded." onRetry={loadPlayers} />
          ) : null}

          {view.status === 'pending' ? (
            <LobbyCard view={view} myManagerId={myManagerId} busy={busy} onStart={startDraft} />
          ) : null}

          {view.status === 'live' ? (
            <>
              <ClockCard view={view} myManagerId={myManagerId} now={now} skewMs={feed.skewMs} />
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
      )}

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

      {feed.toasts.length > 0 ? (
        <View style={local.toastStack} pointerEvents="box-none">
          {feed.toasts.map((toast) => (
            <Pressable
              key={toast.id}
              onPress={() => feed.dismissToast(toast.id)}
              style={[local.toastCard, toast.kind === 'autopick' && local.toastAutopick]}
            >
              <Text style={[styles.lede, local.toastTitle]}>{toast.title}</Text>
              <Text style={styles.lede}>{toast.body}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
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

/** Who is on the clock — the countdown is derived from the server deadline
 * (skew-corrected) on every tick; nothing accumulates locally. */
function ClockCard({
  view,
  myManagerId,
  now,
  skewMs,
}: {
  view: DraftView;
  myManagerId: string | null;
  now: number;
  skewMs: number;
}): ReactElement {
  const onClock = view.clock.managerId;
  const seat = view.seats.find((candidate) => candidate.id === onClock);
  const mine = onClock !== null && onClock === myManagerId;
  const deadline = view.clock.deadline;
  const reading = deadline !== null ? readClock(deadline, now + skewMs) : null;
  const underTen = reading !== null && reading.remainingMs <= 10_000;
  return (
    <View style={[styles.card, mine && local.clockMine]}>
      <Text style={styles.cardTitle}>
        {mine ? 'YOUR PICK' : 'ON THE CLOCK'} — pick {view.clock.overall ?? '—'}
      </Text>
      {reading !== null ? (
        <Text style={[local.clockDigits, underTen && local.clockUrgent]}>
          <Pulse active={mine && underTen}>{formatCountdown(reading.remainingMs)}</Pulse>
        </Text>
      ) : (
        <Text style={styles.lede}>Waiting for the clock…</Text>
      )}
      <Text style={styles.lede}>
        {seat ? seat.displayName : 'Waiting for the server…'}
        {seat?.isAi && !mine ? ' — thinking…' : mine ? ' — the board is yours.' : ''}
      </Text>
    </View>
  );
}

/** Pulses the countdown while my clock runs under ten seconds. */
function Pulse({ active, children }: { active: boolean; children: string }): ReactElement {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);
  return <Animated.Text style={{ opacity }}>{children}</Animated.Text>;
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
  clockDigits: {
    color: colors.cream,
    fontFamily: fontFamilies.mono,
    fontSize: 40,
    marginTop: 4,
  },
  clockUrgent: {
    color: colors.blood,
  },
  fallbackChip: {
    color: colors.brass,
    fontSize: 12,
    marginBottom: 4,
  },
  toastStack: {
    bottom: 18,
    flexDirection: 'column',
    gap: 8,
    left: 16,
    position: 'absolute',
    right: 16,
    zIndex: 10,
  },
  toastCard: {
    backgroundColor: colors.felt700,
    borderColor: colors.felt500,
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
    padding: 12,
  },
  toastAutopick: {
    borderColor: colors.brass,
  },
  toastTitle: {
    color: colors.brass,
    fontWeight: '600',
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
