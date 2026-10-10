import type { DraftView } from '@stakehouse/api-client';
import { draftViewSchema } from '@stakehouse/api-client';
import { z } from 'zod';

/**
 * The client half of the SSE draft stream. The server sends a snapshot on
 * connect, a refreshed view on every mutation, and clock heartbeats; this
 * module turns those into typed callbacks. Parsing the payload through the
 * api-client schema keeps the stream and the GET honest with one contract —
 * a malformed event is skipped, never rendered.
 */

export interface DraftStreamHandlers {
  onDraft: (draft: DraftView) => void;
  onClock: (serverNowMs: number) => void;
}

/** The slice of EventSource the subscriber actually needs — fakes in tests. */
export interface DraftEventSource {
  addEventListener(type: 'draft' | 'clock', listener: (event: { data: string }) => void): void;
  close(): void;
}
export type DraftEventSourceFactory = (url: string) => DraftEventSource;

export function subscribeDraft(
  leagueId: string,
  handlers: DraftStreamHandlers,
  factory: DraftEventSourceFactory = (url) => new EventSource(url),
): () => void {
  const source = factory(`/api/leagues/${leagueId}/draft/stream`);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    source.close();
  };

  source.addEventListener('draft', (event) => {
    try {
      // The stream payload is the GET /draft body: an envelope with the view
      // inside. Validate the envelope, hand the view through.
      const parsed = z.object({ draft: draftViewSchema }).safeParse(JSON.parse(event.data));
      if (!parsed.success) return; // a malformed event is skipped, not rendered
      handlers.onDraft(parsed.data.draft);
      // The server ends the stream at completion; close on our side too or
      // EventSource would reconnect to a finished draft forever.
      if (parsed.data.draft.status === 'complete') close();
    } catch {
      // Non-JSON payload — skip; the next snapshot re-syncs us.
    }
  });

  source.addEventListener('clock', (event) => {
    try {
      const data = JSON.parse(event.data) as { at?: unknown };
      if (typeof data.at === 'number') handlers.onClock(data.at);
    } catch {
      // Malformed heartbeat — the next one is a tick away.
    }
  });

  return close;
}
