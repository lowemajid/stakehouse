import { cents } from '@stakehouse/domain';
import { describe, expect, it } from 'vitest';
import { parseDollarsToCents } from './moneyInput';

/**
 * The create-league form takes a free-text dollar amount; money is stored as
 * integer cents and never computed with floats. These cases pin what the form
 * accepts before the value ever reaches the domain's cents() validator.
 */
describe('parseDollarsToCents', () => {
  it('accepts plain dollar amounts', () => {
    expect(parseDollarsToCents('$25')).toBe(cents(2500));
    expect(parseDollarsToCents('25')).toBe(cents(2500));
    expect(parseDollarsToCents('0.99')).toBe(cents(99));
  });

  it('accepts one or two decimal places and strips commas', () => {
    expect(parseDollarsToCents('25.5')).toBe(cents(2550));
    expect(parseDollarsToCents('25.50')).toBe(cents(2550));
    expect(parseDollarsToCents('1,250')).toBe(cents(125000));
    expect(parseDollarsToCents('  $25  ')).toBe(cents(2500));
  });

  it('rejects anything that is not a plain non-negative dollar amount', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('-5')).toBeNull();
    expect(parseDollarsToCents('1.234')).toBeNull();
    expect(parseDollarsToCents('12.')).toBeNull();
    expect(parseDollarsToCents('$25.00.50')).toBeNull();
  });

  it('rejects values beyond the safe integer range', () => {
    expect(parseDollarsToCents('99999999999999999999')).toBeNull();
  });
});
