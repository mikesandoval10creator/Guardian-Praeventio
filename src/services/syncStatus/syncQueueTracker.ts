// Praeventio Guard — Sprint 39 Fase H.3: Estado Sincronización Visible.
//
// Cierra: Documento usuario "Recomendaciones nuevas §148"
//         Plan integral Top 15 #15
//
// La PWA / mobile escribe local-first (IndexedDB / SQLite) y luego
// sincroniza con Firestore. Sin feedback claro al usuario:
//   - "¿Guardé esto?"
//   - "¿Por qué no aparece en el dashboard?"
//   - "¿Mi cambio se perdió?"
//
// Este servicio maneja la COLA local de cambios pendientes y deriva
// estados visibles:
//   - saved_local: persistido en IndexedDB
//   - syncing: subiendo ahora
//   - synced: en Firestore
//   - sync_error: falla transitoria, se reintenta
//   - sync_failed: agotó reintentos, requiere atención

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SyncStatus =
  | 'saved_local'
  | 'syncing'
  | 'synced'
  | 'sync_error'
  | 'sync_failed';

export interface SyncItem {
  /** Content-addressed id (sha256 del payload). Idempotencia. */
  id: string;
  /** Collection destino en Firestore. */
  collection: string;
  /** Operation: create / update / delete. */
  op: 'create' | 'update' | 'delete';
  /** Documento a escribir (subset de campos que cambiaron). */
  payload: Record<string, unknown>;
  /** Status actual derivado. */
  status: SyncStatus;
  createdAt: string;
  /** Último intento. */
  lastAttemptAt?: string;
  /** Cuándo se sincronizó. */
  syncedAt?: string;
  /** Cuántos intentos llevamos. */
  attempts: number;
  /** Próximo retry (backoff exponencial). */
  nextRetryAt?: string;
  /** Última error message (truncated). */
  lastError?: string;
}

export interface CreateItemInput {
  collection: string;
  op: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  now?: Date;
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30 * 1000; // 30s
const BACKOFF_FACTOR = 2; // exponencial: 30s, 60s, 120s, 240s, 480s

// ────────────────────────────────────────────────────────────────────────
// Item creation
// ────────────────────────────────────────────────────────────────────────

export function computeItemId(
  collection: string,
  op: string,
  payload: Record<string, unknown>,
): string {
  const canonical = `${collection}\x00${op}\x00${JSON.stringify(payload)}`;
  return bytesToHex(sha256(new TextEncoder().encode(canonical))).slice(0, 32);
}

export function createItem(input: CreateItemInput): SyncItem {
  const now = input.now ?? new Date();
  return {
    id: computeItemId(input.collection, input.op, input.payload),
    collection: input.collection,
    op: input.op,
    payload: input.payload,
    status: 'saved_local',
    createdAt: now.toISOString(),
    attempts: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Lifecycle transitions
// ────────────────────────────────────────────────────────────────────────

export function markSyncing(item: SyncItem, now: Date = new Date()): SyncItem {
  if (item.status === 'synced') return item;
  return {
    ...item,
    status: 'syncing',
    attempts: item.attempts + 1,
    lastAttemptAt: now.toISOString(),
  };
}

export function markSynced(item: SyncItem, now: Date = new Date()): SyncItem {
  return {
    ...item,
    status: 'synced',
    syncedAt: now.toISOString(),
    nextRetryAt: undefined,
    lastError: undefined,
  };
}

export function markSyncError(
  item: SyncItem,
  errorMessage: string,
  now: Date = new Date(),
): SyncItem {
  const newStatus: SyncStatus = item.attempts >= MAX_ATTEMPTS ? 'sync_failed' : 'sync_error';
  const backoffMs =
    newStatus === 'sync_failed'
      ? 0
      : BASE_BACKOFF_MS * Math.pow(BACKOFF_FACTOR, item.attempts - 1);
  return {
    ...item,
    status: newStatus,
    lastError: errorMessage.slice(0, 500),
    nextRetryAt:
      newStatus === 'sync_failed'
        ? undefined
        : new Date(now.getTime() + backoffMs).toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Queue queries
// ────────────────────────────────────────────────────────────────────────

export interface QueueSummary {
  totalItems: number;
  byStatus: Record<SyncStatus, number>;
  nextRetryAt?: string;
  /** Items que necesitan atención del usuario (sync_failed). */
  failedItems: SyncItem[];
}

export function summarizeQueue(items: SyncItem[]): QueueSummary {
  const byStatus: Record<SyncStatus, number> = {
    saved_local: 0,
    syncing: 0,
    synced: 0,
    sync_error: 0,
    sync_failed: 0,
  };
  let nextRetry: string | undefined;
  const failed: SyncItem[] = [];

  for (const i of items) {
    byStatus[i.status] += 1;
    if (i.status === 'sync_failed') failed.push(i);
    if (i.nextRetryAt && (nextRetry === undefined || i.nextRetryAt < nextRetry)) {
      nextRetry = i.nextRetryAt;
    }
  }

  return {
    totalItems: items.length,
    byStatus,
    nextRetryAt: nextRetry,
    failedItems: failed,
  };
}

/**
 * Filtra items listos para reintento ahora. El caller los procesa en
 * orden FIFO (createdAt asc).
 */
export function findItemsReadyForRetry(
  items: SyncItem[],
  now: Date = new Date(),
): SyncItem[] {
  return items
    .filter((i) => i.status === 'sync_error' && i.nextRetryAt && i.nextRetryAt <= now.toISOString())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Items que el usuario ve como "pendientes" — todo lo no synced.
 */
export function countPending(items: SyncItem[]): number {
  return items.filter((i) => i.status !== 'synced').length;
}

// ────────────────────────────────────────────────────────────────────────
// UI badge derivation
// ────────────────────────────────────────────────────────────────────────

export type SyncBadgeColor = 'green' | 'amber' | 'red' | 'blue';

export interface SyncBadge {
  color: SyncBadgeColor;
  label: string;
  /** Conteo principal (pending items). */
  count: number;
}

export function deriveBadge(summary: QueueSummary): SyncBadge {
  const pending = summary.totalItems - summary.byStatus.synced;
  if (summary.byStatus.sync_failed > 0) {
    return {
      color: 'red',
      label: `${summary.byStatus.sync_failed} fallido(s)`,
      count: summary.byStatus.sync_failed,
    };
  }
  if (summary.byStatus.syncing > 0) {
    return { color: 'blue', label: 'Sincronizando…', count: summary.byStatus.syncing };
  }
  if (pending > 0) {
    return { color: 'amber', label: `${pending} por sincronizar`, count: pending };
  }
  return { color: 'green', label: 'Todo sincronizado', count: 0 };
}
