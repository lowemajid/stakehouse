import { leagueConfigSchema } from '@stakehouse/domain';
import type { LeagueSize } from '@stakehouse/domain';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER, SCORING_PRESETS, buildLeagueConfig } from './leagueForm';
import type { LeagueFormState } from './leagueForm';

/**
 * The create form builds a full LeagueConfig — the exact shape the server
 * validates with leagueConfigSchema. Scoring presets reuse the sandbox
 * league's blessed rules with the PPR reception value as the only dial.
 */
function formWith(overrides: Partial<LeagueFormState> = {}): LeagueFormState {
  return {
    name: 'Tuesday Seats',
    entryFeeDollars: '$25',
    size: 8 as LeagueSize,
    regularSeasonWeeks: '10',
    playoffTeams: 4,
    split: ['50', '30', '20'],
    scoringPreset: 'halfPpr',
    ...overrides,
  };
}

describe('SCORING_PRESETS', () => {
  it('only varies the reception rate across presets', () => {
    expect(SCORING_PRESETS.standard.reception).toBe(0);
    expect(SCORING_PRESETS.halfPpr.reception).toBe(0.5);
    expect(SCORING_PRESETS.fullPpr.reception).toBe(1);
  });

  it('builds a config the server schema accepts for every preset', () => {
    for (const presetName of Object.keys(SCORING_PRESETS) as Array<keyof typeof SCORING_PRESETS>) {
      const result = buildLeagueConfig(formWith({ scoringPreset: presetName }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(leagueConfigSchema.safeParse(result.config).success).toBe(true);
        expect(result.config.scoring.reception).toBe(SCORING_PRESETS[presetName].reception);
      }
    }
  });
});

describe('buildLeagueConfig', () => {
  it('builds the full config from form state', () => {
    const result = buildLeagueConfig(
      formWith({ name: '  Frostbite Classic ', entryFeeDollars: '$10' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.name).toBe('Frostbite Classic');
      expect(result.config.entryFeeCents).toBe(1000);
      expect(result.config.roster).toEqual(DEFAULT_ROSTER);
      expect(result.config.payoutSplitPct).toEqual([50, 30, 20]);
      expect(result.config.playoffTeams).toBe(4);
    }
  });

  it('rejects a payout split that does not total 100', () => {
    const result = buildLeagueConfig(formWith({ split: ['60', '60', '20'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.split).toBe('string');
  });

  it('rejects a non-numeric split percentage', () => {
    const result = buildLeagueConfig(formWith({ split: ['fifty', '30', '20'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.split).toBe('string');
  });

  it('flags a garbage entry fee', () => {
    const result = buildLeagueConfig(formWith({ entryFeeDollars: 'lots' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.entryFee).toBe('string');
  });

  it('flags a missing league name', () => {
    const result = buildLeagueConfig(formWith({ name: '   ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.name).toBe('string');
  });

  it('flags non-positive or non-numeric week counts', () => {
    for (const weeks of ['0', 'abc', '']) {
      const result = buildLeagueConfig(formWith({ regularSeasonWeeks: weeks }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(typeof result.fieldErrors.regularSeasonWeeks).toBe('string');
    }
  });

  it('surfaces the schema rule that a 4-team playoff needs at least 2 weeks', () => {
    const result = buildLeagueConfig(formWith({ regularSeasonWeeks: '1', playoffTeams: 4 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.fieldErrors.playoffTeams).toBe('string');
  });
});
