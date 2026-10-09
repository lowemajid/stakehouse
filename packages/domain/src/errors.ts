/**
 * The domain's single error type. Domain functions throw `DomainError` with a
 * machine-readable `code` so the HTTP layer can map failures to responses and
 * league chat can show the reason — never a silent rejection.
 */
export type DomainErrorCode =
  | 'not-an-integer'
  | 'unsafe-integer'
  | 'money-overflow'
  | 'empty-id'
  | 'invalid-payout-split'
  | 'invalid-ledger-entry'
  | 'invalid-timestamp'
  | 'zero-weights'
  | 'invalid-draft-state'
  | 'invalid-pick-number'
  | 'unknown-player'
  | 'no-autopick-available'
  | 'invalid-scoring-rules'
  | 'invalid-stat-line'
  | 'unknown-scoring-band'
  | 'invalid-lineup'
  | 'invalid-matchup'
  | 'invalid-schedule'
  | 'invalid-week-result'
  | 'invalid-bracket'
  | 'empty-pool'
  | 'invalid-recipients';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
