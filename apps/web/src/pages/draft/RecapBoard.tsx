import { useState } from 'react';
import { ApiError } from '@stakehouse/api-client';
import type { DraftView } from '@stakehouse/api-client';
import { Panel } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { Table } from '../../components/ui/Table';

interface RecapRow {
  overall: number;
  roundPick: string;
  seat: string;
  player: string;
  position: string;
}

/**
 * The complete draft's record: every pick in snake order with seat and player
 * names resolved from the view, plus the handoff — the commissioner starts
 * week 1, everyone else waits for it.
 */
export function RecapBoard({
  draft,
  isCommissioner,
  onStartWeek,
}: {
  draft: DraftView;
  isCommissioner: boolean;
  onStartWeek: () => Promise<void>;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: RecapRow[] = draft.picks.map((pick) => {
    const seat = draft.managers[String(pick.managerId)];
    const player = draft.players[pick.playerId];
    return {
      overall: pick.overall,
      roundPick: `${Math.floor((pick.overall - 1) / draft.order.length) + 1} · ${((pick.overall - 1) % draft.order.length) + 1}`,
      seat: seat?.displayName ?? String(pick.managerId),
      player: player?.name ?? pick.playerId,
      position: player?.position ?? '—',
    };
  });

  async function startWeek(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      await onStartWeek();
    } catch (error) {
      if (error instanceof ApiError) setError(error.message);
      else throw error;
    } finally {
      setStarting(false);
    }
  }

  return (
    <Panel title="Draft complete">
      <Table
        caption="Draft recap"
        columns={[
          { key: 'overall', header: '#', numeric: true },
          { key: 'roundPick', header: 'Round · Pick' },
          { key: 'seat', header: 'Seat' },
          { key: 'player', header: 'Player' },
          { key: 'position', header: 'Pos' },
        ]}
        rows={rows}
      />
      {error ? (
        <p className="sh-form__error" role="alert">
          {error}
        </p>
      ) : null}
      {isCommissioner ? (
        <div className="draft-recap__handoff">
          <Button disabled={starting} onClick={() => void startWeek()}>
            {starting ? 'Starting…' : 'Start week 1'}
          </Button>
          <span className="sh-muted">Simulates the opening week and opens the league.</span>
        </div>
      ) : (
        <p className="sh-muted">Waiting for the commissioner to start week 1.</p>
      )}
    </Panel>
  );
}
