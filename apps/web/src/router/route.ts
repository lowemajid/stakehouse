import { useSyncExternalStore } from 'react';

/**
 * The minimal history router. Paths are the API's own vocabulary; every
 * route is a plain URL the server's SPA fallback can serve cold. Navigation
 * pushes history state and notifies subscribers; popstate (back/forward)
 * flows through the same store.
 */

export type Route =
  | { name: 'lobby' }
  | { name: 'signIn' }
  | { name: 'createLeague' }
  | { name: 'league'; leagueId: string; tab: 'overview' | 'ledger' }
  | { name: 'draft'; leagueId: string }
  | { name: 'notFound' };

export function parsePath(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return { name: 'lobby' };
  if (path === '/signin') return { name: 'signIn' };
  if (path === '/leagues/new') return { name: 'createLeague' };
  const leagueMatch = /^\/leagues\/([^/]+)(\/ledger)?$/.exec(path);
  if (leagueMatch) {
    return {
      name: 'league',
      leagueId: leagueMatch[1]!,
      tab: leagueMatch[2] ? 'ledger' : 'overview',
    };
  }
  const draftMatch = /^\/leagues\/([^/]+)\/draft$/.exec(path);
  if (draftMatch) return { name: 'draft', leagueId: draftMatch[1]! };
  return { name: 'notFound' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'lobby':
      return '/';
    case 'signIn':
      return '/signin';
    case 'createLeague':
      return '/leagues/new';
    case 'league':
      return route.tab === 'ledger'
        ? `/leagues/${route.leagueId}/ledger`
        : `/leagues/${route.leagueId}`;
    case 'draft':
      return `/leagues/${route.leagueId}/draft`;
    case 'notFound':
      return '/';
  }
}

/** Navigates client-side. Unknown routes keep their URL; rendering decides. */
export function navigateTo(route: Route): void {
  const href = hrefFor(route);
  window.history.pushState(null, '', href);
  setPath();
}

const listeners = new Set<() => void>();

function setPath(): void {
  for (const listener of listeners) listener();
}

let popstateWired = false;
function ensurePopstate(): void {
  if (popstateWired || typeof window === 'undefined') return;
  popstateWired = true;
  window.addEventListener('popstate', () => setPath());
}

function subscribe(listener: () => void): () => void {
  ensurePopstate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The snapshot reads location directly — history is the single source of
// truth, so a test (or a tab) that moves the URL without this module never
// renders from a stale cache.
function getPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

/** The current location as a string — stable across renders. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPath, () => '/');
}

/** The parsed route for the current location. */
export function useRoute(): Route {
  return parsePath(usePathname());
}
