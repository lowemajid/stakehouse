import { ApiError } from '@stakehouse/api-client';

/**
 * The one place a thrown error becomes words for a manager. Server
 * envelopes carry their own message; network failures and unknowns get
 * honest, non-technical copy instead of a stack trace.
 */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network-error') {
      return 'The house is unreachable. Check your connection and try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Try again.';
}
