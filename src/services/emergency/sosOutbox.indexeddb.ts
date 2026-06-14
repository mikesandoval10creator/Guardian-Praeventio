// Praeventio Guard — production IndexedDB persistence for the SOS outbox.
//
// Referenced by sosOutbox.ts:10 (the engine is pure + storage-injected; tests
// use InMemorySosStorage, prod uses THIS). Backed by idb-keyval — the same
// durable store the rest of the app's offline state already uses
// (NotificationContext, ThemeContext, RootLayout) — under a single versioned
// key holding the whole queue.
//
// NOTE on encryption: a SOS event carries the worker's uid + coarse coords
// (lat/lng to 5 decimals). That is mildly sensitive but lives only on the
// worker's OWN device, and reliability of the life-safety queue is paramount.
// This matches the unencrypted idb-keyval used elsewhere in the app;
// encryption-at-rest (mirroring genericOutboxEngine's encrypted IDB) is a
// documented follow-up, not a blocker for never-losing an offline SOS.

import { get, set } from 'idb-keyval';
import type { OutboxEntry, SosOutboxStorage } from './sosOutbox';
import { logger } from '../../utils/logger';

const STORAGE_KEY = 'praeventio:sos-outbox:v1';

export class IndexedDbSosStorage implements SosOutboxStorage {
  async load(): Promise<OutboxEntry[]> {
    try {
      const raw = await get<OutboxEntry[]>(STORAGE_KEY);
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      // IndexedDB unavailable (private mode / quota) — degrade to empty rather
      // than crashing the flush loop. Logged, never silent.
      logger.warn('sosOutbox: IndexedDB load failed', { err: String(err) });
      return [];
    }
  }

  async save(entries: OutboxEntry[]): Promise<void> {
    // Propagate save errors so the caller (enqueue) knows the SOS was NOT
    // durably persisted and can fall back (tel:) instead of assuming success.
    await set(STORAGE_KEY, entries);
  }
}
