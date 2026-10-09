import { describe, expect, it } from 'vitest';
import { managerId } from './brand';
import type { ManagerId } from './brand';
import { DomainError } from './errors';
import {
  applyPick,
  createDraft,
  onTheClock,
  resolveDeadline,
  startDraft,
  totalPicks,
} from './draft';
import type { DraftState, PlayerRef, Position, QueueMap, RosterSlots } from './draft';

const NOW = 1_800_000_000_000;

/**
 * Deterministic RNG (mulberry32 — the same generator the simulation slice
 * uses). Seeded property tests replay identically run-to-run, locally and in
 * CI: a flaky property suite is worth nothing.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES = [4, 6, 8, 10, 12] as const;

/** Nine slots per manager — a standard-ish shape with one FLEX. */
const SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
const SLOTS_PER_MANAGER = 9;

// QBs are scarce (they only ever fit QB slots); the mix keeps every position
// from exhausting before the league does.
const BOARD_MIX: Position[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'];

function makeBoard(count: number): PlayerRef[] {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `pl-${String(i + 1).padStart(3, '0')}`,
    position: BOARD_MIX[i % BOARD_MIX.length]!,
  }));
}

function mg(i: number): ManagerId {
  return managerId(`mgr-${i}`);
}

function mkDraft(size: number, boardMultiplier = 3): DraftState {
  return createDraft({
    order: Array.from({ length: size }, (_, i) => mg(i + 1)),
    slots: SLOTS,
    pickSeconds: 30,
    board: makeBoard(size * SLOTS_PER_MANAGER * boardMultiplier),
  });
}

function liveDraft(size: number, now = NOW, boardMultiplier = 3): DraftState {
  return startDraft(mkDraft(size, boardMultiplier), now);
}

function takenSet(state: DraftState): Set<string> {
  return new Set(state.picks.map((p) => p.playerId));
}

/** The engine's roster rule, restated plainly: exact slot first, then FLEX for RB/WR/TE. */
function isRosterable(state: DraftState, who: ManagerId, position: Position): boolean {
  const mine = state.picks.filter((p) => p.managerId === who);
  const board = new Map(state.board.map((p) => [p.playerId, p.position]));
  // Mirror of the engine's greedy slot replay — exact slots first, FLEX absorbs
  // the overflow; a count shortcut would double-book the FLEX slot.
  const used: Record<string, number> = {};
  for (const pick of mine) {
    const pos = board.get(pick.playerId);
    if (!pos) continue;
    if ((used[pos] ?? 0) < state.slots[pos]) {
      used[pos] = (used[pos] ?? 0) + 1;
    } else if (
      pos !== 'K' &&
      pos !== 'DEF' &&
      pos !== 'QB' &&
      (used.FLEX ?? 0) < state.slots.FLEX
    ) {
      used.FLEX = (used.FLEX ?? 0) + 1;
    }
  }
  if ((used[position] ?? 0) < state.slots[position]) return true;
  const flexEligible = position === 'RB' || position === 'WR' || position === 'TE';
  return flexEligible && (used.FLEX ?? 0) < state.slots.FLEX;
}

/** First board-order player the manager can legally take right now. */
function legalPlayerFor(state: DraftState, who: ManagerId): PlayerRef | null {
  const taken = takenSet(state);
  return (
    state.board.find((p) => !taken.has(p.playerId) && isRosterable(state, who, p.position)) ?? null
  );
}

/** A player nobody has taken yet (legal or not for the current seat). */
function anyUntakenPlayerId(state: DraftState, rng: () => number): string {
  const taken = takenSet(state);
  const open = state.board.filter((p) => !taken.has(p.playerId));
  return open[Math.floor(rng() * open.length)]!.playerId;
}

/** Expected seat for `overall` in a league of `size` managers named mgr-1..mgr-N. */
function snakeManager(size: number, overall: number): ManagerId {
  const round = Math.floor((overall - 1) / size);
  const idx = (overall - 1) % size;
  return mg(round % 2 === 0 ? idx + 1 : size - idx);
}

describe('createDraft — construction invariants', () => {
  it('builds a pending draft with an empty board of picks and no deadline', () => {
    const state = mkDraft(4);
    expect(state.status).toBe('pending');
    expect(state.picks).toEqual([]);
    expect(state.deadline).toBeNull();
    expect(state.pickSeconds).toBe(30);
    expect(state.order).toHaveLength(4);
  });

  it('rejects an empty draft order (snake math needs a seat)', () => {
    expect(() =>
      createDraft({ order: [], slots: SLOTS, pickSeconds: 30, board: makeBoard(36) }),
    ).toThrow(DomainError);
  });

  it('rejects a manager holding two seats', () => {
    expect(() =>
      createDraft({
        order: [mg(1), mg(2), mg(1)],
        slots: SLOTS,
        pickSeconds: 30,
        board: makeBoard(40),
      }),
    ).toThrow(DomainError);
  });

  it('rejects a non-positive pick clock', () => {
    expect(() =>
      createDraft({
        order: [mg(1), mg(2)],
        slots: SLOTS,
        pickSeconds: 0,
        board: makeBoard(20),
      }),
    ).toThrow(DomainError);
  });

  it('rejects a board with duplicate player ids', () => {
    const board = makeBoard(20);
    expect(() =>
      createDraft({
        order: [mg(1), mg(2)],
        slots: SLOTS,
        pickSeconds: 30,
        board: [board[0]!, board[0]!],
      }),
    ).toThrow(DomainError);
  });

  it('rejects a board too small to fill every roster slot', () => {
    expect(() =>
      createDraft({
        order: [mg(1), mg(2)],
        slots: SLOTS, // 9 × 2 = 18 picks needed
        pickSeconds: 30,
        board: makeBoard(17),
      }),
    ).toThrow(DomainError);
  });
});

describe('startDraft — commissioner opens the room', () => {
  it('sets the first clock from the caller-supplied now', () => {
    const pending = mkDraft(4);
    const live = startDraft(pending, NOW);
    expect(live.status).toBe('live');
    expect(live.deadline).toBe(NOW + 30_000);
    expect(pending.status).toBe('pending'); // untouched input
  });

  it('refuses to start twice or after completion', () => {
    const live = liveDraft(4);
    expect(() => startDraft(live, NOW)).toThrow(DomainError);
  });
});

describe.each(SIZES)('onTheClock — snake order for a %i-manager league', (size) => {
  it('walks 1..N then N..1 for every overall pick', () => {
    const state = mkDraft(size);
    const rounds = 5;
    for (let overall = 1; overall <= size * rounds; overall++) {
      expect(onTheClock(state, overall)).toEqual(snakeManager(size, overall));
    }
  });

  it('mirrors the order across the first round boundary', () => {
    const state = mkDraft(size);
    expect(onTheClock(state, 1)).toEqual(mg(1));
    expect(onTheClock(state, size)).toEqual(mg(size));
    expect(onTheClock(state, size + 1)).toEqual(mg(size));
    expect(onTheClock(state, size + 2)).toEqual(mg(size - 1));
  });

  it('rejects overall picks outside the draft', () => {
    const state = mkDraft(size);
    expect(() => onTheClock(state, 0)).toThrow(DomainError);
    expect(() => onTheClock(state, size * SLOTS_PER_MANAGER + 1)).toThrow(DomainError);
  });
});

describe('applyPick — the one guarded transition', () => {
  it('lands an on-time pick by the manager on the clock and advances the deadline', () => {
    const state = liveDraft(4);
    const result = applyPick(state, { managerId: mg(1), playerId: 'pl-001' }, NOW + 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.picks).toHaveLength(1);
    expect(result.next.picks[0]).toEqual({
      overall: 1,
      managerId: mg(1),
      playerId: 'pl-001',
      at: new Date(NOW + 1_000).toISOString(),
    });
    expect(result.next.deadline).toBe(NOW + 1_000 + 30_000);
    expect(onTheClock(result.next, 2)).toEqual(mg(2)); // round 1 walks 1→2→3→4 — the second seat
    expect(state.picks).toHaveLength(0); // input untouched — states are immutable
  });

  it('rejects a pick when the draft is not live', () => {
    const pending = mkDraft(4);
    expect(applyPick(pending, { managerId: mg(1), playerId: 'pl-001' }, NOW)).toMatchObject({
      ok: false,
      reason: 'not-your-turn',
    });

    const live = liveDraft(4);
    let done = live;
    while (done.status === 'live') {
      const who = onTheClock(done, done.picks.length + 1);
      const player = legalPlayerFor(done, who);
      if (!player) throw new Error('fixture could not find a legal player');
      const r = applyPick(done, { managerId: who, playerId: player.playerId }, done.deadline! - 1);
      if (!r.ok) throw new Error(`fixture pick rejected: ${r.reason}`);
      done = r.next;
    }
    expect(done.status).toBe('complete');
    expect(applyPick(done, { managerId: mg(1), playerId: 'pl-001' }, NOW)).toMatchObject({
      ok: false,
      reason: 'not-your-turn',
    });
  });

  it('rejects an out-of-turn manager', () => {
    const state = liveDraft(4);
    expect(applyPick(state, { managerId: mg(2), playerId: 'pl-001' }, NOW)).toMatchObject({
      ok: false,
      reason: 'not-your-turn',
    });
    expect(applyPick(state, { managerId: mg(4), playerId: 'pl-001' }, NOW)).toMatchObject({
      ok: false,
      reason: 'not-your-turn',
    });
  });

  it('rejects a pick after the clock expires — no override after the fact', () => {
    const state = liveDraft(4); // deadline = NOW + 30_000
    expect(applyPick(state, { managerId: mg(1), playerId: 'pl-001' }, NOW + 30_001)).toMatchObject({
      ok: false,
      reason: 'clock-expired',
    });
  });

  it('allows a pick exactly at the deadline — the buzzer still counts', () => {
    const state = liveDraft(4);
    const result = applyPick(state, { managerId: mg(1), playerId: 'pl-001' }, NOW + 30_000);
    expect(result.ok).toBe(true);
  });

  it('rejects a player who is already off the board', () => {
    const state = liveDraft(4);
    const first = applyPick(state, { managerId: mg(1), playerId: 'pl-001' }, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // pick 2 in round 1 belongs to the second seat, mgr-2
    expect(applyPick(first.next, { managerId: mg(2), playerId: 'pl-001' }, NOW + 1)).toMatchObject({
      ok: false,
      reason: 'player-taken',
    });
  });

  it('rejects a player whose position fits no open slot (duplicate roster slot)', () => {
    // Every slot is a QB slot and there is no FLEX: an RB fits nothing, no
    // matter which QB slots are still open for this manager.
    const slots: RosterSlots = { QB: 2, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
    const board: PlayerRef[] = [
      { playerId: 'qb-1', position: 'QB' },
      { playerId: 'qb-2', position: 'QB' },
      { playerId: 'qb-3', position: 'QB' },
      { playerId: 'qb-4', position: 'QB' },
      { playerId: 'qb-5', position: 'QB' },
      { playerId: 'rb-1', position: 'RB' },
    ];
    let state = startDraft(
      createDraft({ order: [mg(1), mg(2), mg(3)], slots, pickSeconds: 30, board }),
      NOW,
    );
    // 3-manager snake: o1 m1 · o2 m2 · o3 m3 · o4 m3 · o5 m2 · o6 m1
    for (const playerId of ['qb-1', 'qb-2', 'qb-3', 'qb-4', 'qb-5']) {
      const who = onTheClock(state, state.picks.length + 1);
      const r = applyPick(state, { managerId: who, playerId }, state.deadline! - 1);
      if (!r.ok) throw new Error(`fixture pick ${playerId} rejected: ${r.reason}`);
      state = r.next;
    }
    expect(onTheClock(state, 6)).toEqual(mg(1));
    expect(applyPick(state, { managerId: mg(1), playerId: 'rb-1' }, NOW)).toMatchObject({
      ok: false,
      reason: 'duplicate-roster-slot',
    });
    expect(state.picks).toHaveLength(5); // a rejection leaves the draft untouched
  });

  it('throws on a player id that is not on the board', () => {
    const state = liveDraft(4);
    expect(() =>
      applyPick(state, { managerId: mg(1), playerId: 'pl-does-not-exist' }, NOW),
    ).toThrow(DomainError);
  });
});

describe('resolveDeadline — the clock answers for an idle manager', () => {
  it('is a no-op (same reference) before the deadline passes', () => {
    const state = liveDraft(4);
    expect(resolveDeadline(state, {}, state.deadline!)).toBe(state);
    expect(resolveDeadline(state, {}, NOW)).toBe(state);
  });

  it('autopicks the queue top when the clock expires', () => {
    const state = liveDraft(4);
    const queues: QueueMap = { [mg(1)]: ['pl-005', 'pl-002'] };
    const next = resolveDeadline(state, queues, state.deadline! + 1);
    expect(next.picks).toHaveLength(1);
    expect(next.picks[0]).toEqual({
      overall: 1,
      managerId: mg(1),
      playerId: 'pl-005',
      at: new Date(state.deadline! + 1).toISOString(),
    });
    expect(next.deadline).toBe(state.deadline! + 1 + 30_000);
    expect(next.status).toBe('live');
  });

  it('skips queue entries that are already off the board', () => {
    const state = liveDraft(4);
    const withPick = resolveDeadline(state, {}, state.deadline! + 1); // pl-001 goes best-available
    expect(withPick.picks[0]!.playerId).toBe('pl-001');
    const queues: QueueMap = { [mg(2)]: ['pl-001', 'pl-003'] }; // pl-001 was just taken
    const next = resolveDeadline(withPick, queues, withPick.deadline! + 1);
    expect(next.picks[1]).toMatchObject({ managerId: mg(2), playerId: 'pl-003' });
  });

  it('skips queue entries the manager cannot roster, then falls back', () => {
    // mgr-2 has no K slot; a queued kicker is unrosterable, the WR behind it fits FLEX.
    const slots: RosterSlots = { QB: 1, RB: 2, WR: 0, TE: 0, FLEX: 1, K: 0, DEF: 0 };
    let state = startDraft(
      createDraft({
        order: [mg(1), mg(2)],
        slots,
        pickSeconds: 30,
        board: makeBoard(24), // pl-001 QB · pl-002 RB · pl-003 RB · pl-004 WR · pl-008 K · pl-011 RB · pl-012 RB
      }),
      NOW,
    );
    // 2-manager snake seats: o1 m1 · o2 m2 · o3 m2 · o4 m1 · o5 m1 · o6 m2
    // o1 mgr-1 QB · o2 mgr-2 RB · o3 mgr-2 RB · o4 mgr-1 RB · o5 mgr-1 RB · o6 mgr-2 on the clock
    for (const playerId of ['pl-001', 'pl-002', 'pl-003', 'pl-011', 'pl-012']) {
      const who = onTheClock(state, state.picks.length + 1);
      const r = applyPick(state, { managerId: who, playerId }, state.deadline! - 1);
      if (!r.ok) throw new Error(`fixture pick ${playerId} rejected: ${r.reason}`);
      state = r.next;
    }
    expect(onTheClock(state, 6)).toEqual(mg(2));
    const next = resolveDeadline(state, { [mg(2)]: ['pl-008', 'pl-004'] }, state.deadline! + 1);
    // pl-008 is a kicker with no K slot — skipped; pl-004 is a WR and fills FLEX
    expect(next.picks[5]).toMatchObject({ managerId: mg(2), playerId: 'pl-004' });
  });

  it('falls back to best-available when the queue is empty', () => {
    const state = liveDraft(4);
    const next = resolveDeadline(state, {}, state.deadline! + 1);
    expect(next.picks[0]).toMatchObject({ managerId: mg(1), playerId: 'pl-001' }); // board order
  });

  it('falls back to best-available when every queue entry is unusable', () => {
    const state = liveDraft(4);
    const queues: QueueMap = { [mg(1)]: ['pl-taken-ghost', 'pl-also-ghost'] };
    const next = resolveDeadline(state, queues, state.deadline! + 1);
    expect(next.picks[0]).toMatchObject({ managerId: mg(1), playerId: 'pl-001' });
  });

  it('throws when no rosterable player remains for the seat on the clock', () => {
    const slots: RosterSlots = { QB: 2, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
    const board: PlayerRef[] = [
      { playerId: 'qb-1', position: 'QB' },
      { playerId: 'qb-2', position: 'QB' },
      { playerId: 'rb-1', position: 'RB' },
      { playerId: 'rb-2', position: 'RB' },
    ];
    let state = startDraft(
      createDraft({ order: [mg(1), mg(2)], slots, pickSeconds: 30, board }),
      NOW,
    );
    state = resolveDeadline(state, {}, state.deadline! + 1); // qb-1 → mgr-1
    state = resolveDeadline(state, {}, state.deadline! + 1); // qb-2 → mgr-2
    // Both QBs gone; mgr-1 needs another QB and RBs fit nothing. The draft is stuck.
    expect(() => resolveDeadline(state, {}, state.deadline! + 1)).toThrow(DomainError);
  });
});

describe('fast-forward — cascading autopicks to the end', () => {
  it('drives a live draft to completion by repeatedly answering expired clocks', () => {
    let state = liveDraft(4);
    const queues: QueueMap = { [mg(2)]: ['pl-010', 'pl-011'] };
    let guard = 0;
    while (state.status === 'live') {
      if (++guard > 500) throw new Error('fast-forward did not terminate');
      state = resolveDeadline(state, queues, state.deadline! + 1);
    }
    expect(state.status).toBe('complete');
    expect(state.deadline).toBeNull();
    expect(state.picks).toHaveLength(36);
    expect(new Set(state.picks.map((p) => p.playerId)).size).toBe(36);
    // queued players land when their seat's clock is answered
    expect(state.picks.some((p) => p.managerId === mg(2) && p.playerId === 'pl-010')).toBe(true);
  });
});

describe('full draft property — seeded random seasons', () => {
  const SEEDS = 25;

  it('completes with every roster slot filled exactly once, for every size and seed', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = mulberry32(0x5eed + seed);
      const size = SIZES[Math.floor(rng() * SIZES.length)]!;
      const fresh = liveDraft(size);
      let state = fresh;
      let steps = 0;
      const queues: QueueMap = {
        [mg(1 + Math.floor(rng() * size))]: ['pl-001', 'pl-002', 'pl-004'],
      };

      while (state.status === 'live') {
        if (++steps > 2_000) throw new Error(`seed ${seed}: draft did not finish`);
        const overall = state.picks.length + 1;
        const who = onTheClock(state, overall);
        const now = state.deadline! - 1; // humans pick inside their clock
        const roll = rng();
        if (roll < 0.15) {
          const other = state.order[(state.order.indexOf(who) + 1) % state.order.length]!;
          expect(
            applyPick(state, { managerId: other, playerId: anyUntakenPlayerId(state, rng) }, now),
          ).toMatchObject({
            ok: false,
            reason: 'not-your-turn',
          });
        } else if (roll < 0.3 && state.picks.length > 0) {
          const victim = state.picks[Math.floor(rng() * state.picks.length)]!;
          expect(
            applyPick(state, { managerId: who, playerId: victim.playerId }, now),
          ).toMatchObject({
            ok: false,
            reason: 'player-taken',
          });
        } else if (roll < 0.45) {
          const expired = resolveDeadline(state, queues, state.deadline! + 1);
          expect(expired).not.toBe(state); // an expired clock always answers
          state = expired;
        } else {
          const player = legalPlayerFor(state, who);
          if (!player) throw new Error(`seed ${seed}: no legal player for ${who}`);
          const r = applyPick(state, { managerId: who, playerId: player.playerId }, now);
          expect(r.ok).toBe(true);
          if (r.ok) state = r.next;
        }
      }

      const label = `seed ${seed}, ${size}-manager league`;
      expect(state.status, label).toBe('complete');
      expect(state.deadline, label).toBeNull();
      expect(state.picks, label).toHaveLength(size * SLOTS_PER_MANAGER);

      const playerIds = state.picks.map((p) => p.playerId);
      expect(new Set(playerIds).size, label).toBe(playerIds.length); // nobody drafted twice

      const board = new Map(state.board.map((p) => [p.playerId, p.position]));
      state.picks.forEach((pick, i) => {
        expect(pick.overall, label).toBe(i + 1);
        expect(pick.managerId, label).toEqual(snakeManager(size, i + 1));
      });

      // every manager's slots filled exactly once: fixed positions exact,
      // RB+WR+TE together cover their slots plus the FLEX.
      for (const who of state.order) {
        const mine = state.picks.filter((p) => p.managerId === who);
        expect(mine, `${label}: ${who}`).toHaveLength(SLOTS_PER_MANAGER);
        const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
        for (const pick of mine) counts[board.get(pick.playerId)!]! += 1;
        expect(counts.QB, `${label}: ${who} QB`).toBe(SLOTS.QB);
        expect(counts.K, `${label}: ${who} K`).toBe(SLOTS.K);
        expect(counts.DEF, `${label}: ${who} DEF`).toBe(SLOTS.DEF);
        expect(counts.RB + counts.WR + counts.TE, `${label}: ${who} flex-capable total`).toBe(
          SLOTS.RB + SLOTS.WR + SLOTS.TE + SLOTS.FLEX,
        );
      }
      expect(totalPicks(state), label).toBe(size * SLOTS_PER_MANAGER);
    }
  });
});
