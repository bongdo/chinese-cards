import type { Card } from '../types';

export const REQUEUE_GAP = 3;

export type Answer = {
  queue: Card[];
  requeued: boolean;
};

export function afterAnswer(queue: Card[], known: boolean): Answer {
  const [current, ...rest] = queue;
  if (!current) {
    return { queue: [], requeued: false };
  }
  if (known) {
    return { queue: rest, requeued: false };
  }
  const at = Math.min(REQUEUE_GAP, rest.length);
  return {
    queue: [...rest.slice(0, at), current, ...rest.slice(at)],
    requeued: true,
  };
}

export function progress(answered: number, remaining: number): number {
  const total = answered + remaining;
  return total === 0 ? 0 : answered / total;
}
