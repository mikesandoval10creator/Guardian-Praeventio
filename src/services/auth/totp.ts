// Praeventio Guard — TOTP (RFC 6238) + HOTP (RFC 4226) puro.
//
// Implementación real, no stub. Compatible con Google Authenticator,
// Authy, 1Password, Microsoft Authenticator y cualquier app TOTP
// estándar.
//
// Algoritmo (RFC 6238):
//   1. Time step T = floor(unixTime / 30)
//   2. HMAC-SHA1(secret, T as 8-byte big-endian) → 20-byte hash
//   3. offset = hash[19] & 0x0F
//   4. truncated = hash[offset..offset+4] como uint32 big-endian
//      masking high bit (& 0x7FFFFFFF)
//   5. code = truncated mod 10^6 → 6 dígitos zero-padded
//
// Secret encoding (Base32 RFC 4648 sin padding) — formato canónico para
// los Authenticator apps. El secret se persiste cifrado vía el
// encryptedKvStore existente (KEK device-bound), nunca en plaintext.

import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { randomBytes } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Base32 (RFC 4648) — sin padding (compatibilidad Google Authenticator)
// ────────────────────────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode bytes → Base32 string. Sin padding. Útil para mostrar el
 * secret en la UI ("ABCD EFGH ..." en grupos de 4) cuando el QR no
 * es práctico.
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Decode Base32 → bytes. Acepta lowercase, ignora espacios y padding.
 * Lanza si caracteres inválidos.
 */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    const v = BASE32_ALPHABET.indexOf(c);
    if (v < 0) {
      throw new Error(`base32Decode: invalid char '${c}' at index ${i}`);
    }
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out.subarray(0, idx);
}

// ────────────────────────────────────────────────────────────────────────
// HOTP — RFC 4226
// ────────────────────────────────────────────────────────────────────────

/**
 * Genera un HOTP code para un counter dado.
 *
 * @param secret raw bytes del shared secret
 * @param counter uint64 — para HOTP es un contador incremental;
 *                para TOTP es floor(unixSeconds / period)
 * @param digits longitud del code. 6 es el default canónico.
 */
export function hotp(
  secret: Uint8Array,
  counter: number,
  digits: number = 6,
): string {
  if (digits < 6 || digits > 8) {
    throw new Error(`hotp: digits must be 6-8, got ${digits}`);
  }
  // Counter as 8-byte big-endian.
  const counterBytes = new Uint8Array(8);
  // JS bitwise opera en 32-bit, así que partimos el counter en 2 halves.
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  counterBytes[0] = (high >>> 24) & 0xff;
  counterBytes[1] = (high >>> 16) & 0xff;
  counterBytes[2] = (high >>> 8) & 0xff;
  counterBytes[3] = high & 0xff;
  counterBytes[4] = (low >>> 24) & 0xff;
  counterBytes[5] = (low >>> 16) & 0xff;
  counterBytes[6] = (low >>> 8) & 0xff;
  counterBytes[7] = low & 0xff;

  const hash = hmac(sha1, secret, counterBytes);

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = hash[hash.length - 1]! & 0x0f;
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  const code = binary % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

// ────────────────────────────────────────────────────────────────────────
// TOTP — RFC 6238 (HOTP con counter = unixTime / period)
// ────────────────────────────────────────────────────────────────────────

export interface TotpOptions {
  /** Step en segundos. Default 30. */
  period?: number;
  /** Longitud del code. Default 6. */
  digits?: number;
  /** Override de "now" en segundos UNIX. Para tests. */
  nowSec?: number;
}

/**
 * Genera el TOTP code actual para un secret.
 */
export function totp(secret: Uint8Array, opts: TotpOptions = {}): string {
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / period);
  return hotp(secret, counter, digits);
}

/**
 * Verifica un código TOTP del usuario contra el secret, con tolerancia
 * de ±N steps (clock drift). Default ±1 step (= ±30s).
 *
 * Devuelve el delta del step si el code es válido (0 = exacto,
 * -1 = previo, +1 = siguiente), o null si NO matches.
 */
export function verifyTotp(
  secret: Uint8Array,
  userCode: string,
  opts: TotpOptions & { windowSteps?: number } = {},
): number | null {
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const windowSteps = opts.windowSteps ?? 1;
  const counter = Math.floor(nowSec / period);
  // Constant-time compare para evitar timing oracles.
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = hotp(secret, counter + delta, digits);
    if (constantTimeEqual(candidate, userCode)) {
      return delta;
    }
  }
  return null;
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
// Secret generation + provisioning URI
// ────────────────────────────────────────────────────────────────────────

/**
 * Genera un secret TOTP nuevo de 20 bytes (160 bits, recomendación RFC
 * 6238 para SHA-1). Devuelve Base32 + raw bytes.
 */
export function generateSecret(): { base32: string; raw: Uint8Array } {
  const raw = randomBytes(20);
  return { base32: base32Encode(raw), raw };
}

export interface ProvisioningUriInput {
  /** Identificador legible del usuario (email o "praeventio:juan@...") */
  accountName: string;
  /** Identificador del sistema. Default "Praeventio". */
  issuer?: string;
  /** Secret Base32 (sin padding). */
  secretBase32: string;
  /** Algoritmo. Solo SHA1 garantiza compatibilidad universal con apps. */
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
  digits?: number;
  period?: number;
}

/**
 * Construye el otpauth:// URI estándar (Key URI Format). Las apps
 * Authenticator escanean este URI desde un QR y configuran la cuenta.
 *
 * Spec: https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 *
 * Ejemplo:
 *   otpauth://totp/Praeventio:juan@empresa.cl?secret=ABCD&issuer=Praeventio
 */
export function buildProvisioningUri(input: ProvisioningUriInput): string {
  const issuer = input.issuer ?? 'Praeventio';
  const algorithm = input.algorithm ?? 'SHA1';
  const digits = input.digits ?? 6;
  const period = input.period ?? 30;
  // Key URI Format: label = "Issuer:Account" donde cada parte está
  // URL-encoded por separado pero los dos puntos se mantienen literales.
  // Esto matchea Google Authenticator + Authy + 1Password.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Genera 10 códigos de recuperación de 8 caracteres alfanuméricos.
 * El caller los muestra UNA vez al usuario y persiste hashes (NO los
 * códigos en claro). Cuando el usuario usa uno, se marca como
 * consumido — single-use.
 */
export function generateRecoveryCodes(count: number = 10): string[] {
  const out: string[] = [];
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(8);
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += ALPHA[bytes[j]! % ALPHA.length];
    }
    out.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return out;
}
