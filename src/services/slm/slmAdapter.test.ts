/**
 * Tests for the SLM main-thread facade — B14 unified runtime.
 *
 * The facade now delegates to the REAL runtime worker (workerRuntime →
 * SlmRuntimeWorkerProxy → slmRuntime). These tests pin:
 *
 *   1. cold start          — ensureSlmReady resolves the Qwen default
 *                            and loads it through the runtime
 *   2. warm reuse          — ensureSlmReady fast-paths for same id
 *   3. complete delegation — complete() forwards to runtime inference
 *                            and maps the response shape
 *   4. honest failure      — runtime errors REJECT (no mock fallback)
 *   5. dispose lifecycle   — disposeSlm releases + clears state
 *   6. unknown model       — throws
 *
 * The runtime is injected via `__setRuntimeFactoryForTests` so no real
 * Worker / ORT session is constructed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetSlmAdapterForTests,
  __setRuntimeFactoryForTests,
  complete,
  disposeSlm,
  ensureSlmReady,
  getActiveModelId,
} from './slmAdapter';
import { DEFAULT_MODEL_ID } from './registry';
import type {
  WorkerBackedSlmRuntime,
  WorkerRuntimeModel,
} from './workerRuntime';

function makeRuntimeStub(overrides: Partial<WorkerBackedSlmRuntime> = {}) {
  const calls = {
    loadModel: 0,
    infer: 0,
    release: 0,
    lastModelId: null as string | null,
    lastPrompt: null as string | null,
  };
  const loadedModel = (id: string): WorkerRuntimeModel => ({
    modelId: id,
    modelHandle: `${id}::handle`,
    observedSha256: 'deadbeef',
    backend: 'wasm-simd',
  });
  const runtime: WorkerBackedSlmRuntime = {
    loadModel: vi.fn(async (id: string) => {
      calls.loadModel += 1;
      calls.lastModelId = id;
      return loadedModel(id);
    }),
    infer: vi.fn(async () => 'texto real'),
    inferStream: vi.fn(async () => 'texto real'),
    inferDetailed: vi.fn(async (_m, prompt: string) => {
      calls.infer += 1;
      calls.lastPrompt = prompt;
      return { text: 'respuesta real del SLM', tokensGenerated: 5, latencyMs: 42 };
    }),
    release: vi.fn(async () => {
      calls.release += 1;
    }),
    ...overrides,
  };
  return { runtime, calls };
}

beforeEach(() => {
  __resetSlmAdapterForTests();
});

afterEach(() => {
  __setRuntimeFactoryForTests(null);
  __resetSlmAdapterForTests();
});

describe('SLM adapter (slmAdapter.ts) — unified real runtime (B14)', () => {
  it('ensureSlmReady loads the registry default (Qwen pre-packaged) through the runtime', async () => {
    const { runtime, calls } = makeRuntimeStub();
    __setRuntimeFactoryForTests(() => runtime);

    const result = await ensureSlmReady();

    expect(result.modelId).toBe(DEFAULT_MODEL_ID);
    expect(result.modelId).toBe('qwen-2.5-0.5b');
    expect(calls.loadModel).toBe(1);
    expect(calls.lastModelId).toBe('qwen-2.5-0.5b');
    expect(getActiveModelId()).toBe('qwen-2.5-0.5b');
  });

  it('ensureSlmReady reuses the loaded model on a second call with the same modelId', async () => {
    const { runtime, calls } = makeRuntimeStub();
    __setRuntimeFactoryForTests(() => runtime);

    await ensureSlmReady();
    await ensureSlmReady({ modelId: DEFAULT_MODEL_ID });

    expect(calls.loadModel).toBe(1);
    expect(getActiveModelId()).toBe(DEFAULT_MODEL_ID);
  });

  it('switching models releases the previous handle before loading the new one', async () => {
    const { runtime, calls } = makeRuntimeStub();
    __setRuntimeFactoryForTests(() => runtime);

    await ensureSlmReady();
    await ensureSlmReady({ modelId: 'phi-3-mini' });

    expect(calls.release).toBe(1);
    expect(calls.loadModel).toBe(2);
    expect(getActiveModelId()).toBe('phi-3-mini');
  });

  it('complete delegates to the real runtime and maps the SLMResponse shape', async () => {
    const { runtime, calls } = makeRuntimeStub();
    __setRuntimeFactoryForTests(() => runtime);

    const out = await complete({ prompt: 'hola guardián' });

    expect(out).toEqual({
      text: 'respuesta real del SLM',
      latencyMs: 42,
      tokensGenerated: 5,
      backend: 'wasm-simd',
    });
    expect(calls.infer).toBe(1);
    expect(calls.lastPrompt).toBe('hola guardián');
  });

  it('complete REJECTS when inference fails — no mock fallback (anti-stub #13)', async () => {
    const { runtime } = makeRuntimeStub({
      inferDetailed: vi.fn(async () => {
        throw new Error('[infer_failure] tokenizer unavailable');
      }),
    });
    __setRuntimeFactoryForTests(() => runtime);

    await expect(complete({ prompt: 'x' })).rejects.toThrow(/infer_failure/);
  });

  it('complete REJECTS when the model load fails (e.g. integrity mismatch)', async () => {
    const { runtime } = makeRuntimeStub({
      loadModel: vi.fn(async () => {
        throw new Error('[integrity_failure] SHA-256 mismatch');
      }),
    });
    __setRuntimeFactoryForTests(() => runtime);

    await expect(complete({ prompt: 'x' })).rejects.toThrow(
      /integrity_failure/,
    );
  });

  it('disposeSlm releases the model and clears active model id (idempotent)', async () => {
    const { runtime, calls } = makeRuntimeStub();
    __setRuntimeFactoryForTests(() => runtime);

    await ensureSlmReady();
    expect(getActiveModelId()).toBe(DEFAULT_MODEL_ID);

    await disposeSlm();
    expect(calls.release).toBe(1);
    expect(getActiveModelId()).toBeNull();

    await disposeSlm();
    expect(calls.release).toBe(1);
  });

  it('ensureSlmReady throws on an unknown model id', async () => {
    const { runtime } = makeRuntimeStub();
    __setRuntimeFactoryForTests(() => runtime);

    await expect(
      ensureSlmReady({ modelId: 'does-not-exist' }),
    ).rejects.toThrow(/Unknown SLM model/);
  });
});
