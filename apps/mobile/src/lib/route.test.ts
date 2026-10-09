import { describe, expect, it } from 'vitest';
import { INITIAL_ROUTE, reduceRoute } from './route';

/**
 * The app shell routes between four flows with a pure reducer — no navigation
 * library, no implicit history. Every transition the UI can trigger is here.
 */
describe('reduceRoute', () => {
  it('starts in the league list', () => {
    expect(INITIAL_ROUTE).toEqual({ name: 'leagues' });
  });

  it('opens the create form from the list and returns from it', () => {
    const creating = reduceRoute(INITIAL_ROUTE, { type: 'openCreateLeague' });
    expect(creating).toEqual({ name: 'createLeague' });
    expect(reduceRoute(creating, { type: 'back' })).toEqual({ name: 'leagues' });
  });

  it('opens a league detail by id and returns from it', () => {
    const detail = reduceRoute(INITIAL_ROUTE, { type: 'openLeague', leagueId: 'lg-sandbox' });
    expect(detail).toEqual({ name: 'leagueDetail', leagueId: 'lg-sandbox' });
    expect(reduceRoute(detail, { type: 'back' })).toEqual({ name: 'leagues' });
  });

  it('opens the draft room from a league and returns to the list from it', () => {
    const detail = reduceRoute(INITIAL_ROUTE, { type: 'openLeague', leagueId: 'lg-1' });
    const room = reduceRoute(detail, { type: 'openDraftRoom', leagueId: 'lg-1' });
    expect(room).toEqual({ name: 'draftRoom', leagueId: 'lg-1' });
    // Leaving the room hands the season flow back to the list, which can
    // re-enter the league for fresh standings.
    expect(reduceRoute(room, { type: 'openLeagues' })).toEqual({ name: 'leagues' });
  });

  it('returns to the list from anywhere and is a no-op there', () => {
    const detail = reduceRoute(INITIAL_ROUTE, { type: 'openLeague', leagueId: 'lg-1' });
    expect(reduceRoute(detail, { type: 'openLeagues' })).toEqual({ name: 'leagues' });
    expect(reduceRoute(INITIAL_ROUTE, { type: 'back' })).toEqual({ name: 'leagues' });
  });
});
