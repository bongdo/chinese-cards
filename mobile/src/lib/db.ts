import * as SQLite from 'expo-sqlite';

import type { Card, Changes } from '../types';
import { nextSchedule, type Schedule } from './scheduler';

type Row = {
  id: string;
  deck: string;
  front: string;
  back: string;
  pinyin: string;
  note: string;
  box: number;
  due_at: number;
  lapses: number;
  reps: number;
  updated_at: number;
  dirty: number;
};

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  deck       TEXT NOT NULL,
  front      TEXT NOT NULL,
  back       TEXT NOT NULL,
  pinyin     TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  box        INTEGER NOT NULL DEFAULT 0,
  due_at     INTEGER NOT NULL DEFAULT 0,
  lapses     INTEGER NOT NULL DEFAULT 0,
  reps       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  dirty      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cards_due ON cards(deck, due_at);
CREATE TABLE IF NOT EXISTS tombstones (
  id         TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL,
  pushed     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  known   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_ts ON reviews(ts);
`;

let connection: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!connection) {
    connection = SQLite.openDatabaseAsync('chinese.db').then(async (database) => {
      await database.execAsync(SCHEMA);
      return database;
    });
  }
  return connection;
}

const toCard = (row: Row): Card => ({
  id: row.id,
  deck: row.deck,
  front: row.front,
  back: row.back,
  pinyin: row.pinyin || undefined,
  note: row.note || undefined,
  box: row.box,
  due_at: new Date(row.due_at).toISOString(),
  lapses: row.lapses,
  reps: row.reps,
  updated_at: new Date(row.updated_at).toISOString(),
});

export async function dueCards(deck: string, limit: number, now = Date.now()): Promise<Card[]> {
  const database = await db();
  const rows = deck
    ? await database.getAllAsync<Row>(
        `SELECT * FROM cards WHERE due_at <= ? AND deck = ? ORDER BY lapses DESC, due_at LIMIT ?`,
        now,
        deck,
        limit,
      )
    : await database.getAllAsync<Row>(
        `SELECT * FROM cards WHERE due_at <= ? ORDER BY lapses DESC, due_at LIMIT ?`,
        now,
        limit,
      );
  return rows.map(toCard);
}

export async function getCard(id: string): Promise<Card | null> {
  const database = await db();
  const row = await database.getFirstAsync<Row>('SELECT * FROM cards WHERE id = ?', id);
  return row ? toCard(row) : null;
}

export async function saveCard(
  id: string,
  fields: { front: string; back: string; pinyin: string; note: string },
): Promise<void> {
  const database = await db();
  await database.runAsync(
    `UPDATE cards SET front=?, back=?, pinyin=?, note=?, updated_at=?, dirty=1 WHERE id=?`,
    fields.front,
    fields.back,
    fields.pinyin,
    fields.note,
    Date.now(),
    id,
  );
}

export async function removeCard(id: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM cards WHERE id = ?', id);
  await database.runAsync(
    'INSERT INTO tombstones(id, deleted_at, pushed) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET pushed=0',
    id,
    Date.now(),
  );
}

async function upsertCard(database: SQLite.SQLiteDatabase, card: Card): Promise<void> {
  const updated = Date.parse(card.updated_at ?? new Date().toISOString());
  await database.runAsync(
    `INSERT INTO cards(id, deck, front, back, pinyin, note, box, due_at, lapses, reps, updated_at, dirty)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,0)
     ON CONFLICT(id) DO UPDATE SET
       deck=excluded.deck, front=excluded.front, back=excluded.back,
       pinyin=excluded.pinyin, note=excluded.note, box=excluded.box,
       due_at=excluded.due_at, lapses=excluded.lapses, reps=excluded.reps,
       updated_at=excluded.updated_at
     WHERE cards.dirty = 0`,
    card.id,
    card.deck,
    card.front,
    card.back,
    card.pinyin ?? '',
    card.note ?? '',
    card.box,
    Date.parse(card.due_at),
    card.lapses,
    card.reps,
    Number.isNaN(updated) ? Date.now() : updated,
  );
}

export async function applyChanges(changes: Changes): Promise<void> {
  const database = await db();
  await database.withTransactionAsync(async () => {
    for (const card of changes.cards) {
      await upsertCard(database, card);
    }
    for (const id of changes.deleted) {
      await database.runAsync('DELETE FROM cards WHERE id = ?', id);
      await database.runAsync('DELETE FROM tombstones WHERE id = ? AND pushed = 1', id);
    }
    await database.runAsync(
      `INSERT INTO meta(key, value) VALUES('since', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      String(changes.now),
    );
  });
}

export async function lastSince(): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'since'`,
  );
  return row ? Number(row.value) : 0;
}

export async function dirtyCards(): Promise<Card[]> {
  const database = await db();
  const rows = await database.getAllAsync<Row>('SELECT * FROM cards WHERE dirty = 1');
  return rows.map(toCard);
}

export async function clearDirty(id: string): Promise<void> {
  const database = await db();
  await database.runAsync('UPDATE cards SET dirty = 0 WHERE id = ?', id);
}

export async function unpushedDeletes(): Promise<string[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ id: string }>(
    'SELECT id FROM tombstones WHERE pushed = 0',
  );
  return rows.map((row) => row.id);
}

export async function markDeletePushed(id: string): Promise<void> {
  const database = await db();
  await database.runAsync('UPDATE tombstones SET pushed = 1 WHERE id = ?', id);
}

export async function cachedCount(): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM cards');
  return row?.total ?? 0;
}

export async function dueSummary(now = Date.now()): Promise<{ total: number; due: number }> {
  const database = await db();
  const row = await database.getFirstAsync<{ total: number; due: number }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END), 0) AS due
     FROM cards`,
    now,
  );
  return { total: row?.total ?? 0, due: row?.due ?? 0 };
}

export async function applyReview(
  cardId: string,
  known: boolean,
  now = Date.now(),
): Promise<Schedule> {
  const database = await db();
  const row = await database.getFirstAsync<Row>('SELECT * FROM cards WHERE id = ?', cardId);
  if (!row) {
    return { box: 0, due_at: now, lapses: 0, reps: 0 };
  }

  const next = nextSchedule(
    { box: row.box, due_at: row.due_at, lapses: row.lapses, reps: row.reps },
    known,
    now,
  );

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'UPDATE cards SET box=?, due_at=?, lapses=?, reps=? WHERE id=?',
      next.box,
      next.due_at,
      next.lapses,
      next.reps,
      cardId,
    );
    await database.runAsync(
      'INSERT INTO reviews(card_id, ts, known) VALUES(?,?,?)',
      cardId,
      now,
      known ? 1 : 0,
    );
  });
  return next;
}

export async function allCards(search: string, limit = 300): Promise<Card[]> {
  const database = await db();
  const like = `%${search.trim()}%`;
  const rows = await database.getAllAsync<Row>(
    `SELECT * FROM cards
     WHERE front LIKE ? OR back LIKE ? OR pinyin LIKE ? OR note LIKE ?
     ORDER BY deck, front LIMIT ?`,
    like,
    like,
    like,
    like,
    limit,
  );
  return rows.map(toCard);
}
