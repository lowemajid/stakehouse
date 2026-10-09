// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money, formatCents } from './Money';

describe('formatCents', () => {
  it('formats integer cents as USD, grouping thousands', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(1250)).toBe('$12.50');
    expect(formatCents(1234567)).toBe('$12,345.67');
    expect(formatCents(100000000)).toBe('$1,000,000.00');
  });

  it('negates with a leading minus, never parentheses or floats', () => {
    expect(formatCents(-2500)).toBe('-$25.00');
    expect(formatCents(-1)).toBe('-$0.01');
  });

  it('rejects non-integer cents — money never rounds silently', () => {
    expect(() => formatCents(12.5)).toThrow(/integer cents/);
  });
});

describe('Money', () => {
  it('renders brass by default (brass is for money and only money)', () => {
    render(<Money cents={5000} />);
    const amount = screen.getByText('$50.00');
    expect(amount).toHaveClass('sh-money');
    expect(amount).not.toHaveClass('sh-money--negative');
  });

  it('marks negative amounts so the ledger can paint them blood', () => {
    render(<Money cents={-2500} />);
    expect(screen.getByText('-$25.00')).toHaveClass('sh-money--negative');
  });
});
