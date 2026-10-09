import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { leagueConfigSchema, parseLeagueConfig } from './leagueConfig';
import type { LeagueConfig } from './leagueConfig';

const validConfig = {
  name: '  Frozen Rope League  ',
  entryFeeCents: 10000,
  size: 8,
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  scoring: {
    passYards: 0.04,
    passTd: 4,
    interception: -2,
    rushYards: 0.1,
    rushTd: 6,
    reception: 1,
    fumbleLost: -2,
    kicking: {
      fg: { '0-19': 3, '20-29': 3, '30-39': 3, '40-49': 4, '50-59': 5, '60+': 6 },
      extraPoint: 1,
    },
    defense: {
      sack: 1,
      takeaway: 2,
      td: 6,
      pointsAllowedBands: [
        [0, 10],
        [10, 7],
        [20, 3],
        [30, 1],
        [40, 0],
      ],
    },
  },
  regularSeasonWeeks: 10,
  playoffTeams: 4,
  payoutSplitPct: [50, 30, 20],
};

describe('leagueConfigSchema', () => {
  it('accepts a fully valid config and normalizes it', () => {
    const parsed = parseLeagueConfig(validConfig);
    expect(parsed.name).toBe('Frozen Rope League'); // trimmed
    expect(parsed.entryFeeCents).toBe(10000); // branded Cents, integer
    expect(parsed.payoutSplitPct).toEqual([50, 30, 20]);
  });

  it('the schema output is exactly the LeagueConfig interface', () => {
    const asInterface = (raw: z.infer<typeof leagueConfigSchema>): LeagueConfig => raw;
    expect(asInterface(parseLeagueConfig(validConfig))).toEqual(parseLeagueConfig(validConfig));
  });

  it('rejects a payout split that does not sum to exactly 100', () => {
    for (const split of [
      [50, 30, 19],
      [50, 30, 21],
      [0, 0, 0],
    ]) {
      const res = leagueConfigSchema.safeParse({ ...validConfig, payoutSplitPct: split });
      expect(res.success).toBe(false);
      if (!res.success) {
        const issue = res.error.issues[0];
        expect(issue?.path).toEqual(['payoutSplitPct']);
        expect(issue?.message).toMatch(/100/);
      }
    }
  });

  it('rejects non-integer or out-of-range split percentages', () => {
    for (const split of [
      [50, 30, 20.5],
      [150, -25, -25],
      [60, 60, 0],
    ]) {
      expect(leagueConfigSchema.safeParse({ ...validConfig, payoutSplitPct: split }).success).toBe(
        false,
      );
    }
  });

  it('only accepts the configured league sizes', () => {
    expect(() => parseLeagueConfig({ ...validConfig, size: 5 })).toThrow();
    for (const size of [4, 6, 8, 10, 12]) {
      expect(parseLeagueConfig({ ...validConfig, size }).size).toBe(size);
    }
  });

  it('rejects a non-integer or negative entry fee', () => {
    for (const entryFeeCents of [9.99, -1]) {
      const res = leagueConfigSchema.safeParse({ ...validConfig, entryFeeCents });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.path).toEqual(['entryFeeCents']);
      }
    }
    expect(parseLeagueConfig({ ...validConfig, entryFeeCents: 0 }).entryFeeCents).toBe(0);
  });

  it('rejects empty league names', () => {
    expect(() => parseLeagueConfig({ ...validConfig, name: '   ' })).toThrow();
  });

  it('rejects negative roster counts and a roster that fields nobody', () => {
    expect(
      leagueConfigSchema.safeParse({ ...validConfig, roster: { ...validConfig.roster, RB: -1 } })
        .success,
    ).toBe(false);
    const empty = leagueConfigSchema.safeParse({
      ...validConfig,
      roster: { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 },
    });
    expect(empty.success).toBe(false);
  });

  it('requires enough regular-season weeks to seat the playoff bracket', () => {
    const res = leagueConfigSchema.safeParse({ ...validConfig, regularSeasonWeeks: 1 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(['playoffTeams']);
      expect(res.error.issues[0]?.message).toMatch(/2 regular-season weeks/);
    }
    expect(leagueConfigSchema.safeParse({ ...validConfig, regularSeasonWeeks: 2 }).success).toBe(
      true,
    );
  });

  it('only accepts 0, 2, or 4 playoff teams', () => {
    for (const playoffTeams of [1, 3, 5, 8]) {
      expect(leagueConfigSchema.safeParse({ ...validConfig, playoffTeams }).success).toBe(false);
    }
    for (const playoffTeams of [0, 2, 4]) {
      expect(leagueConfigSchema.safeParse({ ...validConfig, playoffTeams }).success).toBe(true);
    }
  });
});
