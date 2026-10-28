const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const crate = path.join(root, 'wasm', 'force-graph-layout');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const readCrate = (relativePath) => fs.readFileSync(path.join(crate, relativePath), 'utf8');

test('crate distribution ships sources, lock, toolchain pin and licenses', () => {
  for (const required of [
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
    'README.md',
    '.gitignore',
    'src/main.rs',
    'src/bin/force_graph_layout.rs',
    'LICENSES/d3-force.LICENSE',
    'LICENSES/d3-quadtree.LICENSE',
    'LICENSES/THIRD-PARTY.md',
  ]) {
    assert.ok(fs.existsSync(path.join(crate, required)), `missing ${required}`);
  }
});

test('Cargo.lock pins the audited dependency versions', () => {
  const lock = readCrate('Cargo.lock');
  assert.match(lock, /name = "serde"\nversion = "1\.0\.229"/);
  assert.match(lock, /name = "serde_json"\nversion = "1\.0\.154"/);
});

test('toolchain is pinned to the audited compiler and wasm target', () => {
  const toolchain = readCrate('rust-toolchain.toml');
  assert.match(toolchain, /channel = "1\.99\.1"/);
  assert.match(toolchain, /targets = \["wasm32-unknown-unknown"\]/);
});

test('third-party license audit matches the physical license texts', () => {
  for (const license of ['d3-force.LICENSE', 'd3-quadtree.LICENSE']) {
    const text = readCrate(path.join('LICENSES', license));
    assert.match(text, /Copyright 2010-2021 Mike Bostock/);
    assert.match(text, /Permission to use, copy, modify, and\/or distribute this software for any purpose/);
  }
  const audit = readCrate('LICENSES/THIRD-PARTY.md');
  assert.match(audit, /d3-force[\s\S]*ISC/);
  assert.match(audit, /d3-quadtree[\s\S]*ISC/);
  assert.match(audit, /serde \| 1\.0\.229[\s\S]*MIT OR Apache-2\.0/);
  assert.match(audit, /serde_json \| 1\.0\.154[\s\S]*MIT OR Apache-2\.0/);
  const attribution = readCrate('src/bin/force_graph_layout.rs');
  assert.match(attribution, /ISC \(license texts in LICENSES\//);
  assert.doesNotMatch(attribution, /BSD-3-Clause/);
});

test('module keeps the stable graph ABI exports', () => {
  const source = readCrate('src/bin/force_graph_layout.rs');
  for (const symbol of ['pub extern "C" fn graph_alloc', 'pub unsafe extern "C" fn graph_free', 'pub unsafe extern "C" fn graph_layout']) {
    assert.ok(source.includes(symbol), `missing export ${symbol}`);
  }
  assert.match(source, /#\[no_mangle\]/);
});

test('build script compiles locked and offline and versions the asset by hash', () => {
  const script = read('scripts/build-force-graph-wasm.mjs');
  for (const token of ["'--locked'", "'--offline'", 'sha256', 'force-graph-layout-', 'activatedInProduct: false']) {
    assert.ok(script.includes(token), `build script missing ${token}`);
  }
});

test('crate-local gitignore keeps target and dist out of the repository', () => {
  const gitignore = readCrate('.gitignore');
  assert.match(gitignore, /^target\/$/m);
  assert.match(gitignore, /^dist\/$/m);
});

test('product path is not wired to the wasm module (no activation)', () => {
  for (const product of ['src/components/shared/KnowledgeGraph.tsx', 'src/workers/forceGraphClient.ts']) {
    const source = read(product);
    assert.doesNotMatch(source, /force-graph-layout|graph_layout|graph_alloc/, `${product} must not reference the wasm ABI`);
  }
});

test('package.json wires the build and contract-test commands', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['layout-wasm:build'], 'node scripts/build-force-graph-wasm.mjs');
  assert.equal(
    pkg.scripts['test:layout-wasm'],
    'node --test scripts/__tests__/force-graph-wasm-distribution.test.cjs scripts/__tests__/force-graph-wasm-memory-bound.test.cjs',
  );
});
