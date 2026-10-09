import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { leagueId, managerId } from './brand';
import type { LeagueId } from './brand';

describe('branded id constructors', () => {
  it('passes non-empty ids through unchanged', () => {
    expect(leagueId('lg-frozen-rope')).toBe('lg-frozen-rope');
    expect(managerId('mgr-1')).toBe('mgr-1');
  });

  it('rejects empty and whitespace-only ids', () => {
    for (const bad of ['', '   ']) {
      try {
        leagueId(bad);
        expect.unreachable(`leagueId(${JSON.stringify(bad)}) should have thrown`);
      } catch (err) {
        expect((err as DomainError).code).toBe('empty-id');
      }
      expect(() => managerId(bad)).toThrow(DomainError);
    }
  });
});

describe('the type system keeps ids from cross-contaminating', () => {
  it('refuses a ManagerId in a LeagueId slot at compile time', () => {
    const mgr = managerId('mgr-1');
    // @ts-expect-error a ManagerId can never satisfy a LeagueId parameter — that is the brand's job
    const _wrong: LeagueId = mgr;
    expect(typeof mgr).toBe('string');
  });
});
