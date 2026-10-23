import type { DayStat, HardCard, Stats } from '../types';
import { db } from './db';

const pad = (n: number) => String(n).padStart(2, '0');

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function buildStats(days = 7, now = Date.now()): Promise<Stats> {
  const database = await db();

  const totals = await database.getFirstAsync<{ total: number; due: number; fresh: number }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END), 0) AS due,
            COALESCE(SUM(CASE WHEN reps = 0 AND lapses = 0 THEN 1 ELSE 0 END), 0) AS fresh
     FROM cards`,
    now,
  );

  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));
  const since = start.getTime();

  const byDay = new Map<string, DayStat>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d.getTime());
    byDay.set(key, { date: key, known: 0, unknown: 0 });
  }

  const reviews = await database.getAllAsync<{ ts: number; known: number }>(
    'SELECT ts, known FROM reviews WHERE ts >= ?',
    since,
  );

  let known = 0;
  for (const review of reviews) {
    const day = byDay.get(dayKey(review.ts));
    if (!day) continue;
    if (review.known === 1) {
      day.known++;
      known++;
    } else {
      day.unknown++;
    }
  }

  const answers = reviews.length;

  const all = await database.getAllAsync<{ ts: number }>('SELECT ts FROM reviews');
  const active = new Set(all.map((review) => dayKey(review.ts)));
  const cursor = startOfDay(now);
  if (!active.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (active.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const hardest = await database.getAllAsync<HardCard>(
    `SELECT id, front, back, lapses FROM cards WHERE lapses > 0
     ORDER BY lapses DESC, front LIMIT 5`,
  );

  return {
    total: totals?.total ?? 0,
    due_now: totals?.due ?? 0,
    new: totals?.fresh ?? 0,
    answers,
    known_rate: answers > 0 ? known / answers : 0,
    streak,
    days: Array.from(byDay.values()),
    hardest,
  };
}
