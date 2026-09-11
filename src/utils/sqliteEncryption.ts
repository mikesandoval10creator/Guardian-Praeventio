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
//      `setEncryptionSecret()` (plugin writes to its secure store).
//   3. Whether the secret was new or already stored, the next
//      `createConnection` MUST use mode `'secret'`. In the Android plugin,
//      mode `'encryption'` first calls SQLCipher `encrypt()` on the file; it is
//      a migration mode for an existing plaintext database, not a reopen mode.
//      Reusing it on an already encrypted database produces "file is not a
//      database" on the next launch.
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
 * call. The plugin's `secret` mode opens an encrypted database with the
 * passphrase held in its secure store. The plugin's `encryption` mode is a
 * one-way migration operation that calls SQLCipher `encrypt()` on an existing
 * plaintext file; it must not be used for normal reopen.
 */
export type SqliteOpenMode = 'secret';

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
    // `encryption` would migrate a plaintext file and then open it. This
    // database is already encrypted; reopen it with the stored secret.
    return 'secret';
  }
  const passphrase = generatePassphrase();
  await sqliteConnection.setEncryptionSecret(passphrase);
  return 'secret';
}
