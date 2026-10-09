import type { DraftView } from '@stakehouse/api-client';

/**
 * Wire-shape draft fixtures matching the server's buildDraftView, for draft
 * room tests. Every field is present — the api-client schema rejects partial
 * views, so a fixture that drops a field fails before the component does.
 */

export const DRAFT_SEAT_IDS = ['mgr-marge', 'mgr-ai-1', 'mgr-ai-2'] as const;

export function draftViewFixture(overrides: Partial<DraftView> = {}): DraftView {
  const seats = DRAFT_SEAT_IDS;
  return {
    status: 'live',
    order: [...seats],
    picks: [],
    pickSeconds: 30,
    board: [
      { playerId: 'p-1', position: 'QB', name: 'Dov Amado', projectedPoints: 312.4 },
      { playerId: 'p-2', position: 'RB', name: 'Silas Brummell', projectedPoints: 244.1 },
      { playerId: 'p-3', position: 'WR', name: 'Teo Ferreira', projectedPoints: 231.0 },
      { playerId: 'p-4', position: 'TE', name: 'Marcus Idowu', projectedPoints: 158.2 },
    ],
    clock: { overall: 1, managerId: seats[0], deadline: null },
    rosters: Object.fromEntries(seats.map((id) => [id, []])),
    queues: Object.fromEntries(seats.map((id) => [id, { queue: [], autopick: true }])),
    managers: {
      [seats[0]]: { displayName: 'Marge Kowalski', isAi: false },
      [seats[1]]: { displayName: 'Chester Royales', isAi: true },
      [seats[2]]: { displayName: 'The Coventry Kings', isAi: true },
    },
    players: {
      'p-1': { name: 'Dov Amado', position: 'QB', projectedPoints: 312.4 },
      'p-2': { name: 'Silas Brummell', position: 'RB', projectedPoints: 244.1 },
      'p-3': { name: 'Teo Ferreira', position: 'WR', projectedPoints: 231.0 },
      'p-4': { name: 'Marcus Idowu', position: 'TE', projectedPoints: 158.2 },
    },
    ...overrides,
  };
}

/** A view with one pick on the books and the second seat on the clock. */
export function liveAfterOnePick(): DraftView {
  return draftViewFixture({
    picks: [
      { overall: 1, managerId: DRAFT_SEAT_IDS[0], playerId: 'p-1', at: '2026-10-09T12:01:00Z' },
    ],
    clock: { overall: 2, managerId: DRAFT_SEAT_IDS[1], deadline: 1_791_230_430_000 },
    board: draftViewFixture().board.slice(1),
    rosters: {
      [DRAFT_SEAT_IDS[0]]: [{ playerId: 'p-1', position: 'QB', slot: 'QB' }],
      [DRAFT_SEAT_IDS[1]]: [],
      [DRAFT_SEAT_IDS[2]]: [],
    },
  });
}

/**
 * A fake EventSource: records listeners, tests emit typed events into them.
 * The draft stream module accepts an EventSource factory, so tests inject
 * this instead of the browser built-in jsdom does not ship.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = 0; // CONNECTING, like the real thing before the connection opens
  closed = false;
  private readonly listeners = new Map<string, ((event: { data: string }) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2; // CLOSED
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) });
  }

  static factory(): (url: string) => FakeEventSource {
    FakeEventSource.instances = [];
    return (url: string) => new FakeEventSource(url);
  }
}
