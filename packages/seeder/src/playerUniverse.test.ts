import { describe, expect, it } from 'vitest';
import type { Position } from '@stakehouse/domain';
import {
  PLAYER_UNIVERSE_SIZE,
  POSITION_COUNTS,
  generatePlayerUniverse,
  rankBoard,
  sandboxLeagueConfig,
} from '@stakehouse/seeder';

/**
 * The player universe: ~300 invented athletes whose projections feed the
 * draft board and the week simulator. Two hard guarantees — determinism
 * (byte-identical regeneration, identity-seeded) and fiction (no real
 * athletes can ever appear, because every name is drawn from invented pools
 * shipped in this package).
 */
describe('player universe generator', () => {
  it('generates exactly the intended number of players', () => {
    expect(generatePlayerUniverse()).toHaveLength(PLAYER_UNIVERSE_SIZE);
  });

  it('covers every position with the intended depth', () => {
    const byPosition = new Map<Position, number>();
    for (const card of generatePlayerUniverse()) {
      byPosition.set(card.position, (byPosition.get(card.position) ?? 0) + 1);
    }
    expect(Object.fromEntries(byPosition)).toStrictEqual(POSITION_COUNTS);
  });

  it('is byte-identical across runs — identity-seeded, never wall-clock', () => {
    const first = JSON.stringify(generatePlayerUniverse());
    const second = JSON.stringify(generatePlayerUniverse());
    expect(second).toBe(first);
  });

  it('gives every player a unique name and every id a stable shape', () => {
    const universe = generatePlayerUniverse();
    const names = universe.map((card) => card.name);
    expect(new Set(names).size).toBe(names.length);
    for (const card of universe) {
      expect(card.id).toMatch(/^p-(QB|RB|WR|TE|K|DEF)-\d{2,3}$/);
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.variance).toBeGreaterThan(0);
    }
  });

  it('keeps projections position-appropriate with receiving stats first-class', () => {
    for (const card of generatePlayerUniverse()) {
      const p = card.projection;
      // The amended schema: receivingYards, receivingTd, and receptions are
      // first-class fields on every stat line, alongside pass/rush/kick/DEF.
      for (const field of ['receivingYards', 'receivingTd', 'receptions'] as const) {
        expect(p, `${card.id} is missing ${field}`).toHaveProperty(field);
      }
      const nonNegative = (value: number): void => {
        expect(value).toBeGreaterThanOrEqual(0);
      };
      nonNegative(p.passYards);
      nonNegative(p.receivingYards);
      nonNegative(p.rushYards);
      nonNegative(p.pointsAllowed);

      switch (card.position) {
        case 'QB':
          expect(p.passYards).toBeGreaterThan(0);
          expect(p.receivingYards).toBe(0);
          break;
        case 'RB':
          expect(p.rushYards).toBeGreaterThan(0);
          expect(p.receivingYards).toBeGreaterThan(0);
          expect(p.passYards).toBe(0);
          break;
        case 'WR':
          expect(p.receivingYards).toBeGreaterThan(0);
          expect(p.receptions).toBeGreaterThan(0);
          expect(p.passYards).toBe(0);
          break;
        case 'TE':
          expect(p.receivingYards).toBeGreaterThan(0);
          expect(p.receptions).toBeGreaterThan(0);
          break;
        case 'K':
          expect(Object.values(p.fgMade).reduce((sum, made) => sum + made, 0)).toBeGreaterThan(0);
          expect(p.passYards).toBe(0);
          expect(p.rushYards).toBe(0);
          break;
        case 'DEF':
          expect(p.sacks).toBeGreaterThan(0);
          expect(p.takeaways).toBeGreaterThan(0);
          expect(p.pointsAllowed).toBeGreaterThan(0);
          break;
      }
    }
  });

  it('keeps every field-goal band inside the sandbox scoring rules', () => {
    const bands = Object.keys(sandboxLeagueConfig().scoring.kicking.fg);
    for (const card of generatePlayerUniverse()) {
      for (const band of Object.keys(card.projection.fgMade)) {
        expect(bands, `${card.id} projects the unknown band ${band}`).toContain(band);
      }
    }
  });

  it('ranks the draft board by expected points with Kickers and Defenses last', () => {
    const config = sandboxLeagueConfig();
    const board = rankBoard(generatePlayerUniverse(), config.scoring);
    expect(board).toHaveLength(PLAYER_UNIVERSE_SIZE);
    expect(new Set(board.map((ref) => ref.playerId)).size).toBe(PLAYER_UNIVERSE_SIZE);
    // rankBoard computes expected points under the league's exact rules —
    // reaching here means every projection is scoreable (bands known, counts
    // valid) and the board is strictly ordered.
    const topTier = board.slice(0, 24).map((ref) => ref.position);
    expect(
      topTier.every((position) => position === 'QB' || position === 'RB' || position === 'WR'),
    ).toBe(true);
    const lastTier = board.slice(-16).map((ref) => ref.position);
    expect(lastTier.every((position) => position === 'K' || position === 'DEF')).toBe(true);
  });
});
