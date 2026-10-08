const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const pinScript = path.join(root, 'scripts/check-cert-pinning-ratchet.cjs');
test('release user CA rejection accepts XML attribute whitespace', () => {
  const { findPinProblems } = require('../check-cert-pinning-ratchet.cjs');
  const pins = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)].map(buffer =>
    `<pin digest="SHA-256">${buffer.toString('base64')}</pin>`).join('');
  const xml = `<network-security-config><domain-config><domain>app.praeventio.net</domain><pin-set>${pins}</pin-set><trust-anchors><certificates src = "user" /></trust-anchors></domain-config></network-security-config>`;
  assert.ok(findPinProblems(xml).some(problem => problem.includes('user CAs')));
});
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
test('unterminated XML comments cannot hide a fake release pin-set', () => {
  const { findPinProblems } = require('../check-cert-pinning-ratchet.cjs');
  const hiddenPins = [leaf, backup]
    .map(pin => `<pin digest="SHA-256">${pin}</pin>`)
    .join('');
  const malformed = `<network-security-config><!-- <domain-config><domain>app.praeventio.net</domain><pin-set>${hiddenPins}</pin-set></domain-config></network-security-config>`;
  assert.ok(findPinProblems(malformed).some(problem => /comment/i.test(problem)));
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
test('Android SDK setup does not request the removed tools package', () => {
  const check = fs.readFileSync(path.join(root, '.github/workflows/mobile-build-check.yml'), 'utf8');
  assert.match(check, /uses: android-actions\/setup-android@v3\s*\n\s+with:\s*\n\s+packages:\s*platform-tools/);
  const packageMatch = check.match(/^\s*packages:\s*(.+)$/m);
  assert.ok(packageMatch, 'Android SDK package list must be explicit');
  const sdkPackages = packageMatch[1].trim().split(/\s+/);
  assert.ok(sdkPackages.includes('platform-tools'));
  assert.ok(!sdkPackages.includes('tools'));
});
