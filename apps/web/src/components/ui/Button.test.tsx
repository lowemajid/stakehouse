// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label as a button', () => {
    render(<Button>Draft player</Button>);
    expect(screen.getByRole('button', { name: 'Draft player' })).toBeInTheDocument();
  });

  it('defaults to the primary variant', () => {
    render(<Button>Draft player</Button>);
    expect(screen.getByRole('button')).toHaveClass('sh-btn', 'sh-btn--primary');
  });

  it('applies the requested variant class', () => {
    render(<Button variant="danger">Drop player</Button>);
    expect(screen.getByRole('button')).toHaveClass('sh-btn--danger');
    expect(screen.getByRole('button')).not.toHaveClass('sh-btn--primary');
  });

  it('fires the click handler', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} variant="secondary">
        Propose trade
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Draft player
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
