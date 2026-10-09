import { describe, expect, it } from 'vitest';
import {
  pickInRound,
  roundOf,
  secondsRemaining,
  serverOffsetMs,
  shouldAutopick,
} from './draftClock';

describe('draft clock math', () => {
  it('derives the server offset from a heartbeat and its arrival time', () => {
    expect(serverOffsetMs(1_000_500, 1_000_000)).toBe(500);
    expect(serverOffsetMs(999_000, 1_000_000)).toBe(-1000); // server behind is possible
  });

  it('counts seconds left against the offset-corrected local clock', () => {
    // deadline 1_791_230_430_000, server 2s ahead of local 1_791_230_425_000
    expect(secondsRemaining(1_791_230_430_000, 1_791_230_425_000, 2000)).toBeCloseTo(3, 5);
  });

  it('clamps the countdown at zero — no negative clocks', () => {
    expect(secondsRemaining(1_000, 2_000, 0)).toBe(0);
    expect(secondsRemaining(1_000, 2_000, 5_000)).toBe(0);
  });

  it('maps overall picks to rounds and picks-in-round for every size', () => {
    expect(roundOf(1, 12)).toBe(1);
    expect(pickInRound(1, 12)).toBe(1);
    expect(roundOf(12, 12)).toBe(1);
    expect(pickInRound(12, 12)).toBe(12);
    expect(roundOf(13, 12)).toBe(2);
    expect(pickInRound(13, 12)).toBe(1);
    expect(roundOf(4, 3)).toBe(2); // 3-seat league, fourth pick opens round 2
    expect(pickInRound(4, 3)).toBe(1);
  });

  it('holds for the whole snake: pick N+seats always opens the next round', () => {
    for (const seats of [4, 6, 8, 10, 12]) {
      for (const overall of [1, seats, seats + 1, seats * 7, seats * 15 + 3]) {
        const round = roundOf(overall, seats);
        const inRound = pickInRound(overall, seats);
        expect(round).toBeGreaterThan(0);
        expect(inRound).toBeGreaterThanOrEqual(1);
        expect(inRound).toBeLessThanOrEqual(seats);
        expect((round - 1) * seats + inRound).toBe(overall);
      }
    }
  });
});

describe('shouldAutopick — the expiry decision', () => {
  const base = {
    status: 'live' as const,
    deadline: 1_791_230_430_000 as number | null,
    secondsLeft: 0,
    onClockOverall: 7 as number | null,
    alreadyFiredFor: null as number | null,
    mySeatId: 'mgr-marge' as string | null,
    onClockManagerId: 'mgr-ai-1' as string | null,
    autopickOn: true,
  };

  it('fires for an AI seat whose clock has expired', () => {
    expect(shouldAutopick(base)).toBe(true);
  });

  it('never fires while time remains, the clock is unset, or the room is not live', () => {
    expect(shouldAutopick({ ...base, secondsLeft: 0.25 })).toBe(false);
    expect(shouldAutopick({ ...base, deadline: null })).toBe(false);
    expect(shouldAutopick({ ...base, status: 'pending' })).toBe(false);
    expect(shouldAutopick({ ...base, status: 'complete' })).toBe(false);
  });

  it('fires once per pick — the same pick never double-fires', () => {
    expect(shouldAutopick({ ...base, alreadyFiredFor: 7 })).toBe(false);
    expect(shouldAutopick({ ...base, alreadyFiredFor: 6 })).toBe(true);
  });

  it('your seat fires only with your autopick preference on', () => {
    expect(shouldAutopick({ ...base, onClockManagerId: 'mgr-marge', autopickOn: true })).toBe(true);
    expect(shouldAutopick({ ...base, onClockManagerId: 'mgr-marge', autopickOn: false })).toBe(
      false,
    );
  });

  it('a spectator tab keeps the room moving regardless of any preference', () => {
    expect(shouldAutopick({ ...base, mySeatId: null })).toBe(true);
  });
});
