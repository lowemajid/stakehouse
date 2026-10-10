import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LedgerEntryView, LeagueView, StakehouseClient } from '@stakehouse/api-client';
import { cents, payoutPlan } from '@stakehouse/domain';
import { Button, Money, Panel, formatCents } from '../components/ui';
import { useApi } from '../state/ApiContext';
import { useSession } from '../session/SessionContext';

/**
 * The books: the league's full transaction history. Every number on this
 * screen is server-derived — entries arrive paired with the balance after
 * them, the pool total is the server's own derived balance, and the screen
 * only renders. New rows slide in when money moves: the commissioner's
 * actions refetch in place, genuinely-new entry ids animate, first paint
 * does not.
 *
 * The money desk sits above the books for the commissioner only: distribute
 * the pot, credit it, refund a seat, or void the league. Every desk action
 * posts through the client and refetches — the ledger stays the only source
 * of truth, and the new rows stagger in from that refetch.
 */

type LedgerResult = Awaited<ReturnType<StakehouseClient['getLedger']>>;

type BooksState =
  | { kind: 'loading' }
  | { kind: 'ready'; ledger: LedgerResult; freshIds: string[] }
  | { kind: 'error'; message: string };

const KIND_LABELS: Record<string, string> = {
  'buy-in': 'Buy-in',
  refund: 'Refund',
  payout: 'Payout',
  'commissioner-credit': 'Commissioner credit',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

interface BooksRow {
  id: string;
  at: string;
  kind: string;
  who: string;
  memo: string;
  amount: ReactNode;
  balance: ReactNode;
}

/** One deliberate void: an unset cell renders as a dash, never an empty string. */
const DASH = '—';

interface EnteredRow extends BooksRow {
  entered: boolean;
  staggerIndex: number;
}

function booksRow(
  entry: LedgerEntryView,
  seatNames: ReadonlyMap<string, string>,
  entered: boolean,
  staggerIndex: number,
): EnteredRow {
  return {
    id: entry.id,
    at: new Date(entry.at).toLocaleString(),
    kind: kindLabel(entry.kind),
    who:
      entry.managerId === null ? 'the house' : (seatNames.get(entry.managerId) ?? entry.managerId),
    memo: entry.memo,
    amount: <Money cents={entry.amountCents} />,
    balance:
      entry.balanceAfterCents === undefined ? DASH : <Money cents={entry.balanceAfterCents} />,
    entered,
    staggerIndex,
  };
}

/** Records the ids just seen and returns the ones that are genuinely new. */
function markSeen(seen: { current: Set<string> | null }, ids: string[]): string[] {
  if (seen.current === null) {
    seen.current = new Set(ids);
    return [];
  }
  const fresh = ids.filter((id) => !seen.current!.has(id));
  for (const id of fresh) seen.current.add(id);
  return fresh;
}

/**
 * Desk action state. `voided` mirrors a cancellation this viewer just made —
 * the league prop still carries the old view until the leagues reload, so
 * the desk remembers its own last act.
 */
type DeskState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'confirm-cancel' }
  | { kind: 'voided' }
  | { kind: 'error'; message: string };

/** Parses a dollars string into integer cents; null when not a positive amount. */
function parseDollarsToCents(input: string): number | null {
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const cents = Math.round(parsed * 100);
  return cents > 0 ? cents : null;
}

function MoneyDesk({
  league,
  ledger,
  refresh,
}: {
  league: LeagueView;
  ledger: LedgerResult;
  refresh: () => void;
}) {
  const api = useApi();
  const [state, setState] = useState<DeskState>({ kind: 'idle' });
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const plan = useMemo(
    // cents() re-validates the wire number at the trust boundary — never a cast.
    () => payoutPlan(cents(ledger.poolCents), league.config.payoutSplitPct),
    [ledger.poolCents, league.config.payoutSplitPct],
  );

  async function run(action: () => Promise<void>): Promise<void> {
    setState({ kind: 'busy' });
    try {
      await action();
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'the desk refused that',
      });
    }
  }

  const busy = state.kind === 'busy';

  if (state.kind === 'voided') {
    return (
      <Panel>
        <p className="sh-desk__voided" role="status">
          This league was voided — every paid seat's money went back. The books below stay readable.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={<h2 className="sh-league__books-title">The money desk</h2>}>
      <div className="sh-desk">
        <div className="sh-desk__pool">
          <span className="sh-muted">In the pot</span>
          <span className="sh-desk__pool-amount">
            <Money cents={ledger.poolCents} />
          </span>
        </div>

        {ledger.poolCents > 0 ? (
          <div className="sh-desk__split">
            <p className="sh-muted">On distribution — the configured split, to the cent:</p>
            <ul className="sh-desk__split-list">
              {plan.map((payout) => (
                <li key={payout.place}>
                  {`${payout.place === 1 ? '1st' : payout.place === 2 ? '2nd' : '3rd'} — ${formatCents(payout.amountCents)}`}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="sh-muted">The pot is empty — winners paid in full.</p>
        )}

        <div className="sh-desk__actions">
          <Button
            onClick={() =>
              run(async () => {
                await api.distributePayouts(league.id);
                setState({ kind: 'idle' });
                refresh();
              })
            }
            disabled={busy || ledger.poolCents === 0}
          >
            Empty the pot — pay the winners
          </Button>
        </div>

        <form
          className="sh-form sh-desk__credit"
          onSubmit={(event) => {
            event.preventDefault();
            const cents = parseDollarsToCents(amount);
            if (cents === null) {
              setState({ kind: 'error', message: 'Enter a positive amount.' });
              return;
            }
            void run(async () => {
              await api.creditPool(league.id, { amountCents: cents, memo: memo || undefined });
              setAmount('');
              setMemo('');
              setState({ kind: 'idle' });
              refresh();
            });
          }}
        >
          {state.kind === 'error' && <p className="sh-form__error">{state.message}</p>}
          <div className="sh-desk__credit-fields">
            <label htmlFor="desk-amount">Credit amount (dollars)</label>
            <input
              id="desk-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="5.00"
            />
            <label htmlFor="desk-memo">Memo (optional)</label>
            <input
              id="desk-memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="season-opening promo"
            />
            <Button type="submit" disabled={busy}>
              Credit the pool
            </Button>
          </div>
        </form>

        <div className="sh-desk__seats">
          <h3 className="sh-desk__seats-title">Seats and what they hold</h3>
          <ul className="sh-desk__seat-list">
            {ledger.seats.map((seat) => (
              <li key={seat.id} className="sh-desk__seat">
                <span>{seat.displayName}</span>
                <span className="sh-desk__seat-net">
                  <Money cents={seat.paidCents} />
                </span>
                {seat.paidCents > 0 && (
                  <Button
                    variant="secondary"
                    aria-label={`Return ${seat.displayName}'s net`}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.refundSeat(league.id, seat.id);
                        setState({ kind: 'idle' });
                        refresh();
                      })
                    }
                  >
                    Return
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="sh-desk__danger">
          {state.kind === 'confirm-cancel' ? (
            <div className="sh-desk__confirm" role="alertdialog" aria-label="Void this league">
              <p>
                Voiding closes the books and returns every paid seat's net — to the cent. This
                cannot be undone.
              </p>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.cancelLeague(league.id);
                    setState({ kind: 'voided' });
                    refresh();
                  })
                }
              >
                Yes — void it and refund everyone
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setState({ kind: 'idle' })}
              >
                Keep the league open
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => setState({ kind: 'confirm-cancel' })}
            >
              Void the league
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function LedgerPage({
  league,
  refetchKey = 0,
}: {
  league: LeagueView;
  refetchKey?: number;
}) {
  const api = useApi();
  const { user } = useSession();
  const [state, setState] = useState<BooksState>({ kind: 'loading' });
  // Entry ids seen on the previous load — the difference is what animates.
  const seenRef = useRef<Set<string> | null>(null);
  // Desk actions refetch the books in place.
  const [reload, setReload] = useState(0);
  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api
      .getLedger(league.id)
      .then((ledger) => {
        if (!alive) return;
        const freshIds = markSeen(
          seenRef,
          ledger.entries.map((entry) => entry.id),
        );
        setState({ kind: 'ready', ledger, freshIds });
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
  }, [api, league.id, refetchKey, reload]);

  const seatNames = useMemo(() => {
    if (state.kind !== 'ready') return new Map<string, string>();
    return new Map(state.ledger.seats.map((seat) => [seat.id, seat.displayName]));
  }, [state]);

  const isVoided = league.cancelledAt !== null;
  const isCommissioner =
    !isVoided && league.commissionerEmail !== null && user?.email === league.commissionerEmail;

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

  const voidedNotice = isVoided ? (
    <Panel>
      <p className="sh-desk__voided" role="status">
        This league was voided on {new Date(league.cancelledAt!).toLocaleString()} — every paid
        seat's money went back. The books stay readable.
      </p>
    </Panel>
  ) : null;

  const desk = isCommissioner ? (
    <MoneyDesk league={league} ledger={state.ledger} refresh={refresh} />
  ) : null;

  const freshIndex = new Map(state.freshIds.map((id, index) => [id, index]));
  const rows = state.ledger.entries.map((entry) =>
    booksRow(entry, seatNames, freshIndex.has(entry.id), freshIndex.get(entry.id) ?? 0),
  );

  if (rows.length === 0) {
    return (
      <>
        {voidedNotice}
        {desk}
        <Panel title={<h2 className="sh-league__books-title">The books</h2>}>
          <p className="sh-muted">The books are empty — no money has moved yet.</p>
        </Panel>
      </>
    );
  }

  return (
    <>
      {voidedNotice}
      {desk}
      <Panel title={<h2 className="sh-league__books-title">The books</h2>}>
        <table className="sh-table sh-books__table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Kind</th>
              <th scope="col">Who</th>
              <th scope="col">Memo</th>
              <th scope="col" className="sh-table__num">
                Amount
              </th>
              <th scope="col" className="sh-table__num">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={row.entered ? 'sh-ledger__row--enter' : undefined}
                style={row.entered ? { animationDelay: `${row.staggerIndex * 120}ms` } : undefined}
              >
                <td>{row.at}</td>
                <td>{row.kind}</td>
                <td>{row.who}</td>
                <td className="sh-books__memo">{row.memo}</td>
                <td className="sh-table__num sh-books__amount">{row.amount}</td>
                <td className="sh-table__num">{row.balance}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="sh-books__pool-label">
                Pool total
              </td>
              <td className="sh-table__num sh-books__pool">
                <Money cents={state.ledger.poolCents} />
              </td>
              <td className="sh-table__num">{DASH}</td>
            </tr>
          </tfoot>
        </table>
      </Panel>
    </>
  );
}
