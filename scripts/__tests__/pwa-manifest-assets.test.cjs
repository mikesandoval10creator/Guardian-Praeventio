'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'public/manifest.json'), 'utf8'));
}

test('PWA manifest references only assets shipped in public/', () => {
  const manifest = readManifest();
  const localAssets = manifest.icons
    .map((icon) => icon.src)
    .filter((src) => src.startsWith('/'));

  assert.ok(localAssets.length > 0, 'manifest must declare at least one local icon');

  for (const asset of localAssets) {
    const assetPath = path.join(repoRoot, 'public', asset.slice(1));
    assert.equal(fs.existsSync(assetPath), true, `missing PWA asset: ${asset}`);
  }
});
