import type { DraftView } from '@stakehouse/api-client';
import { Badge, Panel } from '../../components/ui';

/**
 * Every seat with the roster it has landed so far. The seat on the clock is
 * named and — when the seat is an AI manager — shows the thinking state, so
 * an AI turn is visible progress rather than dead air.
 */
export function SeatRosters({ draft }: { draft: DraftView }) {
  const seats = draft.order.filter((id) => draft.managers[id]);
  return (
    <Panel title="Seats & rosters">
      <ul className="sh-draft__seats">
        {seats.map((seatId) => {
          const seat = draft.managers[seatId]!;
          const onClock = draft.clock.managerId === seatId && draft.status === 'live';
          return (
            <li
              key={seatId}
              className={
                'sh-draft__seat' +
                (onClock ? ' sh-draft__seat--on-clock' : '') +
                (onClock && seat.isAi ? ' sh-draft__seat--thinking' : '')
              }
              data-on-clock={onClock ? 'true' : 'false'}
            >
              <div className="sh-draft__seat-head">
                <span className="sh-draft__seat-name">{seat.displayName}</span>
                {seat.isAi ? <Badge tone="neutral">AI</Badge> : null}
                {onClock ? (
                  seat.isAi ? (
                    <Badge tone="active">thinking…</Badge>
                  ) : (
                    <Badge tone="active">on the clock</Badge>
                  )
                ) : null}
              </div>
              <ul className="sh-draft__roster">
                {(draft.rosters[seatId] ?? []).map((slot) => (
                  <li key={`${slot.slot}-${slot.playerId}`} className="sh-draft__roster-slot">
                    <span className="sh-draft__roster-slot-name">
                      {draft.players[slot.playerId]?.name ?? slot.playerId}
                    </span>
                    <span className="sh-draft__roster-slot-pos">
                      {slot.slot} · {slot.position}
                    </span>
                  </li>
                ))}
                {(draft.rosters[seatId] ?? []).length === 0 ? (
                  <li className="sh-muted">no picks yet</li>
                ) : null}
              </ul>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
