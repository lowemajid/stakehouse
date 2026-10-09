import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LedgerEntryView, LeagueView, StakehouseClient } from '@stakehouse/api-client';
import { Money, Panel } from '../components/ui';
import { useApi } from '../state/ApiContext';

/**
 * The books: the league's full transaction history. Every number on this
 * screen is server-derived — entries arrive paired with the balance after
 * them, the pool total is the server's own derived balance, and the screen
 * only renders. New rows slide in when money moves: the commissioner's
 * actions refetch in place, genuinely-new entry ids animate, first paint
 * does not.
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

export function LedgerPage({
  league,
  refetchKey = 0,
}: {
  league: LeagueView;
  refetchKey?: number;
}) {
  const api = useApi();
  const [state, setState] = useState<BooksState>({ kind: 'loading' });
  // Entry ids seen on the previous load — the difference is what animates.
  const seenRef = useRef<Set<string> | null>(null);

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
  }, [api, league.id, refetchKey]);

  const seatNames = useMemo(() => {
    if (state.kind !== 'ready') return new Map<string, string>();
    return new Map(state.ledger.seats.map((seat) => [seat.id, seat.displayName]));
  }, [state]);

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

  const freshIndex = new Map(state.freshIds.map((id, index) => [id, index]));
  const rows = state.ledger.entries.map((entry) =>
    booksRow(entry, seatNames, freshIndex.has(entry.id), freshIndex.get(entry.id) ?? 0),
  );

  if (rows.length === 0) {
    return (
      <Panel title={<h2 className="sh-league__books-title">The books</h2>}>
        <p className="sh-muted">The books are empty — no money has moved yet.</p>
      </Panel>
    );
  }

  return (
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
  );
}
