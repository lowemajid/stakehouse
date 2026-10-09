import type { DraftView, PlayerCardView, StakehouseClient } from '@stakehouse/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  autopickToast,
  createDraftFeed,
  pickToast,
  type FeedStatus,
  type FeedToast,
} from './draft/draftFeed';

export type FeedToastInstance = FeedToast & { id: number };

export interface DraftFeedHandle {
  status: FeedStatus;
  view: DraftView | null;
  skewMs: number;
  toasts: FeedToastInstance[];
  /** The first board read failed — the screen shows its error box. */
  loadFailed: boolean;
  dismissToast(id: number): void;
  /** The screen pushes server-confirmed views (pick/queue responses) here. */
  applyView(next: DraftView): void;
  resync(): Promise<void>;
}

const TOAST_MS = 4_200;
const MAX_TOASTS = 3;

/**
 * React binding for the draft feed: one feed per (client, league), state
 * mirrored into React, foreground/reload resync off AppState, and toasts for
 * the clock-expired autopick and every other seat's pick. nameById and
 * myManagerId are read through refs so a late-loading player universe still
 * names toasts without restarting the feed.
 */
export function useDraftFeed({
  client,
  leagueId,
  myManagerId,
  nameById,
}: {
  client: StakehouseClient;
  leagueId: string;
  myManagerId: string | null;
  nameById: Map<string, PlayerCardView>;
}): DraftFeedHandle {
  const [, setVersion] = useState(0);
  const [toasts, setToasts] = useState<FeedToastInstance[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const toastSeq = useRef(0);
  const toastTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const nameRef = useRef(nameById);
  const mineRef = useRef(myManagerId);
  nameRef.current = nameById;
  mineRef.current = myManagerId;

  function pushToast(toast: FeedToast): void {
    toastSeq.current += 1;
    const instance: FeedToastInstance = { ...toast, id: toastSeq.current };
    setToasts((current) => [...current, instance].slice(-MAX_TOASTS));
    const timer = setTimeout(() => {
      toastTimers.current.delete(timer);
      dismissToast(instance.id);
    }, TOAST_MS);
    toastTimers.current.add(timer);
  }

  function dismissToast(id: number): void {
    setToasts((current) => current.filter((candidate) => candidate.id !== id));
  }

  const feed = useMemo(
    () =>
      createDraftFeed({
        client,
        leagueId,
        now: () => Date.now(),
        openStream: (id, handlers) => client.openDraftStream(id, handlers),
        onEvent: (event) => {
          if (event.type === 'autopick-resolved') {
            pushToast(autopickToast({ pick: event.pick, view: event.view }));
          } else if (event.type === 'view-applied') {
            for (const pick of event.newPicks) {
              const toast = pickToast({
                pick,
                view: event.view,
                myManagerId: mineRef.current,
                playerName: nameRef.current.get(pick.playerId)?.name,
              });
              if (toast) pushToast(toast);
            }
          }
        },
      }),
    // pushToast closes only over stable setters and refs, so the feed's
    // identity stays tied to (client, league) alone.
    [client, leagueId],
  );

  useEffect(() => {
    const unsubscribe = feed.subscribe(() => setVersion((version) => version + 1));
    return unsubscribe;
  }, [feed]);

  useEffect(() => {
    void (async () => {
      await feed.start();
      // The feed keeps the last view through failed polls; a null view here
      // means the very first read never landed.
      if (feed.view() === null) setLoadFailed(true);
    })();
    return () => feed.close();
  }, [feed]);

  // Foreground/reload resync: the deadline is re-read from the server; the
  // stream is reopened if it dropped while backgrounded.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void feed.resync();
    });
    return () => subscription.remove();
  }, [feed]);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return {
    status: feed.status(),
    view: feed.view(),
    skewMs: feed.skewMs(),
    toasts,
    loadFailed,
    dismissToast,
    applyView: (next: DraftView): void => feed.applyView(next),
    resync: async (): Promise<void> => {
      await feed.resync();
      if (feed.view() !== null) setLoadFailed(false);
    },
  };
}
