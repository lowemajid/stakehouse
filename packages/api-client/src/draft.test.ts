import type { DraftView } from './index';
import { ApiError, createClient, openDraftStream } from './index';
import { describe, expect, it, vi } from 'vitest';

/**
 * Draft contract tests: every method's URL, method, body, and response schema
 * pinned against the shapes the server sends (draftRoutes + draftView), plus
 * the SSE reader's parse rules against framed payloads. The fetch
 * implementation is injected, so these run without a server.
 */

interface QueuedResponse {
  status: number;
  body: unknown;
}

function clientWithResponses(responses: QueuedResponse[]): {
  client: ReturnType<typeof createClient>;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('test bug: no queued response for this call');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { client: createClient({ fetchImpl }), calls };
}

function ok(body: unknown): QueuedResponse {
  return { status: 200, body };
}

/** A valid live-draft view, as the server's buildDraftView would emit. */
export function draftView(overrides: Partial<DraftView> = {}): DraftView {
  return {
    status: 'live',
    order: ['mgr-ava', 'mgr-marge'],
    picks: [
      { overall: 1, managerId: 'mgr-ava', playerId: 'pl-1', at: '2026-10-09T12:00:00.000Z' },
    ],
    pickSeconds: 30,
    board: [
      { playerId: 'pl-2', position: 'RB', name: 'Silas Brummell', projectedPoints: 14.2 },
      { playerId: 'pl-3', position: 'WR', name: 'Teo Ferreira', projectedPoints: 12.8 },
    ],
    clock: { overall: 2, managerId: 'mgr-marge', deadline: 1_791_230_400_000 },
    rosters: { 'mgr-ava': [{ playerId: 'pl-1', position: 'QB', slot: 'QB' }], 'mgr-marge': [] },
    queues: {
      'mgr-ava': { queue: ['pl-2', 'pl-3'], autopick: true },
      'mgr-marge': { queue: [], autopick: true },
    },
    seats: [
      { id: 'mgr-ava', displayName: 'Ava Whitfield', isAi: false },
      { id: 'mgr-marge', displayName: 'Marge "Two Beers" Kowalski', isAi: true },
    ],
    ...overrides,
  };
}

describe('draft client methods', () => {
  it('getDraft reads the board and parses the view', async () => {
    const { client, calls } = clientWithResponses([ok({ draft: draftView() })]);
    const view = await client.getDraft('lg-1');
    expect(calls[0]?.url).toBe('/api/leagues/lg-1/draft');
    expect(view.clock.managerId).toBe('mgr-marge');
    expect(view.seats[1]?.displayName).toBe('Marge "Two Beers" Kowalski');
  });

  it('getDraft fails loudly when the view misses a key (seats)', async () => {
    const partial = draftView() as Record<string, unknown>;
    delete partial.seats;
    const { client } = clientWithResponses([ok({ draft: partial })]);
    await expect(client.getDraft('lg-1')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'invalid-response',
    });
  });

  it('startDraft posts to the start route', async () => {
    const { client, calls } = clientWithResponses([ok({ draft: draftView() })]);
    await client.startDraft('lg-1');
    expect(calls[0]?.url).toBe('/api/leagues/lg-1/draft/start');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('postPick sends the player id and parses pick + refreshed view', async () => {
    const { client, calls } = clientWithResponses([
      { status: 201, body: { pick: draftView().picks[0], draft: draftView() } },
    ]);
    const result = await client.postPick('lg-1', 'pl-2');
    expect(calls[0]?.url).toBe('/api/leagues/lg-1/draft/pick');
    expect(JSON.parse(String(calls[0]?.init.body))).toStrictEqual({ playerId: 'pl-2' });
    expect(result.pick.playerId).toBe('pl-1');
    expect(result.draft.board.length).toBe(2);
  });

  it('putQueue sends the queue array', async () => {
    const { client, calls } = clientWithResponses([ok({ queue: ['pl-2'] })]);
    const result = await client.putQueue('lg-1', ['pl-2']);
    expect(calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init.body))).toStrictEqual({ queue: ['pl-2'] });
    expect(result.queue).toStrictEqual(['pl-2']);
  });

  it('postAutopick resolves the expired clock', async () => {
    const view = draftView();
    const pick = { overall: 2, managerId: 'mgr-marge', playerId: 'pl-2', at: '2026-10-09T12:00:30Z' };
    const { client, calls } = clientWithResponses([ok({ autopicked: pick, draft: view })]);
    const result = await client.postAutopick('lg-1');
    expect(calls[0]?.url).toBe('/api/leagues/lg-1/draft/autopick');
    expect(result.autopicked.playerId).toBe('pl-2');
  });

  it('postFastForward cascades to the recap', async () => {
    const view = draftView({ status: 'complete', clock: { overall: null, managerId: null, deadline: null } });
    const { client, calls } = clientWithResponses([ok({ fastForwarded: 34, draft: view })]);
    const result = await client.postFastForward('lg-1');
    expect(calls[0]?.url).toBe('/api/leagues/lg-1/draft/fast-forward');
    expect(result.fastForwarded).toBe(34);
    expect(result.draft.status).toBe('complete');
  });

  it('listPlayers reads the universe and strips to card fields', async () => {
    const { client } = clientWithResponses([
      ok({
        players: [
          { id: 'pl-1', name: 'Dov Amado', position: 'QB', projection: {}, variance: 0.3 },
        ],
        total: 1,
      }),
    ]);
    const players = await client.listPlayers();
    expect(players).toStrictEqual([{ id: 'pl-1', name: 'Dov Amado', position: 'QB' }]);
  });

  it('simulateNextWeek parses the week receipt', async () => {
    const { client, calls } = clientWithResponses([ok({ week: 1, seasonComplete: false })]);
    const result = await client.simulateNextWeek('lg-1');
    expect(calls[0]?.url).toBe('/api/leagues/lg-1/simulate');
    expect(result).toStrictEqual({ week: 1, seasonComplete: false });
  });

  it('surfaces server error envelopes as ApiError with the server code', async () => {
    const { client } = clientWithResponses([
      { status: 409, body: { error: { code: 'clock-live', message: 'the pick clock has not expired yet' } } },
    ]);
    await expect(client.postAutopick('lg-1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('openDraftStream', () => {
  function sseFetch(frames: string[], status = 200): typeof fetch {
    const encoder = new TextEncoder();
    return (async (): Promise<Response> => {
      if (status !== 200) {
        return new Response('nope', { status });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      });
      return new Response(stream, {
        status,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;
  }

  it('parses draft and clock events, then reports a clean end', async () => {
    const view = draftView();
    const events: string[] = [];
    const stream = openDraftStream(
      { leagueId: 'lg-1', fetchImpl: sseFetch([
        `event: draft\ndata: ${JSON.stringify({ draft: view })}\n\n`,
        'event: clock\ndata: {"at": 1791230400000}\n\n',
      ]) },
      {
        onDraft: (draft) => events.push(`draft:${draft.clock.managerId}`),
        onClock: (at) => events.push(`clock:${at}`),
        onDown: (reason) => events.push(`down:${reason}`),
      },
    );
    await vi.waitFor(() => expect(events.join('|')).toContain('down:ended'));
    expect(events[0]).toBe('draft:mgr-marge');
    expect(events[1]).toBe('clock:1791230400000');
    stream.close();
  });

  it('reassembles a frame split across read chunks', async () => {
    const view = draftView();
    const payload = JSON.stringify({ draft: view });
    const half = Math.floor(payload.length / 2);
    const events: string[] = [];
    openDraftStream(
      { leagueId: 'lg-1', fetchImpl: sseFetch([
        `event: draft\ndata: ${payload.slice(0, half)}`,
        `${payload.slice(half)}\n\n`,
      ]) },
      {
        onDraft: (draft) => events.push(`draft:${draft.status}`),
        onClock: () => undefined,
        onDown: (reason) => events.push(`down:${reason}`),
      },
    );
    await vi.waitFor(() => expect(events).toContain('draft:live'));
  });

  it('reports a contract break on a malformed draft payload', async () => {
    const events: string[] = [];
    openDraftStream(
      { leagueId: 'lg-1', fetchImpl: sseFetch(['event: draft\ndata: {"draft": {"status": "bogus"}}\n\n']) },
      {
        onDraft: () => events.push('draft'),
        onClock: () => undefined,
        onDown: (reason) => events.push(`down:${reason}`),
      },
    );
    await vi.waitFor(() => expect(events).toStrictEqual(['down:error']));
  });

  it('reports an error for a non-200 stream response', async () => {
    const events: string[] = [];
    openDraftStream(
      { leagueId: 'lg-1', fetchImpl: sseFetch([], 500) },
      {
        onDraft: () => events.push('draft'),
        onClock: () => undefined,
        onDown: (reason) => events.push(`down:${reason}`),
      },
    );
    await vi.waitFor(() => expect(events).toStrictEqual(['down:error']));
  });

  it('requests the stream with the session cookie and SSE accept header', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured = init;
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.close(); } }), { status: 200 });
    }) as typeof fetch;
    openDraftStream({ leagueId: 'lg-1', fetchImpl }, {
      onDraft: () => undefined,
      onClock: () => undefined,
      onDown: () => undefined,
    });
    await vi.waitFor(() => expect(captured).toBeDefined());
    expect(captured?.credentials).toBe('include');
    expect((captured?.headers as Record<string, string>)['Accept']).toBe('text/event-stream');
  });
});
