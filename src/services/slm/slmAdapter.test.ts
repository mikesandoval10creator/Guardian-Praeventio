/**
 * Tests for the SLM main-thread facade (Fase 1 T-1.4).
 *
 * The four scenarios mirror the four code paths in `slmAdapter.ts`:
 *
 *   1. cold start                — ensureSlmReady loads + initializes
 *   2. warm reuse                — ensureSlmReady fast-paths for same id
 *   3. complete delegation       — complete forwards to worker.generate
 *   4. dispose lifecycle         — disposeSlm tears the worker down
 *
 * The worker proxy is mocked via `vi.mock('./workerProxy')` so the suite
 * never instantiates a real `Worker` (jsdom + `new URL(..., import.meta.url)`
 * is fragile under Vitest's node default environment).
 *
 * The loader path itself is exercised end-to-end in `loader.test.ts`; here
 * we mock `loadModel` so the adapter test isn't coupled to fetch / IDB.
 */

import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetCacheForTests } from './cache/modelCache';
import {
  __resetSlmAdapterForTests,
  __setWorkerFactoryForTests,
  complete,
  disposeSlm,
  ensureSlmReady,
  getActiveModelId,
} from './slmAdapter';
import type { ModelDescriptor, SLMQuery, SLMResponse } from './types';

// The loader path (fetch → IndexedDB cache → SHA-256 integrity gate) is
// exercised end-to-end in `loader.test.ts`. Here we stub `loadModel` so this
// adapter lifecycle test is decoupled from fetch/IDB/integrity and asserts
// ONLY the worker orchestration (load → init → reuse → dispose). Without the
// stub the real loader enforces the registry's pinned `expectedSha256`, which
// no synthetic in-memory byte buffer can satisfy.
vi.mock('./loader', () => ({
  loadModel: vi.fn(async () => new ArrayBuffer(8)),
}));

/**
 * In-memory worker stub. Records calls so the test can assert delegation
 * without a real Comlink proxy.
 */
function makeWorkerStub() {
  const calls = {
    init: 0,
    generate: 0,
    terminate: 0,
    lastQuery: null as SLMQuery | null,
    lastModel: null as ModelDescriptor | null,
  };
  const fixedResponse: SLMResponse = {
    text: '[stub-response]',
    latencyMs: 12,
    tokensGenerated: 4,
    backend: 'wasm-simd',
  };
  const proxy = {
    init: vi.fn(async (model: ModelDescriptor, _bytes: ArrayBuffer) => {
      calls.init += 1;
      calls.lastModel = model;
    }),
    generate: vi.fn(async (q: SLMQuery) => {
      calls.generate += 1;
      calls.lastQuery = q;
      return fixedResponse;
    }),
    dispose: vi.fn(async () => {
      // no-op for the stub
    }),
    terminate: vi.fn(async () => {
      calls.terminate += 1;
    }),
  };
  return { proxy, calls, fixedResponse };
}

beforeEach(async () => {
  // Fresh fake-indexeddb so the loader's cache lookups don't leak between cases.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  __resetCacheForTests();
  __resetSlmAdapterForTests();
});

afterEach(async () => {
  // Clean state after each case so subsequent suites don't see a stale worker.
  __setWorkerFactoryForTests(null);
  __resetSlmAdapterForTests();
  __resetCacheForTests();
});

describe('SLM adapter (slmAdapter.ts)', () => {
  it('ensureSlmReady loads default model and initializes the worker', async () => {
    const { proxy, calls } = makeWorkerStub();
    __setWorkerFactoryForTests(() => proxy as never);

    const result = await ensureSlmReady();

    expect(result.modelId).toBe('phi-3-mini');
    expect(calls.init).toBe(1);
    expect(calls.lastModel?.id).toBe('phi-3-mini');
    expect(getActiveModelId()).toBe('phi-3-mini');
  });

  it('ensureSlmReady reuses the worker on a second call with the same modelId', async () => {
    const { proxy, calls } = makeWorkerStub();
    __setWorkerFactoryForTests(() => proxy as never);

    await ensureSlmReady();
    await ensureSlmReady({ modelId: 'phi-3-mini' });

    // Second call must NOT re-init.
    expect(calls.init).toBe(1);
    expect(getActiveModelId()).toBe('phi-3-mini');
  });

  it('complete delegates to worker.generate and returns its response', async () => {
    const { proxy, calls, fixedResponse } = makeWorkerStub();
    __setWorkerFactoryForTests(() => proxy as never);

    const out = await complete({ prompt: 'hello world' });

    expect(out).toEqual(fixedResponse);
    expect(calls.generate).toBe(1);
    expect(calls.lastQuery?.prompt).toBe('hello world');
  });

  it('disposeSlm terminates the worker and clears active model id', async () => {
    const { proxy, calls } = makeWorkerStub();
    __setWorkerFactoryForTests(() => proxy as never);

    await ensureSlmReady();
    expect(getActiveModelId()).toBe('phi-3-mini');

    await disposeSlm();

    expect(calls.terminate).toBe(1);
    expect(getActiveModelId()).toBeNull();

    // A second dispose should be a no-op (idempotent).
    await disposeSlm();
    expect(calls.terminate).toBe(1);
  });

  it('ensureSlmReady throws on an unknown model id', async () => {
    const { proxy } = makeWorkerStub();
    __setWorkerFactoryForTests(() => proxy as never);

    await expect(
      ensureSlmReady({ modelId: 'does-not-exist' }),
    ).rejects.toThrow(/Unknown SLM model/);
  });
});
