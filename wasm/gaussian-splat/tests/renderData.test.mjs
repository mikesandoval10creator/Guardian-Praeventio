import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { createSplatValidator } from '../bridge.ts';
import { toSplatVertexElement } from '../renderData.ts';

function capture() {
  const bytes = new ArrayBuffer(64);
  const view = new DataView(bytes);
  for (const [index, value] of [2, -3, 7, 0.25, 2, 1, -1, 4, 0, 1, 1, 1].entries()) {
    view.setFloat32(Math.floor(index / 6) * 32 + (index % 6) * 4, value, true);
  }
  new Uint8Array(bytes).set([255, 0, 128, 0, 255, 128, 128, 128], 24);
  new Uint8Array(bytes).set([0, 255, 0, 255, 128, 255, 128, 128], 56);
  return bytes;
}

test('converts a real WASM-validated capture into PlayCanvas vertex columns', async () => {
  const module = await globalThis.WebAssembly.compile(readFileSync(new URL('../target/wasm32-unknown-unknown/release/guardian_gaussian_splat.wasm', import.meta.url)));
  const validate = await createSplatValidator(module);
  const bytes = capture();
  const result = validate(new Uint8Array(bytes));
  assert.deepEqual(result, { ok: true, count: 2 });
  const element = toSplatVertexElement(bytes, result.count);
  assert.equal(element.name, 'vertex');
  assert.equal(element.count, 2);
  const columns = Object.fromEntries(element.properties.map(({ name, storage }) => [name, [...storage]]));
  assert.deepEqual(columns.x, [2, -1]);
  assert.deepEqual(columns.y, [-3, 4]);
  assert.deepEqual(columns.z, [7, 0]);
  assert.ok(Math.abs(Math.exp(columns.scale_0[0]) - 0.25) < 1e-7);
  assert.deepEqual(columns.rot_0, [1, 0]);
  assert.deepEqual(columns.rot_1, [0, 1]);
  assert.deepEqual(columns.opacity_linear, [0, 1]);
  assert.ok(Math.abs(0.5 + columns.f_dc_0[0] * 0.28209479177387814 - 1) < 1e-7);
});

test('rejects inconsistent record counts and non-renderable numeric values', () => {
  assert.throws(() => toSplatVertexElement(capture(), 1), RangeError);
  assert.throws(() => toSplatVertexElement(new ArrayBuffer(0), 0), RangeError);
  const bytes = capture();
  new DataView(bytes).setFloat32(12, 3e38, true);
  assert.throws(() => toSplatVertexElement(bytes, 2), RangeError);
});
