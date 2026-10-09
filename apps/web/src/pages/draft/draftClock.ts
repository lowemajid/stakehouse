/**
 * Pure clock math for the draft room. The server owns time: the draft view
 * carries the deadline in server-epoch milliseconds and the SSE stream
 * carries server heartbeats. The client only derives a display countdown —
 * every decision (what expires, who picks) is re-asked of the server.
 */

/** Milliseconds by which the server clock leads the local one. */
export function serverOffsetMs(serverNow: number, receivedAt: number): number {
  return serverNow - receivedAt;
}

/** Seconds left on the clock, clamped at zero — fractional so the display can breathe. */
export function secondsRemaining(deadline: number, localNow: number, offsetMs: number): number {
  return Math.max(0, (deadline - (localNow + offsetMs)) / 1000);
}

/** The round an overall pick falls in (1-based). */
export function roundOf(overall: number, seats: number): number {
  return Math.floor((overall - 1) / Math.max(1, seats)) + 1;
}

/** The pick's position inside its round (1-based). */
export function pickInRound(overall: number, seats: number): number {
  return ((overall - 1) % Math.max(1, seats)) + 1;
}

/**
 * Whether this tab should fire the room's expiry autopick. Pure so the
 * decision is testable: AI seats always resolve (they have no hands of
 * their own); your seat fires only when your autopick preference is on; a
 * spectator tab keeps the room moving too.
 */
export function shouldAutopick(input: {
  status: 'pending' | 'live' | 'complete';
  deadline: number | null;
  secondsLeft: number;
  onClockOverall: number | null;
  alreadyFiredFor: number | null;
  mySeatId: string | null;
  onClockManagerId: string | null;
  autopickOn: boolean;
}): boolean {
  if (input.status !== 'live' || input.deadline === null) return false;
  if (input.onClockOverall === null || input.alreadyFiredFor === input.onClockOverall) return false;
  if (input.secondsLeft > 0) return false;
  if (input.mySeatId !== null && input.onClockManagerId === input.mySeatId && !input.autopickOn) {
    return false;
  }
  return true;
}
