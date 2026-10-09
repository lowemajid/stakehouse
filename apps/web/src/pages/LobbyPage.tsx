import { Money, Panel } from '../components/ui';
import { useLeagues } from '../state/LeaguesContext';

/**
 * The lobby: every league the house knows, with the pot the ledger shows.
 * All numbers are the server's — this page only arranges them.
 */
export function LobbyPage() {
  const { leagues, reload } = useLeagues();

  if (leagues.state === 'loading') {
    return (
      <Panel className="sh-page" title="Leagues">
        <p className="sh-muted" aria-live="polite">
          Walking the floor…
        </p>
      </Panel>
    );
  }

  if (leagues.state === 'error') {
    return (
      <Panel className="sh-page" title="Leagues">
        <p role="alert" className="sh-field__error">
          Couldn't load the leagues — {leagues.message}
        </p>
        <button type="button" className="sh-btn sh-btn--secondary" onClick={reload}>
          Try again
        </button>
      </Panel>
    );
  }

  if (leagues.value.length === 0) {
    return (
      <Panel className="sh-page" title="Leagues">
        <p className="sh-muted">No leagues yet — the floor is empty and the felt is clean.</p>
        <a className="sh-btn sh-btn--primary" href="/leagues/new">
          Create the first league
        </a>
      </Panel>
    );
  }

  return (
    <div className="sh-page">
      <h1 className="sh-page__title">Leagues</h1>
      <ul className="sh-league-list">
        {leagues.value.map((league) => (
          <li key={league.id}>
            <a className="sh-league-card" href={`/leagues/${league.id}`}>
              <Panel>
                <h3 className="sh-league-card__name">{league.name}</h3>
                <div className="sh-league-card__grid">
                  <div>
                    <span className="sh-label">Pool</span>
                    <Money cents={league.poolCents} className="sh-league-card__money" />
                  </div>
                  <div>
                    <span className="sh-label">Buy-in</span>
                    <Money cents={league.config.entryFeeCents} className="sh-league-card__money" />
                  </div>
                  <div>
                    <span className="sh-label">Seats</span>
                    <span className="sh-league-card__seats">
                      {league.seatsFilled} / {league.config.size} seats
                    </span>
                  </div>
                </div>
              </Panel>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
