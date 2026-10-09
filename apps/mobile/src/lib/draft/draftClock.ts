/**
 * Countdown math for the server-owned pick clock. The ONLY anchor is the
 * server's absolute deadline (epoch ms): every read recomputes
 * `deadline - now` — no local elapsed-time accumulation, which is what RN
 * timers drift on. A resync (foreground, reload, or a fresh server event)
 * replaces the deadline wholesale; nothing here ever counts ticks.
 */

export interface ClockReading {
  remainingMs: number;
  expired: boolean;
}

export function readClock(deadline: number, nowMs: number): ClockReading {
  const remainingMs = deadline - nowMs;
  return { remainingMs, expired: remainingMs <= 0 };
}

/** m:ss for the room's clock face; negative readings clamp to zero. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * True when the room should ask the server to resolve the clock: expiry plus
 * a small grace window so the client never fires before the server's own
 * deadline arithmetic would.
 */
export function isAutopickDue(deadline: number | null, nowMs: number, graceMs: number): boolean {
  return deadline !== null && nowMs > deadline + graceMs;
}
