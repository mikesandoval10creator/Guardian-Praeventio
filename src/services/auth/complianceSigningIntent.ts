import crypto from 'node:crypto';

export const COMPLIANCE_SIGNING_INTENT_VERSION = 1 as const;
export const COMPLIANCE_SIGNING_PURPOSE = 'compliance-document-sign' as const;
export const COMPLIANCE_SIGNING_ACTION = 'sign' as const;
export const DEFAULT_COMPLIANCE_SIGNING_TTL_MS = 5 * 60 * 1000;

export type ComplianceDocumentKind = 'suseso' | 'ds67' | 'ds76';

export interface ComplianceSigningContext {
  tenantId: string;
  formId: string;
  documentKind: ComplianceDocumentKind;
  payloadHashHex: string;
  signerUid: string;
  signerRut: string;
}

export interface ComplianceSigningIntentV1 extends ComplianceSigningContext {
  version: typeof COMPLIANCE_SIGNING_INTENT_VERSION;
  purpose: typeof COMPLIANCE_SIGNING_PURPOSE;
  action: typeof COMPLIANCE_SIGNING_ACTION;
  issuedAtMs: number;
  expiresAtMs: number;
  nonceB64u: string;
}

export interface CreateComplianceSigningIntentOptions {
  now?: () => number;
  randomBytes?: () => Uint8Array;
  ttlMs?: number;
}

export interface CreatedComplianceSigningIntent {
  intent: ComplianceSigningIntentV1;
  challenge: Uint8Array;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const DOCUMENT_KINDS = new Set<ComplianceDocumentKind>(['suseso', 'ds67', 'ds76']);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function normalizePayloadHash(value: unknown): string {
  const normalized = requireNonEmptyString(value, 'payloadHashHex').toLowerCase();
  if (!SHA256_HEX.test(normalized)) {
    throw new TypeError('payloadHashHex must be a 64-character SHA-256 hex digest');
  }
  return normalized;
}

function requireSafeTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeIntent(intent: ComplianceSigningIntentV1): ComplianceSigningIntentV1 {
  if (intent.version !== COMPLIANCE_SIGNING_INTENT_VERSION) {
    throw new TypeError('unsupported compliance signing intent version');
  }
  if (intent.purpose !== COMPLIANCE_SIGNING_PURPOSE) {
    throw new TypeError('invalid compliance signing purpose');
  }
  if (intent.action !== COMPLIANCE_SIGNING_ACTION) {
    throw new TypeError('invalid compliance signing action');
  }
  if (!DOCUMENT_KINDS.has(intent.documentKind)) {
    throw new TypeError('unsupported compliance document kind');
  }

  const issuedAtMs = requireSafeTimestamp(intent.issuedAtMs, 'issuedAtMs');
  const expiresAtMs = requireSafeTimestamp(intent.expiresAtMs, 'expiresAtMs');
  if (expiresAtMs <= issuedAtMs) {
    throw new TypeError('expiresAtMs must be after issuedAtMs');
  }

  const nonceB64u = requireNonEmptyString(intent.nonceB64u, 'nonceB64u');
  if (!BASE64URL.test(nonceB64u)) {
    throw new TypeError('nonceB64u must use unpadded base64url');
  }

  return {
    version: COMPLIANCE_SIGNING_INTENT_VERSION,
    purpose: COMPLIANCE_SIGNING_PURPOSE,
    tenantId: requireNonEmptyString(intent.tenantId, 'tenantId'),
    formId: requireNonEmptyString(intent.formId, 'formId'),
    documentKind: intent.documentKind,
    action: COMPLIANCE_SIGNING_ACTION,
    payloadHashHex: normalizePayloadHash(intent.payloadHashHex),
    signerUid: requireNonEmptyString(intent.signerUid, 'signerUid'),
    signerRut: requireNonEmptyString(intent.signerRut, 'signerRut'),
    issuedAtMs,
    expiresAtMs,
    nonceB64u,
  };
}

/**
 * Serialize the v1 intent using an explicit field order. This byte contract is
 * persisted as audit evidence, so it must not depend on caller object order.
 */
export function canonicalizeComplianceSigningIntent(
  intent: ComplianceSigningIntentV1,
): string {
  return JSON.stringify(normalizeIntent(intent));
}

/** The exact WebAuthn challenge for this legal signing context. */
export function deriveComplianceSigningChallenge(
  intent: ComplianceSigningIntentV1,
): Uint8Array {
  const canonical = canonicalizeComplianceSigningIntent(intent);
  return new Uint8Array(crypto.createHash('sha256').update(canonical, 'utf8').digest());
}

export function createComplianceSigningIntent(
  context: ComplianceSigningContext,
  options: CreateComplianceSigningIntentOptions = {},
): CreatedComplianceSigningIntent {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? (() => new Uint8Array(crypto.randomBytes(32)));
  const ttlMs = options.ttlMs ?? DEFAULT_COMPLIANCE_SIGNING_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new TypeError('ttlMs must be a positive safe integer');
  }

  const issuedAtMs = requireSafeTimestamp(now(), 'issuedAtMs');
  const expiresAtMs = issuedAtMs + ttlMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new TypeError('expiresAtMs exceeds the safe integer range');
  }

  const nonce = randomBytes();
  if (!(nonce instanceof Uint8Array) || nonce.byteLength === 0) {
    throw new TypeError('randomBytes must return a non-empty Uint8Array');
  }

  const intent = normalizeIntent({
    version: COMPLIANCE_SIGNING_INTENT_VERSION,
    purpose: COMPLIANCE_SIGNING_PURPOSE,
    tenantId: context.tenantId,
    formId: context.formId,
    documentKind: context.documentKind,
    action: COMPLIANCE_SIGNING_ACTION,
    payloadHashHex: context.payloadHashHex,
    signerUid: context.signerUid,
    signerRut: context.signerRut,
    issuedAtMs,
    expiresAtMs,
    nonceB64u: Buffer.from(nonce).toString('base64url'),
  });

  return { intent, challenge: deriveComplianceSigningChallenge(intent) };
}

/**
 * Compare an intent against context freshly rebuilt from authoritative server
 * state. Invalid persisted input is treated as a mismatch, never as approval.
 */
export function matchesComplianceSigningContext(
  intent: ComplianceSigningIntentV1,
  context: ComplianceSigningContext,
): boolean {
  try {
    const normalized = normalizeIntent(intent);
    return (
      normalized.tenantId === requireNonEmptyString(context.tenantId, 'tenantId') &&
      normalized.formId === requireNonEmptyString(context.formId, 'formId') &&
      normalized.documentKind === context.documentKind &&
      normalized.payloadHashHex === normalizePayloadHash(context.payloadHashHex) &&
      normalized.signerUid === requireNonEmptyString(context.signerUid, 'signerUid') &&
      normalized.signerRut === requireNonEmptyString(context.signerRut, 'signerRut')
    );
  } catch {
    return false;
  }
}
