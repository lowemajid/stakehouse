import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { expectApiError, paidLeague } from './testSupport';

/**
 * The live-draft contract: a subscriber to GET …/draft/stream receives the
 * initial snapshot, then every pick as it lands — within a clock tick.
 * The stream is a plain text/event-stream response; supertest hands us the
 * raw Node response, so we parse the frames ourselves.
 */

interface SseEvent {
  event: string;
  data: any;
}

function parseFrame(raw: string): SseEvent | undefined {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return undefined;
  return { event, data: JSON.parse(data) };
}

/** Attaches to the raw response as soon as headers arrive, before the stream ends. */
async function openStream(
  streamReq: request.Test,
): Promise<{ response: request.Response; collect: Collector }> {
  const response = await new Promise<request.Response>((resolve, reject) => {
    streamReq.once('response', (res) => resolve(res));
    streamReq.once('error', reject);
  });
  const collector = attachCollector(response);
  return { response, collect: collector };
}

interface Collector {
  events: SseEvent[];
  /** Resolves with the first `count` events seen (immediately if already buffered). */
  next(count: number, timeoutMs?: number): Promise<SseEvent[]>;
}

function attachCollector(response: request.Response): Collector {
  const events: SseEvent[] = [];
  const waiters: { count: number; resolve: () => void; reject: (err: Error) => void }[] = [];
  let buffer = '';
  const check = () => {
    for (const waiter of [...waiters]) {
      if (events.length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };
  response.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary === -1) break;
      const frame = parseFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (frame) events.push(frame);
    }
    check();
  });
  response.on('error', (err: Error) => {
    for (const waiter of [...waiters]) waiter.reject(err);
    waiters.length = 0;
  });
  return {
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
    const { response, collect } = await openStream(
      world.agents[0]!.get(`/api/leagues/${world.leagueId}/draft/stream`),
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');

    const [snapshot] = await collect.next(1);
    expect(snapshot.event).toBe('draft');
    expect(snapshot.data.draft.status).toBe('live');
    expect(snapshot.data.draft.picks).toStrictEqual([]);
    expect(snapshot.data.draft.clock.overall).toBe(1);
    response.destroy();
  });

  it('delivers a pick event within a clock tick of the pick landing', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const { response, collect } = await openStream(
      world.agents[0]!.get(`/api/leagues/${world.leagueId}/draft/stream`),
    );
    await collect.next(1); // initial snapshot consumed

    const pickedAt = Date.now();
    const pickRes = await world.agents[0]!
      .post(`/api/leagues/${world.leagueId}/draft/pick`)
      .send({ playerId: 'p-0' });
    expect(pickRes.status).toBe(201);

    const [event] = await collect.next(2); // everything up to and including the pick
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
    response.destroy();
  });

  it('carries every subsequent pick without re-subscribing', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const { response, collect } = await openStream(
      world.agents[1]!.get(`/api/leagues/${world.leagueId}/draft/stream`),
    );
    await collect.next(1); // snapshot
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-0',
    });
    await world.agents[1]!.post(`/api/leagues/${world.leagueId}/draft/pick`).send({
      playerId: 'p-1',
    });
    const [first, second] = await collect.next(3);
    expect(first.data.draft.picks).toHaveLength(1);
    expect(first.data.draft.picks[0].playerId).toBe('p-0');
    expect(second.data.draft.picks).toHaveLength(2);
    expect(second.data.draft.picks[1].playerId).toBe('p-1');
    response.destroy();
  });

  it('closes the stream when the draft completes', async () => {
    const world = await paidLeague();
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/start`);
    const { response, collect } = await openStream(
      world.agents[0]!.get(`/api/leagues/${world.leagueId}/draft/stream`),
    );
    await collect.next(1); // snapshot
    await world.agents[0]!.post(`/api/leagues/${world.leagueId}/draft/fast-forward`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('stream never closed after completion')),
        3000,
      );
      response.once('end', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});
