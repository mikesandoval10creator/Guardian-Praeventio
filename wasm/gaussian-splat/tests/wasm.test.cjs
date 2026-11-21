const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const wasm = join(__dirname, '../target/wasm32-unknown-unknown/release/guardian_gaussian_splat.wasm');
const MAX = 4 * 1024 * 1024;
async function engine() {
  const module = await WebAssembly.compile(readFileSync(wasm));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  return (await WebAssembly.instantiate(module)).exports;
}
function record(x = 1, scale = 0.25, rotation = 255) {
  const bytes = Buffer.alloc(32);
  bytes.writeFloatLE(x, 0);
  for (const i of [12, 16, 20]) bytes.writeFloatLE(scale, i);
  bytes.set([255, 64, 32, 255, rotation, 128, 128, 128], 24);
  return bytes;
}
function validate(e, data) {
  const ptr = e.reserve(data.length);
  assert.notEqual(ptr, 0);
  new Uint8Array(e.memory.buffer, ptr, data.length).set(data);
  return e.validate();
}

test('counts two complete Gaussian records and validates the final record', async () => {
  const e = await engine();
  assert.equal(validate(e, Buffer.concat([record(), record(-3)])), 2);
  assert.equal(validate(e, Buffer.concat([record(), record(NaN)])), -2);
});

test('rejects empty, fragmented and invalid numeric fields', async () => {
  const e = await engine();
  assert.equal(e.validate(), -1);
  assert.equal(validate(e, record().subarray(0, 31)), -1);
  for (const invalid of [record(Infinity), record(0, 0), record(0, -1), record(0, Infinity), record(0, 1, 128)]) {
    assert.equal(validate(e, invalid), -2);
  }
});

test('enforces input cap before growing memory and clears the old input on rejection', async () => {
  const e = await engine();
  assert.notEqual(e.reserve(MAX), 0);
  const size = e.memory.buffer.byteLength;
  assert.equal(e.reserve(MAX + 1), 0);
  assert.equal(e.memory.buffer.byteLength, size);
  assert.equal(e.validate(), -1);
  assert.equal(e.reserve(-1), 0);
});

test('VM enforces the hard memory ceiling at 16 MiB', async () => {
  const e = await engine();
  e.memory.grow(256 - e.memory.buffer.byteLength / 65536);
  assert.equal(e.memory.buffer.byteLength, 16 * 1024 * 1024);
  assert.throws(() => e.memory.grow(1), RangeError);
});
