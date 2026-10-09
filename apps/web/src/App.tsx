import type { StakehouseClient } from '@stakehouse/api-client';
import { ApiProvider } from './state/ApiContext';
import { LeaguesProvider } from './state/LeaguesContext';
import { SessionProvider } from './session/SessionContext';
import { AppShell } from './shell/AppShell';
import { api as defaultApi } from './api/client';

/**
 * The web app: API client at the root, session and league state above the
 * shell. Every screen renders what the server says; none computes league
 * state itself. Tests inject a fake through `api`.
 */
export default function App({ api = defaultApi }: { api?: StakehouseClient }) {
  return (
    <ApiProvider api={api}>
      <SessionProvider>
        <LeaguesProvider>
          <AppShell />
        </LeaguesProvider>
      </SessionProvider>
    </ApiProvider>
  );
}
