/**
 * Pure league engine — scoring, drafting, simulation, and the ledger land here
 * in upcoming slices. Domain code stays free of I/O: no database, no server,
 * no clock.
 */
export * from './brand';
export * from './draft';
export * from './errors';
export * from './leagueConfig';
export * from './ledger';
export * from './money';
export { hash32, mulberry32, standardNormal, type Rng } from './rng';
export * from './scoring';
export * from './simulation';
// Position is defined identically in draft.ts and scoring.ts (the two slices
// landed concurrently); the explicit re-export resolves the star-export
// ambiguity at the package boundary.
export type { Position } from './scoring';
