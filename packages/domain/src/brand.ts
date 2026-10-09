import { DomainError } from './errors';

/**
 * Branded primitives: `Brand<T, K>` makes ids nominal enough that a ManagerId
 * can never satisfy a LeagueId parameter — the typechecker carries that
 * invariant so functions cannot mix up which entity an id names.
 */
export type Brand<T, K extends string> = T & { __brand: K };

export type LeagueId = Brand<string, 'League'>;
export type ManagerId = Brand<string, 'Manager'>;

export function leagueId(raw: string): LeagueId {
  if (raw.trim().length === 0) {
    throw new DomainError('empty-id', 'league id cannot be empty');
  }
  // The one sanctioned branding point: any LeagueId in the system was built here.
  return raw as LeagueId;
}

export function managerId(raw: string): ManagerId {
  if (raw.trim().length === 0) {
    throw new DomainError('empty-id', 'manager id cannot be empty');
  }
  return raw as ManagerId;
}
