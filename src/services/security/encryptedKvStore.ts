/**
 * Encrypted key-value store sobre IndexedDB.
 *
 * Combinación de `browserEnvelope` + `deviceKek` en un store
 * tipado que cualquier feature puede usar como reemplazo drop-in
 * de `idb-keyval` cuando los valores son sensibles (PHI, contenido
 * de SLM con datos personales, queue offline con identificadores).
 *
 * API mirror parcial de `idb-keyval`:
 *   - `setEncrypted(key, value)`     → encripta + persiste
 *   - `getEncrypted(key)`            → recupera + desencripta
 *   - `deleteEncrypted(key)`         → borra
 *   - `listEncryptedKeys()`          → solo keys, NO contenido
 *   - `clearEncryptedStore()`        → wipe completo (logout)
 *
 * Values JSON-serializables. Strings, objects, arrays — siempre y
 * cuando JSON.stringify round-trip. NO ArrayBuffer ni Date directos
 * (el caller debe serializar/parsear).
 *
 * Threat model:
 *   - Disco físico → ciphertext inútil sin la KEK no-exportable
 *   - DevTools (mismo origen) → puede invocar getEncrypted SI la
 *     KEK aún está disponible. Mitigación: deleteDeviceKek en
 *     logout vacía la KEK haciendo el ciphertext irrecuperable.
 */

import { openDB, type IDBPDatabase } from 'idb';
import {
  decryptEnvelope,
  encryptEnvelope,
  validateEnvelope,
  type BrowserEnvelope,
} from './browserEnvelope';
import { getOrCreateDeviceKek } from './deviceKek';

const DB_NAME = 'praeventio-encrypted-kv';
const STORE = 'kv';
const DB_VERSION = 1;

interface EncryptedRecord {
  /** El key del usuario. */
  id: string;
  /** El envelope completo. */
  envelope: BrowserEnvelope;
  /** Last update timestamp ISO. */
  updatedAt: string;
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
export function __resetEncryptedKvForTests(): void {
  dbPromise = null;
}

/**
 * Persiste `value` (JSON-serializable) encriptado bajo `key`. Si ya
 * existe un record con ese key, se sobrescribe.
 */
export async function setEncrypted<T>(key: string, value: T): Promise<void> {
  const kek = await getOrCreateDeviceKek();
  const plaintext = JSON.stringify(value);
  const envelope = await encryptEnvelope(plaintext, kek, key);
  const record: EncryptedRecord = {
    id: key,
    envelope,
    updatedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db.put(STORE, record);
}

/**
 * Lee y desencripta el value bajo `key`. Devuelve `null` si no
 * existe, o lanza si el envelope está corrupto / KEK no descifra.
 */
export async function getEncrypted<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const record = (await db.get(STORE, key)) as EncryptedRecord | undefined;
  if (!record) return null;
  validateEnvelope(record.envelope);
  const kek = await getOrCreateDeviceKek();
  const plaintext = await decryptEnvelope(record.envelope, kek);
  return JSON.parse(plaintext) as T;
}

/**
 * Borra el record bajo `key`. Idempotent.
 */
export async function deleteEncrypted(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, key);
}

/**
 * Lista solo los keys del store — NO desencripta nada. Útil para
 * UI de "qué tengo cacheado" sin pagar el costo de N decrypts.
 */
export async function listEncryptedKeys(): Promise<string[]> {
  const db = await getDb();
  const keys = (await db.getAllKeys(STORE)) as string[];
  return keys.slice().sort();
}

/**
 * Vacía completamente el store. Útil para logout — combinar con
 * `deleteDeviceKek()` para destruir definitivamente toda capacidad
 * de desencriptar los blobs (incluso si quedaron en otra DB por bug).
 */
export async function clearEncryptedStore(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}

/**
 * Helper: existence check sin desencriptar.
 */
export async function hasEncrypted(key: string): Promise<boolean> {
  const db = await getDb();
  const count = await db.count(STORE, key);
  return count > 0;
}

/**
 * Metadata de un record SIN desencriptar el contenido. Útil para
 * staleness check antes de pagar el decrypt.
 */
export interface EncryptedRecordMeta {
  id: string;
  updatedAt: string;
  /** Tamaño aproximado del ciphertext (chars del base64). */
  ciphertextLength: number;
}

export async function getEncryptedMeta(
  key: string,
): Promise<EncryptedRecordMeta | null> {
  const db = await getDb();
  const record = (await db.get(STORE, key)) as EncryptedRecord | undefined;
  if (!record) return null;
  return {
    id: record.id,
    updatedAt: record.updatedAt,
    ciphertextLength: record.envelope.ciphertext.length,
  };
}

/**
 * Lee el envelope crudo SIN intentar descifrar. Útil para flujos de
 * rotación de KEK donde el caller necesita acceder al ciphertext +
 * wrappedDek bajo la KEK vieja (que el store por default no usa más).
 *
 * Devuelve `null` si no existe el record.
 */
export async function getRawEnvelope(
  key: string,
): Promise<BrowserEnvelope | null> {
  const db = await getDb();
  const record = (await db.get(STORE, key)) as EncryptedRecord | undefined;
  if (!record) return null;
  return record.envelope;
}

/**
 * Escribe un envelope crudo bajo `key`. NO encripta ni envuelve —
 * asume que el caller ya tiene un envelope válido (típicamente
 * resultado de `rewrapEnvelope` durante rotación de KEK).
 *
 * El `updatedAt` se setea a `now()` para que la metadata refleje
 * la rotación.
 */
export async function setRawEnvelope(
  key: string,
  envelope: BrowserEnvelope,
): Promise<void> {
  validateEnvelope(envelope);
  const record: EncryptedRecord = {
    id: key,
    envelope,
    updatedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db.put(STORE, record);
}
