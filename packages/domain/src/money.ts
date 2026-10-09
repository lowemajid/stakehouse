import { z } from 'zod';
import { DomainError } from './errors';

/**
 * Money is integer cents — never a float, never a string. The brand blocks raw
 * numbers from entering money slots at compile time; `cents()` is the only
 * sanctioned constructor and guards the same invariant at runtime.
 */
export type Cents = number & { __cents: true };

export const ZERO_CENTS: Cents = 0 as Cents;

export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new DomainError(
      'not-an-integer',
      `money must be an integer number of cents, got ${value}`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new DomainError('unsafe-integer', `money amount ${value} exceeds the safe integer range`);
  }
  return value as Cents;
}

export function addCents(a: Cents, b: Cents): Cents {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new DomainError(
      'money-overflow',
      `adding ${a} + ${b} cents overflows the safe integer range`,
    );
  }
  return sum as Cents;
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return addCents(a, cents(-b));
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((acc, value) => addCents(acc, value), ZERO_CENTS);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(value: Cents): string {
  return usd.format(value / 100);
}

/** Three percentage shares; validated to sum to exactly 100. */
export type PayoutSplit = [number, number, number];

export const payoutSplitSchema = z
  .tuple([
    z.number().int().min(0).max(100),
    z.number().int().min(0).max(100),
    z.number().int().min(0).max(100),
  ])
  .refine((split) => split[0] + split[1] + split[2] === 100, {
    message: 'payout split must total exactly 100%',
  });

export interface Payout {
  place: 1 | 2 | 3;
  amountCents: Cents;
}

export function payoutPlan(pool: Cents, split: PayoutSplit): Payout[] {
  const parsed = payoutSplitSchema.safeParse(split);
  if (!parsed.success) {
    throw new DomainError(
      'invalid-payout-split',
      `payout split must be three percentages summing to exactly 100, got [${split.join(', ')}]`,
    );
  }
  // Largest-remainder distribution in integer arithmetic: floor each share,
  // then hand the leftover cents to the largest fractional remainders, ties
  // resolved toward the better place. Guarantees Σ payout === pool exactly —
  // a payout that doesn't empty the pool is the bug this exists to prevent.
  const shares = split.map((pct) => Math.floor((pool * pct) / 100));
  let leftover = pool - shares.reduce((sum, share) => sum + share, 0);
  const order = split
    .map((pct, index) => ({ index, remainder: (pool * pct) % 100 }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (leftover === 0) break;
    shares[index] = shares[index]! + 1;
    leftover = leftover - 1;
  }
  const PLACES = [1, 2, 3] as const;
  return PLACES.map((place, index) => ({ place, amountCents: cents(shares[index]!) }));
}
