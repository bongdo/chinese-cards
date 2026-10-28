import assert from 'node:assert/strict';
import test from 'node:test';

import { RELEARN, nextSchedule } from './scheduler.ts';

const NOW = Date.UTC(2026, 9, 22, 12);
const DAY = 24 * 60 * 60 * 1000;

const fresh = { box: 0, due_at: 0, lapses: 0, reps: 0 };

test('known climbs one box', () => {
  const next = nextSchedule(fresh, true, NOW);
  assert.equal(next.box, 1);
  assert.equal(next.reps, 1);
  assert.equal(next.lapses, 0);
  assert.equal(next.due_at, NOW + DAY);
});

test('known climbs the ladder and caps', () => {
  let state = fresh;
  for (let i = 1; i <= 8; i++) {
    state = nextSchedule(state, true, NOW);
    assert.equal(state.box, i);
  }
  assert.equal(nextSchedule(state, true, NOW).box, 8);
});

test('unknown resets and relearns', () => {
  const next = nextSchedule({ box: 5, due_at: 0, lapses: 2, reps: 9 }, false, NOW);
  assert.equal(next.box, 0);
  assert.equal(next.lapses, 3);
  assert.equal(next.reps, 9);
  assert.equal(next.due_at, NOW + RELEARN);
});

test('negative box is sanitised', () => {
  assert.equal(nextSchedule({ box: -3, due_at: 0, lapses: 0, reps: 0 }, true, NOW).box, 1);
});
