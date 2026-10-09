// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignSystemGallery } from './DesignSystemGallery';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

describe('DesignSystemGallery', () => {
  it('renders every base component in isolation, no backend required', () => {
    render(<DesignSystemGallery />);
    // Button — three variants
    expect(screen.getByRole('button', { name: 'Draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propose trade' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drop player' })).toBeInTheDocument();
    // Panel + Table with a standings sample
    expect(screen.getByText('Prize pool')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Manager' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Dov Amado' })).toBeInTheDocument();
    // Money — brass positive and blood negative
    expect(screen.getByText('$41.25')).toBeInTheDocument();
    expect(screen.getByText('-$25.00')).toBeInTheDocument();
    // Clock — calm and urgent
    expect(screen.getByText('0:47')).toBeInTheDocument();
    expect(screen.getByText('0:08')).toHaveClass('sh-clock--urgent');
    // Badges
    expect(screen.getByText('Buy-in paid')).toBeInTheDocument();
    expect(screen.getByText('On the clock')).toBeInTheDocument();
    // lucide icons render as svg, one icon set
    expect(document.querySelector('svg')).not.toBeNull();
  });
});
