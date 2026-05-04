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

// 15th wave Bucket A — kill 6 surviving ConditionalExpression /
// EqualityOperator / BooleanLiteral mutants on `shouldUseOffline`
// (orchestrator.ts:75-76). The 14th wave baseline only had 3 smoke tests
// over the decision matrix; the strict `=== true` checks were trivially
// mutatable. We exhaustively pin all 4 quadrants of the (forceOffline,
// forceOnline) matrix plus the navigator.onLine fall-through.
describe('SLM orchestrator — shouldUseOffline decision matrix (4 quadrants)', () => {
  // Spy on global fetch so the online path doesn't attempt a real HTTP
  // call. Returning `null` from json() trips `data.response ?? data.answer
  // ?? ''` → empty string. We assert *which* mock was called rather than
  // the response payload, so an empty body is fine.
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.mocked(slmCompleteMock).mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'online-stub' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('quadrant 1: (forceOffline=true, forceOnline=false) → SLM (offline wins)', async () => {
    setNavigatorOnline(true);

    await ask(
      { prompt: 'q1' },
      { forceOffline: true, forceOnline: false },
    );

    // Offline path: slmAdapter.complete is called, fetch is NOT.
    expect(slmCompleteMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('quadrant 2: (forceOffline=false, forceOnline=true) → online path', async () => {
    setNavigatorOnline(false); // even with browser offline, forceOnline wins

    await ask(
      { prompt: 'q2' },
      { forceOffline: false, forceOnline: true },
    );

    // Online path: fetch is called, slmAdapter.complete is NOT (response was ok).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(slmCompleteMock).not.toHaveBeenCalled();
  });

  it('quadrant 3: (forceOffline=true, forceOnline=true) → SLM (forceOffline wins per docstring)', async () => {
    setNavigatorOnline(true);

    await ask(
      { prompt: 'q3' },
      { forceOffline: true, forceOnline: true },
    );

    // Per `OrchestratorOptions.forceOffline` JSDoc:
    //   "Wins over `forceOnline` if both are set."
    // So slmAdapter.complete fires; fetch must not.
    expect(slmCompleteMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('quadrant 4a: (forceOffline=false, forceOnline=false) + navigator.onLine=true → online', async () => {
    setNavigatorOnline(true);

    await ask(
      { prompt: 'q4a' },
      { forceOffline: false, forceOnline: false },
    );

    // Falls through to navigator.onLine === true → online path.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(slmCompleteMock).not.toHaveBeenCalled();
  });

  it('quadrant 4b: (forceOffline=false, forceOnline=false) + navigator.onLine=false → SLM', async () => {
    setNavigatorOnline(false);

    await ask(
      { prompt: 'q4b' },
      { forceOffline: false, forceOnline: false },
    );

    // Falls through to navigator.onLine === false → SLM path.
    expect(slmCompleteMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Edge guard: the `=== true` strictness means non-boolean truthy values
  // must NOT trigger the override. This kills the BooleanLiteral mutant
  // that flips `=== true` to `=== false` (which would also pass with
  // booleans alone but fails with truthy non-bools like a string).
  it('forceOffline as non-true truthy value (string "true") does NOT override navigator.onLine=true', async () => {
    setNavigatorOnline(true);

    // Cast through unknown — forceOffline accepts only boolean per the
    // type, but we want to prove the runtime check is strict equality.
    await ask(
      { prompt: 'edge' },
      { forceOffline: 'true' as unknown as boolean },
    );

    // Strict `=== true` → string "true" does NOT match → online path.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(slmCompleteMock).not.toHaveBeenCalled();
  });
});
