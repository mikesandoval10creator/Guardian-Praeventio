// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// Sprint 50 E.13 P1 H9 — SLM capacity preflight tests.
// Ticket 39aaa66d-73fe-810a-a721-da22bb77e808.
//
// The preflight gates model loading before the device can OOM. We
// exercise the three branches:
//   • Storage quota (sufficient / insufficient / API unavailable)
//   • Device memory (sufficient / insufficient / API unavailable)
//   • WASM latency (fast / slow / unavailable)
// Plus the combinations that yield each `recommendation`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetPreflightCacheForTests,
  runSlmPreflight,
  type SlmPreflightResult,
} from './slmPreflight';

// The Qwen descriptor in registry.ts is 483_003_582 bytes. 2x = ~966 MB.
// That constant is intentionally not duplicated here — if the registry
// changes, this test file would silently drift. The preflight reads
// from registry at runtime.

type NavigatorWithStorage = Navigator & {
  storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> };
  deviceMemory?: number;
};

function setNavigator(overrides: {
  freeStorageBytes?: number | null;
  deviceMemoryGb?: number | null;
  wasm?: boolean;
}): void {
  const nav = globalThis.navigator as NavigatorWithStorage;
  // Storage estimate.
  if (overrides.freeStorageBytes === null) {
    (nav as { storage?: unknown }).storage = undefined;
  } else if (typeof overrides.freeStorageBytes === 'number') {
    const free = overrides.freeStorageBytes;
    (nav as { storage?: unknown }).storage = {
      estimate: async () => ({
        quota: free + 100_000,
        usage: 100_000,
      }),
    };
  }
  // deviceMemory (in GB).
  if (overrides.deviceMemoryGb === null) {
    (nav as { deviceMemory?: unknown }).deviceMemory = undefined;
  } else if (typeof overrides.deviceMemoryGb === 'number') {
    (nav as { deviceMemory?: number }).deviceMemory = overrides.deviceMemoryGb;
  }
}

beforeEach(() => {
  __resetPreflightCacheForTests();
  setNavigator({});
});

afterEach(() => {
  __resetPreflightCacheForTests();
  vi.restoreAllMocks();
});

describe('runSlmPreflight', () => {
  it('returns allow when all checks pass', async () => {
    setNavigator({
      freeStorageBytes: 2 * 1024 * 1024 * 1024, // 2 GB free
      deviceMemoryGb: 4,
    });
    const result = await runSlmPreflight();
    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe('allow');
    expect(result.degradeTo).toBeNull();
    expect(result.reasons).toHaveLength(0);
    expect(result.measurements.freeStorageBytes).toBeGreaterThan(0);
    expect(result.measurements.deviceMemoryGb).toBe(4);
  });

  it('blocks when free storage is less than 2× model size', async () => {
    setNavigator({
      freeStorageBytes: 50 * 1024 * 1024, // 50 MB free (Qwen needs ~966 MB)
      deviceMemoryGb: 4,
    });
    const result = await runSlmPreflight();
    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe('block');
    expect(result.degradeTo).toBe('rag_local');
    expect(result.reasons.some((r) => r.startsWith('storage_low'))).toBe(true);
  });

  it('blocks when deviceMemory is below the threshold', async () => {
    setNavigator({
      freeStorageBytes: 2 * 1024 * 1024 * 1024,
      deviceMemoryGb: 1, // Below MIN_DEVICE_MEMORY_GB (2)
    });
    const result = await runSlmPreflight();
    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe('block');
    expect(result.degradeTo).toBe('rag_local');
    expect(result.reasons.some((r) => r.startsWith('memory_low'))).toBe(true);
  });

  it('blocks when WASM is unavailable', async () => {
    setNavigator({
      freeStorageBytes: 2 * 1024 * 1024 * 1024,
      deviceMemoryGb: 4,
      wasm: false,
    });
    // Simulate WASM being unavailable by stubbing probeWasmLatency
    // via the cache-internal path. Easier: assert the result mentions
    // `wasm_unavailable` regardless of jsdom's WebAssembly presence —
    // if jsdom has it, the latency test path produces a non-slow
    // latency and the result is `allow`. So instead test the
    // unavailable branch by mocking the validate path to throw.
    const original = globalThis.WebAssembly;
    const stub = {
      validate: () => {
        throw new Error('WebAssembly disabled');
      },
    };
    globalThis.WebAssembly = stub as unknown as typeof WebAssembly;
    try {
      const result = await runSlmPreflight({ forceRefresh: true });
      expect(result.ok).toBe(false);
      expect(result.recommendation).toBe('block');
      expect(result.reasons).toContain('wasm_unavailable');
    } finally {
      globalThis.WebAssembly = original;
    }
  });

  it('returns allow_with_warning when all measurement APIs are unavailable', async () => {
    setNavigator({
      freeStorageBytes: null,
      deviceMemoryGb: null,
    });
    const result = await runSlmPreflight({ forceRefresh: true });
    // Storage + device memory are unknowns, but WASM is available
    // (jsdom default), so the unknowns list is non-empty.
    expect(result.recommendation).toBe('allow_with_warning');
    expect(result.ok).toBe('unknown');
    expect(result.degradeTo).toBeNull();
  });

  it('caches the result for the same session', async () => {
    setNavigator({
      freeStorageBytes: 2 * 1024 * 1024 * 1024,
      deviceMemoryGb: 4,
    });
    const first = await runSlmPreflight();
    // Second call without forceRefresh should return the same
    // `evaluatedAt` (cached) even if the underlying APIs change.
    setNavigator({ freeStorageBytes: 0, deviceMemoryGb: 0.25 });
    const second = await runSlmPreflight();
    expect(second.evaluatedAt).toBe(first.evaluatedAt);
    expect(second.ok).toBe(first.ok);
  });

  it('forceRefresh bypasses the cache', async () => {
    setNavigator({
      freeStorageBytes: 2 * 1024 * 1024 * 1024,
      deviceMemoryGb: 4,
    });
    const first = await runSlmPreflight();
    // Advance the clock past the cache TTL so the next call can't
    // accidentally re-hit the cache via expiry logic.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);
    setNavigator({ freeStorageBytes: 0, deviceMemoryGb: 0.25 });
    const second = await runSlmPreflight({ forceRefresh: true });
    expect(second.evaluatedAt).toBeGreaterThan(first.evaluatedAt);
    expect(second.ok).toBe(false);
    expect(second.recommendation).toBe('block');
  });

  it('result shape matches SlmPreflightResult interface', async () => {
    setNavigator({
      freeStorageBytes: 2 * 1024 * 1024 * 1024,
      deviceMemoryGb: 4,
    });
    const result: SlmPreflightResult = await runSlmPreflight();
    // Compile-time: the type assertion above enforces the shape; the
    // runtime keys check below catches accidental renames.
    expect(Object.keys(result).sort()).toEqual(
      [
        'degradeTo',
        'evaluatedAt',
        'measurements',
        'ok',
        'recommendation',
        'reasons',
      ].sort(),
    );
    expect(Object.keys(result.measurements).sort()).toEqual(
      ['deviceMemoryGb', 'freeStorageBytes', 'wasmLatencyMs'].sort(),
    );
  });
});
