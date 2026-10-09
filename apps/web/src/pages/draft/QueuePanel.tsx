import { useEffect, useState } from 'react';
import type { DraftView } from '@stakehouse/api-client';
import { Badge, Button, Panel } from '../../components/ui';

/**
 * The personal queue: an ordered wishlist the server's deadline autopick
 * reads top-first. Saving is an intent PUT — the server echoes what it
 * stored, and that echo is the panel's truth. The autopick toggle is a
 * client-side preference (localStorage): it decides whether this tab fires
 * the room's expiry autopick while your own seat is on the clock. AI seats
 * always resolve through the engine's autopick — they have no hands.
 */
export function QueuePanel({
  draft,
  mySeatId,
  onSave,
}: {
  draft: DraftView;
  mySeatId: string | null;
  onSave: (queue: string[]) => Promise<void>;
}) {
  const serverQueue = mySeatId ? (draft.queues[mySeatId]?.queue ?? []) : [];
  const [queue, setQueue] = useState<string[]>(serverQueue);
  const [saving, setSaving] = useState(false);
  const [autopickOn, setAutopickOn] = useState<boolean>(() => {
    if (!mySeatId) return true;
    const stored = window.localStorage.getItem(`sh-autopick:${mySeatId}`);
    return stored !== 'off';
  });

  // Reseed when the seat or the server's queue changes from outside — the
  // joined key keeps the effect from firing on every parent render.
  const serverQueueKey = serverQueue.join(',');
  useEffect(() => {
    setQueue(serverQueue);
  }, [mySeatId, serverQueueKey]);

  if (!mySeatId) {
    return (
      <Panel title="Your queue">
        <p className="sh-muted">Sign in and take a seat to keep a queue.</p>
      </Panel>
    );
  }

  const nameOf = (playerId: string) => draft.players[playerId]?.name ?? playerId;

  async function commit(next: string[]): Promise<void> {
    setQueue(next);
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Your queue">
      <label className="sh-draft__autopick">
        <input
          type="checkbox"
          checked={autopickOn}
          onChange={(event) => {
            setAutopickOn(event.target.checked);
            window.localStorage.setItem(
              `sh-autopick:${mySeatId}`,
              event.target.checked ? 'on' : 'off',
            );
          }}
        />
        <Badge tone={autopickOn ? 'money' : 'neutral'}>autopick {autopickOn ? 'ON' : 'OFF'}</Badge>
      </label>
      {queue.length === 0 ? (
        <p className="sh-muted">
          Queue nobody — when your clock runs out, the best available player lands.
        </p>
      ) : (
        <ol className="sh-draft__queue">
          {queue.map((playerId, index) => (
            <li key={playerId} className="sh-draft__queue-row">
              <span>
                {index + 1}. {nameOf(playerId)}
              </span>
              <span className="sh-draft__row-actions">
                <Button
                  variant="secondary"
                  disabled={index === 0 || saving}
                  onClick={() => {
                    const up = [...queue];
                    const [moved] = up.splice(index, 1);
                    up.splice(index - 1, 0, moved!);
                    void commit(up);
                  }}
                  aria-label={`Move ${nameOf(playerId)} up`}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void commit(queue.filter((id) => id !== playerId))}
                  aria-label={`Remove ${nameOf(playerId)} from the queue`}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
