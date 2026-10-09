// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Panel } from './Panel';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

describe('Panel', () => {
  it('renders children inside a card panel by default', () => {
    render(
      <Panel>
        <p>Pool contents</p>
      </Panel>,
    );
    expect(screen.getByText('Pool contents').closest('.sh-panel')).toHaveClass('sh-panel--card');
  });

  it('renders an optional title', () => {
    render(
      <Panel title="Prize pool">
        <p>Pool contents</p>
      </Panel>,
    );
    expect(screen.getByText('Prize pool')).toBeInTheDocument();
  });

  it('supports the raised tone', () => {
    render(
      <Panel title="Raised" tone="raised">
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByText('body').closest('.sh-panel')).toHaveClass('sh-panel--raised');
  });
});
