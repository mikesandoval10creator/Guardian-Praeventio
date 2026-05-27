// Praeventio Guard — P0 security fix (SQLite mobile data-at-rest encryption).
//
// Capacitor SQLite supports per-database encryption via SQLCipher (sqlite-cipher
// under the hood). Until this module landed, both offline stores were calling
// `createConnection(name, false, "no-encryption", 1, false)` despite the
// capacitor.config.ts claiming `iosIsEncryption: true` / `androidIsEncryption:
// true`. The config was a lie — at runtime, all rows landed in plaintext.
//
// This helper generates a strong 32-byte (256-bit) passphrase on the FIRST
// boot of a given device, persists it through `@capacitor/preferences`
// (keychain-backed on iOS, EncryptedSharedPreferences-backed on Android), and
// returns the SAME passphrase on every subsequent call so the existing
// encrypted database can be re-opened.
//
// IMPORTANT — migration path for existing dev installs:
//   Pre-existing unencrypted databases CANNOT be re-opened in encryption
//   mode (SQLCipher will fail with "file is not a database"). Existing dev
//   installs that have any pending_sync / blackbox / breadcrumbs rows need
//   to either (a) drain the queue before upgrading, or (b) uninstall +
//   reinstall the app. Production user base for this change is 0 (mobile
//   build is still pre-release), so delete-and-rebuild is acceptable for
//   all current installs.

import { Preferences } from '@capacitor/preferences';

/**
 * Versioned key. If we ever need to rotate the passphrase (e.g. after a
 * security incident), bump to `v2` here AND clear the previous key. The
 * version suffix also gives us a clean migration handle — pre-v1 installs
 * never wrote this key, so reading it returns `null` and we generate fresh.
 */
const SQLITE_PASSPHRASE_KEY = 'praeventio.sqlite.passphrase.v1';

/**
 * 32 bytes hex-encoded = 64 characters. We accept the persisted value only
 * if its length matches; a shorter / longer string means corruption or a
 * partial write — regenerate rather than fail loudly (the device data
 * either decrypts with the regenerated key or it doesn't, and either way
 * we don't have a recovery story for a torn keychain entry).
 */
const EXPECTED_HEX_LENGTH = 64;

/**
 * Returns the device-local SQLite passphrase, generating + persisting one
 * on first call. Idempotent across cold starts.
 *
 * Storage:
 *   - iOS: Apple Keychain (`SecKeychainItemRef`, default `kSecAttrAccessible`
 *     ≈ `AfterFirstUnlock`). Keychain entries survive app delete only when
 *     explicitly configured; for our purposes, app delete = key gone =
 *     encrypted blobs cannot be opened, which is fine (data is already
 *     considered lost when the app is uninstalled).
 *   - Android: `EncryptedSharedPreferences` backed by `MasterKey` in the
 *     Android Keystore. Same survival semantics.
 *   - Web (fallback): `localStorage`. The web path NEVER uses Capacitor
 *     SQLite — only IndexedDB — so this branch is exercised only by tests
 *     running under jsdom / node.
 */
export async function getOrGenerateSqlitePassphrase(): Promise<string> {
  const { value } = await Preferences.get({ key: SQLITE_PASSPHRASE_KEY });
  if (typeof value === 'string' && value.length === EXPECTED_HEX_LENGTH) {
    return value;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await Preferences.set({ key: SQLITE_PASSPHRASE_KEY, value: hex });
  return hex;
}

/** Internal — exported only so tests can clear the cache. */
export const __SQLITE_PASSPHRASE_KEY = SQLITE_PASSPHRASE_KEY;
