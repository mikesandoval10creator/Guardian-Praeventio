// Praeventio Guard — Sprint 39 Fase J.7: Cadena de Custodia de Evidencias.
//
// Cierra: Documento usuario "Recomendaciones nuevas §24"
//
// NO blockchain. Hash SHA-256 + audit log inmutable es suficiente para
// trazabilidad legal de fotos, PDFs, declaraciones e incidentes.
//
// Cada artefacto:
//   - hash content-addressed (sha256 del payload bytes)
//   - quién lo subió + cuándo + desde dónde
//   - si fue reemplazado, qué hash lo sustituyó
//   - referencia al nodo Zettelkasten correspondiente

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type EvidenceArtifactKind =
  | 'photo'
  | 'video'
  | 'document_pdf'
  | 'audio'
  | 'declaration'
  | 'measurement_data';

export interface EvidenceArtifact {
  /** Hash SHA-256 del contenido (hex). */
  id: string;
  kind: EvidenceArtifactKind;
  mimeType: string;
  /** Tamaño en bytes. */
  byteSize: number;
  /** UID del que subió. */
  uploadedByUid: string;
  uploadedAt: string;
  /** Origen geográfico opcional. */
  capturedAt?: { lat: number; lng: number; timestamp: string };
  /** Vinculación al nodo del grafo (incident, inspection, etc.). */
  linkedNodeId?: string;
  /** Si fue reemplazado por otra evidencia. */
  replacedByHash?: string;
  replacedAt?: string;
  /** Notas del subidor. */
  notes?: string;
  /** Storage URL — el caller la setea después del upload. */
  storageUrl?: string;
}

export interface CustodyEvent {
  artifactHash: string;
  /** Tipo del evento: upload, access, replacement, deletion_request. */
  eventKind: 'upload' | 'access' | 'replacement' | 'deletion_request' | 'export';
  actorUid: string;
  actorRole: string;
  at: string;
  /** IP / dispositivo (audit trail). */
  context?: { ip?: string; userAgent?: string };
  notes?: string;
}

export class CustodyValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'CustodyValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Hashing
// ────────────────────────────────────────────────────────────────────────

export function hashArtifact(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

export interface RegisterArtifactInput {
  kind: EvidenceArtifactKind;
  mimeType: string;
  bytes: Uint8Array;
  uploadedByUid: string;
  capturedAt?: { lat: number; lng: number; timestamp: string };
  linkedNodeId?: string;
  notes?: string;
  now?: Date;
}

export function registerArtifact(input: RegisterArtifactInput): {
  artifact: EvidenceArtifact;
  event: CustodyEvent;
} {
  if (input.bytes.length === 0) {
    throw new CustodyValidationError(
      'EMPTY_PAYLOAD',
      'cannot register empty evidence',
    );
  }
  const id = hashArtifact(input.bytes);
  const now = input.now ?? new Date();
  const artifact: EvidenceArtifact = {
    id,
    kind: input.kind,
    mimeType: input.mimeType,
    byteSize: input.bytes.length,
    uploadedByUid: input.uploadedByUid,
    uploadedAt: now.toISOString(),
    capturedAt: input.capturedAt,
    linkedNodeId: input.linkedNodeId,
    notes: input.notes,
  };
  const event: CustodyEvent = {
    artifactHash: id,
    eventKind: 'upload',
    actorUid: input.uploadedByUid,
    actorRole: 'unknown', // caller debe enriquecer
    at: now.toISOString(),
  };
  return { artifact, event };
}

/**
 * Cuando una evidencia se "reemplaza" (foto duplicada o reedición),
 * NO se borra: se marca como replaced y la nueva queda relacionada.
 * Esto preserva la cadena de custodia.
 */
export function replaceArtifact(
  original: EvidenceArtifact,
  newArtifactHash: string,
  replacerUid: string,
  reason: string,
  now: Date = new Date(),
): { artifact: EvidenceArtifact; event: CustodyEvent } {
  if (original.replacedByHash) {
    throw new CustodyValidationError(
      'ALREADY_REPLACED',
      `artifact ${original.id} already replaced by ${original.replacedByHash}`,
    );
  }
  if (reason.trim().length < 10) {
    throw new CustodyValidationError(
      'REASON_TOO_SHORT',
      'replacement reason ≥10 chars',
    );
  }
  const updated: EvidenceArtifact = {
    ...original,
    replacedByHash: newArtifactHash,
    replacedAt: now.toISOString(),
  };
  const event: CustodyEvent = {
    artifactHash: original.id,
    eventKind: 'replacement',
    actorUid: replacerUid,
    actorRole: 'unknown',
    at: now.toISOString(),
    notes: reason.trim(),
  };
  return { artifact: updated, event };
}

export function recordAccess(
  artifact: EvidenceArtifact,
  actorUid: string,
  actorRole: string,
  context?: { ip?: string; userAgent?: string },
  now: Date = new Date(),
): CustodyEvent {
  return {
    artifactHash: artifact.id,
    eventKind: 'access',
    actorUid,
    actorRole,
    at: now.toISOString(),
    context,
  };
}

export function recordExport(
  artifact: EvidenceArtifact,
  actorUid: string,
  actorRole: string,
  exportTarget: string,
  now: Date = new Date(),
): CustodyEvent {
  return {
    artifactHash: artifact.id,
    eventKind: 'export',
    actorUid,
    actorRole,
    at: now.toISOString(),
    notes: `exported to ${exportTarget}`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Verification
// ────────────────────────────────────────────────────────────────────────

/**
 * Para verificar que una evidencia NO fue modificada: re-hashear los
 * bytes y comparar con artifact.id.
 */
export function verifyIntegrity(
  artifact: EvidenceArtifact,
  bytes: Uint8Array,
): { valid: boolean; computedHash: string } {
  const computedHash = hashArtifact(bytes);
  return {
    valid: computedHash === artifact.id,
    computedHash,
  };
}

export interface ChainSummary {
  artifactHash: string;
  uploadedAt: string;
  totalEvents: number;
  accessCount: number;
  exportCount: number;
  isReplaced: boolean;
  /** Quién es el último que accedió. */
  lastAccessByUid?: string;
}

export function summarizeChain(
  artifact: EvidenceArtifact,
  events: CustodyEvent[],
): ChainSummary {
  const own = events.filter((e) => e.artifactHash === artifact.id);
  const access = own.filter((e) => e.eventKind === 'access');
  const exports = own.filter((e) => e.eventKind === 'export');
  const lastAccess = access.sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    artifactHash: artifact.id,
    uploadedAt: artifact.uploadedAt,
    totalEvents: own.length,
    accessCount: access.length,
    exportCount: exports.length,
    isReplaced: Boolean(artifact.replacedByHash),
    lastAccessByUid: lastAccess?.actorUid,
  };
}
