// Praeventio Guard — Sprint 39 STUB-3 cierre: SLM integrity checker.
//
// Cierra: AUDIT_TRUTH_MATRIX (SLM URLs Qwen/Gemma sin SHA256)
//         Plan integral STUB 2 — factibilidad alta
//
// Verifica que un modelo SLM descargado coincide con el `expectedSha256`
// declarado en su `ModelDescriptor`. Modelo de seguridad:
//
//   - Si descriptor.expectedSha256 está definido:
//       - sha256 coincide → ✅ accept
//       - sha256 NO coincide → ❌ fail-closed (modelo rechazado)
//   - Si descriptor.expectedSha256 está undefined:
//       - production → ❌ fail-closed con error claro
//       - non-production → ⚠️ warn pero pasa
//
// El SHA-256 se computa sobre el blob completo del weight file (no del
// archivo cifrado / no del bundle ZIP). Usa Web Crypto SubtleCrypto en
// browser, `node:crypto` en server-side tests.

import type { ModelDescriptor } from './types.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type IntegrityResult =
  | { status: 'verified'; computedSha256: string }
  | {
      status: 'mismatch';
      expected: string;
      computedSha256: string;
      reason: 'hash_mismatch';
    }
  | { status: 'unverified'; reason: 'no_expected_hash'; mode: 'staging' }
  | {
      status: 'rejected';
      reason: 'no_expected_hash_in_production' | 'compute_failed';
      detail?: string;
    };

export interface IntegrityCheckOptions {
  /** Override NODE_ENV detection for tests. Default reads process.env. */
  environment?: 'production' | 'staging' | 'development' | 'test';
  /** Override Web Crypto subtle for tests (or use node:crypto). */
  hasher?: (bytes: Uint8Array) => Promise<string>;
}

// ────────────────────────────────────────────────────────────────────────
// Default hasher (works in browser + Node)
// ────────────────────────────────────────────────────────────────────────

async function defaultHasher(bytes: Uint8Array): Promise<string> {
  // Browser (incluye Cloudflare Workers, Deno, etc.)
  if (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).crypto?.subtle?.digest === 'function'
  ) {
    const digest = await (globalThis as any).crypto.subtle.digest(
      'SHA-256',
      bytes,
    );
    return bufferToHex(new Uint8Array(digest));
  }
  // Node fallback — solo para tests/server-side.
  try {
    // Dynamic import para que el browser bundle no traiga node:crypto.
    const nodeCrypto: any = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  } catch (err) {
    throw new Error(
      `slmIntegrityCheck: no SHA-256 implementation available (browser SubtleCrypto and node:crypto both unavailable): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Validate that `bytes` matches `descriptor.expectedSha256`. Returns a
 * discriminated union; caller must check status before loading the model
 * into the ONNX session.
 *
 * Política production:
 *   - status='mismatch' → caller MUST NOT load (riesgo de modelo
 *     comprometido o corrupto)
 *   - status='rejected' (no hash in prod) → caller MUST NOT load
 *   - status='unverified' → solo OK fuera de production
 *   - status='verified' → safe to load
 */
export async function verifyModelIntegrity(
  descriptor: ModelDescriptor,
  bytes: Uint8Array,
  opts: IntegrityCheckOptions = {},
): Promise<IntegrityResult> {
  const env =
    opts.environment ??
    (typeof process !== 'undefined' &&
      (process.env?.NODE_ENV as 'production' | 'staging' | 'development' | 'test')) ??
    'development';
  const hasher = opts.hasher ?? defaultHasher;

  // No hash declarado.
  if (!descriptor.expectedSha256) {
    if (env === 'production') {
      return {
        status: 'rejected',
        reason: 'no_expected_hash_in_production',
        detail: `Model '${descriptor.id}' has no expectedSha256 — production refuses load`,
      };
    }
    return { status: 'unverified', reason: 'no_expected_hash', mode: 'staging' };
  }

  let computedSha256: string;
  try {
    computedSha256 = await hasher(bytes);
  } catch (err) {
    return {
      status: 'rejected',
      reason: 'compute_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (computedSha256.toLowerCase() !== descriptor.expectedSha256.toLowerCase()) {
    return {
      status: 'mismatch',
      expected: descriptor.expectedSha256,
      computedSha256,
      reason: 'hash_mismatch',
    };
  }

  return { status: 'verified', computedSha256 };
}

/**
 * Helper: dado un IntegrityResult, decide si el loader puede proceder.
 * Centraliza la política en un solo lugar.
 */
export function shouldLoadModel(result: IntegrityResult): boolean {
  return result.status === 'verified' || result.status === 'unverified';
}

/**
 * Construye URL completa del weight file dado un descriptor.
 * Si descriptor.weightFilename está presente, lo concatena al url base.
 * Si no, devuelve el url tal cual (asume el loader resolverá heurístico).
 */
export function buildWeightUrl(descriptor: ModelDescriptor): string {
  if (!descriptor.weightFilename) return descriptor.url;
  // HuggingFace canónico: https://huggingface.co/<repo>/resolve/main/<path>
  // Si la url ya es el repo root, agregamos /resolve/main/<filename>.
  const base = descriptor.url.replace(/\/$/, '');
  if (base.includes('/resolve/')) {
    // Ya tiene un /resolve/ — el caller pasó URL completa.
    return base;
  }
  return `${base}/resolve/main/${descriptor.weightFilename}`;
}
