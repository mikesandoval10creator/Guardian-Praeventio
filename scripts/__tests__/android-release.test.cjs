const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const pinScript = path.join(root, 'scripts/check-cert-pinning-ratchet.cjs');
const { BROWSER_SLM_DIR, findBundleProblems } = require('../check-mobile-bundle.cjs');
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
  // Check the requested SDK packages independently of the action's version.
  const packageMatch = check.match(/uses: android-actions\/setup-android@[^\s]+\s*\n\s+with:\s*\n\s+packages:\s*([^\r\n]+)/);
  assert.ok(packageMatch, 'Android SDK package list must be explicit');
  const sdkPackages = packageMatch[1].trim().split(/\s+/);
  assert.ok(sdkPackages.includes('platform-tools'));
  assert.ok(!sdkPackages.includes('tools'));
});

function withBundleTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praeventio-bundle-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeBundleFile(rootDir, relativePath, bytes) {
  const target = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.alloc(bytes));
}

test('a small clean mobile bundle passes the size guard', () => {
  withBundleTempDir(dir => {
    writeBundleFile(dir, 'index.html', 10);
    writeBundleFile(dir, 'assets/app.js', 20);
    assert.deepEqual(findBundleProblems({ assetsDir: dir, maxAssetsBytes: 100 }), []);
  });
});

test('the browser SLM model fails the mobile bundle guard even under budget', () => {
  withBundleTempDir(dir => {
    writeBundleFile(dir, path.join(BROWSER_SLM_DIR, 'model_q4f16.onnx'), 1);
    const problems = findBundleProblems({ assetsDir: dir, maxAssetsBytes: 1000 });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /browser SLM model must not be bundled/);
  });
});

test('over-budget, empty, and missing mobile bundles fail closed', () => {
  withBundleTempDir(dir => {
    writeBundleFile(dir, 'assets/large.bin', 20);
    assert.match(
      findBundleProblems({ assetsDir: dir, maxAssetsBytes: 10 })[0],
      /over the 10-byte budget/,
    );
    fs.rmSync(path.join(dir, 'assets'), { recursive: true });
    assert.match(findBundleProblems({ assetsDir: dir })[0], /empty/);
  });
  const missing = path.join(os.tmpdir(), `praeventio-missing-${process.pid}`);
  assert.match(findBundleProblems({ assetsDir: missing })[0], /not found/);
});

test('the signed AAB must fit the byte budget', () => {
  withBundleTempDir(dir => {
    const aab = path.join(dir, 'app-release.aab');
    fs.writeFileSync(aab, Buffer.alloc(20));
    assert.deepEqual(findBundleProblems({ aabPath: aab, maxAabBytes: 20 }), []);
    assert.match(
      findBundleProblems({ aabPath: aab, maxAabBytes: 10 })[0],
      /AAB is 20 bytes, over the 10-byte budget/,
    );
  });
  assert.match(findBundleProblems()[0], /no --assets or --aab/);
});

test('release web bundles skip the 483 MB browser SLM model and guard both targets', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/mobile-release.yml'),
    'utf8',
  );
  const androidJob = workflow.slice(
    workflow.indexOf('  android-release:'),
    workflow.indexOf('  android-internal-upload:'),
  );
  const iosJob = workflow.slice(
    workflow.indexOf('  ios-release:'),
    workflow.indexOf('  fastfile-lint:'),
  );

  for (const [name, job] of [
    ['Android', androidJob],
    ['iOS', iosJob],
  ]) {
    assert.match(job, /SLM_PREPACKAGE_SKIP: '1'/, `${name} must skip the browser SLM model`);
    assert.match(
      job,
      /node scripts\/check-mobile-bundle\.cjs --assets dist/,
      `${name} must guard the web bundle`,
    );
  }
  assert.match(
    androidJob,
    /node scripts\/check-mobile-bundle\.cjs --aab android\/app\/build\/outputs\/bundle\/release\/app-release\.aab/,
  );
});

test('the SLM skip documents the mobile store and web deploy split', () => {
  const script = fs.readFileSync(
    path.join(root, 'scripts/prepackage-slm-models.mjs'),
    'utf8',
  );
  assert.match(script, /Mobile store builds also set it/);
  assert.match(script, /200 MB compressed-download limit/);
  assert.match(script, /Web deploys MUST NOT set it/);
  assert.match(script, /runtime acquisition prompt/);
});
