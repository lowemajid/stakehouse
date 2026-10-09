import { useEffect, useState } from 'react';
import { ApiError } from '@stakehouse/api-client';
import { Button, Money, Panel, Table, formatCents } from '../components/ui';
import { useApi } from '../state/ApiContext';
import { useLeagues } from '../state/LeaguesContext';
import { useSession } from '../session/SessionContext';
import { ShellLink } from '../shell/AppShell';

export type LeagueTab = 'overview' | 'ledger';

/**
 * What a join/pay action leaves behind. Notes render in an aria-live area —
 * a 409 already-joined/already-paid is the house telling you where you
 * stand, not a failure.
 */
type LeagueActionState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'note'; message: string }
  | { kind: 'error'; message: string };

const LEDGER_COLUMNS = [
  { key: 'at', header: 'When' },
  { key: 'kind', header: 'Kind' },
  { key: 'memo', header: 'Memo' },
  { key: 'amount', header: 'Amount', numeric: true },
] as const;

/** The league's books: every entry and the running pool, straight from the server. */
function LedgerView({ leagueId, refetchKey }: { leagueId: string; refetchKey: number }) {
  const api = useApi();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; ledger: Awaited<ReturnType<typeof api.getLedger>> }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .getLedger(leagueId)
      .then((ledger) => {
        if (alive) setState({ kind: 'ready', ledger });
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'the books would not open',
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [api, leagueId, refetchKey]);

  if (state.kind === 'loading') {
    return (
      <Panel>
        <p className="sh-muted" aria-live="polite">
          Opening the books…
        </p>
      </Panel>
    );
  }
  if (state.kind === 'error') {
    return (
      <Panel>
        <p className="sh-form__error">{state.message}</p>
      </Panel>
    );
  }
  if (state.ledger.entries.length === 0) {
    return (
      <Panel title={<h2 className="sh-league__books-title">The books</h2>}>
        <p className="sh-muted">The books are empty — no money has moved yet.</p>
      </Panel>
    );
  }
  return (
    <Panel title={<h2 className="sh-league__books-title">The books</h2>}>
      <Table
        columns={[...LEDGER_COLUMNS]}
        rows={state.ledger.entries.map((entry) => ({
          at: new Date(entry.at).toLocaleString(),
          kind: entry.kind,
          memo: entry.memo,
          amount: formatCents(entry.amountCents),
        }))}
      />
      <p className="sh-league__pool-row">
        <span>Pool total</span>
        <Money cents={state.ledger.poolCents} />
      </p>
    </Panel>
  );
}

function presetName(reception: number): string {
  if (reception === 0.5) return 'Half-PPR';
  if (reception === 1) return 'Full PPR';
  return 'Standard scoring';
}

/**
 * One league: the pot, the seats, join and the demo checkout on the
 * overview tab; the books on the ledger tab. Everything rendered is what
 * the server said last.
 */
export function LeaguePage({ leagueId, tab }: { leagueId: string; tab: LeagueTab }) {
  const { leagues, reload } = useLeagues();
  const { user } = useSession();
  const api = useApi();
  const [action, setAction] = useState<LeagueActionState>({ kind: 'idle' });
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [ledgerRefetch, setLedgerRefetch] = useState(0);

  const league =
    leagues.state === 'ready' ? leagues.value.find((l) => l.id === leagueId) : undefined;
  const seatsOpen = league ? league.seatsFilled < league.config.size : false;

  async function join() {
    setAction({ kind: 'busy' });
    try {
      await api.joinLeague(leagueId);
      await reload();
      setAction({
        kind: 'note',
        message: user
          ? `You hold a seat in this league, ${user.displayName} — the buy-in is due before kickoff.`
          : 'You hold a seat in this league.',
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'already-joined') {
        setAction({ kind: 'note', message: 'You hold a seat in this league.' });
      } else if (error instanceof ApiError && error.code === 'league-full') {
        setAction({ kind: 'note', message: 'every seat is taken' });
      } else if (error instanceof ApiError) {
        setAction({ kind: 'error', message: error.message });
      } else {
        throw error;
      }
    }
  }

  async function pay() {
    setAction({ kind: 'busy' });
    try {
      const result = await api.payBuyIn(leagueId);
      await reload();
      setLedgerRefetch((count) => count + 1);
      setCheckoutOpen(false);
      setAction({
        kind: 'note',
        message: `Buy-in recorded — the pool stands at ${formatCents(result.poolCents)}.`,
      });
    } catch (error) {
      setCheckoutOpen(false);
      if (error instanceof ApiError && error.code === 'already-paid') {
        setAction({ kind: 'note', message: error.message });
      } else if (error instanceof ApiError) {
        setAction({ kind: 'error', message: error.message });
      } else {
        throw error;
      }
    }
  }

  if (leagues.state === 'ready' && !league) {
    return (
      <div className="sh-page">
        <h1 className="sh-page__title">Couldn't find that league</h1>
        <p className="sh-muted">The floor you're looking for isn't in this house.</p>
        <ShellLink href="/">Back to the lobby</ShellLink>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="sh-page">
        <p className="sh-muted" aria-live="polite">
          Fetching the league…
        </p>
      </div>
    );
  }

  const config = league.config;
  return (
    <div className="sh-page">
      <h1 className="sh-page__title">{league.name}</h1>
      <nav className="sh-league__tabs" aria-label="League views">
        <ShellLink
          href={`/leagues/${league.id}`}
          className={tab === 'overview' ? 'sh-league__tab sh-league__tab--on' : 'sh-league__tab'}
        >
          Overview
        </ShellLink>
        <ShellLink
          href={`/leagues/${league.id}/ledger`}
          className={tab === 'ledger' ? 'sh-league__tab sh-league__tab--on' : 'sh-league__tab'}
        >
          The books
        </ShellLink>
      </nav>

      {tab === 'overview' ? (
        <>
          <Panel title="The pot" tone="raised">
            <dl className="sh-league__facts">
              <div>
                <dt>Pool</dt>
                <dd>
                  <Money cents={league.poolCents} />
                </dd>
              </div>
              <div>
                <dt>Buy-in</dt>
                <dd>
                  <Money cents={config.entryFeeCents} />
                </dd>
              </div>
              <div>
                <dt>Seats</dt>
                <dd>
                  {league.seatsFilled} / {config.size} seats
                </dd>
              </div>
              <div>
                <dt>Scoring</dt>
                <dd>{presetName(config.scoring.reception)}</dd>
              </div>
              <div>
                <dt>Payouts</dt>
                <dd>
                  {config.payoutSplitPct[0]} / {config.payoutSplitPct[1]} /{' '}
                  {config.payoutSplitPct[2]}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Your seat">
            {!user ? (
              <p>
                <ShellLink href="/signin">Sign in to join or pay</ShellLink>
              </p>
            ) : (
              <div className="sh-league__actions">
                {seatsOpen ? (
                  <Button onClick={() => void join()} disabled={action.kind === 'busy'}>
                    Join this league
                  </Button>
                ) : (
                  <p className="sh-muted">Every seat is taken.</p>
                )}
                <Button variant="secondary" onClick={() => setCheckoutOpen(true)}>
                  Pay the buy-in — {formatCents(config.entryFeeCents)}
                </Button>
              </div>
            )}
            <div aria-live="polite">
              {action.kind === 'note' ? <p className="sh-league__note">{action.message}</p> : null}
              {action.kind === 'error' ? <p className="sh-form__error">{action.message}</p> : null}
            </div>
          </Panel>

          {checkoutOpen && user ? (
            <Panel title="Demo checkout" tone="raised" className="sh-checkout">
              <p className="sh-checkout__label">
                This is simulated — no real money changes hands, ever. Confirming records a
                simulated buy-in of {formatCents(config.entryFeeCents)} on the league's books.
              </p>
              <div className="sh-league__actions">
                <Button onClick={() => void pay()} disabled={action.kind === 'busy'}>
                  {action.kind === 'busy' ? 'Recording…' : 'Record simulated buy-in'}
                </Button>
                <Button variant="secondary" onClick={() => setCheckoutOpen(false)}>
                  Cancel
                </Button>
              </div>
            </Panel>
          ) : null}
        </>
      ) : (
        <LedgerView leagueId={leagueId} refetchKey={ledgerRefetch} />
      )}
    </div>
  );
}
