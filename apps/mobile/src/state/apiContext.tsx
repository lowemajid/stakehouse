import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { StakehouseClient } from '@stakehouse/api-client';

/** The signed-in visitor, as the session endpoint reported them. */
export interface SessionUser {
  displayName: string;
  email: string;
}

interface ApiContextValue {
  client: StakehouseClient;
  user: SessionUser | null;
  setUser(user: SessionUser | null): void;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({
  client,
  children,
}: {
  client: StakehouseClient;
  children: ReactNode;
}): ReactElement {
  const [user, setUser] = useState<SessionUser | null>(null);
  const value = useMemo(() => ({ client, user, setUser }), [client, user]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (value === null) {
    throw new Error('useApi must be used inside ApiProvider');
  }
  return value;
}
