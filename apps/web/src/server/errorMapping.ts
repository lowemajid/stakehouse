import type { DomainErrorCode, PickRejectionReason } from '@stakehouse/domain';
import { HttpError } from './http';

/**
 * The single error-mapping table. Every failure a client can see is decided
 * here and nowhere else: domain rejection codes → the HTTP status each earns,
 * and the guarded draft matrix → status plus the human message league chat
 * shows. The middleware consults the table for DomainErrors that reach it
 * uncaught; routes raise rejections through `rejectDraft`. One place to read,
 * one place to change.
 */

/** Every domain code → its HTTP status. */
export const DOMAIN_HTTP: Record<DomainErrorCode, number> = {
  // Malformed input — the client sent something the domain cannot parse.
  'not-an-integer': 400,
  'unsafe-integer': 400,
  'money-overflow': 400,
  'empty-id': 400,
  'invalid-timestamp': 400,
  'zero-weights': 400,
  'invalid-payout-split': 400,
  'invalid-scoring-rules': 400,
  'invalid-schedule': 400,
  'invalid-recipients': 400,
  // State-machine violations — the request arrived at the wrong time.
  'invalid-draft-state': 409,
  'invalid-pick-number': 409,
  'invalid-ledger-entry': 409,
  'invalid-lineup': 409,
  'invalid-matchup': 409,
  'invalid-week-result': 409,
  'invalid-bracket': 409,
  'empty-pool': 409,
  // The request named a resource the domain does not know.
  'unknown-player': 404,
  // State conflict — autopick asked for a pick with nothing available.
  'no-autopick-available': 409,
  // Internal invariants — not client-fixable, so they surface as server faults.
  'invalid-stat-line': 500,
  'unknown-scoring-band': 500,
};

/** The HTTP status for a domain rejection that reaches the middleware uncaught. */
export function statusForDomain(code: DomainErrorCode): number {
  return DOMAIN_HTTP[code];
}

/**
 * The guarded draft matrix: the /pick reject reasons plus the lifecycle guard,
 * each with its status and the human message the UI shows the proposer.
 */
export const DRAFT_REJECTIONS: Record<
  PickRejectionReason | 'draft-already-complete',
  { status: number; message: string }
> = {
  'not-your-turn': { status: 409, message: 'it is not your turn to pick' },
  'player-taken': { status: 409, message: 'that player is already on a roster' },
  'clock-expired': {
    status: 409,
    message: 'your pick clock expired — the autopick must resolve first',
  },
  'duplicate-roster-slot': {
    status: 409,
    message: 'that player does not fit any open roster slot',
  },
  'draft-already-complete': { status: 409, message: 'the draft has already completed' },
};

export type DraftRejectionReason = keyof typeof DRAFT_REJECTIONS;

/** Raise the documented HTTP error for a guarded draft rejection. */
export function rejectDraft(reason: DraftRejectionReason): never {
  const mapped = DRAFT_REJECTIONS[reason];
  throw new HttpError(mapped.status, reason, mapped.message);
}
