import type { SessionInput } from '@stakehouse/api-client';

/**
 * Local identity persistence for the demo sign-in. The signed cookie stays
 * httpOnly — the browser can't read it — so the display name and email live
 * here, and restoring a session re-runs the idempotent POST /api/session to
 * re-issue the cookie. Only what the visitor typed about themselves is
 * stored; no league state ever lands in localStorage.
 */

const STORAGE_KEY = 'sh.session';

export function loadStoredSession(): SessionInput | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { displayName?: unknown; email?: unknown };
    if (typeof parsed.displayName !== 'string' || typeof parsed.email !== 'string') return null;
    return { displayName: parsed.displayName, email: parsed.email };
  } catch {
    // Unreadable storage (disabled, corrupted) means signed out — never a crash.
    return null;
  }
}

export function storeSession(user: SessionInput): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable — the session still works for this page load.
  }
}

export function clearStoredSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear without storage.
  }
}
