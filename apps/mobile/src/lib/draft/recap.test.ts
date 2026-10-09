import { describe, expect, it } from 'vitest';
import type { DraftPickView } from '@stakehouse/api-client';
import { groupRecapByRound } from './recap';

function pick(overall: number, playerId: string): DraftPickView {
  return { overall, managerId: `m${overall}`, playerId, at: `2026-01-01T00:00:0${overall % 10}Z` };
}

describe('groupRecapByRound', () => {
  it('groups picks by snake round and preserves overall order inside each round', () => {
    const picks = [pick(1, 'p1'), pick(2, 'p2'), pick(3, 'p3'), pick(4, 'p4'), pick(5, 'p5')];
    const rounds = groupRecapByRound(picks, 3);
    expect(rounds.map((round) => round.round)).toEqual([1, 2]);
    expect(rounds[0]?.picks.map((p) => p.overall)).toEqual([1, 2, 3]);
    expect(rounds[1]?.picks.map((p) => p.overall)).toEqual([4, 5]);
  });

  it('returns an empty recap for an empty board', () => {
    expect(groupRecapByRound([], 4)).toEqual([]);
  });

  it('handles a single seat so the recap never divides by zero', () => {
    const rounds = groupRecapByRound([pick(1, 'p1'), pick(2, 'p2')], 1);
    expect(rounds.map((round) => round.round)).toEqual([1, 2]);
  });
});
