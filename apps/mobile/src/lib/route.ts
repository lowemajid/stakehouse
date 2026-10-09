/**
 * The app shell's typed route state. No navigation library — four flows and
 * an explicit reducer, so every transition is unit-testable.
 */
export type Route =
  { name: 'leagues' } | { name: 'createLeague' } | { name: 'leagueDetail'; leagueId: string };

export type RouteAction =
  | { type: 'openCreateLeague' }
  | { type: 'openLeague'; leagueId: string }
  | { type: 'openLeagues' }
  | { type: 'back' };

export const INITIAL_ROUTE: Route = { name: 'leagues' };

export function reduceRoute(route: Route, action: RouteAction): Route {
  switch (action.type) {
    case 'openCreateLeague':
      return { name: 'createLeague' };
    case 'openLeague':
      return { name: 'leagueDetail', leagueId: action.leagueId };
    case 'openLeagues':
      return { name: 'leagues' };
    case 'back':
      return route.name === 'leagues' ? route : { name: 'leagues' };
  }
}
