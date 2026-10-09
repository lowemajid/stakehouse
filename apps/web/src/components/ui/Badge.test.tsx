// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

describe('Badge', () => {
  it('renders its label with the neutral tone by default', () => {
    render(<Badge>Week 6</Badge>);
    expect(screen.getByText('Week 6')).toHaveClass('sh-badge', 'sh-badge--neutral');
  });

  it('applies the requested tone — brass only for money states', () => {
    render(<Badge tone="money">Buy-in paid</Badge>);
    expect(screen.getByText('Buy-in paid')).toHaveClass('sh-badge--money');
    render(<Badge tone="danger">Vetoed</Badge>);
    expect(screen.getByText('Vetoed')).toHaveClass('sh-badge--danger');
    render(<Badge tone="active">On the clock</Badge>);
    expect(screen.getByText('On the clock')).toHaveClass('sh-badge--active');
  });
});
