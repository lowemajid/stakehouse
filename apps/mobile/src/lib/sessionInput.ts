import { sessionInputSchema } from '@stakehouse/api-client';

type SessionInput = { displayName: string; email: string };

/**
 * Client-side mirror of the server's sign-in rules. The server stays the
 * source of truth — this fails fast with field-level messages so the mobile
 * form can mark the right inputs without a round-trip.
 */
export type SessionValidation =
  | { ok: true; value: SessionInput }
  | { ok: false; fieldErrors: Partial<Record<keyof SessionInput, string>> };

export function validateSessionInput(input: SessionInput): SessionValidation {
  const parsed = sessionInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };

  const fieldErrors: SessionValidation extends never
    ? never
    : Partial<Record<keyof SessionInput, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if ((key === 'displayName' || key === 'email') && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return { ok: false, fieldErrors };
}
