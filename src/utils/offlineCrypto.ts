// SPDX-License-Identifier: MIT
//
// Real authenticated encryption (AES-256-GCM) for the web offline cache.
//
// The previous implementation called itself "encryption" but was
// `btoa(encodeURIComponent(JSON.stringify(x)))` — trivially reversible, no key,
// no integrity. On native, SQLCipher already encrypts the cache at rest
// (CLAUDE.md #16); on the web PWA the IndexedDB cache had NO real protection.
// This brings the web layer to genuine encryption (and defense-in-depth on
// native).
//
// A device-bound, NON-EXTRACTABLE AES-GCM key is generated once and persisted in
// IndexedDB (idb-keyval). Non-extractable keys can be structured-cloned into
// IndexedDB but never exported, so the raw key bytes never reach JS. Payloads are
// `v1:` + base64(iv ‖ ciphertext+tag).
//
// Migration-safe: `decryptData` still reads legacy base64 payloads (no `v1:`
// prefix), so a cache written by the old code is not lost on upgrade. The cache
// is re-syncable from Firestore, so a cleared key only invalidates the cache (no
// data loss). Directive: cifrado real — no llamarlo cifrado si no lo es.

import { get as idbGet, set as idbSet } from 'idb-keyval';
import { logger } from './logger';

const KEY_STORAGE = 'praeventio:offline-aes-key:v1';
const VERSION_PREFIX = 'v1:';
const IV_BYTES = 12;

let keyPromise: Promise<CryptoKey | null> | null = null;

function getSubtle(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.subtle && typeof c.getRandomValues === 'function' ? c.subtle : null;
}

/**
 * Device-bound non-extractable AES-GCM key: generated once, persisted in
 * IndexedDB, cached in-memory for the session. Returns null when WebCrypto or
 * IndexedDB are unavailable (callers fall back to legacy obfuscation).
 */
export async function getOfflineKey(): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    if (!getSubtle()) return null;
    try {
      const existing = await idbGet(KEY_STORAGE);
      if (existing instanceof CryptoKey) return existing;
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable
        ['encrypt', 'decrypt'],
      );
      try {
        await idbSet(KEY_STORAGE, key);
      } catch {
        // Key not persisted (no IndexedDB) — still usable for this session.
      }
      return key;
    } catch (e) {
      logger.error('offline key init failed', e);
      return null;
    }
  })();
  return keyPromise;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function legacyEncode(json: string): string {
  return btoa(encodeURIComponent(json));
}

/**
 * Encrypt a JSON-serializable value → versioned base64. Falls back to the legacy
 * obfuscation only if WebCrypto is unavailable (offline must keep working).
 */
export async function encryptData(data: unknown): Promise<string> {
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch (e) {
    logger.error('Encryption serialize error', e);
    return '';
  }
  const key = await getOfflineKey();
  if (!key) return legacyEncode(json);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json)),
    );
    const packed = new Uint8Array(iv.length + ct.length);
    packed.set(iv, 0);
    packed.set(ct, iv.length);
    return VERSION_PREFIX + toB64(packed);
  } catch (e) {
    logger.error('Encryption error', e);
    return legacyEncode(json);
  }
}

/**
 * Decrypt a value produced by `encryptData`. Reads legacy base64 payloads too
 * (migration). Returns null on tamper/corruption (GCM authentication failure).
 */
export async function decryptData(payload: string): Promise<unknown> {
  try {
    if (!payload.startsWith(VERSION_PREFIX)) {
      return JSON.parse(decodeURIComponent(atob(payload)));
    }
    const key = await getOfflineKey();
    if (!key) return null;
    const packed = fromB64(payload.slice(VERSION_PREFIX.length));
    const iv = packed.slice(0, IV_BYTES);
    const ct = packed.slice(IV_BYTES);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) {
    logger.error('Decryption error', e);
    return null;
  }
}

/** Reset the in-memory key cache (tests / sign-out). */
export function __resetOfflineKeyForTests(): void {
  keyPromise = null;
}
