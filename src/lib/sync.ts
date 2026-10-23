import type { Config } from '../types';
import { api } from './api';
import {
  applyChanges,
  clearDirty,
  dirtyCards,
  lastSince,
  markDeletePushed,
  unpushedDeletes,
} from './db';

export type SyncResult = {
  pushed: number;
  deleted: number;
  pulled: number;
  failed: number;
};

export async function sync(config: Config): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, deleted: 0, pulled: 0, failed: 0 };

  for (const id of await unpushedDeletes()) {
    try {
      await api.deleteCard(config, id);
      await markDeletePushed(id);
      result.deleted++;
    } catch {
      result.failed++;
    }
  }

  for (const card of await dirtyCards()) {
    try {
      await api.updateCard(config, card.id, {
        front: card.front,
        back: card.back,
        pinyin: card.pinyin ?? '',
        note: card.note ?? '',
      });
      await clearDirty(card.id);
      result.pushed++;
    } catch {
      result.failed++;
    }
  }

  const since = await lastSince();
  const changes = await api.changes(config, since);
  await applyChanges(changes);
  result.pulled = changes.cards.length + changes.deleted.length;

  return result;
}
