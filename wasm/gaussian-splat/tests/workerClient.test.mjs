import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSplatInWorker } from '../workerClient.ts';

const engine = new globalThis.WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
function setup(send = () => {}) {
  let started = 0;
  let terminated = 0;
  const worker = {
    postMessage(message, transfer) { send(worker, message, transfer); },
    terminate() { terminated++; },
  };
  return { options: { createWorker: () => { started++; return worker; } }, counts: () => [started, terminated] };
}

test('a valid reply preserves the capture and releases the worker', async () => {
  const bytes = new ArrayBuffer(32);
  const { options, counts } = setup((worker, message, transfer) => {
    assert.equal(message.module, engine);
    assert.equal(message.bytes, bytes);
    assert.deepEqual(transfer, [bytes]);
    const owned = globalThis.structuredClone(bytes, { transfer });
    worker.onmessage({ data: { ok: true, count: 1, bytes: owned } });
  });
  const result = await validateSplatInWorker(engine, bytes, options);
  assert.equal(bytes.byteLength, 0);
  assert.deepEqual(result, { ok: true, count: 1, bytes: new ArrayBuffer(32) });
  assert.deepEqual(counts(), [1, 1]);
});

test('aborts in-flight validation and ignores a late reply', async () => {
  const controller = new globalThis.AbortController();
  const { options, counts } = setup((worker) => {
    const late = worker.onmessage;
    controller.abort();
    late({ data: { ok: true, count: 1, bytes: new ArrayBuffer(32) } });
  });
  assert.deepEqual(await validateSplatInWorker(engine, new ArrayBuffer(32), { ...options, signal: controller.signal }), { ok: false, reason: 'cancelled' });
  assert.deepEqual(counts(), [1, 1]);
});

test('rejects pre-aborted and oversized inputs without constructing a worker', async () => {
  const { options, counts } = setup();
  assert.deepEqual(await validateSplatInWorker(engine, new ArrayBuffer(32), { ...options, signal: globalThis.AbortSignal.abort() }), { ok: false, reason: 'cancelled' });
  assert.deepEqual(await validateSplatInWorker(engine, new ArrayBuffer(4 * 1024 * 1024 + 32), options), { ok: false, reason: 'input_limit' });
  assert.deepEqual(counts(), [0, 0]);
});

test('rejects a mismatched reply and terminates an unresponsive worker', async () => {
  const wrong = setup((worker) => worker.onmessage({ data: { ok: true, count: 2, bytes: new ArrayBuffer(32) } }));
  assert.deepEqual(await validateSplatInWorker(engine, new ArrayBuffer(32), wrong.options), { ok: false, reason: 'engine_error' });
  assert.deepEqual(wrong.counts(), [1, 1]);
  const silent = setup();
  assert.deepEqual(await validateSplatInWorker(engine, new ArrayBuffer(32), { ...silent.options, timeoutMs: 5 }), { ok: false, reason: 'timeout' });
  assert.deepEqual(silent.counts(), [1, 1]);
});
