import type { QueueMap } from '@stakehouse/domain';

/**
 * The league-operations seam. Waivers, trade proposals, and draft queues have
 * no repositories in the persistence package yet — this interface gives the
 * API layer its own storage contract today and the AI-managers module (landing
 * in parallel) a place to write proposals tomorrow. The in-memory
 * implementation below is the production default until an SQL-backed ops
 * store lands; like the persistence fakes it clones on read and write so no
 * caller can corrupt stored state through a retained reference.
 */

/** A completed add-drop; ownership follows it from the moment it is saved. */
export interface WaiverRecord {
  id: string;
  leagueId: string;
  managerId: string;
  addPlayerId: string;
  /** Null for adds onto open rosters. */
  dropPlayerId: string | null;
  at: string;
}

/** A trade proposal as stored state — proposed, resolved, or vetoed. */
export interface TradeRecord {
  id: string;
  leagueId: string;
  fromManagerId: string;
  toManagerId: string;
  /** Player ids leaving the proposer, in board order. */
  gives: string[];
  /** Player ids the proposer wants back. */
  wants: string[];
  /** The valuation note shown to the receiving manager. */
  reason: string;
  status: 'proposed' | 'accepted' | 'vetoed' | 'rejected';
  createdAt: string;
  processedAt: string | null;
}

export interface WaiverRepository {
  /** Appends a completed waiver; the latest save is the ownership truth. */
  save(record: WaiverRecord): void;
  /** The league's waiver history, oldest first. */
  list(leagueId: string): WaiverRecord[];
}

export interface TradeRepository {
  save(record: TradeRecord): void;
  list(leagueId: string): TradeRecord[];
}

export interface QueueRepository {
  /** The draft queues for one league, keyed by manager id. */
  get(leagueId: string): QueueMap;
  set(leagueId: string, queues: QueueMap): void;
}

export interface LeagueOpsStore {
  readonly waivers: WaiverRepository;
  readonly trades: TradeRepository;
  readonly queues: QueueRepository;
}

export function createInMemoryOpsStore(): LeagueOpsStore {
  const waivers = new Map<string, WaiverRecord[]>();
  const trades = new Map<string, TradeRecord[]>();
  const queues = new Map<string, QueueMap>();

  const clone = <T>(value: T): T => structuredClone(value);

  return {
    waivers: {
      save(record) {
        const list = waivers.get(record.leagueId) ?? [];
        list.push(clone(record));
        waivers.set(record.leagueId, list);
      },
      list(leagueId) {
        return clone(waivers.get(leagueId) ?? []);
      },
    },
    trades: {
      save(record) {
        const list = trades.get(record.leagueId) ?? [];
        const existing = list.findIndex((t) => t.id === record.id);
        if (existing === -1) list.push(clone(record));
        else list[existing] = clone(record);
        trades.set(record.leagueId, list);
      },
      list(leagueId) {
        return clone(trades.get(leagueId) ?? []);
      },
    },
    queues: {
      get(leagueId) {
        return clone(queues.get(leagueId) ?? {});
      },
      set(leagueId, next) {
        queues.set(leagueId, clone(next));
      },
    },
  };
}
