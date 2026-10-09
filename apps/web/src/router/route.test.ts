import { describe, expect, it } from 'vitest';
import { hrefFor, parsePath } from './route';

describe('parsePath', () => {
  it('maps the lobby, sign-in, and create routes', () => {
    expect(parsePath('/')).toEqual({ name: 'lobby' });
    expect(parsePath('/signin')).toEqual({ name: 'signIn' });
    expect(parsePath('/leagues/new')).toEqual({ name: 'createLeague' });
  });

  it('maps league routes with their id and tab', () => {
    expect(parsePath('/leagues/lg-sandbox')).toEqual({
      name: 'league',
      leagueId: 'lg-sandbox',
      tab: 'overview',
    });
    expect(parsePath('/leagues/lg-sandbox/ledger')).toEqual({
      name: 'league',
      leagueId: 'lg-sandbox',
      tab: 'ledger',
    });
  });

  it('renders unknown paths as not-found, never a crash', () => {
    expect(parsePath('/nowhere')).toEqual({ name: 'notFound' });
    expect(parsePath('/leagues/')).toEqual({ name: 'notFound' });
  });
});

describe('hrefFor', () => {
  it('round-trips every route', () => {
    const routes = [
      { name: 'lobby' },
      { name: 'signIn' },
      { name: 'createLeague' },
      { name: 'league', leagueId: 'lg-sandbox', tab: 'overview' },
      { name: 'league', leagueId: 'lg-sandbox', tab: 'ledger' },
    ] as const;
    for (const route of routes) {
      expect(parsePath(hrefFor(route))).toEqual(route);
    }
  });
});
