import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SessionInput } from '@stakehouse/api-client';
import { useApi } from '../state/ApiContext';
import { clearStoredSession, loadStoredSession, storeSession } from './sessionStorage';

export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';

export interface SessionHandle {
  status: SessionStatus;
  user: SessionInput | null;
  /** Signs in (or re-signs) and persists the identity locally. */
  signIn(input: { displayName: string; email: string }): Promise<SessionInput>;
  /** Forgets the local identity; the next action re-signs from the form. */
  switchManager(): void;
}

const SessionContext = createContext<SessionHandle | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [user, setUser] = useState<SessionInput | null>(null);
  const [status, setStatus] = useState<SessionStatus>('restoring');

  // Boot restore: a stored identity re-signs the idempotent session route,
  // which re-issues the httpOnly cookie the SPA cannot read for itself.
  useEffect(() => {
    const stored = loadStoredSession();
    if (!stored) {
      setStatus('signedOut');
      return;
    }
    let cancelled = false;
    api
      .signIn(stored)
      .then((restored) => {
        if (cancelled) return;
        setUser(restored);
        setStatus('signedIn');
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredSession();
        setStatus('signedOut');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const signIn = useCallback(
    async (input: { displayName: string; email: string }) => {
      const signedIn = await api.signIn(input);
      storeSession(signedIn);
      setUser(signedIn);
      setStatus('signedIn');
      return signedIn;
    },
    [api],
  );

  const switchManager = useCallback(() => {
    clearStoredSession();
    setUser(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, switchManager }),
    [status, user, signIn, switchManager],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionHandle {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return session;
}
