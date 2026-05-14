/**
 * Device-bound Key Encryption Key (KEK).
 *
 * Genera y persiste en IndexedDB una `CryptoKey` AES-GCM no-exportable
 * que sirve como wrapping key para `browserEnvelope.ts`. La clave:
 *
 *   - Se genera UNA VEZ por instalación (primer launch que pida la
 *     KEK).
 *   - Se persiste en IDB como `CryptoKey` con `extractable=false` —
 *     el material crudo NUNCA sale del SubtleCrypto. JavaScript del
 *     mismo origen puede USARLA (encrypt/decrypt) pero no leerla.
 *   - Si el usuario borra los datos del navegador, se pierde la KEK
 *     y todo el ciphertext queda irrecuperable. Esto es feature, no
 *     bug — protege el dispositivo prestado/perdido.
 *
 * Para multi-dispositivo (recuperación tras reinstalación), el caller
 * debe implementar un mecanismo separado: passphrase-derived KEK
 * (PBKDF2), sync de KEK encriptado con un master del usuario, etc.
 * Este módulo es PURAMENTE device-bound.
 *
 * Esquema IDB:
 *   - DB:      'praeventio-device-kek'
 *   - Store:   'kek'
 *   - Record:  { id: 'main', key: CryptoKey, createdAt: ISO }
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'praeventio-device-kek';
const STORE = 'kek';
const DB_VERSION = 1;
const KEK_ID = 'main';

interface KekRecord {
  id: string;
  key: CryptoKey;
  createdAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Test-only escape hatch.
 * @internal
 */
export function __resetDeviceKekForTests(): void {
  dbPromise = null;
}

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (!subtle) {
    throw new Error(
      'deviceKek: globalThis.crypto.subtle unavailable (insecure context?)',
    );
  }
  return subtle;
}

/**
 * Genera una nueva KEK AES-256-GCM no-exportable. Solo se llama
 * cuando la IDB no tiene una persistida todavía.
 */
async function generateKek(): Promise<CryptoKey> {
  const subtle = getSubtle();
  return subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // CRITICAL: extractable=false — nadie puede leer raw bytes
    ['encrypt', 'decrypt'],
  );
}

/**
 * Obtiene la KEK del dispositivo. Si no existe, la genera + persiste
 * + devuelve. Si existe, la lee directo del store.
 *
 * El record IDB guarda el `CryptoKey` directamente — IDB lo serializa
 * como referencia interna del subsistema cripto del browser, sin
 * exponer el material crudo. Esta es la magia que permite que
 * `extractable=false` keys sobrevivan entre sesiones.
 */
export async function getOrCreateDeviceKek(
  nowIso: string = new Date().toISOString(),
): Promise<CryptoKey> {
  const db = await getDb();
  const existing = (await db.get(STORE, KEK_ID)) as KekRecord | undefined;
  if (existing && existing.key) {
    return existing.key;
  }
  const key = await generateKek();
  const record: KekRecord = {
    id: KEK_ID,
    key,
    createdAt: nowIso,
  };
  await db.put(STORE, record);
  return key;
}

/**
 * Devuelve la KEK existente o `null` si nunca fue generada. NO genera
 * automáticamente — útil para flujos que necesitan distinguir
 * "primer launch" vs "instalación con datos previos".
 */
export async function tryGetDeviceKek(): Promise<CryptoKey | null> {
  const db = await getDb();
  const existing = (await db.get(STORE, KEK_ID)) as KekRecord | undefined;
  return existing?.key ?? null;
}

/**
 * Sobrescribe la KEK del dispositivo con una nueva (rotación).
 *
 * IMPORTANTE: tras rotar, TODO ciphertext envuelto con la vieja KEK
 * queda irrecuperable. El caller DEBE re-wrap todos los envelopes
 * con la nueva KEK antes de descartarla (ver `browserEnvelope.rewrap-
 * Envelope`).
 *
 * El patrón seguro de rotación:
 *   1. const oldKek = await getOrCreateDeviceKek()
 *   2. const newKek = await rotateDeviceKek()   // sobrescribe
 *   3. forEach envelope: rewrapped = await rewrapEnvelope(env, oldKek, newKek)
 *   4. Persistir los rewrapped envelopes en IDB
 *
 * Si el paso 3 falla a mitad, los envelopes nuevos quedan con KEK
 * nueva y los viejos con KEK vieja — ambos siguen siendo legibles
 * porque tenemos referencias en memoria a oldKek. Pero tras refresh
 * la oldKek se pierde y los no-rewrappeados quedan dead. Por eso
 * cada rewrap debe persistirse atómicamente.
 */
export async function rotateDeviceKek(
  nowIso: string = new Date().toISOString(),
): Promise<CryptoKey> {
  const db = await getDb();
  const newKey = await generateKek();
  const record: KekRecord = {
    id: KEK_ID,
    key: newKey,
    createdAt: nowIso,
  };
  await db.put(STORE, record);
  return newKey;
}

/**
 * Elimina la KEK del dispositivo (e.g. logout del usuario, factory
 * reset). Después de esto, getOrCreateDeviceKek generará una nueva.
 *
 * Idempotent.
 */
export async function deleteDeviceKek(): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, KEK_ID);
}

/**
 * Stats: cuándo se generó la KEK actual + si existe. NO expone la
 * clave misma.
 */
export interface DeviceKekInfo {
  exists: boolean;
  createdAt?: string;
  /** Edad en ms de la KEK actual. Útil para decidir rotación. */
  ageMs?: number;
}

export async function inspectDeviceKek(
  nowIso: string = new Date().toISOString(),
): Promise<DeviceKekInfo> {
  const db = await getDb();
  const existing = (await db.get(STORE, KEK_ID)) as KekRecord | undefined;
  if (!existing) return { exists: false };
  const ageMs = Date.parse(nowIso) - Date.parse(existing.createdAt);
  return {
    exists: true,
    createdAt: existing.createdAt,
    ageMs: Number.isFinite(ageMs) ? ageMs : undefined,
  };
}
