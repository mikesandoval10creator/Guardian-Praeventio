/**
 * Encrypted persistence adapter para `GenericOutboxEngine`.
 *
 * Cualquier feature que use el outbox para data sensible (incident
 * report con identificadores personales, site book entry con datos
 * de trabajadores, audit con PII) cablea este adapter en lugar del
 * in-memory.
 *
 * Bajo el capó:
 *   - Cada entry se serializa a JSON
 *   - Se cifra con `encryptedKvStore` (#230) que usa envelope AES-256-GCM
 *     wrapped con la KEK device-bound no-exportable
 *   - Una key index lista todos los clientEventIds activos (sin
 *     contenido — solo IDs) para evitar paginación N×decrypt
 *
 * Threat model:
 *   - Disco físico compromise → ciphertext útil solo con la KEK que
 *     vive en el subsistema cripto del browser, no en disco
 *   - Logout: caller llama `deleteDeviceKek()` + `clearAll()` y los
 *     blobs quedan irrecuperables
 *
 * Diseño isolación de namespace: cada feature pasa un `namespace` único
 * (ej. `'incidents'`, `'siteBook'`). El adapter prefija las keys del
 * encrypted store con `${namespace}::` para que features distintas no
 * choquen y se puedan listar/limpiar independientemente.
 */

import {
  deleteEncrypted,
  getEncrypted,
  listEncryptedKeys,
  setEncrypted,
} from '../security/encryptedKvStore';
import type {
  OutboxAdapter,
  OutboxEntry,
} from './genericOutboxEngine';

const INDEX_SUFFIX = '__index';

interface IndexValue {
  /** clientEventIds activos en este namespace. */
  ids: string[];
}

function namespaceKey(namespace: string, suffix: string): string {
  return `outbox::${namespace}::${suffix}`;
}

function entryKey(namespace: string, clientEventId: string): string {
  return namespaceKey(namespace, clientEventId);
}

function indexKey(namespace: string): string {
  return namespaceKey(namespace, INDEX_SUFFIX);
}

async function readIndex(namespace: string): Promise<string[]> {
  const idx = await getEncrypted<IndexValue>(indexKey(namespace));
  return idx?.ids ?? [];
}

async function writeIndex(namespace: string, ids: string[]): Promise<void> {
  // Dedup defensivo + orden estable para que dos clientes con la misma
  // operación produzcan el mismo blob (testability).
  const sorted = Array.from(new Set(ids)).sort();
  await setEncrypted<IndexValue>(indexKey(namespace), { ids: sorted });
}

/**
 * Construye un `OutboxAdapter<T>` cifrado para una feature específica.
 *
 * @param namespace  Prefijo único de la feature (ej. `'incidents'`).
 *                   No usar `'::'` en el namespace — colisiona con el
 *                   separador interno.
 */
export function createEncryptedOutboxAdapter<T>(
  namespace: string,
): OutboxAdapter<T> {
  if (namespace.includes('::')) {
    throw new Error(
      `createEncryptedOutboxAdapter: namespace '${namespace}' contains forbidden '::' separator`,
    );
  }
  if (namespace.length === 0) {
    throw new Error('createEncryptedOutboxAdapter: namespace empty');
  }

  return {
    async listEntries() {
      const ids = await readIndex(namespace);
      const out: OutboxEntry<T>[] = [];
      for (const id of ids) {
        const entry = await getEncrypted<OutboxEntry<T>>(entryKey(namespace, id));
        if (entry) {
          out.push(entry);
        }
      }
      return out;
    },

    async saveEntry(entry) {
      const id = entry.event.clientEventId;
      await setEncrypted<OutboxEntry<T>>(entryKey(namespace, id), entry);
      // Actualizamos el index — leemos, mergeamos, escribimos.
      const ids = await readIndex(namespace);
      if (!ids.includes(id)) {
        await writeIndex(namespace, [...ids, id]);
      }
    },

    async deleteEntry(clientEventId) {
      await deleteEncrypted(entryKey(namespace, clientEventId));
      const ids = await readIndex(namespace);
      const filtered = ids.filter((x) => x !== clientEventId);
      if (filtered.length !== ids.length) {
        await writeIndex(namespace, filtered);
      }
    },
  };
}

/**
 * Helper para limpiar TODO un namespace (logout / factory reset).
 * Itera el index + borra cada entry + borra el index. Idempotente.
 */
export async function clearOutboxNamespace(namespace: string): Promise<void> {
  const ids = await readIndex(namespace);
  for (const id of ids) {
    await deleteEncrypted(entryKey(namespace, id));
  }
  await deleteEncrypted(indexKey(namespace));
}

/**
 * Lista los namespaces actualmente con data — útil para una UI que
 * muestra "cuántas cosas hay en cola por feature". Hace un scan del
 * encrypted store buscando las keys `outbox::*::__index`.
 */
export async function listOutboxNamespaces(): Promise<string[]> {
  const allKeys = await listEncryptedKeys();
  const prefix = 'outbox::';
  const suffix = `::${INDEX_SUFFIX}`;
  const namespaces: string[] = [];
  for (const k of allKeys) {
    if (k.startsWith(prefix) && k.endsWith(suffix)) {
      namespaces.push(k.slice(prefix.length, -suffix.length));
    }
  }
  return namespaces.sort();
}
