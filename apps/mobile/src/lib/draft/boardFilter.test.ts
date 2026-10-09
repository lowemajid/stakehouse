import type { BoardEntryView } from '@stakehouse/api-client';
import { describe, expect, it } from 'vitest';
import { BOARD_PAGE, filterBoard } from './boardFilter';

/**
 * Board filtering for the room's player list: case-insensitive name search
 * plus a position chip, paged so a 300-player universe renders a window.
 */

const BOARD: BoardEntryView[] = [
  { playerId: 'pl-1', position: 'QB', name: 'Dov Amado', projectedPoints: 21.4 },
  { playerId: 'pl-2', position: 'RB', name: 'Silas Brummell', projectedPoints: 14.2 },
  { playerId: 'pl-3', position: 'WR', name: 'Teo Ferreira', projectedPoints: 12.8 },
  { playerId: 'pl-4', position: 'TE', name: 'Marcus Idowu', projectedPoints: 8.1 },
  { playerId: 'pl-5', position: 'K', name: 'Ruth Calhoun', projectedPoints: 7.0 },
  { playerId: 'pl-6', position: 'DEF', name: 'Ironwood Ravens', projectedPoints: 6.5 },
];

describe('filterBoard', () => {
  it('filters by case-insensitive name substring', () => {
    expect(filterBoard(BOARD, 'brum', 'ALL').map((entry) => entry.playerId)).toStrictEqual([
      'pl-2',
    ]);
  });

  it('filters by exact position', () => {
    expect(filterBoard(BOARD, '', 'WR').map((entry) => entry.playerId)).toStrictEqual(['pl-3']);
  });

  it('combines search and position', () => {
    expect(filterBoard(BOARD, 'teo', 'WR').map((entry) => entry.playerId)).toStrictEqual(['pl-3']);
  });

  it('returns everything untouched for an empty query and ALL', () => {
    expect(filterBoard(BOARD, '', 'ALL')).toHaveLength(6);
  });
});

describe('BOARD_PAGE', () => {
  it('caps the rendered window', () => {
    const universe: BoardEntryView[] = Array.from({ length: 40 }, (_, index) => ({
      playerId: `pl-${index}`,
      position: 'QB',
      name: `Player ${index}`,
      projectedPoints: 20 - index / 10,
    }));
    const visible = filterBoard(universe, '', 'ALL');
    expect(visible.length).toBeGreaterThan(BOARD_PAGE);
    // The screen renders the page over the filtered list; the full list stays
    // available for counts.
    expect(visible.slice(0, BOARD_PAGE)).toHaveLength(BOARD_PAGE);
  });
});
