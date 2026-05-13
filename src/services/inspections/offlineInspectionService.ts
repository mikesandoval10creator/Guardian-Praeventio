// Praeventio Guard — Sprint 42 Fase F.6: Modo Sin Señal para Inspecciones.
//
// Cierra Plan F.6 "Modo Sin Señal para Inspecciones".
//
// Permite que un inspector/supervisor ejecute una inspección de terreno
// COMPLETA sin conexión: arranca sesión, registra observaciones (yes/no,
// foto, texto, rating), valida obligatorios, y prepara un payload
// JSON-safe para sync diferido cuando vuelva la señal.
//
// El servicio es 100% determinístico y sin I/O:
//   - No toca IndexedDB ni el FS (lo hace el caller).
//   - No sube Blobs (los reemplaza por un placeholder de storage path).
//   - Mismo input → mismo sessionId (content-addressed con sha256).
//
// Filosofía Praeventio:
//   - Detección Predictiva: capturamos hallazgos en terreno aunque no
//     haya señal → no perdemos riesgos detectados.
//   - Respuesta Adaptativa: el caller decide cuándo y cómo sincronizar.
//   - Consolidación de Conocimiento: las inspecciones se vuelven nodos
//     auditables una vez sincronizadas.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type InspectionItemKind = 'yes_no' | 'photo' | 'text' | 'rating';

export interface InspectionItem {
  id: string;
  label: string;
  kind: InspectionItemKind;
  required: boolean;
}

export interface InspectionTemplate {
  id: string;
  title: string;
  items: InspectionItem[];
}

export interface InspectionContext {
  projectId: string;
  workerUid: string;
  /** Epoch ms cuando arrancó la inspección (provisto por caller). */
  startedAt: number;
}

export type InspectionResponse =
  | { kind: 'yes_no'; value: 'yes' | 'no' | 'na' }
  | { kind: 'photo'; blobRef: string }
  | { kind: 'text'; value: string }
  | { kind: 'rating'; value: number };

export interface InspectionObservation {
  itemId: string;
  response: InspectionResponse;
  notes?: string;
  photoBlobRef?: string;
  locationLatLng?: { lat: number; lng: number };
}

export type InspectionSyncStatus = 'draft' | 'queued' | 'synced';

export interface InspectionSession {
  id: string;
  templateId: string;
  projectId: string;
  workerUid: string;
  startedAt: number;
  observations: InspectionObservation[];
  syncStatus: InspectionSyncStatus;
  syncedAt?: number;
}

export interface ValidationResult {
  valid: boolean;
  missingRequired: string[];
}

/**
 * Payload listo para sync: sin Blobs binarios, photoBlobRef en
 * observation es reemplazado por placeholder de storage path; el
 * caller resuelve el upload real de la foto por separado.
 */
export interface SyncReadyPayload {
  id: string;
  templateId: string;
  projectId: string;
  workerUid: string;
  startedAt: number;
  observations: Array<{
    itemId: string;
    response: InspectionResponse;
    notes?: string;
    photoStoragePath?: string;
    locationLatLng?: { lat: number; lng: number };
  }>;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Arranca una nueva sesión de inspección.
 * `id` es content-addressed sobre {templateId, projectId, workerUid,
 * startedAt} → mismo input produce el mismo id (idempotencia + dedupe
 * en el server cuando el dispositivo reintenta la sync).
 */
export function startInspection(
  templateId: string,
  ctx: InspectionContext,
): InspectionSession {
  const id = computeSessionId(templateId, ctx);
  return {
    id,
    templateId,
    projectId: ctx.projectId,
    workerUid: ctx.workerUid,
    startedAt: ctx.startedAt,
    observations: [],
    syncStatus: 'draft',
  };
}

/**
 * Registra una observación. INMUTABLE: devuelve una nueva sesión, no
 * muta la original. Si ya existía una observación para ese itemId, se
 * reemplaza (última gana).
 */
export function recordObservation(
  session: InspectionSession,
  itemId: string,
  response: InspectionResponse,
  extra: {
    notes?: string;
    photoBlobRef?: string;
    locationLatLng?: { lat: number; lng: number };
  } = {},
): InspectionSession {
  const newObs: InspectionObservation = {
    itemId,
    response,
    ...(extra.notes !== undefined ? { notes: extra.notes } : {}),
    ...(extra.photoBlobRef !== undefined
      ? { photoBlobRef: extra.photoBlobRef }
      : {}),
    ...(extra.locationLatLng !== undefined
      ? { locationLatLng: extra.locationLatLng }
      : {}),
  };
  const filtered = session.observations.filter((o) => o.itemId !== itemId);
  return {
    ...session,
    observations: [...filtered, newObs],
  };
}

/**
 * Valida que todos los items `required` del template estén respondidos.
 * No bloquea — solo informa. El caller decide si permite sync incompleta.
 */
export function validateSession(
  session: InspectionSession,
  template: InspectionTemplate,
): ValidationResult {
  if (session.templateId !== template.id) {
    return {
      valid: false,
      missingRequired: template.items
        .filter((i) => i.required)
        .map((i) => i.id),
    };
  }
  const answered = new Set(session.observations.map((o) => o.itemId));
  const missing = template.items
    .filter((i) => i.required && !answered.has(i.id))
    .map((i) => i.id);
  return { valid: missing.length === 0, missingRequired: missing };
}

/**
 * Convierte la sesión a un payload JSON-safe para sync. Reemplaza
 * cualquier `photoBlobRef` por un placeholder de storage path
 * determinístico: `inspections/{sessionId}/{itemId}.jpg`. El caller
 * sube el Blob real a ese path por su cuenta.
 */
export function prepareForSync(session: InspectionSession): SyncReadyPayload {
  return {
    id: session.id,
    templateId: session.templateId,
    projectId: session.projectId,
    workerUid: session.workerUid,
    startedAt: session.startedAt,
    observations: session.observations.map((o) => {
      const hasPhoto = o.photoBlobRef !== undefined || o.response.kind === 'photo';
      const photoStoragePath = hasPhoto
        ? `inspections/${session.id}/${o.itemId}.jpg`
        : undefined;
      // Nunca exponemos blobRef binario en el response.
      const response: InspectionResponse =
        o.response.kind === 'photo'
          ? { kind: 'photo', blobRef: photoStoragePath ?? '' }
          : o.response;
      return {
        itemId: o.itemId,
        response,
        ...(o.notes !== undefined ? { notes: o.notes } : {}),
        ...(photoStoragePath !== undefined ? { photoStoragePath } : {}),
        ...(o.locationLatLng !== undefined
          ? { locationLatLng: o.locationLatLng }
          : {}),
      };
    }),
  };
}

/**
 * Marca la sesión como sincronizada. INMUTABLE.
 */
export function markSynced(
  session: InspectionSession,
  syncedAt: number,
): InspectionSession {
  return { ...session, syncStatus: 'synced', syncedAt };
}

/**
 * Marca la sesión como encolada para sync. INMUTABLE.
 */
export function markQueued(session: InspectionSession): InspectionSession {
  return { ...session, syncStatus: 'queued' };
}

// ────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────

function computeSessionId(
  templateId: string,
  ctx: InspectionContext,
): string {
  const canonical = JSON.stringify({
    templateId,
    projectId: ctx.projectId,
    workerUid: ctx.workerUid,
    startedAt: ctx.startedAt,
  });
  return bytesToHex(sha256(new TextEncoder().encode(canonical))).slice(0, 32);
}
