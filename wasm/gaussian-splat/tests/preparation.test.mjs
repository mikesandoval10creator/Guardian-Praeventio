import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { prepareSplatForRendering } from '../preparation.ts';

const engine = await globalThis.WebAssembly.compile(readFileSync(new URL('../target/wasm32-unknown-unknown/release/guardian_gaussian_splat.wasm', import.meta.url)));

function setup(t, afterReply = () => {}) {
  const bytes = new ArrayBuffer(32);
  const view = new DataView(bytes);
  view.setFloat32(0, 2.5, true);
  for (const offset of [12, 16, 20]) view.setFloat32(offset, 0.25, true);
  new Uint8Array(bytes).set([255, 128, 128, 128], 28);
  return { bytes, view, createWorker() {
    const thread = new Worker(new URL('./workerThreadFixture.mjs', import.meta.url));
    t.after(() => thread.terminate());
    const adapter = {
      postMessage: (message, transfer) => thread.postMessage(message, transfer),
      terminate: () => { void thread.terminate(); },
    };
    thread.on('message', (data) => {
      adapter.onmessage?.({ data });
      afterReply(data);
    });
    thread.on('messageerror', (error) => adapter.onmessageerror?.(error));
    thread.on('error', (error) => adapter.onerror?.(error));
    return adapter;
  } };
}

test('transfers a capture through the real WASM worker and returns only render columns', async (t) => {
  const { bytes, createWorker } = setup(t);
  const result = await prepareSplatForRendering(engine, bytes, { createWorker });
  assert.equal(bytes.byteLength, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['element', 'ok']);
  assert.equal(result.element.count, 1);
  assert.equal(result.element.properties.find(({ name }) => name === 'x').storage[0], 2.5);
});

test('keeps WASM rejection distinct from render-envelope rejection', async (t) => {
  const invalid = setup(t);
  invalid.view.setFloat32(0, NaN, true);
  assert.deepEqual(await prepareSplatForRendering(engine, invalid.bytes, invalid), { ok: false, reason: 'invalid_geometry' });
  const outOfRange = setup(t);
  outOfRange.view.setFloat32(0, 2_000_000, true);
  assert.deepEqual(await prepareSplatForRendering(engine, outOfRange.bytes, outOfRange), { ok: false, reason: 'outside_render_envelope' });
});

for (const valid of [true, false]) {
  test(`honors cancellation before consuming a ${valid ? 'valid' : 'rejected'} worker reply`, async (t) => {
    const controller = new globalThis.AbortController();
    let workerResult;
    const { bytes, view, createWorker } = setup(t, (reply) => {
      workerResult = reply;
      controller.abort();
    });
    if (!valid) view.setFloat32(0, NaN, true);

    const result = await prepareSplatForRendering(engine, bytes, { createWorker, signal: controller.signal });

    assert.equal(workerResult?.ok, valid);
    assert.equal(bytes.byteLength, 0);
    assert.deepEqual(result, { ok: false, reason: 'cancelled' });
  });
}

test('honors cancellation without constructing a worker', async () => {
  const bytes = new ArrayBuffer(32);
  const result = await prepareSplatForRendering(engine, bytes, {
    signal: globalThis.AbortSignal.abort(),
    createWorker: () => assert.fail('worker must not start'),
  });
  assert.deepEqual(result, { ok: false, reason: 'cancelled' });
  assert.equal(bytes.byteLength, 32);
});
