import { onTheClock, projectedPoints } from '@stakehouse/domain';
import type {
  DraftState,
  PlayerCard,
  Position,
  RosterSlots,
  ScoringRules,
} from '@stakehouse/domain';
import type { LeagueRecord } from '@stakehouse/persistence';
import type { StakehouseStore } from '@stakehouse/persistence';
import type { LeagueOpsStore } from './opsStore';

/**
 * The draft view: everything a board needs, derived from stored state on every
 * request — picks, waiver-adjusted rosters with slot assignments, queues, and
 * the clock. Nothing about the view is cached: the stored DraftState is the
 * only truth, and the view is a pure function over it plus the universe.
 */

export interface BoardEntry {
  playerId: string;
  position: Position;
  name: string;
  /** Points the player's projection scores under THIS league's rules. */
  projectedPoints: number;
}

export interface RosterSlot {
  playerId: string;
  position: Position;
  slot: string;
}

export interface DraftSeat {
  id: string;
  displayName: string;
  isAi: boolean;
}

export interface DraftView {
  status: DraftState['status'];
  order: string[];
  picks: DraftState['picks'];
  pickSeconds: number;
  board: BoardEntry[];
  clock: { overall: number | null; managerId: string | null; deadline: number | null };
  rosters: Record<string, RosterSlot[]>;
  queues: Record<string, { queue: string[]; autopick: boolean }>;
  /** Seat identity for the room — who is on the clock, and whether they think. */
  seats: DraftSeat[];
  /** Seats by id — names and AI flags every board and recap renders. */
  managers: Record<string, { displayName: string; isAi: boolean }>;
  /** The whole universe by id, so a pick keeps its name after leaving the
   * live board — rosters, the picks feed, and the recap all resolve here. */
  players: Record<string, { name: string; position: Position; projectedPoints: number }>;
  /** The caller's own seat, null when signed out or seatless. */
  you: string | null;
}

const FLEX_ELIGIBLE = new Set<Position>(['RB', 'WR', 'TE']);
const DEFAULT_PICK_SECONDS = 30;

/** Ranks the universe the way the board shows it: projection, then name, then id. */
export function rankedBoard(players: readonly PlayerCard[], scoring: ScoringRules): BoardEntry[] {
  return players
    .map((player) => ({
      playerId: player.id,
      position: player.position,
      name: player.name,
      projectedPoints: projectedPoints(player.projection, scoring),
    }))
    .sort(
      (a, b) =>
        b.projectedPoints - a.projectedPoints ||
        a.name.localeCompare(b.name) ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    );
}

/**
 * Slot assignment by the same greedy replay the engine's guard uses: an open
 * exact-position slot first, else FLEX (RB/WR/TE only). Callers only hand in
 * ownership that already passed a fit check, so this never overflows.
 */
export function assignSlots(
  owned: readonly { playerId: string; position: Position }[],
  slots: RosterSlots,
): RosterSlot[] {
  const used: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  return owned.map(({ playerId, position }) => {
    let slot: string;
    if (used[position]! < slots[position]) {
      used[position]! += 1;
      slot = position;
    } else {
      used.FLEX! += 1;
      slot = 'FLEX';
    }
    return { playerId, position, slot };
  });
}

/**
 * Would `position` fit this manager's would-be roster? Mirrors the engine's
 * `fitsRosterSlot`: exact slot first, FLEX for RB/WR/TE only.
 */
export function fitsRoster(
  owned: readonly { position: Position }[],
  slots: RosterSlots,
  position: Position,
): boolean {
  const used: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  for (const { position: held } of owned) {
    if (used[held]! < slots[held]) used[held]! += 1;
    else if (FLEX_ELIGIBLE.has(held) && used.FLEX! < slots.FLEX) used.FLEX! += 1;
  }
  if (used[position]! < slots[position]) return true;
  return FLEX_ELIGIBLE.has(position) && used.FLEX! < slots.FLEX;
}

export function totalSlots(slots: RosterSlots): number {
  return Object.values(slots).reduce((sum, count) => sum + count, 0);
}

export function buildDraftView(
  store: StakehouseStore,
  ops: LeagueOpsStore,
  league: LeagueRecord,
  youSeatId: string | null = null,
): DraftView {
  const state = store.drafts.get(league.id);
  const config = league.config;
  const universe = new Map(store.players.all().map((player) => [player.id, player]));

  const boardAll = rankedBoard(store.players.all(), config.scoring);
  const pickedIds = new Set((state?.picks ?? []).map((pick) => pick.playerId));
  const board = boardAll.filter((entry) => !pickedIds.has(entry.playerId));

  const managers = store.managers.list(league.id);
  const order = state?.order ?? managers.map((manager) => manager.id);

  // Ownership = draft picks, then the waiver history in order (drop removes,
  // add appends). Waivers re-use the engine's fit rule at save time, so the
  // replayed assignment never overflows a slot.
  const owned = new Map<string, { playerId: string; position: Position }[]>(
    managers.map((manager) => [String(manager.id), []]),
  );
  for (const pick of state?.picks ?? []) {
    const mine = owned.get(String(pick.managerId));
    const card = universe.get(pick.playerId);
    if (mine && card) mine.push({ playerId: pick.playerId, position: card.position });
  }
  for (const waiver of ops.waivers.list(String(league.id))) {
    const mine = owned.get(waiver.managerId);
    if (!mine) continue;
    if (waiver.dropPlayerId !== null) {
      const index = mine.findIndex((slot) => slot.playerId === waiver.dropPlayerId);
      if (index !== -1) mine.splice(index, 1);
    }
    const card = universe.get(waiver.addPlayerId);
    if (card) mine.push({ playerId: waiver.addPlayerId, position: card.position });
  }
  const rosters: Record<string, RosterSlot[]> = {};
  for (const [id, slots] of owned) rosters[id] = assignSlots(slots, config.roster);

  const queueMap = ops.queues.get(String(league.id));
  const queues: Record<string, { queue: string[]; autopick: boolean }> = {};
  for (const id of order) {
    queues[String(id)] = { queue: [...(queueMap[id] ?? [])], autopick: true };
  }

  const seatsById: Record<string, { displayName: string; isAi: boolean }> = {};
  for (const seat of managers) {
    seatsById[String(seat.id)] = { displayName: seat.displayName, isAi: seat.isAi };
  }
  const players: Record<string, { name: string; position: Position; projectedPoints: number }> =
    Object.fromEntries(
      boardAll.map((entry) => [
        entry.playerId,
        { name: entry.name, position: entry.position, projectedPoints: entry.projectedPoints },
      ]),
    );

  const clock =
    state && state.status === 'live'
      ? {
          overall: state.picks.length + 1,
          managerId: String(onTheClock(state, state.picks.length + 1)),
          deadline: state.deadline,
        }
      : { overall: null, managerId: null, deadline: null };

  return {
    status: state?.status ?? 'pending',
    order: order.map(String),
    picks: state?.picks ?? [],
    pickSeconds: state?.pickSeconds ?? DEFAULT_PICK_SECONDS,
    board,
    clock,
    rosters,
    queues,
    seats: managers.map((manager) => ({
      id: String(manager.id),
      displayName: manager.displayName,
      isAi: manager.isAi,
    })),
    managers: seatsById,
    players,
    you: youSeatId,
  };
}
