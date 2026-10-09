import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '@stakehouse/domain';
import type { DomainErrorCode } from '@stakehouse/domain';

/**
 * The HTTP error envelope: every failure a client sees is
 * `{ error: { code, message, details? } }` — a rejection is never silent and
 * never a naked status code. Domain rejections carry their own machine codes;
 * this layer only decides which status each earns.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The status each domain rejection earns. */
const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
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

/**
 * Domain rejections carry their own machine codes; most are already
 * translated by the routes that call them — these are the ones a route lets
 * propagate because the mapping is global, not route-specific.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation-error',
        message: 'request failed schema validation',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }
  if (err instanceof DomainError) {
    res.status(DOMAIN_STATUS[err.code]).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error('UNEXPECTED_API_ERROR', err);
  res.status(500).json({ error: { code: 'internal-error', message: 'unexpected server error' } });
}
