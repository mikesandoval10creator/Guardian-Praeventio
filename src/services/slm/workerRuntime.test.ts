/**
 * B14 — worker-backed runtime client. Pins:
 *   1. loadModel delegates to the proxy and maps the handle shape.
 *   2. infer/inferStream/inferDetailed delegate with streaming hooks.
 *   3. release forwards the handle.
 *   4. Failures REJECT (no fabricated text — anti-stub #13).
 */

import { describe, expect, it, vi } from 'vitest';

import { createWorkerBackedSlmRuntime } from './workerRuntime';
import type { SlmRuntimeWorkerProxy } from './worker/slmRuntimeWorkerProxy';

function makeProxyStub() {
  const proxy = {
    loadModel: vi.fn(async (modelId: string) => ({
      modelHandle: `${modelId}::h1`,
      modelId,
      observedSha256: 'f'.repeat(64),
      backend: 'webgpu' as const,
    })),
    infer: vi.fn(
      async (
        _handle: string,
        _prompt: string,
        opts: { onToken?: (e: { token: string; cumulativeText: string; tokenCount: number }) => void } = {},
      ) => {
        opts.onToken?.({ token: 'ho', cumulativeText: 'ho', tokenCount: 1 });
        opts.onToken?.({ token: 'la', cumulativeText: 'hola', tokenCount: 2 });
        return { text: 'hola', tokensGenerated: 2, latencyMs: 7 };
      },
    ),
    release: vi.fn(async () => undefined),
    abort: vi.fn(),
    terminate: vi.fn(),
  };
  return proxy as unknown as SlmRuntimeWorkerProxy & typeof proxy;
}

describe('createWorkerBackedSlmRuntime (B14)', () => {
  it('loadModel delegates to the proxy and returns the mapped handle', async () => {
    const proxy = makeProxyStub();
    const runtime = createWorkerBackedSlmRuntime(() => proxy);

    const model = await runtime.loadModel('qwen-2.5-0.5b');

    expect(proxy.loadModel).toHaveBeenCalledWith(
      'qwen-2.5-0.5b',
      expect.any(Object),
    );
    expect(model).toEqual({
      modelId: 'qwen-2.5-0.5b',
      modelHandle: 'qwen-2.5-0.5b::h1',
      observedSha256: 'f'.repeat(64),
      backend: 'webgpu',
    });
  });

  it('infer returns the real text from the worker', async () => {
    const proxy = makeProxyStub();
    const runtime = createWorkerBackedSlmRuntime(() => proxy);
    const model = await runtime.loadModel('qwen-2.5-0.5b');

    const text = await runtime.infer(model, '¿qué hago ante un sismo?');

    expect(text).toBe('hola');
    expect(proxy.infer).toHaveBeenCalledWith(
      'qwen-2.5-0.5b::h1',
      '¿qué hago ante un sismo?',
      expect.any(Object),
    );
  });

  it('inferStream forwards per-token callbacks', async () => {
    const proxy = makeProxyStub();
    const runtime = createWorkerBackedSlmRuntime(() => proxy);
    const model = await runtime.loadModel('qwen-2.5-0.5b');

    const tokens: string[] = [];
    const text = await runtime.inferStream(model, 'hola', {
      onToken: (t) => tokens.push(t),
    });

    expect(text).toBe('hola');
    expect(tokens).toEqual(['ho', 'la']);
  });

  it('release forwards the model handle', async () => {
    const proxy = makeProxyStub();
    const runtime = createWorkerBackedSlmRuntime(() => proxy);
    const model = await runtime.loadModel('qwen-2.5-0.5b');

    await runtime.release(model);
    expect(proxy.release).toHaveBeenCalledWith('qwen-2.5-0.5b::h1');
  });

  it('proxy failures REJECT — nothing fabricates a response', async () => {
    const proxy = makeProxyStub();
    proxy.infer.mockRejectedValueOnce(
      new Error('[infer_failure] tokenizer unavailable'),
    );
    const runtime = createWorkerBackedSlmRuntime(() => proxy);
    const model = await runtime.loadModel('qwen-2.5-0.5b');

    await expect(runtime.infer(model, 'x')).rejects.toThrow(/infer_failure/);
  });
});
