import type { StakehouseStore } from '@stakehouse/persistence';
import type { LeagueOpsStore } from './opsStore';
import type { Broadcaster } from './broadcaster';

/**
 * Everything a route module needs, injected — no route reads a clock or a
 * global. Tests substitute the store, the ops store, and the clock; the
 * production app supplies the real ones.
 */
export interface ApiContext {
  readonly store: StakehouseStore;
  readonly ops: LeagueOpsStore;
  /** Server time in epoch ms — the only clock the API layer may read. */
  readonly now: () => number;
  readonly broadcaster: Broadcaster;
  /** HMAC secret for session cookies. */
  readonly cookieSecret: string;
}
