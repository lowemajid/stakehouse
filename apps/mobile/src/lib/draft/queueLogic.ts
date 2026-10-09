/**
 * Pure queue operations — the room's queue card is a thin renderer over
 * these, and the PUT /queue body is their direct output. No network, no
 * state: arrays in, arrays out.
 */

export type QueueAddResult = { ok: true; queue: string[] } | { ok: false; queue: string[] };

export function addToQueue(queue: readonly string[], playerId: string): QueueAddResult {
  if (queue.includes(playerId)) return { ok: false, queue: [...queue] };
  return { ok: true, queue: [...queue, playerId] };
}

export function removeFromQueue(queue: readonly string[], playerId: string): string[] {
  return queue.filter((entry) => entry !== playerId);
}

export function moveInQueue(
  queue: readonly string[],
  playerId: string,
  direction: 'up' | 'down',
): string[] {
  const next = [...queue];
  const index = next.indexOf(playerId);
  if (index === -1) return next;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return next;
  const held = next[index]!;
  next[index] = next[target]!;
  next[target] = held;
  return next;
}
