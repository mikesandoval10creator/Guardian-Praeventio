#!/usr/bin/env node
/**
 * Praeventio Guard — pre-commit guard for android:allowBackup="true".
 *
 * Fails the commit if android/app/src/main/AndroidManifest.xml has
 * android:allowBackup="true". When enabled, the Android Backup Manager
 * lets `adb backup` extract the entire app data (SQLCipher DB included)
 * from a USB-debugged device WITHOUT requiring root — a clear data-at-
 * rest bypass that defeats the SQLCipher encryption shipped in PR #512.
 *
 * Override path: if there is a legitimate reason to allow backup (e.g.
 * Google Drive auto-backup of non-sensitive prefs), add an inline XML
 * comment on the same line explaining why. The regex below accepts the
 * `<!-- ... -->` form to allow that escape hatch without bypassing the
 * guard at the hook level.
 *
 * Wiring: PR #514 wires this script into .husky/pre-commit. THIS PR
 * does NOT modify .husky/pre-commit — the script ships standalone and
 * can be run manually:
 *
 *   node scripts/precommit-allowbackup-guard.cjs
 *
 * Modeled after scripts/precommit-medical-guard.cjs (ADR 0012 enforcement).
 */

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_RELATIVE = path.join(
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
);
const MANIFEST = path.join(__dirname, '..', MANIFEST_RELATIVE);

function main() {
  if (!fs.existsSync(MANIFEST)) {
    // No manifest yet (e.g. fresh clone before `cap add android`). Nothing
    // to guard. precommit-medical-guard.cjs uses the same no-op pattern
    // when the staged-files set is empty.
    process.exit(0);
  }

  const content = fs.readFileSync(MANIFEST, 'utf-8');

  // Match `android:allowBackup="true"` ignoring case-insensitive attribute
  // value (Android XML allows "true"/"True"/"TRUE"). We deliberately do not
  // accept whitespace inside the attribute value — XML parsers are strict
  // about that, so the manifest would already be malformed if it had any.
  const ALLOW_BACKUP_TRUE = /android:allowBackup\s*=\s*"true"/i;

  if (!ALLOW_BACKUP_TRUE.test(content)) {
    process.exit(0);
  }

  // Escape hatch: scan the matching line for an explanatory `<!-- ... -->`
  // comment. If present, allow the commit but warn. This mirrors the
  // medical-guard convention that documented exceptions don't block.
  const lines = content.split(/\r?\n/);
  const offendingLines = lines
    .map((line, idx) => ({ line, lineNo: idx + 1 }))
    .filter((entry) => ALLOW_BACKUP_TRUE.test(entry.line));

  const allHaveOverride = offendingLines.every((entry) =>
    /<!--[\s\S]*?-->/.test(entry.line),
  );
  if (allHaveOverride) {
    process.stderr.write(
      '[precommit-allowbackup-guard] WARNING: android:allowBackup="true" with documented override.\n',
    );
    process.exit(0);
  }

  process.stderr.write('\n[precommit-allowbackup-guard] FAIL\n');
  process.stderr.write(
    `  ${MANIFEST_RELATIVE} has android:allowBackup="true".\n`,
  );
  process.stderr.write(
    '  This allows `adb backup` to extract app data WITHOUT root —\n',
  );
  process.stderr.write(
    '  defeating the SQLCipher encryption shipped in PR #512.\n',
  );
  process.stderr.write('\n  Offending line(s):\n');
  for (const entry of offendingLines) {
    process.stderr.write(`    L${entry.lineNo}: ${entry.line.trim()}\n`);
  }
  process.stderr.write(
    '\n  Fix: change to android:allowBackup="false".\n',
  );
  process.stderr.write(
    '  If you have a documented reason to allow backup, add an inline\n',
  );
  process.stderr.write(
    '  XML comment (<!-- justificación -->) on the same line.\n\n',
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { main, MANIFEST };
