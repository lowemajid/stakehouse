import { describe, expect, it, vi } from 'vitest';
import { draftViewFixture, FakeEventSource } from '../../test/draft';
import { subscribeDraft } from './draftStream';

describe('draft stream subscriber', () => {
  it('parses the snapshot and every refreshed draft view', () => {
    const factory = FakeEventSource.factory();
    const onDraft = vi.fn();
    const onClock = vi.fn();
    subscribeDraft('lg-x', { onDraft, onClock }, factory);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/leagues/lg-x/draft/stream');

    source.emit('draft', { draft: draftViewFixture() });
    expect(onDraft).toHaveBeenCalledWith(draftViewFixture());

    // A draft event whose payload shape drifts from the contract is skipped.
    source.emit('draft', { draft: { status: 'nonsense' } });
    expect(onDraft).toHaveBeenCalledTimes(1);
  });

  it('carries clock heartbeats and ignores malformed ones', () => {
    const factory = FakeEventSource.factory();
    const onClock = vi.fn();
    subscribeDraft('lg-x', { onDraft: vi.fn(), onClock }, factory);
    const source = FakeEventSource.instances[0]!;

    source.emit('clock', { at: 1_791_230_400_000 });
    expect(onClock).toHaveBeenCalledWith(1_791_230_400_000);
    source.emit('clock', { at: 'not-a-number' });
    source.emit('clock', 'garbage');
    expect(onClock).toHaveBeenCalledTimes(1);
  });

  it('closes when the draft completes so EventSource never reconnects to a finished draft', () => {
    const factory = FakeEventSource.factory();
    const close = subscribeDraft('lg-x', { onDraft: vi.fn(), onClock: vi.fn() }, factory);
    const source = FakeEventSource.instances[0]!;

    source.emit('draft', { draft: draftViewFixture({ status: 'complete' }) });
    expect(source.closed).toBe(true);

    // The unsubscribe fn is safe to call after the auto-close.
    expect(() => close()).not.toThrow();
  });

  it('closing the subscription closes the underlying source exactly once', () => {
    const factory = FakeEventSource.factory();
    const close = subscribeDraft('lg-x', { onDraft: vi.fn(), onClock: vi.fn() }, factory);
    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    close();
    close();
    expect(source.closed).toBe(true);
  });
});
