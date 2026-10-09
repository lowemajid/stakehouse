/**
 * Deterministic randomness primitives. Seeds derive from immutable identity —
 * never wall clock, never array order — so the same inputs always replay to
 * the same stream.
 */

/** The random source contract: a stateful thunk returning [0, 1). */
export type Rng = () => number;

/**
 * The random source for one player's week: mulberry32 seeded by a 32-bit
 * FNV-1a hash of `${leagueId}:${week}:${playerId}`. Because the seed comes
 * from identity alone, the same week always replays to the same stat lines —
 * in tests, in a re-render, and in a dispute in league chat — regardless of
 * iteration order or wall clock.
 */
export function weekRng(leagueId: string, week: number, playerId: string): Rng {
  return mulberry32(hash32(`${leagueId}:${week}:${playerId}`));
}

export function hash32(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV-1a prime
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller over two uniforms — a standard normal with no hidden state. */
export function standardNormal(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}
