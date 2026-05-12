// Praeventio Guard — Sprint 40 Fase F.5: Firma de Recepción Digital con QR.
//
// Cierra: Plan F.5 "Firma de Recepción Digital con QR (EPP, charlas,
// docs, capacitaciones)".
//
// Flujo:
//   1. Supervisor abre modal en su app → genera `QrSignatureChallenge`
//      con payload firmado HMAC y TTL corto (5 min default).
//   2. Trabajador escanea QR con su app autenticada → POST al server
//      con el challenge.
//   3. Server valida HMAC + TTL + worker está autorizado para el item.
//   4. Server registra `SignedAcknowledgement` (immutable).
//
// 100% determinístico. Crypto via @noble/hashes (ya en deps). El
// transport HTTP queda al caller; este motor solo razona sobre
// challenges + verificación.

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SignatureItemKind =
  | 'epp_delivery'
  | 'safety_talk'
  | 'document_read'
  | 'training_completion'
  | 'permit_acknowledgement'
  | 'inspection_handover';

export interface QrSignatureChallenge {
  /** ID único del challenge (también es el QR payload primary key). */
  challengeId: string;
  /** ID interno del item al que se firma. */
  itemId: string;
  kind: SignatureItemKind;
  projectId: string;
  /** UID del supervisor que inició la firma. */
  initiatedByUid: string;
  /** ISO-8601 — vence pasado este tiempo. */
  expiresAt: string;
  /** HMAC del payload — el server verifica antes de aceptar. */
  signatureHex: string;
  /** Nonce para evitar replay. */
  nonceHex: string;
  /** Versión del schema (para migrar). */
  schemaVersion: number;
}

export interface SignedAcknowledgement {
  /** Mismo id que el challenge — la firma es 1:1. */
  challengeId: string;
  itemId: string;
  kind: SignatureItemKind;
  projectId: string;
  initiatedByUid: string;
  /** UID del trabajador que escaneó. */
  signedByUid: string;
  signedAt: string;
  /** True si el método de firma usó biometría (WebAuthn / Capacitor). */
  biometricUsed: boolean;
  /** Lat/lng opcional para audit (si la app provee location). */
  location?: { lat: number; lng: number };
}

// ────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────

export const DEFAULT_TTL_MINUTES = 5;
export const MAX_TTL_MINUTES = 30;
export const SCHEMA_VERSION = 1;

// ────────────────────────────────────────────────────────────────────────
// HMAC helpers (server-side; secret nunca cruza al cliente)
// ────────────────────────────────────────────────────────────────────────

function canonicalize(payload: Omit<QrSignatureChallenge, 'signatureHex'>): string {
  const ordered = {
    challengeId: payload.challengeId,
    itemId: payload.itemId,
    kind: payload.kind,
    projectId: payload.projectId,
    initiatedByUid: payload.initiatedByUid,
    expiresAt: payload.expiresAt,
    nonceHex: payload.nonceHex,
    schemaVersion: payload.schemaVersion,
  };
  return JSON.stringify(ordered);
}

function computeHmac(payloadJson: string, secret: string): string {
  const key = utf8ToBytes(secret);
  const msg = utf8ToBytes(payloadJson);
  return bytesToHex(hmac(sha256, key, msg));
}

// ────────────────────────────────────────────────────────────────────────
// Challenge construction (server)
// ────────────────────────────────────────────────────────────────────────

export interface BuildChallengeInput {
  challengeId: string;
  itemId: string;
  kind: SignatureItemKind;
  projectId: string;
  initiatedByUid: string;
  /** Bytes de un random source (server provee — el caller pasa). */
  nonceHex: string;
  /** ISO-8601. Override now para tests. */
  now?: Date;
  /** Override TTL. Default 5min, cap 30min. */
  ttlMinutes?: number;
}

export class QrSignatureValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'QrSignatureValidationError';
  }
}

export function buildChallenge(
  input: BuildChallengeInput,
  serverSecret: string,
): QrSignatureChallenge {
  if (typeof serverSecret !== 'string' || serverSecret.length < 16) {
    throw new QrSignatureValidationError('WEAK_SECRET', 'serverSecret must be >= 16 chars');
  }
  if (!input.challengeId || !input.itemId || !input.projectId || !input.initiatedByUid) {
    throw new QrSignatureValidationError('MISSING_FIELD', 'required fields missing');
  }
  if (!input.nonceHex || input.nonceHex.length < 16) {
    throw new QrSignatureValidationError('WEAK_NONCE', 'nonceHex must be >= 16 hex chars');
  }
  const ttlMin = Math.min(
    MAX_TTL_MINUTES,
    Math.max(1, input.ttlMinutes ?? DEFAULT_TTL_MINUTES),
  );
  const nowMs = (input.now ?? new Date()).getTime();
  const expiresAt = new Date(nowMs + ttlMin * 60_000).toISOString();

  const partial: Omit<QrSignatureChallenge, 'signatureHex'> = {
    challengeId: input.challengeId,
    itemId: input.itemId,
    kind: input.kind,
    projectId: input.projectId,
    initiatedByUid: input.initiatedByUid,
    expiresAt,
    nonceHex: input.nonceHex,
    schemaVersion: SCHEMA_VERSION,
  };
  const signatureHex = computeHmac(canonicalize(partial), serverSecret);

  return { ...partial, signatureHex };
}

// ────────────────────────────────────────────────────────────────────────
// QR payload encoding (cliente lee este string del QR)
// ────────────────────────────────────────────────────────────────────────

/**
 * Encode challenge a string base64url para QR. Compacto y URL-safe.
 */
export function encodeForQr(challenge: QrSignatureChallenge): string {
  const json = JSON.stringify(challenge);
  // Base64url manual (sin browser/Buffer deps cross-env).
  const bytes = utf8ToBytes(json);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  const b64 = (typeof btoa !== 'undefined' ? btoa(str) : Buffer.from(str, 'binary').toString('base64'));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeFromQr(qrText: string): QrSignatureChallenge {
  let b64 = qrText.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const str = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  // Codex P2 PR #94: decode UTF-8 properly so accented characters
  // (itemId="arnés-001", etc.) round-trip; previous charCode loop produced
  // mojibake breaking the recomputed HMAC.
  const json =
    typeof TextDecoder !== 'undefined'
      ? new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      : Buffer.from(bytes).toString('utf8');
  const parsed = JSON.parse(json) as QrSignatureChallenge;
  if (!parsed.challengeId || !parsed.signatureHex || !parsed.expiresAt) {
    throw new QrSignatureValidationError('MALFORMED_QR', 'missing required QR fields');
  }
  return parsed;
}

// ────────────────────────────────────────────────────────────────────────
// Verification (server-side cuando trabajador POSTea)
// ────────────────────────────────────────────────────────────────────────

export interface VerificationResult {
  valid: boolean;
  reason?: 'expired' | 'bad_signature' | 'malformed' | 'replayed';
}

export interface VerifyInput {
  challenge: QrSignatureChallenge;
  serverSecret: string;
  now?: Date;
  /** Set de nonces ya consumidos para detección de replay. */
  consumedNonces?: Set<string>;
}

export function verifyChallenge(input: VerifyInput): VerificationResult {
  const { challenge, serverSecret } = input;
  const now = input.now ?? new Date();

  // 1) Expiración
  const expMs = Date.parse(challenge.expiresAt);
  if (!Number.isFinite(expMs)) return { valid: false, reason: 'malformed' };
  if (now.getTime() > expMs) return { valid: false, reason: 'expired' };

  // 2) HMAC re-compute
  const partial: Omit<QrSignatureChallenge, 'signatureHex'> = {
    challengeId: challenge.challengeId,
    itemId: challenge.itemId,
    kind: challenge.kind,
    projectId: challenge.projectId,
    initiatedByUid: challenge.initiatedByUid,
    expiresAt: challenge.expiresAt,
    nonceHex: challenge.nonceHex,
    schemaVersion: challenge.schemaVersion,
  };
  const expected = computeHmac(canonicalize(partial), serverSecret);
  // Comparación constant-time-ish (suficiente para evitar timing trivial).
  if (!constantTimeEqual(expected, challenge.signatureHex)) {
    return { valid: false, reason: 'bad_signature' };
  }

  // 3) Replay (si caller provee tracking set)
  if (input.consumedNonces?.has(challenge.nonceHex)) {
    return { valid: false, reason: 'replayed' };
  }

  // Codex P2 PR #94: mark nonce consumed AFTER successful verification so
  // the next call with the same Set rejects the replay. Caller still owns
  // persistence (Set is per-process); for cross-process replay protection
  // the caller wraps this with a Firestore-backed nonce store.
  input.consumedNonces?.add(challenge.nonceHex);

  return { valid: true };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ────────────────────────────────────────────────────────────────────────
// Build acknowledgement (después de verify successful)
// ────────────────────────────────────────────────────────────────────────

export interface BuildAckInput {
  challenge: QrSignatureChallenge;
  signedByUid: string;
  biometricUsed: boolean;
  location?: { lat: number; lng: number };
  now?: Date;
}

export function buildSignedAcknowledgement(
  input: BuildAckInput,
): SignedAcknowledgement {
  return {
    challengeId: input.challenge.challengeId,
    itemId: input.challenge.itemId,
    kind: input.challenge.kind,
    projectId: input.challenge.projectId,
    initiatedByUid: input.challenge.initiatedByUid,
    signedByUid: input.signedByUid,
    signedAt: (input.now ?? new Date()).toISOString(),
    biometricUsed: input.biometricUsed,
    location: input.location,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Nonce generator helper (cliente / server pueden usar)
// ────────────────────────────────────────────────────────────────────────

/**
 * Genera nonce hex aleatorio. Caller provee `randomBytes` para evitar
 * hard-dep crypto (test puede inyectar deterministic).
 */
export function generateNonceHex(
  randomSource: () => Uint8Array = defaultRandomSource,
  byteLength = 16,
): string {
  const bytes = randomSource();
  if (bytes.length < byteLength) {
    throw new QrSignatureValidationError('SHORT_NONCE_SOURCE', 'random source too short');
  }
  return bytesToHex(bytes.slice(0, byteLength));
}

function defaultRandomSource(): Uint8Array {
  const g = globalThis as unknown as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint8Array(32);
    g.crypto.getRandomValues(buf);
    return buf;
  }
  throw new QrSignatureValidationError(
    'NO_CRYPTO',
    'crypto.getRandomValues unavailable',
  );
}

// Re-export hex utilities for callers (avoids them depending on @noble directly)
export { bytesToHex, hexToBytes };
