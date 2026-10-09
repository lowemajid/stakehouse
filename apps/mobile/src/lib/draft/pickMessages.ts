import { ApiError } from '@stakehouse/api-client';
import { apiErrorMessage } from '../apiErrors';

/**
 * Every guarded pick rejection gets a room-voiced sentence, not a bare code —
 * the spec's rule that failure cases are part of the product. Unknown codes
 * fall back to the server's own message.
 */
export function pickRejectionMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'not-your-turn':
        return 'It is not your pick — hold your seat.';
      case 'player-taken':
        return 'Gone — another seat just drafted that player.';
      case 'clock-expired':
        return 'The clock beat you — the autopick must resolve first.';
      case 'duplicate-roster-slot':
        return 'No open roster slot fits that position.';
      case 'draft-already-complete':
        return 'The draft has already completed.';
      default:
        return apiErrorMessage(error);
    }
  }
  return apiErrorMessage(error);
}
