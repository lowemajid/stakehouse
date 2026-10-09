import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { USER, expectApiError, paidLeague, type PaidLeague } from './testSupport';

/**
 * The live-draft contract: a subscriber to GET …/draft/stream receives the
 * initial snapshot, then every pick as it lands — within a clock tick.
 * supertest buffers whole responses, which never end for a live stream, so
 * the streaming tests listen on an ephemeral port and consume the body as a
 * web stream, parsing SSE frames themselves.
 */

interface DraftPayload {
  draft: {
    status: string;
    picks: { overall: number; managerId: string; playerId: string }[];
    clock: { overall: number };
  };
}

interface SseEvent {
  event: string;
  data: DraftPayload;
}

function parseFrame(raw: string): SseEvent | undefined {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return undefined;
  return { event, data: JSON.parse(data) as DraftPayload };
}

interface Collector {
  events: SseEvent[];
  /** Resolves with the first `count` events seen (immediately if already buffered). */
  next(count: number, timeoutMs?: number): Promise<SseEvent[]>;
  /** Resolves when the server ends the stream; rejects if it stays open. */
  closed(timeoutMs?: number): Promise<void>;
}

interface OpenStream {
  status: number;
  headers: Record<string, unknown>;
  collect: Collector;
  /** Aborts the subscription and releases the port. */
  close(): Promise<void>;
}

async function openStream(world: PaidLeague, managerIndex: number): Promise<OpenStream> {
  const server = http.createServer(world.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // A bare fetch needs the cookie explicitly — capture one from a fresh sign-in.
  const login = await request(world.app).post('/api/session').send(USER(managerIndex));
  expect(login.status).toBe(200);
  const rawCookie = login.headers['set-cookie']?.[0] ?? '';
  const cookie = rawCookie.split(';')[0] ?? '';

  const controller = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${port}/api/leagues/${world.leagueId}/draft/stream`,
    {
      headers: { cookie },
      signal: controller.signal,
    },
  );

  const events: SseEvent[] = [];
  const waiters: { count: number; resolve: () => void; reject: (err: Error) => void }[] = [];
  let buffer = '';
  let ended = false;
  let wakeEnded: (() => void) | undefined;

  const check = () => {
    for (const waiter of [...waiters]) {
      if (events.length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };

  // Pump the body in the background: frames split on the blank-line boundary.
  const pump = (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary === -1) break;
          const frame = parseFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (frame) events.push(frame);
        }
        check();
      }
    } catch {
      // A closed connection surfaces here once we abort — waiters reject below.
    }
    ended = true;
    wakeEnded?.();
  })();
  void pump;

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    collect: {
      events,
      next(count, timeoutMs = 3000) {
        if (events.length >= count) return Promise.resolve(events.slice(0, count));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(new Error(`SSE timeout after ${timeoutMs}ms — saw ${events.length} event(s)`)),
            timeoutMs,
          );
          waiters.push({
            count,
            resolve: () => {
              clearTimeout(timer);
              resolve(events.slice(0, count));
            },
            reject: (err) => {
              clearTimeout(timer);
              reject(err);
            },
          });
        });
      },
      closed(timeoutMs = 3000) {
        if (ended) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('stream never closed after completion')),
            timeoutMs,
          );
          wakeEnded = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      },
    },
    async close() {
      controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pump;
    },
  };
}

describe('GET /api/leagues/:id/draft/stream', () => {
  it('requires a session', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const res = await request(world.app).get(`/api/leagues/${world.leagueId}/draft/stream`);
    expectApiError(res, 401, 'unauthorized');
  });

  it('answers 404 for an unknown league', async () => {
    const world = await paidLeague();
    const res = await request(world.app).get('/api/leagues/lg-nope/draft/stream');
    expectApiError(res, 404, 'unknown-league');
  });

  it('serves text/event-stream with an initial snapshot', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const stream = await openStream(world, 0);
    try {
      expect(stream.status).toBe(200);
      expect(stream.headers['content-type']).toContain('text/event-stream');
      expect(stream.headers['cache-control']).toContain('no-cache');

      const [snapshot] = await stream.collect.next(1);
      expect(snapshot!.event).toBe('draft');
      expect(snapshot!.data.draft.status).toBe('live');
      expect(snapshot!.data.draft.picks).toStrictEqual([]);
      expect(snapshot!.data.draft.clock.overall).toBe(1);
    } finally {
      await stream.close();
    }
  });

  it('delivers a pick event within a clock tick of the pick landing', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const stream = await openStream(world, 0);
    try {
      await stream.collect.next(1); // initial snapshot consumed

      const pickedAt = Date.now();
      const pickRes = await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send(
        { playerId: 'p-0' },
      );
      expect(pickRes.status).toBe(201);

      const events = await stream.collect.next(2); // snapshot + the pick
      const event = events.at(-1)!; // the newest event is the pick landing
      const elapsed = Date.now() - pickedAt;
      expect(event.event).toBe('draft');
      expect(event.data.draft.picks).toHaveLength(1);
      expect(event.data.draft.picks[0]).toStrictEqual({
        overall: 1,
        managerId: world.managerIds[0],
        playerId: 'p-0',
        at: expect.any(String),
      });
      expect(event.data.draft.clock.overall).toBe(2);
      // Acceptance is "within one clock tick" (30s); locally it must be immediate.
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      await stream.close();
    }
  });

  it('carries every subsequent pick without re-subscribing', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const stream = await openStream(world, 1); // a second manager watches their own feed
    try {
      await stream.collect.next(1); // snapshot
      await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
        playerId: 'p-0',
      });
      await world.agents[1]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
        playerId: 'p-1',
      });
      const events = await stream.collect.next(3); // snapshot + two picks
      const first = events[1]!;
      const second = events[2]!;
      expect(first.data.draft.picks).toHaveLength(1);
      expect(first.data.draft.picks[0]!.playerId).toBe('p-0');
      expect(second.data.draft.picks).toHaveLength(2);
      expect(second.data.draft.picks[1]!.playerId).toBe('p-1');
    } finally {
      await stream.close();
    }
  });

  it('closes the stream when the draft completes', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const stream = await openStream(world, 0);
    try {
      await stream.collect.next(1); // snapshot
      await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/fast-forward`);
      await stream.collect.closed(3000);
    } finally {
      await stream.close();
    }
  });
});
