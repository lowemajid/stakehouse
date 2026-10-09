import { describe, expect, it } from 'vitest';
import { addToQueue, moveInQueue, removeFromQueue } from './queueLogic';

/**
 * Pure queue operations — the room's queue card is a thin renderer over
 * these, and the PUT /queue body is their direct output.
 */

describe('addToQueue', () => {
  it('appends a player', () => {
    expect(addToQueue(['a', 'b'], 'c')).toStrictEqual({ ok: true, queue: ['a', 'b', 'c'] });
  });

  it('refuses a duplicate', () => {
    expect(addToQueue(['a', 'b'], 'b')).toStrictEqual({ ok: false, queue: ['a', 'b'] });
  });

  it('accepts into an empty queue', () => {
    expect(addToQueue([], 'a')).toStrictEqual({ ok: true, queue: ['a'] });
  });
});

describe('removeFromQueue', () => {
  it('drops the entry and keeps order', () => {
    expect(removeFromQueue(['a', 'b', 'c'], 'b')).toStrictEqual(['a', 'c']);
  });

  it('is a no-op for an absent player', () => {
    expect(removeFromQueue(['a'], 'zzz')).toStrictEqual(['a']);
  });
});

describe('moveInQueue', () => {
  const queue = ['a', 'b', 'c'];

  it('swaps upward', () => {
    expect(moveInQueue(queue, 'b', 'up')).toStrictEqual(['b', 'a', 'c']);
  });

  it('swaps downward', () => {
    expect(moveInQueue(queue, 'b', 'down')).toStrictEqual(['a', 'c', 'b']);
  });

  it('holds at the ends', () => {
    expect(moveInQueue(queue, 'a', 'up')).toStrictEqual(queue);
    expect(moveInQueue(queue, 'c', 'down')).toStrictEqual(queue);
  });

  it('never mutates the input', () => {
    const held = ['a', 'b'];
    moveInQueue(held, 'b', 'up');
    expect(held).toStrictEqual(['a', 'b']);
  });
});
