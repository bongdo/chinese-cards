import type { Card, Changes, Config } from '../types';
import { baseUrls } from './config';
import type { Schedule } from './scheduler';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const TIMEOUT_MS = 8000;

let preferred = 0;

async function request<T>(config: Config, path: string, init?: RequestInit): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < baseUrls.length; attempt++) {
    const index = (preferred + attempt) % baseUrls.length;
    try {
      const result = await once<T>(baseUrls[index], config, path, init);
      preferred = index;
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError && error.status > 0) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError('Нет связи с сервером', 0);
}

async function once<T>(
  base: string,
  config: Config,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(base.replace(/\/+$/, '') + path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    const text = await response.text();
    if (!response.ok) {
      let message = text || `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
      }
      throw new ApiError(message, response.status);
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Сервер не ответил вовремя', 0);
    }
    throw new ApiError(error instanceof Error ? error.message : 'Нет связи с сервером', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: (config: Config) => request<{ ok: boolean }>(config, '/api/health'),

  review: (config: Config, cardId: string, known: boolean, elapsedMs: number, schedule?: Schedule, eventId?: string) =>
    request<{ card: Card; interval: string }>(config, '/api/review', {
      method: 'POST',
      body: JSON.stringify({
        card_id: cardId,
        known,
        elapsed_ms: Math.max(0, Math.round(elapsedMs)),
        ...(eventId ? { event_id: eventId } : {}),
        ...(schedule
          ? {
              box: schedule.box,
              due_at: schedule.due_at,
              lapses: schedule.lapses,
              reps: schedule.reps,
            }
          : {}),
      }),
    }),

  changes: (config: Config, since: number) =>
    request<Changes>(config, `/api/changes?since=${since}`),

  updateCard: (
    config: Config,
    id: string,
    fields: { front: string; back: string; pinyin: string; note: string },
  ) =>
    request<Card>(config, `/api/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),

  deleteCard: (config: Config, id: string) =>
    request<null>(config, `/api/cards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
