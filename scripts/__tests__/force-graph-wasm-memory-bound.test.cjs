const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const crate = path.join(root, 'wasm', 'force-graph-layout');
const readCrate = (relativePath) => fs.readFileSync(path.join(crate, relativePath), 'utf8');

test('module memory ceiling is pinned at the linker level', () => {
  const config = readCrate(path.join('.cargo', 'config.toml'));
  assert.match(config, /--max-memory=33554432/);
});

test('graph_alloc rejects over-cap requests instead of allocating', () => {
  const source = readCrate('src/bin/force_graph_layout.rs');
  assert.match(source, /MAX_INPUT_BYTES: usize = 8 \* 1024 \* 1024/);
  const alloc = source.slice(source.indexOf('pub extern "C" fn graph_alloc'));
  assert.match(alloc, /len > MAX_INPUT_BYTES/);
  assert.match(alloc, /null_mut\(\)/);
});

test('README documents the hard bound and its failure semantics', () => {
  const readme = readCrate('README.md');
  assert.match(readme, /33554432|32 MiB/);
  assert.match(readme, /8 MiB/);
  assert.match(readme, /memory\.grow|trampa|trap/);
});

test('behavioral memory bound: VM ceiling and graceful input cap (skips without built module)', async (t) => {
  const wasmPath = path.join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'force_graph_layout.wasm');
  if (!fs.existsSync(wasmPath)) {
    t.skip('built module absent (CI has no Rust toolchain); covered by local evidence run');
    return;
  }
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
  const k = instance.exports;

  const pagesBefore = k.memory.buffer.byteLength / 65536;
  assert.throws(() => k.memory.grow(8192), RangeError, 'memory.grow beyond 32 MiB must fail (VM-enforced maximum)');
  assert.equal(k.memory.buffer.byteLength / 65536, pagesBefore);

  const oversize = k.graph_alloc(9 * 1024 * 1024);
  assert.equal(Number(oversize), 0, 'graph_alloc must return null above the 8 MiB input cap');

  const ptr = k.graph_alloc(64);
  assert.ok(Number(ptr) !== 0, 'graph_alloc must still serve in-cap requests');
  k.graph_free(ptr, 64);
});
