import { describe, expect, it } from 'vitest';
import { validateSessionInput } from './sessionInput';

/**
 * Client-side mirror of the server's session rules (apps/web/src/server/
 * sessions.ts): a display name up to 80 chars and a valid email. The server
 * stays the source of truth; this just fails fast with field-level messages.
 */
describe('validateSessionInput', () => {
  it('accepts and trims a valid sign-in', () => {
    const result = validateSessionInput({
      displayName: '  Majid  ',
      email: ' majid@stakehouse.test ',
    });
    expect(result).toEqual({
      ok: true,
      value: { displayName: 'Majid', email: 'majid@stakehouse.test' },
    });
  });

  it('flags a missing display name', () => {
    const result = validateSessionInput({ displayName: '   ', email: 'majid@stakehouse.test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.displayName).toBe('string');
  });

  it('flags a display name past the server limit', () => {
    const result = validateSessionInput({
      displayName: 'x'.repeat(81),
      email: 'majid@stakehouse.test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.displayName).toBe('string');
  });

  it('flags an invalid email', () => {
    const result = validateSessionInput({ displayName: 'Majid', email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.email).toBe('string');
  });
});
