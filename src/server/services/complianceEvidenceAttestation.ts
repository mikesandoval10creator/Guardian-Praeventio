import crypto from 'node:crypto';
import { canonicalize } from '../middleware/canonicalBody.js';
import type { ComplianceArchiveAttestation } from '../../services/compliance/complianceSignature.js';

const DOMAIN = 'praeventio:compliance-evidence-attestation:v1\0';
const MIN_SECRET_BYTES = 32;

export interface ComplianceEvidenceAttestationKeyring {
  currentKeyId: string;
  keys: Readonly<Record<string, string>>;
}

export type ComplianceEvidenceAttestationVerification =
  | 'verified'
  | 'invalid'
  | 'unavailable';

export class ComplianceEvidenceAttestationError extends Error {
  constructor(readonly code: 'not_configured' | 'invalid_configuration') {
    super(code);
    this.name = 'ComplianceEvidenceAttestationError';
  }
}

function validKeyId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

function validSecret(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= MIN_SECRET_BYTES;
}

function unsignedEvidence(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { archiveAttestation: _ignored, ...unsigned } = value as Record<string, unknown>;
  return unsigned;
}

function macFor(unsigned: Record<string, unknown>, secret: string): Buffer {
  return crypto
    .createHmac('sha256', secret)
    .update(DOMAIN, 'utf8')
    .update(canonicalize(unsigned), 'utf8')
    .digest();
}

export function loadComplianceEvidenceAttestationKeyring(
  env: NodeJS.ProcessEnv = process.env,
): ComplianceEvidenceAttestationKeyring {
  const currentKeyId = env.COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID;
  const rawKeys = env.COMPLIANCE_EVIDENCE_ATTESTATION_KEYS;
  if (!currentKeyId || !rawKeys) {
    throw new ComplianceEvidenceAttestationError('not_configured');
  }
  let keys: unknown;
  try {
    keys = JSON.parse(rawKeys);
  } catch {
    throw new ComplianceEvidenceAttestationError('invalid_configuration');
  }
  if (!validKeyId(currentKeyId) || !keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new ComplianceEvidenceAttestationError('invalid_configuration');
  }
  const entries = Object.entries(keys as Record<string, unknown>);
  if (
    entries.length === 0 ||
    entries.some(([keyId, secret]) => !validKeyId(keyId) || !validSecret(secret)) ||
    !validSecret((keys as Record<string, unknown>)[currentKeyId])
  ) {
    throw new ComplianceEvidenceAttestationError('invalid_configuration');
  }
  return {
    currentKeyId,
    keys: keys as Record<string, string>,
  };
}

export function attestComplianceEvidence(
  evidence: unknown,
  options: { keyring?: ComplianceEvidenceAttestationKeyring } = {},
): ComplianceArchiveAttestation {
  const unsigned = unsignedEvidence(evidence);
  if (!unsigned) throw new TypeError('compliance evidence must be an object');
  const keyring = options.keyring ?? loadComplianceEvidenceAttestationKeyring();
  const secret = keyring.keys[keyring.currentKeyId];
  if (!validKeyId(keyring.currentKeyId) || !validSecret(secret)) {
    throw new ComplianceEvidenceAttestationError('invalid_configuration');
  }
  return {
    version: 1,
    keyId: keyring.currentKeyId,
    macB64u: macFor(unsigned, secret).toString('base64url'),
  };
}

export function verifyComplianceEvidenceAttestation(
  evidence: unknown,
  options: { keyring?: ComplianceEvidenceAttestationKeyring } = {},
): ComplianceEvidenceAttestationVerification {
  const unsigned = unsignedEvidence(evidence);
  if (!unsigned) return 'invalid';
  const attestation = (evidence as Record<string, unknown>).archiveAttestation;
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    return 'invalid';
  }
  const { version, keyId, macB64u } = attestation as Record<string, unknown>;
  if (
    version !== 1 || !validKeyId(keyId) ||
    typeof macB64u !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(macB64u)
  ) {
    return 'invalid';
  }
  let keyring: ComplianceEvidenceAttestationKeyring;
  try {
    keyring = options.keyring ?? loadComplianceEvidenceAttestationKeyring();
  } catch (error) {
    if (error instanceof ComplianceEvidenceAttestationError) return 'unavailable';
    throw error;
  }
  const secret = keyring.keys[keyId];
  if (!secret) return 'unavailable';
  if (!validSecret(secret)) return 'unavailable';
  try {
    const provided = Buffer.from(macB64u, 'base64url');
    const expected = macFor(unsigned, secret);
    return provided.byteLength === expected.byteLength &&
      crypto.timingSafeEqual(provided, expected)
      ? 'verified'
      : 'invalid';
  } catch {
    return 'invalid';
  }
}
