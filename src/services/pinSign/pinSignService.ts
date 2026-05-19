// Praeventio Guard — Sprint K F.25: PIN Sign (firma por PIN sin biometría).
//
// Cierra: Sprint K reformulado §F.25 — "componente reusable PIN sign
// para firmar sin biometría". Es el fallback de WebAuthn / QR cuando
// el trabajador no tiene huella registrada o el dispositivo no soporta
// biometría (ej. tablet compartido, kiosk de obra).
//
// Diseño:
//   1. Trabajador escoge PIN de 4-6 dígitos al registrarse.
//   2. Server guarda PBKDF2(pin, salt, 600_000 iter) — never el PIN.
//   3. Para firmar un item, cliente envía `{itemId, kind, projectId, pin}`.
//   4. Server verifica PBKDF2(pin, salt) == storedHash (timing-safe).
//   5. Si OK: emite `PinSignedAcknowledgement` con timestamp + HMAC.
//
// Lockout: 5 intentos fallidos consecutivos → bloquear 15 min.
// Re-emisión PIN: workflow separado con verificación de identidad
// (admin/supervisor confirma identidad), no implementado aquí (el
// caller orquesta vía /api/admin/pin/reset cuando el item lo amerite).
//
// 100% determinístico. KDF via @noble/hashes/pbkdf2.

import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PinSignItemKind =
  | 'epp_delivery'
  | 'safety_talk'
  | 'document_read'
  | 'training_completion'
  | 'permit_acknowledgement'
  | 'inspection_handover';

export interface PinCredential {
  /** UID del trabajador propietario. */
  workerUid: string;
  /** Salt único por usuario (hex). */
  saltHex: string;
  /** PBKDF2(pin, salt, iter) en hex. */
  hashHex: string;
  /** Iteraciones (default 600_000 para SHA-256). */
  iterations: number;
  /** ISO-8601 cuando se registró. */
  createdAt: string;
  /** Conteo intentos fallidos consecutivos (reset on success). */
  consecutiveFailures: number;
  /** ISO-8601 — si presente y futuro, cuenta bloqueada hasta. */
  lockedUntil?: string;
}

export interface PinSignedAcknowledgement {
  itemId: string;
  kind: PinSignItemKind;
  projectId: string;
  signedByUid: string;
  signedAt: string;
  /** HMAC del acknowledgement para integridad — server-side secret. */
  attestationHex: string;
  /** Lat/lng opcional. */
  location?: { lat: number; lng: number };
  /** Falso siempre — distintivo vs biometric/qr. */
  biometricUsed: false;
}

export class PinSignValidationError extends Error {
  constructor(
    public readonly code: string,
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'PinSignValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

export const PBKDF2_ITERATIONS = 600_000;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const SALT_BYTES = 16;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const LOCKOUT_MINUTES = 15;
const PIN_DIGITS_REGEX = /^\d{4,6}$/;
/** Subset of "trivial" PINs that should be rejected at registration. */
const TRIVIAL_PINS = new Set<string>([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '2345', '5432', '3456', '6543', '4567', '7654', '5678', '8765', '6789', '9876',
  '0123', '3210',
  '00000', '11111', '22222', '33333', '44444', '55555', '66666', '77777', '88888', '99999',
  '12345', '54321', '23456', '65432', '34567', '76543', '45678', '87654', '56789', '98765',
  '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '234567', '765432', '345678', '876543', '456789', '987654',
]);

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function computePbkdf2Hex(
  pin: string,
  saltHex: string,
  iterations: number = PBKDF2_ITERATIONS,
): string {
  const pinBytes = utf8ToBytes(pin);
  const saltBytes = hexToBytes(saltHex);
  const dk = pbkdf2(sha256, pinBytes, saltBytes, { c: iterations, dkLen: 32 });
  return bytesToHex(dk);
}

// ────────────────────────────────────────────────────────────────────────
// PIN validation (registration-time policy)
// ────────────────────────────────────────────────────────────────────────

export function validatePinPolicy(pin: string): void {
  if (typeof pin !== 'string' || !PIN_DIGITS_REGEX.test(pin)) {
    throw new PinSignValidationError(
      'PIN_FORMAT',
      `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`,
    );
  }
  if (TRIVIAL_PINS.has(pin)) {
    throw new PinSignValidationError(
      'PIN_TRIVIAL',
      'PIN matches a trivial sequence (e.g. 1234, 0000); pick a less predictable value',
    );
  }
}

// ────────────────────────────────────────────────────────────────────────
// Register a new PIN credential
// ────────────────────────────────────────────────────────────────────────

export interface RegisterPinInput {
  workerUid: string;
  pin: string;
  /** Random bytes (server provee). Hex, len = SALT_BYTES*2. */
  saltHex: string;
  /** Override for tests. */
  now?: Date;
  /** Override iterations for tests. */
  iterations?: number;
}

export function registerPin(input: RegisterPinInput): PinCredential {
  if (!input.workerUid || input.workerUid.length === 0) {
    throw new PinSignValidationError('MISSING_WORKER', 'workerUid required');
  }
  if (typeof input.saltHex !== 'string' || input.saltHex.length < SALT_BYTES * 2) {
    throw new PinSignValidationError(
      'WEAK_SALT',
      `saltHex must be >= ${SALT_BYTES * 2} hex chars`,
    );
  }
  validatePinPolicy(input.pin);
  const iterations = input.iterations ?? PBKDF2_ITERATIONS;
  const hashHex = computePbkdf2Hex(input.pin, input.saltHex, iterations);
  return {
    workerUid: input.workerUid,
    saltHex: input.saltHex,
    hashHex,
    iterations,
    createdAt: (input.now ?? new Date()).toISOString(),
    consecutiveFailures: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Verify PIN + signal lockout
// ────────────────────────────────────────────────────────────────────────

export interface VerifyPinInput {
  credential: PinCredential;
  pin: string;
  /** Override for tests. */
  now?: Date;
}

export interface VerifyPinOutcome {
  ok: boolean;
  /** Returns the updated credential (counter incremented or reset). */
  credential: PinCredential;
  /** True when this verification just placed the credential into lockout. */
  justLockedOut: boolean;
  /** Minutes until lockout expires (only when locked). */
  remainingLockoutMinutes?: number;
}

export function verifyPin(input: VerifyPinInput): VerifyPinOutcome {
  const now = input.now ?? new Date();
  const cred = input.credential;

  // Check existing lockout window.
  if (cred.lockedUntil) {
    const lockedUntilMs = Date.parse(cred.lockedUntil);
    if (now.getTime() < lockedUntilMs) {
      const remainingMin = Math.ceil((lockedUntilMs - now.getTime()) / 60_000);
      return {
        ok: false,
        credential: cred,
        justLockedOut: false,
        remainingLockoutMinutes: remainingMin,
      };
    }
    // Lockout expired — reset counter, drop lockedUntil.
    cred.consecutiveFailures = 0;
    delete cred.lockedUntil;
  }

  if (!PIN_DIGITS_REGEX.test(input.pin)) {
    // Bad format — count as a failure but don't reveal "format" vs "wrong".
    return registerFailure(cred, now);
  }

  const candidate = computePbkdf2Hex(input.pin, cred.saltHex, cred.iterations);
  const match = timingSafeHexEqual(candidate, cred.hashHex);

  if (match) {
    return {
      ok: true,
      credential: { ...cred, consecutiveFailures: 0, lockedUntil: undefined },
      justLockedOut: false,
    };
  }
  return registerFailure(cred, now);
}

function registerFailure(cred: PinCredential, now: Date): VerifyPinOutcome {
  const nextFailures = cred.consecutiveFailures + 1;
  if (nextFailures >= MAX_CONSECUTIVE_FAILURES) {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString();
    return {
      ok: false,
      credential: {
        ...cred,
        consecutiveFailures: nextFailures,
        lockedUntil,
      },
      justLockedOut: true,
      remainingLockoutMinutes: LOCKOUT_MINUTES,
    };
  }
  return {
    ok: false,
    credential: { ...cred, consecutiveFailures: nextFailures },
    justLockedOut: false,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Build acknowledgement (after verifyPin returns ok=true)
// ────────────────────────────────────────────────────────────────────────

export interface BuildAcknowledgementInput {
  itemId: string;
  kind: PinSignItemKind;
  projectId: string;
  signedByUid: string;
  location?: { lat: number; lng: number };
  /** Override for tests. */
  now?: Date;
}

/**
 * Compute attestation HMAC. The server keeps `serverSecret` private —
 * audit log can later re-derive the same HMAC and detect tampering.
 */
function attestationHmac(
  payload: Omit<PinSignedAcknowledgement, 'attestationHex'>,
  serverSecret: string,
): string {
  const ordered = {
    itemId: payload.itemId,
    kind: payload.kind,
    projectId: payload.projectId,
    signedByUid: payload.signedByUid,
    signedAt: payload.signedAt,
    biometricUsed: payload.biometricUsed,
    location: payload.location,
  };
  const json = JSON.stringify(ordered);
  const key = utf8ToBytes(serverSecret);
  const msg = utf8ToBytes(json);
  return bytesToHex(hmac(sha256, key, msg));
}

export function buildAcknowledgement(
  input: BuildAcknowledgementInput,
  serverSecret: string,
): PinSignedAcknowledgement {
  if (typeof serverSecret !== 'string' || serverSecret.length < 16) {
    throw new PinSignValidationError('WEAK_SECRET', 'serverSecret must be >= 16 chars');
  }
  if (!input.itemId || !input.projectId || !input.signedByUid) {
    throw new PinSignValidationError('MISSING_FIELD', 'required fields missing');
  }
  const partial: Omit<PinSignedAcknowledgement, 'attestationHex'> = {
    itemId: input.itemId,
    kind: input.kind,
    projectId: input.projectId,
    signedByUid: input.signedByUid,
    signedAt: (input.now ?? new Date()).toISOString(),
    biometricUsed: false,
    location: input.location,
  };
  const attestationHex = attestationHmac(partial, serverSecret);
  return { ...partial, attestationHex };
}

/**
 * Re-derive the HMAC for an existing acknowledgement and compare in a
 * timing-safe manner. Audit tools call this to detect tampering.
 */
export function verifyAcknowledgement(
  ack: PinSignedAcknowledgement,
  serverSecret: string,
): boolean {
  const { attestationHex, ...rest } = ack;
  const expected = attestationHmac(rest, serverSecret);
  return timingSafeHexEqual(expected, attestationHex);
}
