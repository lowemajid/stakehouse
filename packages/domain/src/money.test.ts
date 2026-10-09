import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { addCents, cents, formatCents, subtractCents, sumCents, ZERO_CENTS } from './money';
import type { Cents } from './money';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

describe('cents constructor', () => {
  it('accepts exact integer cents', () => {
    expect(cents(0)).toBe(0);
    expect(cents(100)).toBe(100);
    expect(cents(-25)).toBe(-25);
  });

  it('rejects floats, NaN, and infinities — floats-for-money is forbidden', () => {
    for (const bad of [1.5, 0.1, NaN, Infinity, -Infinity]) {
      try {
        cents(bad);
        expect.unreachable(`cents(${bad}) should have thrown`);
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('not-an-integer');
      }
    }
  });

  it('rejects integers beyond the safe range', () => {
    try {
      cents(MAX_SAFE + 1);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DomainError).code).toBe('unsafe-integer');
    }
  });
});

describe('cents arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addCents(cents(1000), cents(250))).toBe(1250);
    expect(subtractCents(cents(1000), cents(250))).toBe(750);
    expect(addCents(cents(-1000), cents(250))).toBe(-750);
  });

  it('throws on overflow instead of silently corrupting a pool', () => {
    expect(() => addCents(cents(MAX_SAFE), cents(1))).toThrow(DomainError);
    expect(() => subtractCents(cents(-MAX_SAFE), cents(1))).toThrow(DomainError);
    try {
      addCents(cents(MAX_SAFE), cents(1));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DomainError).code).toBe('money-overflow');
    }
  });

  it('sums ledgers of any length, empty included', () => {
    expect(sumCents([])).toBe(ZERO_CENTS);
    expect(sumCents([cents(100), cents(200), cents(-50)])).toBe(250);
  });
});

describe('formatCents', () => {
  it('renders golden display vectors', () => {
    expect(formatCents(cents(0))).toBe('$0.00');
    expect(formatCents(cents(7))).toBe('$0.07');
    expect(formatCents(cents(1234))).toBe('$12.34');
    expect(formatCents(cents(-500))).toBe('-$5.00');
    expect(formatCents(cents(1234567))).toBe('$12,345.67');
  });
});

describe('the type system blocks floats-for-money', () => {
  it('refuses raw numbers in Cents slots at compile time', () => {
    // @ts-expect-error a raw number — float or not — cannot enter a Cents slot; use cents()
    const _leak: Cents = 1000;
    // @ts-expect-error a float literal cannot reach a money API; use cents()
    const _floated = formatCents(12.5);
    expect(typeof cents(1000)).toBe('number');
  });
});
