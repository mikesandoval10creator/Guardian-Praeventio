import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { Worker } from 'node:worker_threads';

const module = await globalThis.WebAssembly.compile(readFileSync(new URL('../target/wasm32-unknown-unknown/release/guardian_gaussian_splat.wasm', import.meta.url)));
const workerUrl = new URL('./workerThreadFixture.mjs', import.meta.url);

function sample() {
  const bytes = new ArrayBuffer(32);
  const view = new DataView(bytes);
  for (const offset of [12, 16, 20]) view.setFloat32(offset, 0.25, true);
  new Uint8Array(bytes).set([255, 128, 128, 128], 28);
  return bytes;
}

async function validate(t, bytes) {
  const worker = new Worker(workerUrl);
  t.after(() => worker.terminate());
  const reply = new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`Worker exited: ${code}`)));
    worker.postMessage({ module, bytes }, [bytes]);
  });
  assert.equal(bytes.byteLength, 0, 'capture ownership was transferred');
  return reply;
}

test('worker validates and returns the transferable capture intact', { timeout: 5000 }, async (t) => {
  const expected = sample();
  const reply = await validate(t, expected.slice(0));
  assert.deepEqual(reply, { ok: true, count: 1, bytes: expected });
});

test('worker does not return rejected capture bytes', { timeout: 5000 }, async (t) => {
  const bytes = sample();
  new DataView(bytes).setFloat32(0, NaN, true);
  assert.deepEqual(await validate(t, bytes), { ok: false, reason: 'invalid_geometry' });
});
