import { cents, leagueConfigSchema } from '@stakehouse/domain';
import type { LeagueConfig, LeagueSize } from '@stakehouse/domain';
import { sandboxLeagueConfig } from '@stakehouse/seeder';
import type { z } from 'zod';
import { parseDollarsToCents } from './moneyInput';

/**
 * The create-league form builds a full LeagueConfig — the exact shape the
 * server validates. Scoring presets and the default roster derive from the
 * sandbox league's blessed config (the same values the seeder installs), so
 * the form never invents its own rules; the PPR reception value is the only
 * dial the commissioner turns.
 */
const SANDBOX = sandboxLeagueConfig();

export const SCORING_PRESETS = {
  standard: { ...SANDBOX.scoring, reception: 0 },
  halfPpr: { ...SANDBOX.scoring, reception: 0.5 },
  fullPpr: { ...SANDBOX.scoring, reception: 1 },
} as const satisfies Record<'standard' | 'halfPpr' | 'fullPpr', typeof SANDBOX.scoring>;

export const DEFAULT_ROSTER: LeagueConfig['roster'] = SANDBOX.roster;

export interface LeagueFormState {
  name: string;
  entryFeeDollars: string;
  size: LeagueSize;
  regularSeasonWeeks: string;
  playoffTeams: 0 | 2 | 4;
  split: [string, string, string];
  scoringPreset: keyof typeof SCORING_PRESETS;
}

export type LeagueFormFieldErrors = Partial<
  Record<'name' | 'entryFee' | 'regularSeasonWeeks' | 'playoffTeams' | 'split' | 'form', string>
>;

export type LeagueFormResult =
  { ok: true; config: LeagueConfig } | { ok: false; fieldErrors: LeagueFormFieldErrors };

function parsePct(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^\d{1,3}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 0 && value <= 100 ? value : null;
}

export function buildLeagueConfig(form: LeagueFormState): LeagueFormResult {
  const fieldErrors: LeagueFormFieldErrors = {};

  const name = form.name.trim();
  if (!name) fieldErrors.name = 'Name your league.';

  const weeks = Number(form.regularSeasonWeeks.trim());
  if (!Number.isInteger(weeks) || weeks < 1) {
    fieldErrors.regularSeasonWeeks = 'Weeks must be a whole number of at least 1.';
  }

  let splitInvalid = false;
  const split: number[] = [];
  for (const raw of form.split) {
    const part = parsePct(raw);
    if (part === null) splitInvalid = true;
    else split.push(part);
  }
  if (splitInvalid) {
    fieldErrors.split = 'Percentages must be whole numbers from 0 to 100.';
  } else if (split.reduce((sum, part) => sum + part, 0) !== 100) {
    fieldErrors.split = 'Percentages must total exactly 100.';
  }

  // Fee check last so a null fee can return early — everything already
  // accumulated still reaches the user, and feeCents narrows to number.
  const feeCents =
    form.entryFeeDollars.trim() === '' ? 0 : parseDollarsToCents(form.entryFeeDollars);
  if (feeCents === null) {
    fieldErrors.entryFee = 'Enter a dollar amount like 25 or 25.50.';
    return { ok: false, fieldErrors };
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const candidate = {
    name,
    entryFeeCents: cents(feeCents),
    size: form.size,
    roster: DEFAULT_ROSTER,
    scoring: SCORING_PRESETS[form.scoringPreset],
    regularSeasonWeeks: weeks,
    playoffTeams: form.playoffTeams,
    payoutSplitPct: split as [number, number, number],
  };

  // The server's own schema is the arbiter — surfacing its messages keeps the
  // client from ever diverging from what the API will accept.
  const parsed = leagueConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of (parsed.error as z.ZodError).issues) {
      const key = issue.path[0];
      if (key === 'name' || key === 'regularSeasonWeeks' || key === 'playoffTeams') {
        fieldErrors[key] ??= issue.message;
      } else if (key === 'entryFeeCents') {
        fieldErrors.entryFee ??= issue.message;
      } else if (key === 'payoutSplitPct') {
        fieldErrors.split ??= issue.message;
      } else {
        fieldErrors.form ??= issue.message;
      }
    }
    return { ok: false, fieldErrors };
  }

  return { ok: true, config: parsed.data as LeagueConfig };
}
