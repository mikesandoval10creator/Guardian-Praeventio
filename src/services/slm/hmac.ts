/**
 * Per-session HMAC-SHA256 sign / verify primitives for the offline
 * SLM queue (Sprint 20, ninth wave, Bucket B — TM-T03 mitigation).
 *
 * THREAT MODEL (justifies the non-obvious design):
 *
 * The offline queue (`offlineQueue.ts`) persists `{query, response}`
 * pairs to IndexedDB while the device is offline. The reconciler later
 * drains the queue and writes each entry into the Zettelkasten audit
 * trail via `writeNodes`. A passive disk-resident attacker — a
 * malicious browser extension, a local script with same-origin scope,
 * or someone editing the IndexedDB store via DevTools — could mutate a
 * queued record between enqueue and reconcile, persisting attacker-
 * authored data into the safety-learning corpus.
 *
 * The mitigation is a per-session HMAC-SHA256 tag stored alongside
 * each record. The tag is computed at enqueue, verified at reconcile,
 * and a mismatch causes the entry to be dropped + a Sentry warning to
 * be raised.
 *
 * The HMAC key lives in `sessionStorage` only — NOT in `localStorage`
 * and NOT in IndexedDB. That choice is deliberate:
 *   - Defeats passive disk-resident tampering (extensions, devtools
 *     edits, file-system-level snooping). The key is gone the moment
 *     the tab closes.
 *   - Does NOT defend against full XSS — script with the same origin
 *     can read sessionStorage and forge tags. TM-T03 explicitly scopes
 *     this control to "passive" tampering. XSS prevention is a
 *     separate axis (CSP, framework escaping).
 *   - Cross-tab desync is acceptable: each tab has its own key, but
 *     the queue is per-origin. A second tab opening mid-flight would
 *     simply not be able to verify entries enqueued by the first tab,
 *     and they'd be reported as `hmac_mismatch` and dropped. In
 *     practice the SLM offline path is single-tab; the cost of cross-
 *     tab key sharing (broadcastchannel + race window) outweighs the
 *     benefit.
 *
 * The tag is base64url-encoded (URL-safe, no `+` `/` `=`) so an
 * operator inspecting the IndexedDB store in DevTools can copy-paste
 * it without escaping.
 */

import * as Sentry from '@sentry/core';

/**
 * `sessionStorage` slot used to persist the raw HMAC key bytes.
 * Re-imported on every page load via `crypto.subtle.importKey` so the
 * `CryptoKey` reference is reusable across tab navigations within the
 * same session.
 */
const SESSION_KEY_NAME = 'gp_slm_hmac_key';

/**
 * Module-scoped cache of the imported `CryptoKey`. Avoids re-importing
 * the key on every sign / verify call — `importKey` is async and adds
 * unnecessary latency on the hot reconcile path.
 */
let cachedKey: CryptoKey | null = null;

/**
 * In-memory fallback for environments without `sessionStorage` (Node
 * test runner without `vi.stubGlobal`). Tests that want stable keys
 * across calls in one suite still work; tests that want fresh keys
 * call `__resetSessionKeyForTesting()` between cases.
 */
let inMemoryKeyBytes: Uint8Array | null = null;

/**
 * Resolve the global `crypto` object, throwing a clear error if it's
 * unavailable. Modern browsers and Node 20+ both expose
 * `globalThis.crypto.subtle`; this helper exists to surface a single
 * actionable error message rather than letting the SDK call NPE
 * deeper in the stack.
 */
function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error('hmac: crypto.subtle is unavailable in this environment');
  }
  return c.subtle;
}

/**
 * Resolve `sessionStorage` if available (browser, jsdom, vitest with
 * `vi.stubGlobal('sessionStorage', ...)`). Returns `null` otherwise so
 * the caller can fall back to the in-memory key cache.
 */
function getSessionStorage(): Storage | null {
  try {
    const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return ss ?? null;
  } catch {
    return null;
  }
}

/**
 * Encode a Uint8Array as standard base64 (used for sessionStorage
 * persistence — NOT URL-safe; the HMAC tag uses base64url separately).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return globalThis.btoa(s);
}

/**
 * Decode standard base64 → Uint8Array.
 */
function base64ToBytes(b64: string): Uint8Array {
  const s = globalThis.atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Encode a Uint8Array as base64url (URL-safe). Used for the HMAC tag
 * stored alongside each queue entry so an inspector can read it
 * without escaping.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a base64url string → Uint8Array. Pads back up to a multiple
 * of 4 with `=` so `atob` accepts it.
 */
function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  return base64ToBytes(padded + '='.repeat(pad));
}

/**
 * Lazily generate (or load) the per-session HMAC key.
 *
 * First call within a session:
 *   1. Look up `SESSION_KEY_NAME` in `sessionStorage`. If present,
 *      base64-decode + `importKey` and cache.
 *   2. Otherwise generate a fresh 256-bit key, export raw bytes,
 *      base64-encode, persist to `sessionStorage`, then import (so the
 *      cached `CryptoKey` is non-extractable for subsequent re-imports
 *      from disk are isolated from the live key reference).
 *
 * Subsequent calls return the cached `CryptoKey` directly.
 */
async function getOrCreateSessionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const subtle = getSubtle();
  const ss = getSessionStorage();

  // Try to recover an existing key from sessionStorage first so a
  // page reload mid-session keeps verifying entries it signed earlier.
  const existing = ss?.getItem(SESSION_KEY_NAME) ?? null;
  if (existing) {
    try {
      const raw = base64ToBytes(existing);
      cachedKey = await subtle.importKey(
        'raw',
        raw as unknown as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      );
      return cachedKey;
    } catch {
      // Corrupt entry — clear and fall through to regenerate.
      ss?.removeItem(SESSION_KEY_NAME);
    }
  }

  // In-memory fallback (Node test without sessionStorage stub) keeps
  // the cached key stable across calls in one test case.
  if (!ss && inMemoryKeyBytes) {
    cachedKey = await subtle.importKey(
      'raw',
      inMemoryKeyBytes as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    return cachedKey;
  }

  // Fresh key path — generate, export, persist, re-import.
  const generated = await subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const rawBuf = await subtle.exportKey('raw', generated);
  const raw = new Uint8Array(rawBuf);
  if (ss) {
    try {
      ss.setItem(SESSION_KEY_NAME, bytesToBase64(raw));
    } catch {
      // Quota exceeded / storage disabled — fall back to in-memory.
      inMemoryKeyBytes = raw;
    }
  } else {
    inMemoryKeyBytes = raw;
  }

  // Re-import the raw bytes as a non-extractable key so the cached
  // reference cannot be exported from this module's scope.
  cachedKey = await subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return cachedKey;
}

/**
 * Sign `payload` with the per-session HMAC key. Returns the tag as
 * base64url. Failures (missing crypto.subtle, etc.) re-throw so the
 * caller can surface them.
 */
export async function signPayload(payload: string): Promise<string> {
  const subtle = getSubtle();
  const key = await getOrCreateSessionKey();
  const data = new TextEncoder().encode(payload);
  const tagBuf = await subtle.sign(
    { name: 'HMAC' },
    key,
    data as unknown as BufferSource,
  );
  return bytesToBase64Url(new Uint8Array(tagBuf));
}

/**
 * Verify `payload` against `tag` using the per-session HMAC key. The
 * comparison is performed by `crypto.subtle.verify`, which the Web
 * Crypto spec defines as constant-time (the tag is reduced to a
 * single boolean match before returning to userland, no early-out on
 * the first differing byte).
 *
 * Returns `false` on any of: tag malformed, tag wrong length, key
 * missing, signature mismatch. Never throws on a verification failure
 * — only on environment faults (missing `crypto.subtle`), and even
 * those are wrapped in a Sentry breadcrumb so a corrupted runtime
 * doesn't silently disable integrity checks.
 */
export async function verifyPayload(
  payload: string,
  tag: string,
): Promise<boolean> {
  let tagBytes: Uint8Array;
  try {
    tagBytes = base64UrlToBytes(tag);
  } catch {
    return false;
  }
  // HMAC-SHA256 produces exactly 32 bytes — bail early on obviously
  // malformed input rather than handing it to subtle.verify which
  // would still reject it but with extra cost.
  if (tagBytes.length !== 32) return false;

  try {
    const subtle = getSubtle();
    const key = await getOrCreateSessionKey();
    const data = new TextEncoder().encode(payload);
    return await subtle.verify(
      { name: 'HMAC' },
      key,
      tagBytes as unknown as BufferSource,
      data as unknown as BufferSource,
    );
  } catch (err) {
    // Environment fault (e.g. no crypto.subtle) — record but don't
    // throw, so the caller can treat verification failure as a drop
    // signal.
    try {
      Sentry.addBreadcrumb({
        category: 'slm.queue.hmac_verify_error',
        level: 'warning',
        message: err instanceof Error ? err.message : String(err),
      });
    } catch {
      /* observability faults must not mask the verify result */
    }
    return false;
  }
}

/**
 * Test-only — clear the cached key + sessionStorage entry + in-memory
 * fallback. Used between cases so each test starts with a fresh key.
 *
 * @internal
 */
export function __resetSessionKeyForTesting(): void {
  cachedKey = null;
  inMemoryKeyBytes = null;
  const ss = getSessionStorage();
  try {
    ss?.removeItem(SESSION_KEY_NAME);
  } catch {
    /* swallow */
  }
}
