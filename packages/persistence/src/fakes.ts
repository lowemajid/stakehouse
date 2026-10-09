import type {
  DraftState,
  LedgerEntry,
  LeagueId,
  PlayerCard,
  SeasonResult,
  WeekResult,
} from '@stakehouse/domain';
import type {
  DraftRepository,
  LedgerRepository,
  LeagueRecord,
  LeagueRepository,
  ManagerRecord,
  ManagerRepository,
  PlayerRepository,
  SeasonRepository,
  StakehouseStore,
} from './types';

/**
 * The in-memory fakes: the reference implementation of the contract. Maps with
 * structuredClone on write AND read — storage snapshots its inputs and hands
 * back copies, exactly like a real database would, so a caller can never
 * corrupt a store through a retained reference.
 */
export function createFakeStore(): StakehouseStore {
  const leagues = new Map<string, LeagueRecord>();
  const managers = new Map<string, ManagerRecord>(); // key: `${leagueId}::${id}`
  const entries = new Map<string, LedgerEntry[]>(); // per league, append-only
  const drafts = new Map<string, DraftState>();
  const players = new Map<string, PlayerCard>();
  const weeks = new Map<string, WeekResult[]>(); // per league, ascending by week
  const seasons = new Map<string, SeasonResult>();

  const clone = <T>(value: T): T => structuredClone(value);

  const requireLeague = (leagueId: LeagueId, verb: string): void => {
    if (!leagues.has(String(leagueId))) {
      throw new Error(`cannot store ${verb} for unknown league ${String(leagueId)}`);
    }
  };

  const leaguesRepo: LeagueRepository = {
    create(record) {
      const key = String(record.id);
      if (leagues.has(key)) throw new Error(`league ${key} already exists`);
      leagues.set(key, clone(record));
    },
    get(id) {
      const record = leagues.get(String(id));
      return record ? clone(record) : null;
    },
    list() {
      return [...leagues.values()].map(clone);
    },
  };

  const managersRepo: ManagerRepository = {
    add(record) {
      const leagueKey = String(record.leagueId);
      requireLeague(record.leagueId, 'a manager');
      const key = `${leagueKey}::${String(record.id)}`;
      if (managers.has(key)) {
        throw new Error(`manager ${String(record.id)} already exists in league ${leagueKey}`);
      }
      managers.set(key, clone(record));
    },
    list(leagueId) {
      return [...managers.values()]
        .filter((record) => String(record.leagueId) === String(leagueId))
        .map(clone);
    },
  };

  const ledgerRepo: LedgerRepository = {
    append(leagueId, newEntries) {
      requireLeague(leagueId, 'ledger entries');
      const history = entries.get(String(leagueId)) ?? [];
      for (const candidate of newEntries) {
        if (history.some((existing) => existing.id === candidate.id)) {
          throw new Error(`ledger entry ${candidate.id} already exists in ${String(leagueId)}`);
        }
        history.push(clone(candidate));
      }
      entries.set(String(leagueId), history);
    },
    list(leagueId) {
      return (entries.get(String(leagueId)) ?? []).map(clone);
    },
  };

  const draftsRepo: DraftRepository = {
    save(leagueId, state) {
      requireLeague(leagueId, 'a draft');
      drafts.set(String(leagueId), clone(state));
    },
    get(leagueId) {
      const state = drafts.get(String(leagueId));
      return state ? clone(state) : null;
    },
  };

  const playersRepo: PlayerRepository = {
    upsert(player) {
      players.set(String(player.id), clone(player));
    },
    get(id) {
      const player = players.get(id);
      return player ? clone(player) : null;
    },
    all() {
      return [...players.values()].map(clone);
    },
  };

  const seasonsRepo: SeasonRepository = {
    saveWeek(leagueId, result) {
      requireLeague(leagueId, 'a week result');
      const key = String(leagueId);
      const history = weeks.get(key) ?? [];
      const existing = history.findIndex((saved) => saved.week === result.week);
      if (existing >= 0) history[existing] = clone(result);
      else history.push(clone(result));
      history.sort((a, b) => a.week - b.week);
      weeks.set(key, history);
    },
    listWeeks(leagueId) {
      return (weeks.get(String(leagueId)) ?? []).map(clone);
    },
    saveSeason(leagueId, result) {
      requireLeague(leagueId, 'a season result');
      seasons.set(String(leagueId), clone(result));
    },
    getSeason(leagueId) {
      const result = seasons.get(String(leagueId));
      return result ? clone(result) : null;
    },
  };

  return {
    leagues: leaguesRepo,
    managers: managersRepo,
    ledger: ledgerRepo,
    drafts: draftsRepo,
    players: playersRepo,
    seasons: seasonsRepo,
    close() {
      // In-memory: nothing to release; the store lives until garbage collected.
    },
  };
}
