import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { StakehouseApi } from '@stakehouse/api-client';

/**
 * Dependency seam for the API client: the app mounts with the real client;
 * route-level tests inject fakes through the same door.
 */

const ApiContext = createContext<StakehouseApi | null>(null);

export function ApiProvider({ api, children }: { api: StakehouseApi; children: ReactNode }) {
  const value = useMemo(() => api, [api]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): StakehouseApi {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi must be used inside <ApiProvider>');
  }
  return api;
}
