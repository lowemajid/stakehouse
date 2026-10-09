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
