'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const minimum = '24.22.1';

test('package installs reject vulnerable and unsupported Node release lines', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines?.node, '^24.22.1 || ^26.12.1');
  assert.deepEqual(JSON.parse(read('package-lock.json')).packages[''].engines, pkg.engines);
  assert.match(read('.npmrc'), /^engine-strict=true$/m);
});

test('all Node container stages use the patched release, including load tests', () => {
  for (const file of ['Dockerfile', 'Dockerfile.api', 'Dockerfile.frontend', 'loadtest/Dockerfile']) {
    const images = [...read(file).matchAll(/^FROM\s+node:([^\s]+)/gm)].map((match) => match[1]);
    assert.ok(images.length > 0, file);
    for (const image of images) {
      assert.ok(image.startsWith(`${minimum}-`), `${file}: unpatched or floating Node image ${image}`);
    }
  }
});

test('every setup-node job selects an exact patched runtime', () => {
  let jobs = 0;
  for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
    if (!/\.ya?ml$/.test(file)) continue;
    const workflow = read(`.github/workflows/${file}`);
    // Support both block and inline YAML `with` mappings.
    const selected = [...workflow.matchAll(/node-version:\s*['"]?([^'",}\s]+)/g)];
    assert.equal(selected.length, (workflow.match(/uses:\s*actions\/setup-node@/g) || []).length, file);
    for (const version of selected) {
      assert.equal(version[1], minimum, `${file}: setup-node must not reuse a vulnerable cached patch`);
      jobs += 1;
    }
  }
  assert.ok(jobs > 0);
  assert.match(read('.github/workflows/deploy.yml'), /uses:\s*actions\/setup-node@/);
});

test('Cloud Build defaults to the patched Node line and refreshes base images', () => {
  const config = read('cloudbuild.yaml');
  assert.match(config, /_NODE_TAG:\s*"24\.22\.1-alpine"/);
  assert.equal((config.match(/- "--pull"/g) || []).length, 2);
  assert.match(read('.github/workflows/deploy.yml'), /docker build --pull/);
});

test('runtime policy regression checks execute in CI', () => {
  assert.match(read('.github/workflows/ci.yml'), /node --test scripts\/node-runtime-security\.test\.cjs/);
});

test('executing Node is patched and Brotli round-trips and rejects invalid input', () => {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const floor = { 24: [22, 1], 26: [12, 1] }[major];
  assert.ok(floor && (minor > floor[0] || (minor === floor[0] && patch >= floor[1])), process.version);
  const { brotliCompressSync, brotliDecompressSync } = require('node:zlib');
  const payload = Buffer.from('Guardian — reporte de incidente sintético. '.repeat(128));
  assert.deepEqual(brotliDecompressSync(brotliCompressSync(payload)), payload);
  assert.throws(() => brotliDecompressSync(Buffer.from([0xff])));
});
