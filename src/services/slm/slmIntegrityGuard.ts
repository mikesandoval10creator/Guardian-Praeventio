/**
 * SLM Integrity Guard — Sprint 47, Brecha C (C.9 SLM offline runtime).
 *
 * Pure-function motor that enforces SHA-256 integrity on downloaded SLM
 * payloads before they are handed to `ort.InferenceSession.create()`.
 * Complements (does not replace) `slmIntegrityCheck.ts`: that module
 * implements a *policy* discriminated union (`verified | mismatch |
 * unverified | rejected`) suitable for staged rollouts. THIS module is
 * the strict, throw-on-mismatch surface used by `slmRuntime.ts` and
 * any other call site that prefers exceptions over discriminated unions.
 *
 * Why both shapes:
 *   - `slmIntegrityCheck.ts` powers the existing worker pipeline where
 *     missing-hash-in-staging must degrade gracefully (warn but pass).
 *   - `slmIntegrityGuard.ts` is the C.9 runtime contract — every model
 *     load must produce a measurable SHA-256, and any mismatch against
 *     a declared expectation MUST short-circuit the load (`SlmIntegrityError`).
 *
 * The motor is environment-agnostic: it uses Web Crypto `subtle.digest`
 * everywhere (browsers, Node 20+, Deno, Cloudflare Workers). No
 * `node:crypto` fallback — keeps the bundle clean for the browser path.
 */

/**
 * Thrown by `assertModelIntegrity` when the computed SHA-256 of the
 * payload does not match the expected hash. Carries both hashes so
 * callers can log them for forensic analysis (e.g. corrupted CDN
 * cache vs. supply-chain tamper).
 */
export class SlmIntegrityError extends Error {
  public readonly expectedSha256: string;
  public readonly computedSha256: string;

  constructor(expected: string, computed: string, modelId?: string) {
    super(
      `SLM integrity check failed${modelId ? ` for model '${modelId}'` : ''}: ` +
        `expected SHA-256 ${expected}, got ${computed}`,
    );
    this.name = 'SlmIntegrityError';
    this.expectedSha256 = expected;
    this.computedSha256 = computed;
  }
}

/**
 * Compute the SHA-256 of a payload and return its hex-encoded form
 * (64 lowercase hex chars).
 *
 * Uses `globalThis.crypto.subtle.digest('SHA-256', ...)` which is
 * available in all modern runtimes targeted by the SLM bundle (Chrome,
 * Safari, Firefox, Edge, Node 20+, Deno, CF Workers).
 *
 * @throws if Web Crypto SubtleCrypto is unavailable in the current
 *         environment — production code paths should never see this.
 */
export async function computeSha256Hex(
  payload: Uint8Array | ArrayBuffer,
): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error(
      'slmIntegrityGuard: globalThis.crypto.subtle.digest unavailable. ' +
        'SHA-256 cannot be computed in this environment.',
    );
  }
  const bytes =
    payload instanceof Uint8Array
      ? payload
      : new Uint8Array(payload as ArrayBuffer);
  // `subtle.digest` accepts a BufferSource; pass the underlying buffer slice
  // so we don't double-copy. Using `bytes.buffer` directly is unsafe when
  // the Uint8Array views a subset of a larger buffer — slice() to be safe.
  const view = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const digest = await subtle.digest('SHA-256', view);
  return bufferToHex(new Uint8Array(digest));
}

/**
 * Strict assertion: if `expectedSha256` is provided, the computed
 * SHA-256 of `payload` MUST match it case-insensitively. Otherwise
 * throws `SlmIntegrityError`. When `expectedSha256` is `null` or
 * `undefined` the assertion is a no-op (caller policy decides what
 * to do with unverified payloads — see `slmIntegrityCheck.ts`).
 *
 * Returns the computed hex hash on success so callers can log /
 * persist it (useful when a model is downloaded for the first time
 * and the release pipeline still needs to capture its hash).
 */
export async function assertModelIntegrity(
  payload: Uint8Array | ArrayBuffer,
  expectedSha256: string | null | undefined,
  modelId?: string,
): Promise<string> {
  const computed = await computeSha256Hex(payload);
  if (expectedSha256 == null || expectedSha256 === '') {
    return computed;
  }
  if (computed.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new SlmIntegrityError(expectedSha256, computed, modelId);
  }
  return computed;
}

/**
 * Hex-encode a byte array as lowercase 2-char-per-byte string. Avoids
 * `Buffer` so we stay portable across runtimes.
 */
function bufferToHex(buf: Uint8Array): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const h = buf[i].toString(16);
    out += h.length === 1 ? `0${h}` : h;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Sprint 54 SLM real: bundle-level integrity (model + companions)
// ────────────────────────────────────────────────────────────────────────

export interface BundleFileToVerify {
  filename: string;
  payload: Uint8Array | ArrayBuffer;
  expectedSha256: string | null;
}

export interface BundleVerificationResult {
  modelId: string;
  /** Cada archivo + su hash computado + si pasó. */
  files: Array<{
    filename: string;
    computedSha256: string;
    expectedSha256: string | null;
    passed: boolean;
  }>;
  /** Si todos los archivos pasaron (true = bundle confiable). */
  allVerified: boolean;
  /** Archivos sin expected (skip — solo computed se reporta). */
  unverifiedCount: number;
  /** Archivos donde el computed NO match. */
  mismatchCount: number;
}

/**
 * Verifica un bundle completo (modelo principal + companions) en una
 * sola pasada. Útil para modelos split como Phi-3 ONNX-web donde
 * `.onnx` + `.onnx_data` ambos necesitan integrity check antes de
 * dar al loader.
 *
 * Si CUALQUIER archivo declara expectedSha256 y NO matchea →
 * throw SlmIntegrityError con detalle del primer archivo malo.
 *
 * Archivos con expectedSha256=null pasan y se incluyen en
 * unverifiedCount (caller decide qué hacer).
 */
export async function verifyBundleIntegrity(
  modelId: string,
  files: ReadonlyArray<BundleFileToVerify>,
): Promise<BundleVerificationResult> {
  const results: BundleVerificationResult['files'] = [];
  let mismatchCount = 0;
  let unverifiedCount = 0;
  let firstMismatch: { filename: string; expected: string; computed: string } | null = null;

  for (const f of files) {
    const computed = await computeSha256Hex(f.payload);
    let passed: boolean;
    if (f.expectedSha256 == null || f.expectedSha256 === '') {
      passed = true; // sin expected, no se rechaza; caller decide via unverifiedCount
      unverifiedCount += 1;
    } else if (computed.toLowerCase() === f.expectedSha256.toLowerCase()) {
      passed = true;
    } else {
      passed = false;
      mismatchCount += 1;
      if (!firstMismatch) {
        firstMismatch = {
          filename: f.filename,
          expected: f.expectedSha256,
          computed,
        };
      }
    }
    results.push({
      filename: f.filename,
      computedSha256: computed,
      expectedSha256: f.expectedSha256,
      passed,
    });
  }

  if (firstMismatch) {
    throw new SlmIntegrityError(
      firstMismatch.expected,
      firstMismatch.computed,
      `${modelId}/${firstMismatch.filename}`,
    );
  }

  return {
    modelId,
    files: results,
    allVerified: mismatchCount === 0 && unverifiedCount === 0,
    unverifiedCount,
    mismatchCount,
  };
}
