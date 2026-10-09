import type { BoardEntryView } from '@stakehouse/api-client';
import type { Position } from '@stakehouse/domain';

/**
 * Board filtering for the room's player list: case-insensitive name search
 * plus a position chip, so a 300-player universe renders a window. The full
 * filtered list is returned — the screen pages it with BOARD_PAGE.
 */

export type PositionFilter = Position | 'ALL';

/** How many board rows the room renders per page. */
export const BOARD_PAGE = 15;

export function filterBoard(
  board: readonly BoardEntryView[],
  query: string,
  position: PositionFilter,
): BoardEntryView[] {
  const needle = query.trim().toLowerCase();
  return board.filter(
    (entry) =>
      (position === 'ALL' || entry.position === position) &&
      (needle === '' || entry.name.toLowerCase().includes(needle)),
  );
}
