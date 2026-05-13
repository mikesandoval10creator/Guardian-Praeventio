// Praeventio Guard — Sprint 41 F.6: Modo Sin Señal para Inspecciones.
//
// Motor puro (sin I/O) que opera sobre InspectionTemplate / InspectionSession
// como objetos inmutables. La persistencia IndexedDB y el upload de blobs
// los maneja el caller — este servicio solo provee:
//
//   • startInspection(): crea una InspectionSession con sessionId
//     determinístico (sha256 de {templateId, projectId, workerUid, startedAt})
//     para que el mismo arranque produzca el mismo id (idempotencia).
//   • recordObservation(): appendea/actualiza una observación, retornando
//     una nueva session (inmutable, sin mutar el input).
//   • validateSession(): chequea que cada InspectionItem (asumidas todas
//     required en el modo F.6 inicial) tenga respuesta.
//   • prepareForSync(): serializa la session a un shape JSON-safe (omite
//     Blobs; reemplaza con un placeholder de storage path).
//   • markSynced(): cambia syncStatus a 'synced' y setea syncedAt.
//
// Diseño:
//   - 100% determinístico para entrada fija.
//   - No usa `Date.now()` ni `crypto.randomUUID()` salvo cuando el caller
//     no proveyó timestamp explícito.
//   - Compatible con offline-first: la session se crea, se modifica y se
//     valida sin necesidad de red.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type InspectionItemKind = 'yes_no' | 'photo' | 'text' | 'rating';

export interface InspectionItem {
  /** ID estable del item dentro del template. */
  id: string;
  /** Texto mostrado al inspector. */
  label: string;
  /** Tipo de respuesta esperado. */
  kind: InspectionItemKind;
  /** Si false, el item es opcional. Default: true. */
  required?: boolean;
}

export interface InspectionTemplate {
  id: string;
  title: string;
  items: InspectionItem[];
}

/**
 * Respuesta a un item.
 * - yes_no  → boolean
 * - text    → string
 * - rating  → number (1..5)
 * - photo   → undefined (la imagen vive en photoBlob)
 */
export type InspectionResponse = boolean | string | number | undefined;

export interface InspectionObservation {
  itemId: string;
  response: InspectionResponse;
  notes?: string;
  /** Blob de la foto, solo en memoria. prepareForSync lo omite. */
  photoBlob?: Blob;
  /** Path en storage tras upload. Lo setea el caller post-upload. */
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
}

export type InspectionSyncStatus =
  | 'draft'
  | 'pending_sync'
  | 'syncing'
  | 'synced'
  | 'sync_error';

export interface InspectionSession {
  id: string;
  templateId: string;
  projectId: string;
  workerUid: string;
  /** ISO timestamp del arranque (determinístico al recrearse). */
  startedAt: string;
  observations: InspectionObservation[];
  syncStatus: InspectionSyncStatus;
  syncedAt?: string;
  syncError?: string;
}

export interface StartInspectionContext {
  projectId: string;
  workerUid: string;
  /** ISO string; si se omite, el caller debe haber congelado new Date(). */
  startedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// ID computation (content-addressed, determinístico)
// ────────────────────────────────────────────────────────────────────────

export function computeSessionId(
  templateId: string,
  projectId: string,
  workerUid: string,
  startedAt: string,
): string {
  const canonical = `${templateId}\x00${projectId}\x00${workerUid}\x00${startedAt}`;
  return bytesToHex(sha256(new TextEncoder().encode(canonical))).slice(0, 32);
}

// ────────────────────────────────────────────────────────────────────────
// Lifecycle: start / record / validate
// ────────────────────────────────────────────────────────────────────────

export function startInspection(
  templateId: string,
  ctx: StartInspectionContext,
): InspectionSession {
  if (!templateId) throw new Error('templateId required');
  if (!ctx.projectId) throw new Error('projectId required');
  if (!ctx.workerUid) throw new Error('workerUid required');
  if (!ctx.startedAt) throw new Error('startedAt required');

  return {
    id: computeSessionId(templateId, ctx.projectId, ctx.workerUid, ctx.startedAt),
    templateId,
    projectId: ctx.projectId,
    workerUid: ctx.workerUid,
    startedAt: ctx.startedAt,
    observations: [],
    syncStatus: 'draft',
  };
}

/**
 * Appendea o sustituye la observación del item dado. Inmutable.
 */
export function recordObservation(
  session: InspectionSession,
  itemId: string,
  response: InspectionResponse,
  extras: Partial<Pick<InspectionObservation, 'notes' | 'photoBlob' | 'locationLatLng'>> = {},
): InspectionSession {
  if (!itemId) throw new Error('itemId required');

  const filtered = session.observations.filter((o) => o.itemId !== itemId);
  const next: InspectionObservation = {
    itemId,
    response,
    ...(extras.notes !== undefined ? { notes: extras.notes } : {}),
    ...(extras.photoBlob !== undefined ? { photoBlob: extras.photoBlob } : {}),
    ...(extras.locationLatLng !== undefined
      ? { locationLatLng: extras.locationLatLng }
      : {}),
  };

  return {
    ...session,
    observations: [...filtered, next],
  };
}

export interface ValidationResult {
  valid: boolean;
  missingItemIds: string[];
}

/**
 * Una observación se considera respondida si:
 *  - yes_no/rating/text: response !== undefined && response !== ''
 *  - photo: photoBlob presente o photoStoragePath presente
 */
export function validateSession(
  session: InspectionSession,
  template: InspectionTemplate,
): ValidationResult {
  const byId = new Map(session.observations.map((o) => [o.itemId, o]));
  const missing: string[] = [];

  for (const item of template.items) {
    const isRequired = item.required !== false;
    if (!isRequired) continue;
    const obs = byId.get(item.id);
    if (!obs) {
      missing.push(item.id);
      continue;
    }
    if (item.kind === 'photo') {
      if (!obs.photoBlob && !obs.photoStoragePath) missing.push(item.id);
      continue;
    }
    if (obs.response === undefined || obs.response === '') {
      missing.push(item.id);
    }
  }

  return { valid: missing.length === 0, missingItemIds: missing };
}

// ────────────────────────────────────────────────────────────────────────
// Sync preparation
// ────────────────────────────────────────────────────────────────────────

export interface SerializedObservation {
  itemId: string;
  response: InspectionResponse;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
}

export interface SerializedInspectionSession {
  id: string;
  templateId: string;
  projectId: string;
  workerUid: string;
  startedAt: string;
  observations: SerializedObservation[];
  syncStatus: InspectionSyncStatus;
  syncedAt?: string;
}

/**
 * Serializa session a un shape JSON-safe. Omite Blobs (los uploadea el
 * caller a Storage previo a llamar prepareForSync, sustituyendo por
 * photoStoragePath). Si todavía hay un Blob sin path, se reemplaza por
 * el placeholder 'pending-upload://{itemId}' para que sea evidente al
 * leer el JSON que faltó un upload.
 */
export function prepareForSync(
  session: InspectionSession,
): SerializedInspectionSession {
  return {
    id: session.id,
    templateId: session.templateId,
    projectId: session.projectId,
    workerUid: session.workerUid,
    startedAt: session.startedAt,
    syncStatus: session.syncStatus === 'draft' ? 'pending_sync' : session.syncStatus,
    syncedAt: session.syncedAt,
    observations: session.observations.map((o) => {
      const serialized: SerializedObservation = {
        itemId: o.itemId,
        response: o.response,
      };
      if (o.notes !== undefined) serialized.notes = o.notes;
      if (o.locationLatLng !== undefined) serialized.locationLatLng = o.locationLatLng;
      if (o.photoStoragePath) {
        serialized.photoStoragePath = o.photoStoragePath;
      } else if (o.photoBlob) {
        serialized.photoStoragePath = `pending-upload://${o.itemId}`;
      }
      return serialized;
    }),
  };
}

export function markSynced(
  session: InspectionSession,
  syncedAt: string,
): InspectionSession {
  return {
    ...session,
    syncStatus: 'synced',
    syncedAt,
    syncError: undefined,
  };
}
