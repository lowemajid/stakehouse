import { DomainError } from './errors';
import type { ManagerId } from './brand';

/**
 * The pure draft core. Server-authoritative by construction: every pick —
 * human or AI — lands through `applyPick`'s one guarded transition or through
 * `resolveDeadline`, which answers an expired clock on the seat's behalf. The
 * engine never reads a clock (callers pass `now`) and never touches storage —
 * states go in, new states come out, inputs are never mutated.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

/** Roster slots; FLEX is a slot kind, not a player position. */
export type SlotKey = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'K' | 'DEF';

export type RosterSlots = Record<SlotKey, number>;

export type DraftStatus = 'pending' | 'live' | 'complete';

export interface PlayerRef {
  playerId: string;
  position: Position;
}

export interface Pick {
  overall: number;
  managerId: ManagerId;
  playerId: string;
  at: string; // caller-supplied instant, ISO — the domain never reads a clock
}

export interface DraftState {
  status: DraftStatus;
  order: ManagerId[]; // round-1 seat order; later rounds snake arithmetically
  picks: Pick[];
  pickSeconds: number; // length of one pick clock
  deadline: number | null; // epoch ms of the current pick's expiry; null when pending or complete
  slots: RosterSlots; // roster shape each manager must fill exactly once
  board: readonly PlayerRef[]; // ranked player universe — board order is best-available order
}

export interface PlayerPick {
  managerId: ManagerId;
  playerId: string;
}

export type QueueMap = Partial<Record<ManagerId, readonly string[]>>;

export type PickRejectionReason =
  'not-your-turn' | 'player-taken' | 'clock-expired' | 'duplicate-roster-slot';

export type PickResult =
  { ok: true; next: DraftState } | { ok: false; reason: PickRejectionReason };

export interface CreateDraftInput {
  order: ManagerId[];
  slots: RosterSlots;
  pickSeconds: number;
  board: readonly PlayerRef[];
}

const FLEX_ELIGIBLE: readonly Position[] = ['RB', 'WR', 'TE'];

function slotTotal(slots: RosterSlots): number {
  return Object.values(slots).reduce((sum, count) => sum + count, 0);
}

/** Every roster slot across the league gets exactly one pick. */
export function totalPicks(state: DraftState): number {
  return state.order.length * slotTotal(state.slots);
}

export function createDraft(input: CreateDraftInput): DraftState {
  const { order, slots, pickSeconds, board } = input;
  if (order.length === 0) {
    throw new DomainError('invalid-draft-state', 'a draft needs at least one seat in the order');
  }
  if (new Set(order).size !== order.length) {
    throw new DomainError(
      'invalid-draft-state',
      'a manager cannot hold two seats in the draft order',
    );
  }
  if (!Number.isInteger(pickSeconds) || pickSeconds < 1) {
    throw new DomainError(
      'invalid-draft-state',
      `the pick clock must be a positive whole number of seconds, got ${pickSeconds}`,
    );
  }
  if (new Set(board.map((ref) => ref.playerId)).size !== board.length) {
    throw new DomainError('invalid-draft-state', 'the draft board has duplicate player ids');
  }
  const needed = order.length * slotTotal(slots);
  if (board.length < needed) {
    throw new DomainError(
      'invalid-draft-state',
      `the board has ${board.length} players but the draft needs ${needed} to fill every roster slot`,
    );
  }
  return {
    status: 'pending',
    order: [...order],
    picks: [],
    pickSeconds,
    deadline: null,
    slots: { ...slots },
    board: [...board],
  };
}

export function startDraft(state: DraftState, now: number): DraftState {
  if (state.status !== 'pending') {
    throw new DomainError('invalid-draft-state', `cannot start a draft that is ${state.status}`);
  }
  return { ...state, status: 'live', deadline: now + state.pickSeconds * 1000 };
}

function positionOf(state: DraftState, playerId: string): Position {
  const ref = state.board.find((candidate) => candidate.playerId === playerId);
  if (!ref) {
    throw new DomainError('unknown-player', `player "${playerId}" is not on the draft board`);
  }
  return ref.position;
}

/**
 * Slot usage, derived by greedily replaying a manager's pick sequence: each
 * pick fills an exact position slot when one is open, else FLEX (RB/WR/TE
 * only). A count shortcut (flexCapable − exact capacity) cannot say this — it
 * lets a WR overflow into FLEX while a TE slot sits open, then lets a later
 * RB claim that same FLEX. Replay is the only honest accounting.
 */
function slotUsage(mine: readonly Position[], slots: RosterSlots): Record<SlotKey, number> {
  const used: Record<SlotKey, number> = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  for (const position of mine) {
    if (used[position] < slots[position]) {
      used[position] += 1;
    } else if (FLEX_ELIGIBLE.includes(position) && used.FLEX < slots.FLEX) {
      used.FLEX += 1;
    }
  }
  return used;
}

function fitsRosterSlot(
  mine: readonly Position[],
  slots: RosterSlots,
  position: Position,
): boolean {
  const used = slotUsage(mine, slots);
  if (used[position] < slots[position]) return true;
  return FLEX_ELIGIBLE.includes(position) && used.FLEX < slots.FLEX;
}

export function onTheClock(state: DraftState, overall: number): ManagerId {
  const seats = state.order.length;
  const total = totalPicks(state);
  if (!Number.isInteger(overall) || overall < 1 || overall > total) {
    throw new DomainError(
      'invalid-pick-number',
      `overall pick ${overall} is outside this draft's 1..${total}`,
    );
  }
  const zero = overall - 1;
  const round = Math.floor(zero / seats);
  const indexInRound = zero % seats;
  // Even rounds walk the order forward, odd rounds walk it backward.
  const seat = state.order[round % 2 === 0 ? indexInRound : seats - 1 - indexInRound]!;
  return seat;
}

function commitPick(state: DraftState, who: ManagerId, playerId: string, now: number): DraftState {
  const picks = [
    ...state.picks,
    { overall: state.picks.length + 1, managerId: who, playerId, at: new Date(now).toISOString() },
  ];
  const complete = picks.length === totalPicks(state);
  return {
    ...state,
    picks,
    status: complete ? 'complete' : 'live',
    deadline: complete ? null : now + state.pickSeconds * 1000,
  };
}

export function applyPick(state: DraftState, pick: PlayerPick, now: number): PickResult {
  if (state.status !== 'live') return { ok: false, reason: 'not-your-turn' };
  const who = onTheClock(state, state.picks.length + 1);
  if (pick.managerId !== who) return { ok: false, reason: 'not-your-turn' };
  // A pick exactly at the deadline beats the buzzer; one ms later is too late
  // — only resolveDeadline may answer an expired clock.
  if (state.deadline !== null && now > state.deadline) {
    return { ok: false, reason: 'clock-expired' };
  }
  const position = positionOf(state, pick.playerId);
  const taken = new Set(state.picks.map((p) => p.playerId));
  if (taken.has(pick.playerId)) return { ok: false, reason: 'player-taken' };
  const mine = state.picks
    .filter((p) => p.managerId === who)
    .map((p) => positionOf(state, p.playerId));
  if (!fitsRosterSlot(mine, state.slots, position)) {
    return { ok: false, reason: 'duplicate-roster-slot' };
  }
  return { ok: true, next: commitPick(state, who, pick.playerId, now) };
}

export function resolveDeadline(state: DraftState, queues: QueueMap, now: number): DraftState {
  // Not expired (or nothing in flight): a no-op, returning the same reference
  // so the fast-forward loop can detect termination by identity.
  if (state.status !== 'live' || state.deadline === null || now <= state.deadline) {
    return state;
  }
  const who = onTheClock(state, state.picks.length + 1);
  const taken = new Set(state.picks.map((p) => p.playerId));
  const mine = state.picks
    .filter((p) => p.managerId === who)
    .map((p) => positionOf(state, p.playerId));
  const rosterable = (playerId: string): boolean =>
    state.board.some((ref) => ref.playerId === playerId) &&
    !taken.has(playerId) &&
    fitsRosterSlot(mine, state.slots, positionOf(state, playerId));
  // The queue's top available player; ghost, taken, and unrosterable entries
  // are skipped. An empty (or unusable) queue falls back to best-available.
  const fromQueue = (queues[who] ?? []).find(rosterable);
  const choice = fromQueue ?? state.board.find((ref) => rosterable(ref.playerId))?.playerId;
  if (!choice) {
    throw new DomainError(
      'no-autopick-available',
      `no rosterable player remains for the seat on the clock (${who}) — the draft cannot continue`,
    );
  }
  return commitPick(state, who, choice, now);
}
