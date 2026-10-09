import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '@stakehouse/domain';
import { statusForDomain } from './errorMapping';

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

/**
 * Domain rejections carry their own machine codes; the status each earns is
 * decided by the single table in errorMapping.ts. Most domain rejections are
 * already translated by the routes that call them; these are the ones a
 * route lets propagate because the mapping is global, not route-specific.
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
    res.status(statusForDomain(err.code)).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error('UNEXPECTED_API_ERROR', err);
  res.status(500).json({ error: { code: 'internal-error', message: 'unexpected server error' } });
}
