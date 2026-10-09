import { describe, expect, it } from 'vitest';
import { formatCountdown, isAutopickDue, readClock } from './draftClock';

/**
 * The pick clock's only anchor is the server's absolute deadline. Every read
 * recomputes `deadline - now` — nothing accumulates locally, which is what
 * RN timers drift on. These tests pin that contract.
 */

describe('readClock', () => {
  it('derives remaining time from the deadline, not from elapsed ticks', () => {
    const deadline = 1_000_000;
    // A stalled JS thread "skips" 20 seconds between reads: the read is
    // still exactly deadline - now, never accumulated from tick counts.
    expect(readClock(deadline, 990_000)).toStrictEqual({
      remainingMs: 10_000,
      expired: false,
    });
    expect(readClock(deadline, 1_019_500)).toStrictEqual({
      remainingMs: -19_500,
      expired: true,
    });
  });

  it('is expired at exactly the deadline (the buzzer beats no one)', () => {
    expect(readClock(500, 500).expired).toBe(true);
    expect(readClock(500, 499).expired).toBe(false);
  });
});

describe('formatCountdown', () => {
  it('renders m:ss and clamps negatives to zero', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(59_999)).toBe('0:59');
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(95_000)).toBe('1:35');
    expect(formatCountdown(-3_000)).toBe('0:00');
  });
});

describe('isAutopickDue', () => {
  it('fires only past the deadline plus a grace window', () => {
    const deadline = 100_000;
    expect(isAutopickDue(deadline, 100_000, 250)).toBe(false);
    expect(isAutopickDue(deadline, 100_250, 250)).toBe(false);
    expect(isAutopickDue(deadline, 100_251, 250)).toBe(true);
  });

  it('never fires without a deadline (pending or complete drafts)', () => {
    expect(isAutopickDue(null, 999_999, 250)).toBe(false);
  });
});
