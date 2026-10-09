// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Clock, formatClock } from './Clock';

describe('formatClock', () => {
  it('renders m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });

  it('clamps negative time to zero — a clock never reads negative', () => {
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('Clock', () => {
  it('renders the remaining time, calm above ten seconds', () => {
    render(<Clock secondsRemaining={47} />);
    expect(screen.getByText('0:47')).toBeInTheDocument();
    expect(screen.getByText('0:47')).not.toHaveClass('sh-clock--urgent');
    expect(screen.getByText('0:47')).toHaveAttribute('data-urgent', 'false');
  });

  it('turns urgent at ten seconds and under', () => {
    render(<Clock secondsRemaining={10} />);
    expect(screen.getByText('0:10')).toHaveClass('sh-clock--urgent');
    expect(screen.getByText('0:10')).toHaveAttribute('data-urgent', 'true');
  });
});
