/**
 * Tests for the online/offline orchestrator (Fase 1 T-1.4).
 *
 * These cases pin the decision rule documented in `orchestrator.ts`:
 *
 *   - navigator.onLine === false       → SLM
 *   - navigator.onLine === true        → online path (currently SLM stub)
 *   - opts.forceOffline === true       → SLM regardless of navigator
 *
 * `slmAdapter.complete` is mocked via `vi.mock('./slmAdapter')` so the
 * orchestrator test does not touch the worker / loader / IDB layers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ask } from './orchestrator';
import type { SLMResponse } from './types';

vi.mock('./slmAdapter', () => {
  const fixed: SLMResponse = {
    text: '[orchestrator-test-stub]',
    latencyMs: 7,
    tokensGenerated: 3,
    backend: 'wasm-simd',
  };
  const complete = vi.fn(async () => fixed);
  return {
    complete,
    // Keep these defined so other importers in the same module graph
    // (none, today, but defensive) don't see undefined.
    ensureSlmReady: vi.fn(async () => ({ modelId: 'phi-3-mini' })),
    disposeSlm: vi.fn(async () => undefined),
    getActiveModelId: vi.fn(() => null),
  };
});

import { complete as slmCompleteMock } from './slmAdapter';

beforeEach(() => {
  vi.mocked(slmCompleteMock).mockClear();
});

afterEach(() => {
  // Clean up the navigator override leaked by a case. We can't simply
  // `delete` because Node defines `navigator` as a non-configurable
  // getter — instead we redefine it back to a placeholder onLine=true
  // so subsequent tests start on the "online" path.
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });
  } catch {
    // Some environments lock navigator entirely; ignore — the per-test
    // setNavigatorOnline call resets it anyway.
  }
});

/**
 * Install a stub navigator with the requested onLine state. Node 20+
 * exposes `globalThis.navigator` as a read-only accessor, so plain
 * assignment throws — we use `Object.defineProperty` with `configurable`
 * so we can flip it case-by-case.
 */
function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: value },
    configurable: true,
    writable: true,
  });
}

describe('SLM orchestrator (orchestrator.ts)', () => {
  it('uses the SLM path when navigator.onLine is false', async () => {
    setNavigatorOnline(false);

    const out = await ask({ prompt: 'offline prompt' });

    expect(slmCompleteMock).toHaveBeenCalledTimes(1);
    expect(slmCompleteMock).toHaveBeenCalledWith({ prompt: 'offline prompt' });
    expect(out.text).toBe('[orchestrator-test-stub]');
  });

  it('returns a valid SLMResponse on the online path', async () => {
    setNavigatorOnline(true);

    const out = await ask({ prompt: 'online prompt' });

    // Today the online path is also stubbed via SLM (TODO T-1.4.1).
    // We assert the *response shape* rather than the routing detail so
    // this test survives the eventual server wiring without rewriting.
    expect(typeof out.text).toBe('string');
    expect(typeof out.latencyMs).toBe('number');
    expect(typeof out.tokensGenerated).toBe('number');
    expect(out.backend).toBeDefined();
  });

  it('forceOffline=true overrides navigator.onLine=true', async () => {
    setNavigatorOnline(true);

    await ask({ prompt: 'forced offline' }, { forceOffline: true });

    expect(slmCompleteMock).toHaveBeenCalledTimes(1);
    expect(slmCompleteMock).toHaveBeenCalledWith({ prompt: 'forced offline' });
  });
});
