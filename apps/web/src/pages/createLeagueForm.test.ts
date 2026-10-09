import { describe, expect, it } from 'vitest';
import {
  parseCreateLeagueForm,
  scoringForPreset,
  type CreateLeagueFormValues,
} from './createLeagueForm';

const valid: CreateLeagueFormValues = {
  name: 'Tuesday Night Kitchen League',
  entryFeeDollars: '25',
  size: '8',
  roster: { QB: '1', RB: '2', WR: '2', TE: '1', FLEX: '1', K: '1', DEF: '1' },
  preset: 'standard',
  weeks: '10',
  playoffTeams: '4',
  split: ['50', '30', '20'],
};

describe('parseCreateLeagueForm', () => {
  it('accepts a valid form and converts dollars to integer cents', () => {
    const result = parseCreateLeagueForm(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.entryFeeCents).toBe(2500);
      expect(result.config.size).toBe(8);
      expect(result.config.payoutSplitPct).toEqual([50, 30, 20]);
      expect(result.config.scoring.reception).toBe(0); // standard PPR
      expect(result.config.roster).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 });
    }
  });

  it('maps presets to reception values', () => {
    expect(scoringForPreset('standard').reception).toBe(0);
    expect(scoringForPreset('half').reception).toBe(0.5);
    expect(scoringForPreset('full').reception).toBe(1);
  });

  it('rejects a missing name', () => {
    const result = parseCreateLeagueForm({ ...valid, name: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.name).toBe('league name is required');
  });

  it('rejects a split that does not total exactly 100', () => {
    const result = parseCreateLeagueForm({ ...valid, split: ['60', '30', '20'] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.split).toBe('the payout split must total exactly 100%');
    }
  });

  it('rejects a negative entry fee', () => {
    const result = parseCreateLeagueForm({ ...valid, entryFeeDollars: '-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.entryFee).toBe('the entry fee cannot be negative');
  });

  it('rejects fees finer than one cent', () => {
    const result = parseCreateLeagueForm({ ...valid, entryFeeDollars: '25.005' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.entryFee).toBe('the entry fee must be whole cents');
  });

  it('rejects a negative roster slot', () => {
    const result = parseCreateLeagueForm({ ...valid, roster: { ...valid.roster, RB: '-1' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.roster).toBe('roster slots cannot be negative');
  });

  it('rejects a season too short to seat a 4-team bracket', () => {
    const result = parseCreateLeagueForm({ ...valid, weeks: '1', playoffTeams: '4' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.weeks).toBe(
        'a 4-team playoff needs at least 2 regular-season weeks to seat the bracket',
      );
    }
  });
});
