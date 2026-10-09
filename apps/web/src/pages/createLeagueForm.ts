import type { LeagueConfigInput, ScoringRulesView } from '@stakehouse/api-client';

/**
 * The commissioner's create-league form: string inputs from the DOM, parsed
 * into the exact wire config the API expects — dollars to integer cents,
 * presets to scoring rules, the split to a sum-100 triple. Parsing lives in
 * this pure module so the validation matrix is testable without a DOM.
 *
 * Validation mirrors the domain's leagueConfigSchema (the API rejects
 * anything else with 400 field errors); the form surfaces the same rules
 * before a single byte is sent.
 */

export type ScoringPreset = 'standard' | 'half' | 'full';

export interface CreateLeagueFormValues {
  name: string;
  /** Dollars as typed, e.g. "25" or "25.50". */
  entryFeeDollars: string;
  size: string;
  roster: { QB: string; RB: string; WR: string; TE: string; FLEX: string; K: string; DEF: string };
  preset: ScoringPreset;
  weeks: string;
  playoffTeams: string;
  split: [string, string, string];
}

/** The house scoring template; only the PPR reception value moves. */
export function scoringForPreset(preset: ScoringPreset): ScoringRulesView {
  return {
    passYards: 0.04,
    passTd: 4,
    interception: -2,
    rushYards: 0.1,
    rushTd: 6,
    reception: preset === 'half' ? 0.5 : preset === 'full' ? 1 : 0,
    fumbleLost: -2,
    kicking: { fg: { '0-19': 3, '20-29': 3, '30-39': 4, '40-49': 5, '50+': 6 }, extraPoint: 1 },
    defense: {
      sack: 1,
      takeaway: 2,
      td: 6,
      pointsAllowedBands: [
        [0, 12],
        [6, 7],
        [13, 4],
        [20, 1],
      ],
    },
  };
}

export type CreateLeagueFieldErrors = Partial<{
  name: string;
  entryFee: string;
  roster: string;
  weeks: string;
  split: string;
}>;

export type CreateLeagueParseResult =
  { ok: true; config: LeagueConfigInput } | { ok: false; fieldErrors: CreateLeagueFieldErrors };

export function parseCreateLeagueForm(values: CreateLeagueFormValues): CreateLeagueParseResult {
  const errors: CreateLeagueFieldErrors = {};

  const name = values.name.trim();
  if (!name) errors.name = 'league name is required';

  const fee = parseCents(values.entryFeeDollars);
  if (!fee.ok)
    errors.entryFee =
      fee.reason === 'negative'
        ? 'the entry fee cannot be negative'
        : 'the entry fee must be whole cents';

  const roster = {} as LeagueConfigInput['roster'];
  let rosterInvalid = false;
  for (const slot of ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const) {
    const n = Number.parseInt(values.roster[slot], 10);
    if (!Number.isInteger(n) || n < 0) rosterInvalid = true;
    roster[slot] = Number.isInteger(n) ? n : 0;
  }
  if (rosterInvalid) errors.roster = 'roster slots cannot be negative';

  const weeks = Number.parseInt(values.weeks, 10);
  const playoffTeams = Number.parseInt(values.playoffTeams, 10);
  if (!Number.isInteger(weeks) || weeks < 1 || (playoffTeams === 4 && weeks < 2)) {
    errors.weeks =
      playoffTeams === 4
        ? 'a 4-team playoff needs at least 2 regular-season weeks to seat the bracket'
        : 'the regular season needs at least one week';
  }

  const split = values.split.map((raw) => Number.parseInt(raw, 10));
  const splitSum = split.reduce((sum, n) => (Number.isInteger(n) ? sum + n : sum), 0);
  if (split.some((n) => !Number.isInteger(n) || n < 0) || splitSum !== 100) {
    errors.split = 'the payout split must total exactly 100%';
  }

  if (Object.keys(errors).length > 0 || !fee.ok) return { ok: false, fieldErrors: errors };

  return {
    ok: true,
    config: {
      name,
      entryFeeCents: fee.cents as number & { __brand: 'Cents' },
      size: Number.parseInt(values.size, 10) as LeagueConfigInput['size'],
      roster,
      scoring: scoringForPreset(values.preset),
      regularSeasonWeeks: weeks,
      playoffTeams: playoffTeams as LeagueConfigInput['playoffTeams'],
      payoutSplitPct: split as LeagueConfigInput['payoutSplitPct'],
    },
  };
}

/**
 * "$25" → { ok: true, cents: 2500 }. A negative fee, a finer-than-a-cent fee
 * ("25.005"), or gibberish are all refused — each with its own reason, so the
 * form can tell the commissioner what to fix.
 */
export type ParseCentsResult =
  | { ok: true; cents: number }
  | { ok: false; reason: 'negative' | 'not-whole-cents' | 'not-a-number' };

export function parseCents(dollars: string): ParseCentsResult {
  const parsed = Number.parseFloat(dollars);
  if (!Number.isFinite(parsed)) return { ok: false, reason: 'not-a-number' };
  if (parsed < 0) return { ok: false, reason: 'negative' };
  const cents = Math.round(parsed * 100);
  // A float fee finer than one cent drifts on the wire — refuse it here,
  // where the commissioner can fix the input, rather than at the API.
  if (!Number.isSafeInteger(cents) || Math.abs(parsed * 100 - cents) > 1e-9) {
    return { ok: false, reason: 'not-whole-cents' };
  }
  return { ok: true, cents };
}
