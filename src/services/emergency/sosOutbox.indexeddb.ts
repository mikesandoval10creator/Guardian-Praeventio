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
  /**
   * [P0][VIDA-SAFETY] Hy3-audit 3c3aa66d-73fe-8167-90ae-ec60dbb94c6c
   * (reabierto 2026-08-24): este adapter NO tiene mutex propio. El
   * engine (SosOutbox en sosOutbox.ts:129) serializa load/save/clear
   * vía `private mutation: Promise<unknown>` — toda escritura DEBE
   * pasar por el engine para evitar read-modify-write race que
   * sobrescriba un SOS concurrente. Cualquier caller que invoque
   * load() o save() directamente fuera del engine es un bug de
   * data-loss esperando a ocurrir.
   *
   * El fix completo (mover el lock al adapter) es scope > 1 archivo
   * y cambia el contrato del engine. Por ahora la invariante queda
   * documentada aquí como guard contra mal uso futuro.
   */
  async load(): Promise<OutboxEntry[]> {
    try {
      const raw = await get<OutboxEntry[]>(STORAGE_KEY);
      if (Array.isArray(raw)) return raw;
      // Distinguish "no key set yet" (legitimate first run) from "key set
      // but stored value isn't an array" (real corruption/schema drift).
      if (raw === undefined || raw === null) return [];
      // raw is NOT an array here — could be string, number, object, etc.
      // Log type and length for forense. Do NOT return []: the next enqueue
      // would then save only the new SOS and overwrite the stored value.
      const rawAsUnknown: unknown = raw;
      const rawType: string = typeof rawAsUnknown;
      const rawLength: string =
        typeof rawAsUnknown === 'string' || Array.isArray(rawAsUnknown)
          ? String((rawAsUnknown as { length: number }).length)
          : 'N/A';
      logger.error(
        'sosOutbox: IndexedDB load returned non-array (corruption or schema mismatch). ' +
        'Refusing to overwrite. Investigate before this happens again — offline SOS may be lost.',
        { rawType, rawIsNull: rawAsUnknown === null, rawLength },
      );
      throw new Error('sos_outbox_corrupt');
    } catch (err) {
      // IndexedDB unavailable (private mode / quota). Propagate the failure:
      // returning an empty queue here would make the next enqueue overwrite
      // any SOS already persisted. Callers (SOSButton) already fall back to
      // tel: and surface "no se pudo enviar" when enqueue rejects.
      logger.warn('sosOutbox: IndexedDB load failed — refusing to overwrite the queue', {
        err: String(err),
      });
      throw err;
    }
  }

  async save(entries: OutboxEntry[]): Promise<void> {
    // Propagate save errors so the caller (enqueue) knows the SOS was NOT
    // durably persisted and can fall back (tel:) instead of assuming success.
    await set(STORAGE_KEY, entries);
  }
}
