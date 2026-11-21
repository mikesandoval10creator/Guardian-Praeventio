const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const artifact = join(__dirname, '../target/wasm32-unknown-unknown/release/guardian_gaussian_splat.wasm');

test('TypeScript calls real Rust/WASM, including reuse after invalid input', async () => {
  const { createSplatValidator } = await import('../bridge.ts');
  const validate = await createSplatValidator(await WebAssembly.compile(readFileSync(artifact)));
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);
  for (const offset of [12, 16, 20]) view.setFloat32(offset, 0.25, true);
  data.set([255, 128, 128, 128], 28);
  assert.deepEqual(validate(data), { ok: true, count: 1 });
  view.setFloat32(0, NaN, true);
  assert.deepEqual(validate(data), { ok: false, reason: 'invalid_geometry' });
  view.setFloat32(0, 1, true);
  assert.deepEqual(validate(new Uint8Array(0)), { ok: false, reason: 'invalid_length' });
  assert.deepEqual(validate(new Uint8Array(4 * 1024 * 1024 + 1)), { ok: false, reason: 'input_limit' });
  assert.deepEqual(validate(data), { ok: true, count: 1 });
});
