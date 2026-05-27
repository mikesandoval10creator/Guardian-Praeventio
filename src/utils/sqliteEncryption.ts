// Praeventio Guard — P0 security fix (SQLite mobile data-at-rest encryption).
//
// Capacitor SQLite supports per-database encryption via SQLCipher. The two
// offline stores were calling `createConnection(name, false, "no-encryption",
// 1, false)` despite `capacitor.config.ts` claiming `iosIsEncryption: true`
// / `androidIsEncryption: true`. The config was a lie — at runtime, all rows
// landed in plaintext on the device.
//
// This helper coordinates the one-time secret initialisation with the SQLite
// plugin's OWN secure store (Keychain on iOS, plugin's secret-storage on
// Android). We deliberately do NOT persist the passphrase ourselves via
// `@capacitor/preferences` (which would be UserDefaults / SharedPreferences,
// i.e. plaintext-equivalent on a rooted/restored device) — Codex P1
// 3308579640 caught the earlier draft that did that.
//
// Pattern (per https://github.com/capacitor-community/sqlite docs):
//   1. `isSecretStored()` — does the native secure store already have a
//      passphrase from a previous boot?
//   2. If NO: generate a fresh 256-bit passphrase, hand it to the plugin via
//      `setEncryptionSecret()` (plugin writes to its secure store). The
//      next `createConnection` MUST use mode `'secret'` so the new secret
//      binds to a fresh DB.
//   3. If YES: skip secret setup. The next `createConnection` uses mode
//      `'encryption'` so the plugin retrieves the previously stored secret.
//
// IMPORTANT — migration path for existing dev installs:
//   Pre-existing unencrypted databases CANNOT be re-opened in encryption
//   mode (SQLCipher fails with "file is not a database"). Existing dev
//   installs with any pending_sync / blackbox / breadcrumbs rows must
//   either (a) drain the queue before upgrading, or (b) uninstall +
//   reinstall the app. Production user base for this change is 0 (mobile
//   build is still pre-release), so delete-and-rebuild is acceptable for
//   all current installs.

import type { SQLiteConnection } from '@capacitor-community/sqlite';

const PASSPHRASE_BYTES = 32; // 256-bit key

/** Generate a fresh 256-bit hex passphrase via WebCrypto. */
function generatePassphrase(): string {
  const bytes = new Uint8Array(PASSPHRASE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Mode hint for the next `createConnection(name, true, mode, version, ro)`
 * call. `'secret'` binds a newly-set passphrase to a fresh DB; `'encryption'`
 * reuses the previously stored passphrase.
 */
export type SqliteOpenMode = 'secret' | 'encryption';

/**
 * Idempotent: ensures the SQLite plugin's native secure store has an
 * encryption secret, generating + persisting one through the plugin's
 * own `setEncryptionSecret` API on first invocation (per device).
 *
 * The plugin handles persistence in the platform's secure store — we never
 * write the passphrase to `@capacitor/preferences` because that surface is
 * NOT a keychain on either platform.
 */
export async function ensureSqliteEncryptionSecret(
  sqliteConnection: SQLiteConnection,
): Promise<SqliteOpenMode> {
  // Codex P2 3308579650: re-calling setEncryptionSecret when the secret is
  // already stored is rejected by the plugin. Guard with isSecretStored().
  const stored = await sqliteConnection.isSecretStored();
  if (stored.result) {
    return 'encryption';
  }
  const passphrase = generatePassphrase();
  await sqliteConnection.setEncryptionSecret(passphrase);
  return 'secret';
}
