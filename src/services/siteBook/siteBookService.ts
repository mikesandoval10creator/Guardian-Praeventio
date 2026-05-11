// Praeventio Guard — Sprint 39 Fase H.2: Libro de Obra Digital Preventivo.
//
// Cierra: Documento usuario "Recomendaciones nuevas §6"
//         Plan integral Top 15 #6
//
// Registro cronológico formal del proyecto — equivalente digital del
// libro de obra tradicional pero específico para prevención:
//
//   - Inspecciones
//   - Incidentes / near-miss
//   - Visitas (mandante, fiscalizador, mutualidad)
//   - Cambios en el proyecto
//   - Instrucciones del prevencionista
//   - Paralizaciones / reanudaciones
//   - Entregas documentales
//   - Resoluciones de hallazgos
//
// Diseño:
//   - Cada entrada es INMUTABLE post-firma (solo se agregan correcciones
//     como entries posteriores que referencian la original)
//   - Numeración consecutiva por proyecto/año
//   - Hash content-addressed para cadena de custodia

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SiteBookEntryKind =
  | 'inspection'
  | 'incident'
  | 'near_miss'
  | 'visit'
  | 'change'
  | 'instruction'
  | 'stoppage'
  | 'resumption'
  | 'document_delivery'
  | 'finding_closure'
  | 'training_event'
  | 'observation';

export type SiteBookEntryStatus = 'open' | 'signed' | 'corrected';

export interface SiteBookEntry {
  /** Content-addressed hash of (projectId + sequenceNumber + body). */
  id: string;
  projectId: string;
  /** Año + sequenceNumber: SB-2026-000042. */
  folio: string;
  /** Año (para particionar por año fiscal). */
  year: number;
  /** Número consecutivo dentro del año. */
  sequenceNumber: number;
  kind: SiteBookEntryKind;
  /** ISO-8601 — momento del hecho registrado (puede ser pasado si se
   *  documenta a posteriori). */
  occurredAt: string;
  /** ISO-8601 — cuándo se ingresó al libro. */
  recordedAt: string;
  recordedByUid: string;
  recordedByRole: string;
  /** Cuerpo principal del registro. */
  description: string;
  /** Personas involucradas. */
  involvedWorkerUids?: string[];
  /** Lugar dentro del proyecto. */
  location?: string;
  /** Evidencias adjuntas (Storage URLs). */
  evidenceUrls?: string[];
  /** Si esta entrada CORRIGE una anterior, referencia su folio. */
  correctsEntryFolio?: string;
  /** Razón de la corrección. */
  correctionReason?: string;
  /** Status — signed=inmutable. */
  status: SiteBookEntryStatus;
  /** Firma digital (WebAuthn ECDSA-P256 o KMS-RSA). */
  signature?: {
    signerUid: string;
    signedAt: string;
    algorithm: 'webauthn-ecdsa-p256' | 'kms-sign-rsa';
    payloadHashHex: string;
  };
}

export class SiteBookValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'SiteBookValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Folio generation
// ────────────────────────────────────────────────────────────────────────

/**
 * Formato: SB-{year}-{seq:06d}. El caller atómicamente incrementa el
 * counter en Firestore (transaction) y pasa el seq aquí.
 */
export function buildFolio(year: number, sequenceNumber: number): string {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new SiteBookValidationError('INVALID_YEAR', `year out of range: ${year}`);
  }
  if (sequenceNumber < 1 || sequenceNumber > 999_999) {
    throw new SiteBookValidationError(
      'INVALID_SEQUENCE',
      `sequenceNumber must be in [1, 999999]`,
    );
  }
  return `SB-${year}-${String(sequenceNumber).padStart(6, '0')}`;
}

function computeEntryId(
  projectId: string,
  folio: string,
  description: string,
): string {
  const payload = `${projectId}\x00${folio}\x00${description}`;
  return bytesToHex(sha256(new TextEncoder().encode(payload))).slice(0, 32);
}

// ────────────────────────────────────────────────────────────────────────
// Entry creation
// ────────────────────────────────────────────────────────────────────────

export interface CreateEntryInput {
  projectId: string;
  year: number;
  sequenceNumber: number;
  kind: SiteBookEntryKind;
  occurredAt: string;
  recordedByUid: string;
  recordedByRole: string;
  description: string;
  involvedWorkerUids?: string[];
  location?: string;
  evidenceUrls?: string[];
  now?: Date;
}

const MIN_DESCRIPTION_LENGTH = 20;

export function createEntry(input: CreateEntryInput): SiteBookEntry {
  if (input.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    throw new SiteBookValidationError(
      'DESCRIPTION_TOO_SHORT',
      `description must be at least ${MIN_DESCRIPTION_LENGTH} chars`,
    );
  }
  const folio = buildFolio(input.year, input.sequenceNumber);
  const id = computeEntryId(input.projectId, folio, input.description);
  const now = input.now ?? new Date();
  return {
    id,
    projectId: input.projectId,
    folio,
    year: input.year,
    sequenceNumber: input.sequenceNumber,
    kind: input.kind,
    occurredAt: input.occurredAt,
    recordedAt: now.toISOString(),
    recordedByUid: input.recordedByUid,
    recordedByRole: input.recordedByRole,
    description: input.description.trim(),
    involvedWorkerUids: input.involvedWorkerUids,
    location: input.location,
    evidenceUrls: input.evidenceUrls,
    status: 'open',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Signing (immutability gate)
// ────────────────────────────────────────────────────────────────────────

export function signEntry(
  entry: SiteBookEntry,
  signature: NonNullable<SiteBookEntry['signature']>,
): SiteBookEntry {
  if (entry.status !== 'open') {
    throw new SiteBookValidationError(
      'NOT_OPEN',
      `cannot sign entry in status '${entry.status}'`,
    );
  }
  return { ...entry, status: 'signed', signature };
}

/**
 * Para corregir un registro FIRMADO, se crea una NUEVA entry que
 * referencia el folio original. NO se modifica el original.
 */
export function createCorrection(
  original: SiteBookEntry,
  input: Omit<CreateEntryInput, 'kind'> & { correctionReason: string },
): SiteBookEntry {
  if (original.status !== 'signed') {
    throw new SiteBookValidationError(
      'CAN_ONLY_CORRECT_SIGNED',
      `only signed entries can be corrected, got '${original.status}'`,
    );
  }
  if (input.correctionReason.trim().length < 20) {
    throw new SiteBookValidationError(
      'REASON_TOO_SHORT',
      'correctionReason must be at least 20 chars',
    );
  }
  const correction = createEntry({ ...input, kind: 'observation' });
  return {
    ...correction,
    correctsEntryFolio: original.folio,
    correctionReason: input.correctionReason.trim(),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────────────────

export interface SiteBookQuery {
  projectId: string;
  year?: number;
  kind?: SiteBookEntryKind;
  fromDate?: string;
  toDate?: string;
  workerUid?: string;
}

export function filterEntries(
  entries: SiteBookEntry[],
  query: SiteBookQuery,
): SiteBookEntry[] {
  return entries.filter((e) => {
    if (e.projectId !== query.projectId) return false;
    if (query.year !== undefined && e.year !== query.year) return false;
    if (query.kind && e.kind !== query.kind) return false;
    if (query.fromDate && e.occurredAt < query.fromDate) return false;
    if (query.toDate && e.occurredAt > query.toDate) return false;
    if (
      query.workerUid &&
      !(e.involvedWorkerUids ?? []).includes(query.workerUid)
    ) {
      return false;
    }
    return true;
  });
}

export interface SiteBookSummary {
  totalEntries: number;
  byKind: Record<SiteBookEntryKind, number>;
  signedCount: number;
  pendingSignatureCount: number;
  correctionsCount: number;
  lastEntryAt?: string;
}

export function summarizeSiteBook(entries: SiteBookEntry[]): SiteBookSummary {
  const byKind: Partial<Record<SiteBookEntryKind, number>> = {};
  let signed = 0;
  let pending = 0;
  let corrections = 0;
  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.status === 'signed') signed += 1;
    if (e.status === 'open') pending += 1;
    if (e.correctsEntryFolio) corrections += 1;
  }
  const lastEntry = entries
    .map((e) => e.recordedAt)
    .sort()
    .pop();
  return {
    totalEntries: entries.length,
    byKind: byKind as Record<SiteBookEntryKind, number>,
    signedCount: signed,
    pendingSignatureCount: pending,
    correctionsCount: corrections,
    lastEntryAt: lastEntry,
  };
}
