const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const pinScript = path.join(root, 'scripts/check-cert-pinning-ratchet.cjs');
const leaf = Buffer.alloc(32, 7).toString('base64');
const backup = Buffer.alloc(32, 9).toString('base64');
const xml = (pins) => `<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="false"><domain>app.praeventio.net</domain><pin-set>${pins.map(p => `<pin digest="SHA-256">${p}</pin>`).join('')}</pin-set></domain-config></network-security-config>`;

function pinRun(pins) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-pins-'));
  const file = path.join(dir, 'pins.xml');
  fs.writeFileSync(file, xml(pins));
  try { return spawnSync(process.execPath, [pinScript, '--config', file], { encoding: 'utf8' }); }
  finally { fs.rmSync(dir, { recursive: true }); }
}
test('padded and unpadded SHA-256 Base64 digests both pass', () => {
  assert.equal(pinRun([leaf, backup.replace(/=$/, '')]).status, 0);
});
test('malformed, short, noncanonical, duplicated and placeholder pins fail', () => {
  for (const pins of [[leaf, 'x'], [leaf, Buffer.alloc(31).toString('base64')], [leaf, `${backup.slice(0, -2)}B=`], [leaf, leaf.replace(/=$/, '')], [leaf, 'PIN_SHA256_BACKUP_REPLACE_AT_PROD_DEPLOY']]) {
    assert.equal(pinRun(pins).status, 1);
  }
});
test('release guard fails missing native Firebase and signing without exposing credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/check-android-release.cjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, KEYSTORE_PATH: '', ANDROID_KEYSTORE_PASSWORD: 'do-not-print-this', KEY_ALIAS: '', KEY_PASSWORD: '' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Firebase/);
  assert.match(result.stderr, /signing/);
  assert.doesNotMatch(result.stderr, /do-not-print-this/);
});
test('every local Release Gradle task is guarded before execution', () => {
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  assert.match(gradle, /taskGraph\.whenReady/);
  assert.match(gradle, /check-android-release\.cjs/);
  assert.match(gradle, /release/i);
});
test('mobile check compiles native changes and production distribution awaits protected manual approval', () => {
  const check = fs.readFileSync(path.join(root, '.github/workflows/mobile-build-check.yml'), 'utf8');
  assert.match(check, /'android\/\*\*'/);
  assert.match(check, /'packages\/\*\*'/);
  assert.match(check, /assembleDebug/);
  const release = fs.readFileSync(path.join(root, '.github/workflows/mobile-release.yml'), 'utf8');
  assert.match(release, /environment: android-production/);
  assert.match(release, /needs: \[android-release/);
  assert.doesNotMatch(release, /LANE="production"/);
  const fastfile = fs.readFileSync(path.join(root, 'fastlane/Fastfile'), 'utf8');
  assert.match(fastfile, /project_dir:/);
  assert.match(fastfile, /print_command: false/);
});
