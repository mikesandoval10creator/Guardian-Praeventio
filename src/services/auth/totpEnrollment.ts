// Praeventio Guard — TOTP enrollment + verification service.
//
// Wrapper sobre `totp.ts` (que es pure crypto) que añade el flujo de
// enrollment + persistencia + recovery codes. El secret se persiste
// CIFRADO via `encryptedKvStore` (KEK device-bound) — NUNCA en
// plaintext en IndexedDB ni en Firestore.
//
// Flujo de enrollment:
//   1. user.startEnrollment() → genera secret + provisioning URI + recovery codes
//      Estado: 'pending-verification' (en draft, secret pasa al QR pero NO se persiste yet)
//   2. usuario escanea QR con Authenticator y obtiene un código de 6 dígitos
//   3. user.confirmEnrollment(code) → verifica que el código coincide, persiste
//      secret cifrado + hashes de recovery codes
//      Estado: 'enrolled'
//   4. Al login con MFA: user.verifyCode(code) o user.verifyRecoveryCode(rc)
//
// Si confirmEnrollment NO se llama dentro de N minutos, el draft expira
// (el secret no se persistió, hay que reenrollarse).
//
// Recovery codes: persistimos solo SHA-256 hashes. Cuando se usa uno,
// se marca como consumido — single-use.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  base32Decode,
  generateSecret,
  generateRecoveryCodes,
  buildProvisioningUri,
  verifyTotp,
} from './totp.js';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type TotpEnrollmentStatus = 'none' | 'pending-verification' | 'enrolled';

export interface TotpEnrollmentDraft {
  /** Estado interno. */
  status: 'pending-verification';
  /** Secret en Base32 (para mostrar al user como backup). */
  secretBase32: string;
  /** otpauth:// URI para el QR. */
  provisioningUri: string;
  /** Recovery codes EN CLARO (mostrar UNA vez al user). */
  recoveryCodesPlaintext: string[];
  /** Hashes de los recovery codes (lo que se persistirá). */
  recoveryCodeHashes: string[];
  /** ISO timestamp de cuándo expira el draft. */
  expiresAtIso: string;
  /** UID del usuario que está enrolando. */
  userUid: string;
}

export interface TotpEnrolledRecord {
  status: 'enrolled';
  /**
   * Secret cifrado base64 — el caller lo persiste via encryptedKvStore.
   * NUNCA plaintext fuera de memoria.
   */
  secretBase32Plaintext: string;
  /** Recovery codes hashes (SHA-256 hex). */
  recoveryCodeHashes: string[];
  /** Hashes ya consumidos (marcados como usados). */
  consumedRecoveryHashes: string[];
  /** ISO timestamp del enrollment. */
  enrolledAtIso: string;
  /** UID del usuario enrolado. */
  userUid: string;
}

export class TotpEnrollmentError extends Error {
  constructor(
    public readonly code:
      | 'NO_DRAFT'
      | 'DRAFT_EXPIRED'
      | 'INVALID_CODE'
      | 'NOT_ENROLLED'
      | 'ALREADY_ENROLLED'
      | 'RECOVERY_CODE_INVALID'
      | 'RECOVERY_CODE_ALREADY_USED',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'TotpEnrollmentError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Crypto helpers
// ────────────────────────────────────────────────────────────────────────

function hashRecoveryCode(code: string): string {
  // Normalize: uppercase + remove dashes for forgiving comparison.
  const normalized = code.toUpperCase().replace(/-/g, '');
  return bytesToHex(sha256(new TextEncoder().encode(normalized)));
}

// ────────────────────────────────────────────────────────────────────────
// Enrollment flow
// ────────────────────────────────────────────────────────────────────────

const DRAFT_TTL_MIN = 10;

export interface StartEnrollmentInput {
  userUid: string;
  /** Account name a mostrar en el Authenticator app (email del user). */
  accountName: string;
  /** Issuer custom. Default "Praeventio". */
  issuer?: string;
  /** Override now para tests. */
  now?: Date;
}

export function startEnrollment(input: StartEnrollmentInput): TotpEnrollmentDraft {
  const now = input.now ?? new Date();
  const { base32 } = generateSecret();
  const provisioningUri = buildProvisioningUri({
    accountName: input.accountName,
    issuer: input.issuer ?? 'Praeventio',
    secretBase32: base32,
  });
  const recoveryCodes = generateRecoveryCodes(10);
  const recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);
  return {
    status: 'pending-verification',
    secretBase32: base32,
    provisioningUri,
    recoveryCodesPlaintext: recoveryCodes,
    recoveryCodeHashes,
    expiresAtIso: new Date(now.getTime() + DRAFT_TTL_MIN * 60 * 1000).toISOString(),
    userUid: input.userUid,
  };
}

export interface ConfirmEnrollmentInput {
  draft: TotpEnrollmentDraft;
  /** Código TOTP de 6 dígitos del Authenticator app del user. */
  userCode: string;
  now?: Date;
}

/**
 * Verifica el código TOTP contra el secret del draft. Si OK, devuelve
 * el TotpEnrolledRecord listo para persistir. Si NO, throws.
 *
 * Tolerancia clock drift: ±1 step (30s).
 */
export function confirmEnrollment(
  input: ConfirmEnrollmentInput,
): TotpEnrolledRecord {
  const now = input.now ?? new Date();
  if (now.toISOString() > input.draft.expiresAtIso) {
    throw new TotpEnrollmentError('DRAFT_EXPIRED', 'el draft expiró, reinicia el enrollment');
  }
  const secretRaw = base32Decode(input.draft.secretBase32);
  const result = verifyTotp(secretRaw, input.userCode.trim(), {
    nowSec: Math.floor(now.getTime() / 1000),
    windowSteps: 1,
  });
  if (result === null) {
    throw new TotpEnrollmentError(
      'INVALID_CODE',
      'código TOTP inválido (verifica el reloj del teléfono)',
    );
  }
  return {
    status: 'enrolled',
    secretBase32Plaintext: input.draft.secretBase32,
    recoveryCodeHashes: input.draft.recoveryCodeHashes,
    consumedRecoveryHashes: [],
    enrolledAtIso: now.toISOString(),
    userUid: input.draft.userUid,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Verify (login-time)
// ────────────────────────────────────────────────────────────────────────

export interface VerifyTotpCodeInput {
  record: TotpEnrolledRecord;
  userCode: string;
  now?: Date;
  windowSteps?: number;
}

export function verifyEnrolledCode(input: VerifyTotpCodeInput): boolean {
  const now = input.now ?? new Date();
  const secretRaw = base32Decode(input.record.secretBase32Plaintext);
  const result = verifyTotp(secretRaw, input.userCode.trim(), {
    nowSec: Math.floor(now.getTime() / 1000),
    windowSteps: input.windowSteps ?? 1,
  });
  return result !== null;
}

export interface UseRecoveryCodeResult {
  ok: boolean;
  /** Si ok=true, devuelve el record actualizado con el hash marcado consumido. */
  updatedRecord?: TotpEnrolledRecord;
}

/**
 * Verifica un recovery code y lo marca como consumido (single-use). El
 * caller persiste el `updatedRecord` resultante.
 */
export function useRecoveryCode(
  record: TotpEnrolledRecord,
  userCode: string,
): UseRecoveryCodeResult {
  const hash = hashRecoveryCode(userCode);
  if (!record.recoveryCodeHashes.includes(hash)) {
    return { ok: false };
  }
  if (record.consumedRecoveryHashes.includes(hash)) {
    return { ok: false };
  }
  return {
    ok: true,
    updatedRecord: {
      ...record,
      consumedRecoveryHashes: [...record.consumedRecoveryHashes, hash],
    },
  };
}

/**
 * Cuenta cuántos recovery codes quedan disponibles (no consumidos).
 * UI usa esto para advertir "te quedan 3 — regenera pronto".
 */
export function countAvailableRecoveryCodes(record: TotpEnrolledRecord): number {
  return (
    record.recoveryCodeHashes.length - record.consumedRecoveryHashes.length
  );
}

// ────────────────────────────────────────────────────────────────────────
// Disable enrollment (user wants to disable MFA)
// ────────────────────────────────────────────────────────────────────────

export interface DisableEnrollmentInput {
  record: TotpEnrolledRecord;
  /** Para disable se requiere un código válido — esto previene que un
   *  atacante con sesión activa pero sin el segundo factor desactive MFA. */
  userCode: string;
  now?: Date;
}

export function disableEnrollment(input: DisableEnrollmentInput): boolean {
  return verifyEnrolledCode({
    record: input.record,
    userCode: input.userCode,
    now: input.now,
  });
}
