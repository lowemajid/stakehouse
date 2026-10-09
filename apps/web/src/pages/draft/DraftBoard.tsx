import type { DraftView } from '@stakehouse/api-client';
import { Button, Table } from '../../components/ui';

/**
 * The live board: the server's ranked available players, best first. The
 * Draft button arms only on your turn — the server re-guards every pick, so
 * a stale turn costs a reason, never a wrong roster.
 */
export function DraftBoard({
  draft,
  myTurn,
  onPick,
  onQueue,
}: {
  draft: DraftView;
  myTurn: boolean;
  onPick: (playerId: string) => void;
  onQueue: (playerId: string) => void;
}) {
  return (
    <Table
      caption="Available players — best available first"
      columns={[
        { key: 'name', header: 'Player' },
        { key: 'position', header: 'Pos' },
        { key: 'projected', header: 'Proj', numeric: true },
        { key: 'actions', header: '' },
      ]}
      rows={draft.board.slice(0, 25).map((entry) => ({
        name: entry.name,
        position: entry.position,
        projected: entry.projectedPoints.toFixed(1),
        actions: (
          <span className="sh-draft__row-actions">
            <Button
              variant="primary"
              disabled={!myTurn}
              onClick={() => onPick(entry.playerId)}
              aria-label={`Draft ${entry.name}`}
            >
              Draft
            </Button>
            <Button
              variant="secondary"
              onClick={() => onQueue(entry.playerId)}
              aria-label={`Queue ${entry.name}`}
            >
              Queue
            </Button>
          </span>
        ),
      }))}
    />
  );
}
