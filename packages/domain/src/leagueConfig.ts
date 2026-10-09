import { z } from 'zod';
import { cents, payoutSplitSchema } from './money';
import type { Cents } from './money';

/**
 * Scoring rules and league configuration, validated with zod so an invalid
 * league can never exist: the payout split must sum to exactly 100 at
 * creation, rosters must field someone, and a playoff bracket must fit inside
 * the regular season. Scoring values are POINTS (floats by design — 0.04 per
 * passing yard); only money is integer-cents.
 */
export interface ScoringRules {
  passYards: number;
  passTd: number;
  interception: number;
  rushYards: number;
  rushTd: number;
  reception: number;
  fumbleLost: number;
  kicking: { fg: Record<string, number>; extraPoint: number };
  defense: { sack: number; takeaway: number; td: number; pointsAllowedBands: [number, number][] };
}

export type LeagueSize = 4 | 6 | 8 | 10 | 12;

export interface LeagueConfig {
  name: string;
  entryFeeCents: Cents;
  size: LeagueSize;
  roster: { QB: number; RB: number; WR: number; TE: number; FLEX: number; K: number; DEF: number };
  scoring: ScoringRules;
  regularSeasonWeeks: number;
  playoffTeams: 0 | 2 | 4;
  payoutSplitPct: [number, number, number];
}

const finiteNumber = z
  .number({ invalid_type_error: 'must be a finite number' })
  .refine((value) => Number.isFinite(value), { message: 'must be a finite number' });

const nonNegativeInteger = z.number().int().min(0);

const leagueSizeSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
]);

export const rosterSchema = z
  .object({
    QB: nonNegativeInteger,
    RB: nonNegativeInteger,
    WR: nonNegativeInteger,
    TE: nonNegativeInteger,
    FLEX: nonNegativeInteger,
    K: nonNegativeInteger,
    DEF: nonNegativeInteger,
  })
  .superRefine((roster, ctx) => {
    const total =
      roster.QB + roster.RB + roster.WR + roster.TE + roster.FLEX + roster.K + roster.DEF;
    if (total < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'roster must field at least one player',
      });
    }
  });

export const scoringRulesSchema = z.object({
  passYards: finiteNumber,
  passTd: finiteNumber,
  interception: finiteNumber,
  rushYards: finiteNumber,
  rushTd: finiteNumber,
  reception: finiteNumber,
  fumbleLost: finiteNumber,
  kicking: z.object({ fg: z.record(z.string(), finiteNumber), extraPoint: finiteNumber }),
  defense: z.object({
    sack: finiteNumber,
    takeaway: finiteNumber,
    td: finiteNumber,
    pointsAllowedBands: z.array(z.tuple([finiteNumber, finiteNumber])),
  }),
});

const entryFeeSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, { message: 'entry fee exceeds the safe integer range' })
  .transform(cents);

export const leagueConfigSchema = z
  .object({
    name: z.string().trim().min(1, 'league name is required'),
    entryFeeCents: entryFeeSchema,
    size: leagueSizeSchema,
    roster: rosterSchema,
    scoring: scoringRulesSchema,
    regularSeasonWeeks: z.number().int().min(1),
    playoffTeams: z.union([z.literal(0), z.literal(2), z.literal(4)]),
    payoutSplitPct: payoutSplitSchema,
  })
  .superRefine((config, ctx) => {
    if (config.playoffTeams === 4 && config.regularSeasonWeeks < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['playoffTeams'],
        message: 'a 4-team playoff needs at least 2 regular-season weeks to seat the bracket',
      });
    }
  });

export function parseLeagueConfig(raw: unknown): LeagueConfig {
  return leagueConfigSchema.parse(raw);
}
