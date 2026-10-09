import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Request } from 'express';
import { HttpError } from './http';

/**
 * Lightweight sign-in: a display name and email, carried in an HMAC-signed
 * cookie. There is no password — this is a demo-money platform — but the
 * signature is real: a tampered cookie fails verification and reads as
 * signed-out, never as another manager.
 */

const COOKIE_NAME = 'sh_session';

export const sessionSchema = z.object({
  displayName: z.string().trim().min(1, 'display name is required').max(80),
  email: z.string().trim().email('a valid email is required'),
});

export type SessionPayload = z.infer<typeof sessionSchema>;

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifySession(
  cookieValue: string | undefined,
  secret: string,
): SessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const given = Buffer.from(mac);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const parsed = sessionSchema.safeParse(
      JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return undefined;
}

export function sessionOf(req: Request, secret: string): SessionPayload | null {
  return verifySession(readSessionCookie(req.headers.cookie), secret);
}

export function requireSession(req: Request, secret: string): SessionPayload {
  const session = sessionOf(req, secret);
  if (!session) {
    throw new HttpError(401, 'unauthorized', 'sign in before calling this route');
  }
  return session;
}

/**
 * A manager's seat id derives from the email's local part — the join response
 * echoes it, and every later call resolves the same seat. Two different
 * addresses with the same local part would collide; for this demo-money
 * platform that collision reads as a re-join (409 already-joined), which is
 * the honest failure for a league of seats.
 */
export function managerIdForEmail(email: string): string {
  const local = email
    .split('@')[0]!
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return `mgr-${local.length > 0 ? local : 'manager'}`;
}
