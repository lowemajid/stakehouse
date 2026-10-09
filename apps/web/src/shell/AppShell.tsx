import type { ReactNode } from 'react';
import { Panel } from '../components/ui';
import { navigateTo, parsePath, useRoute } from '../router/route';
import { useLeagues } from '../state/LeaguesContext';
import { useSession } from '../session/SessionContext';
import { CreateLeaguePage } from '../pages/CreateLeaguePage';
import { LeaguePage } from '../pages/LeaguePage';
import { LobbyPage } from '../pages/LobbyPage';
import { SignInPage } from '../pages/SignInPage';
import './shell.css';

/** An anchor that navigates through the history router, not the browser. */
export function ShellLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        navigateTo(parsePath(href));
      }}
    >
      {children}
    </a>
  );
}

/** The league switcher: the house's leagues as a plain select. */
function LeagueSwitcher() {
  const { leagues } = useLeagues();
  const route = useRoute();
  const currentLeagueId = route.name === 'league' ? route.leagueId : '';
  const ready = leagues.state === 'ready';

  return (
    <select
      aria-label="League switcher"
      value={currentLeagueId}
      onChange={(event) => {
        const id = event.target.value;
        if (id.length > 0) navigateTo({ name: 'league', leagueId: id, tab: 'overview' });
      }}
    >
      <option value="">The floor</option>
      {ready
        ? leagues.value.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))
        : null}
    </select>
  );
}

/** The session area: sign-in offer when signed out, the identity when not. */
function SessionArea() {
  const { status, user } = useSession();
  if (status === 'restoring') {
    return <span className="sh-shell__session sh-muted">Checking the list…</span>;
  }
  if (user) {
    return <span className="sh-shell__session">Signed in as {user.displayName}</span>;
  }
  return (
    <ShellLink href="/signin" className="sh-shell__session sh-shell__signin">
      Sign in
    </ShellLink>
  );
}

/** Unknown URLs get a way home, never a blank screen. */
function NotFoundPage() {
  return (
    <Panel className="sh-page">
      <h2 className="sh-page__title">That page doesn't exist</h2>
      <p className="sh-muted">The floor you're looking for isn't in this house.</p>
      <ShellLink href="/">Back to the lobby</ShellLink>
    </Panel>
  );
}

function CurrentRoute() {
  const route = useRoute();
  switch (route.name) {
    case 'lobby':
      return <LobbyPage />;
    case 'signIn':
      return <SignInPage />;
    case 'createLeague':
      return <CreateLeaguePage />;
    case 'league':
      return <LeaguePage leagueId={route.leagueId} tab={route.tab} />;
    case 'notFound':
      return <NotFoundPage />;
  }
}

/**
 * The app shell: felt background, wordmark, primary nav, league switcher,
 * session area, and the demo-money notice — every screen mounts inside it.
 */
export function AppShell() {
  return (
    <div className="sh-shell">
      <header className="sh-shell__header">
        <ShellLink href="/" className="sh-shell__brand">
          Stakehouse
        </ShellLink>
        <nav aria-label="Primary">
          <ShellLink href="/" className="sh-shell__navlink">
            Leagues
          </ShellLink>
          <ShellLink href="/leagues/new" className="sh-shell__navlink">
            New league
          </ShellLink>
        </nav>
        <LeagueSwitcher />
        <SessionArea />
      </header>
      <p className="sh-shell__notice">Demo money only — every dollar in this house is simulated.</p>
      <main className="sh-shell__main">
        <CurrentRoute />
      </main>
    </div>
  );
}
