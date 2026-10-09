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
