/**
 * The persistence package's runtime surface. The repository contract suite
 * (contract.ts) is deliberately NOT re-exported here: it imports vitest, and
 * any production value import of this package would crash outside a test
 * run. Test suites consume it via the './contract' subpath instead.
 */
export * from './fakes';
export * from './types';
