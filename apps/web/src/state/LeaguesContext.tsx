import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LeagueView } from '@stakehouse/api-client';
import type { LeagueConfig } from '@stakehouse/domain';
import { ApiError } from '@stakehouse/api-client';
import { useApi } from './ApiContext';

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; error: ApiError; message: string };

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message.length > 0 ? error.message : 'Something went wrong. Try again.';
  }
  return 'Something went wrong. Try again.';
}

export interface LeaguesHandle {
  leagues: Loadable<LeagueView[]>;
  /** Creates a league and returns it; throws ApiError with field detail. */
  createLeague(input: LeagueConfig): Promise<LeagueView>;
  /** Refreshes the lobby list from the server. */
  reload(): void;
}

const LeaguesContext = createContext<LeaguesHandle | null>(null);

/** Any thrown value becomes the one client-side failure type. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, 'unknown', describeError(error));
}

export function LeaguesProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [leagues, setLeagues] = useState<Loadable<LeagueView[]>>({ state: 'loading' });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLeagues({ state: 'loading' });
    api
      .listLeagues()
      .then((value) => {
        if (!cancelled) setLeagues({ state: 'ready', value });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLeagues({ state: 'error', error: toApiError(error), message: describeError(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, reloadTick]);

  const createLeague = useCallback(
    async (input: LeagueConfig) => {
      const created = await api.createLeague(input);
      setReloadTick((tick) => tick + 1); // the lobby refetches; server stays the truth
      return created;
    },
    [api],
  );

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  const value = useMemo(() => ({ leagues, createLeague, reload }), [leagues, createLeague, reload]);

  return <LeaguesContext.Provider value={value}>{children}</LeaguesContext.Provider>;
}

export function useLeagues(): LeaguesHandle {
  const leagues = useContext(LeaguesContext);
  if (!leagues) {
    throw new Error('useLeagues must be used inside <LeaguesProvider>');
  }
  return leagues;
}
