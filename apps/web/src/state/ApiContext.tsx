import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { StakehouseClient } from '@stakehouse/api-client';

/**
 * Dependency seam for the API client: the app mounts with the real client;
 * route-level tests inject fakes through the same door.
 */

const ApiContext = createContext<StakehouseClient | null>(null);

export function ApiProvider({ api, children }: { api: StakehouseClient; children: ReactNode }) {
  const value = useMemo(() => api, [api]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): StakehouseClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi must be used inside <ApiProvider>');
  }
  return api;
}
