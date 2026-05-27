#!/usr/bin/env node
/**
 * Self-test for scripts/precommit-allowbackup-guard.cjs.
 *
 * Runs the script against synthetic AndroidManifest.xml fixtures inside a
 * tmp directory tree to verify exit codes match the spec:
 *
 *   allowBackup="true" without override → exit 1 (block)
 *   allowBackup="true" with comment override → exit 0 (allow + warn)
 *   allowBackup="false" → exit 0 (pass)
 *   missing allowBackup attribute → exit 0 (pass)
 *   missing manifest file → exit 0 (pre-cap-add no-op)
 *
 * Designed to run via `node scripts/precommit-allowbackup-guard.test.cjs`
 * — no test framework, just process exit. Mirrors the standalone-script
 * convention used elsewhere in scripts/.
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.join(__dirname, 'precommit-allowbackup-guard.cjs');

function runWithManifest(manifestContent) {
  // The script's MANIFEST path is computed as `__dirname/../android/app/src/
  // main/AndroidManifest.xml`. To exercise it under a fixture, we copy the
  // script into a tmp `scripts/` dir whose parent contains a fresh android
  // tree. The behaviour then matches a real repo layout.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowbackup-guard-'));
  try {
    const scriptsDir = path.join(tmpDir, 'scripts');
    const androidDir = path.join(tmpDir, 'android', 'app', 'src', 'main');
    fs.mkdirSync(scriptsDir, { recursive: true });
    if (manifestContent !== null) {
      fs.mkdirSync(androidDir, { recursive: true });
      fs.writeFileSync(
        path.join(androidDir, 'AndroidManifest.xml'),
        manifestContent,
      );
    }
    const tmpScript = path.join(scriptsDir, 'precommit-allowbackup-guard.cjs');
    fs.copyFileSync(SCRIPT, tmpScript);
    try {
      execSync(`node "${tmpScript}"`, { stdio: 'pipe' });
      return 0;
    } catch (e) {
      return typeof e.status === 'number' ? e.status : 1;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const cases = [
  {
    name: 'allowBackup="true" without override → exit 1',
    manifest:
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '  <application android:allowBackup="true" />\n' +
      '</manifest>\n',
    expected: 1,
  },
  {
    name: 'allowBackup="false" → exit 0',
    manifest:
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '  <application android:allowBackup="false" />\n' +
      '</manifest>\n',
    expected: 0,
  },
  {
    name: 'missing allowBackup → exit 0',
    manifest:
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '  <application android:label="@string/app_name" />\n' +
      '</manifest>\n',
    expected: 0,
  },
  {
    name: 'allowBackup="true" with inline comment override → exit 0',
    manifest:
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '  <application android:allowBackup="true" />  <!-- Justified: non-sensitive prefs only, see runbook -->\n' +
      '</manifest>\n',
    expected: 0,
  },
  {
    name: 'allowBackup="TRUE" upper-case → exit 1 (case-insensitive)',
    manifest:
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '  <application android:allowBackup="TRUE" />\n' +
      '</manifest>\n',
    expected: 1,
  },
  {
    name: 'manifest absent (pre-cap-add) → exit 0',
    manifest: null,
    expected: 0,
  },
];

let failures = 0;
for (const c of cases) {
  const got = runWithManifest(c.manifest);
  const status = got === c.expected ? 'OK' : 'FAIL';
  if (got !== c.expected) {
    failures += 1;
    process.stderr.write(
      `${status}: ${c.name} — expected exit ${c.expected}, got ${got}\n`,
    );
  } else {
    process.stdout.write(`${status}: ${c.name}\n`);
  }
}

if (failures > 0) {
  process.stderr.write(`\n${failures} test(s) failed.\n`);
  process.exit(1);
}
process.stdout.write(
  `\nOK: precommit-allowbackup-guard self-tests passed (${cases.length}/${cases.length})\n`,
);
process.exit(0);
