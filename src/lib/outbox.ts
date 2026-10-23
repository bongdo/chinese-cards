import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Config } from '../types';
import { api } from './api';

const KEY = 'chinese.outbox.v1';
const LIMIT = 500;

export type Pending = {
  card_id: string;
  known: boolean;
  elapsed_ms: number;
  at: number;
};

async function read(): Promise<Pending[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Pending[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(items: Pending[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items.slice(-LIMIT)));
}

export async function enqueue(item: Omit<Pending, 'at'>): Promise<void> {
  const items = await read();
  items.push({ ...item, at: Date.now() });
  await write(items);
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

export async function flush(config: Config): Promise<{ sent: number; left: number }> {
  const items = await read();
  if (items.length === 0) return { sent: 0, left: 0 };

  const failed: Pending[] = [];
  let sent = 0;
  for (const item of items) {
    try {
      await api.review(config, item.card_id, item.known, item.elapsed_ms);
      sent++;
    } catch {
      failed.push(item);
    }
  }
  await write(failed);
  return { sent, left: failed.length };
}
