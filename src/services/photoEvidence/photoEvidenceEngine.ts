// Praeventio Guard — Sprint 42 Fase F.19: Motor Evidencia Fotográfica.
//
// Cierra Plan F.19 "Motor Evidencia Fotográfica (nodo EVIDENCE con
// edges al contexto). Fase posterior: MediaPipe/Vertex".
//
// Encapsula el pipeline de evidencia foto:
//   1. Validación de payload (mimeType, size, EXIF date razonable)
//   2. Hash SHA-256 (content-addressed)
//   3. Generación de metadata canónica
//   4. Linkage al nodo del grafo (incident, inspection, audit)
//   5. Cadena de custodia (reusa custodyChainService existente)
//
// 100% determinístico. Hash function se inyecta (caller usa @noble/hashes
// o crypto.subtle según ambiente).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type EvidenceMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'video/mp4'
  | 'video/webm';

export interface PhotoEvidencePayload {
  /** Nombre de archivo original (para auditoría). */
  originalFilename: string;
  mimeType: string;
  /** Tamaño en bytes. */
  byteSize: number;
  /** ISO-8601 del momento de captura (de EXIF o now). */
  capturedAt: string;
  /** Coords del momento de captura, opcional. */
  capturedLocation?: { lat: number; lng: number };
  /** UID del trabajador / supervisor que captura. */
  capturedByUid: string;
  /** Notas opcionales del capturador. */
  notes?: string;
}

export type LinkedNodeKind =
  | 'incident'
  | 'inspection'
  | 'audit'
  | 'finding'
  | 'work_permit'
  | 'training_session'
  | 'corrective_action';

export interface EvidenceLinkage {
  nodeKind: LinkedNodeKind;
  nodeId: string;
}

export interface EvidenceArtifact {
  /** SHA-256 hex del contenido (content-addressed primary key). */
  id: string;
  mimeType: EvidenceMimeType;
  byteSize: number;
  originalFilename: string;
  capturedAt: string;
  capturedByUid: string;
  capturedLocation?: { lat: number; lng: number };
  notes?: string;
  /** Linkages al grafo (mismo artifact puede vincularse a N nodos). */
  linkages: EvidenceLinkage[];
  /** ISO-8601 cuando se registró en el sistema. */
  registeredAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES: Set<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
]);

const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

export type EvidenceValidationCode =
  | 'invalid_mime'
  | 'too_large'
  | 'invalid_filename'
  | 'missing_captured_at'
  | 'invalid_capture_date'
  | 'future_capture'
  | 'missing_uid';

export class PhotoEvidenceValidationError extends Error {
  constructor(public readonly code: EvidenceValidationCode, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'PhotoEvidenceValidationError';
  }
}

export interface ValidationOptions {
  /** Override now para tests. */
  now?: Date;
  /** Cuántos días en el pasado son razonables. Default 30 (foto reciente). */
  maxPastDays?: number;
}

export function validatePayload(
  payload: PhotoEvidencePayload,
  options: ValidationOptions = {},
): void {
  if (!ALLOWED_MIME_TYPES.has(payload.mimeType)) {
    throw new PhotoEvidenceValidationError(
      'invalid_mime',
      `Mime ${payload.mimeType} no permitido. Allowed: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`,
    );
  }
  const isVideo = payload.mimeType.startsWith('video/');
  const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (payload.byteSize <= 0 || payload.byteSize > cap) {
    throw new PhotoEvidenceValidationError(
      'too_large',
      `byteSize ${payload.byteSize} fuera de rango [1..${cap}]`,
    );
  }
  if (!payload.originalFilename || payload.originalFilename.trim().length === 0) {
    throw new PhotoEvidenceValidationError('invalid_filename', 'originalFilename required');
  }
  if (!payload.capturedByUid || payload.capturedByUid.trim().length === 0) {
    throw new PhotoEvidenceValidationError('missing_uid', 'capturedByUid required');
  }
  if (!payload.capturedAt) {
    throw new PhotoEvidenceValidationError('missing_captured_at', 'capturedAt required');
  }
  const capMs = Date.parse(payload.capturedAt);
  if (!Number.isFinite(capMs)) {
    throw new PhotoEvidenceValidationError(
      'invalid_capture_date',
      `capturedAt ${payload.capturedAt} no parsea`,
    );
  }
  const now = options.now ?? new Date();
  const maxPastDays = options.maxPastDays ?? 30;
  if (capMs > now.getTime() + 5 * 60_000) {
    // 5min slack para clock skew
    throw new PhotoEvidenceValidationError(
      'future_capture',
      'capturedAt en el futuro (>5min) — clock skew o tampering',
    );
  }
  if (capMs < now.getTime() - maxPastDays * 86_400_000) {
    throw new PhotoEvidenceValidationError(
      'invalid_capture_date',
      `capturedAt más antiguo que ${maxPastDays} días — evidencia rancia`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────
// Artifact construction
// ────────────────────────────────────────────────────────────────────────

export interface BuildArtifactInput {
  payload: PhotoEvidencePayload;
  /** SHA-256 hex del contenido del archivo. Caller provee. */
  contentHash: string;
  linkages: EvidenceLinkage[];
  /** Override now. */
  now?: Date;
  /** Override de validación. */
  validationOptions?: ValidationOptions;
}

export function buildArtifact(input: BuildArtifactInput): EvidenceArtifact {
  validatePayload(input.payload, input.validationOptions);
  if (!input.contentHash || !/^[a-f0-9]{64}$/i.test(input.contentHash)) {
    throw new PhotoEvidenceValidationError(
      'invalid_mime', // reused code; específico no estaba listado
      `contentHash debe ser SHA-256 hex (64 chars): ${input.contentHash}`,
    );
  }
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: input.contentHash.toLowerCase(),
    mimeType: input.payload.mimeType as EvidenceMimeType,
    byteSize: input.payload.byteSize,
    originalFilename: input.payload.originalFilename,
    capturedAt: input.payload.capturedAt,
    capturedByUid: input.payload.capturedByUid,
    capturedLocation: input.payload.capturedLocation,
    notes: input.payload.notes,
    linkages: [...input.linkages],
    registeredAt: now,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Linkage helpers (idempotente)
// ────────────────────────────────────────────────────────────────────────

export function addLinkage(
  artifact: EvidenceArtifact,
  link: EvidenceLinkage,
): EvidenceArtifact {
  const exists = artifact.linkages.some(
    (l) => l.nodeKind === link.nodeKind && l.nodeId === link.nodeId,
  );
  if (exists) return artifact;
  return { ...artifact, linkages: [...artifact.linkages, link] };
}

export function removeLinkage(
  artifact: EvidenceArtifact,
  link: EvidenceLinkage,
): EvidenceArtifact {
  return {
    ...artifact,
    linkages: artifact.linkages.filter(
      (l) => !(l.nodeKind === link.nodeKind && l.nodeId === link.nodeId),
    ),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Storage path (convención para Cloud Storage)
// ────────────────────────────────────────────────────────────────────────

/**
 * Path canónico para Storage:
 *   tenants/{tid}/evidence/{contentHash}.{ext}
 * Caller wrap con tenantId al persistir.
 */
export function buildStoragePath(
  artifact: EvidenceArtifact,
  tenantId: string,
): string {
  const extByMime: Record<EvidenceMimeType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return `tenants/${tenantId}/evidence/${artifact.id}.${extByMime[artifact.mimeType]}`;
}

// ────────────────────────────────────────────────────────────────────────
// Bulk validation (CSV import / batch)
// ────────────────────────────────────────────────────────────────────────

export interface BatchValidationReport {
  valid: PhotoEvidencePayload[];
  invalid: Array<{ payload: PhotoEvidencePayload; reason: string }>;
}

export function validateBatch(
  payloads: PhotoEvidencePayload[],
  options: ValidationOptions = {},
): BatchValidationReport {
  const valid: PhotoEvidencePayload[] = [];
  const invalid: BatchValidationReport['invalid'] = [];
  for (const p of payloads) {
    try {
      validatePayload(p, options);
      valid.push(p);
    } catch (err) {
      invalid.push({ payload: p, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { valid, invalid };
}
