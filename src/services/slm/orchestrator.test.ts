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

// 17th wave Bucket A — kill Run #2 NEW surviving mutants:
//
//   • orchestrator.ts:237–245 trackQueryOffline analytics seam (5
//     mutants: BlockStatement {}, StringLiteral "", ObjectLiteral {}).
//   • orchestrator.ts:104–105 tryGetIdToken truthy-guard (5 mutants:
//     `?.` chain elision, `&&` flips, `EqualityOperator` flips).
//   • orchestrator.ts:162 LogicalOperator on
//     `data.response ?? data.answer ?? ''` (2 mutants).
//
// The existing top-of-file `vi.mock('./slmAdapter')` continues to fire.
// We add hoisted mocks for `../analytics` and `../firebase` so the
// orchestrator's dynamic imports resolve to deterministic spies.

// Hoisted analytics mock — lives at module level so vi.mock() runs
// before orchestrator.ts evaluates its dynamic `import('../analytics')`.
const analyticsTrackMock = vi.fn();
vi.mock('../analytics', () => ({
  analytics: { track: analyticsTrackMock },
}));

// Hoisted firebase mock for tryGetIdToken truthy-guard tests. We expose
// `currentUser` as a swappable property so each test pins its own
// (`null`, `{ getIdToken: → 'token-x' }`, `{ getIdToken: → '' }`).
const firebaseAuthMock: { currentUser: { getIdToken: () => Promise<unknown> } | null } = {
  currentUser: null,
};
vi.mock('../firebase', () => ({
  auth: firebaseAuthMock,
}));

describe('orchestrator — trackQueryOffline analytics seam (Run #2 #1)', () => {
  beforeEach(() => {
    vi.mocked(slmCompleteMock).mockClear();
    analyticsTrackMock.mockReset();
  });

  it('tracks slm.query.offline with the documented props when forceOffline=true', async () => {
    setNavigatorOnline(true);

    await ask({ prompt: 'offline analytics' }, { forceOffline: true });

    // The trackQueryOffline body fires asynchronously inside `void
    // trackQueryOffline(resp)`. Yield once so the dynamic import
    // resolves before assertions.
    await new Promise((r) => setTimeout(r, 0));

    expect(analyticsTrackMock).toHaveBeenCalledTimes(1);
    // Pins the StringLiteral "slm.query.offline" — empty-string mutant
    // would emit `''`, breaking this assertion.
    expect(analyticsTrackMock).toHaveBeenCalledWith(
      'slm.query.offline',
      // Pins ObjectLiteral — the 5-mutant cluster includes blanking the
      // payload to {} which would fail every property assertion below.
      expect.objectContaining({
        query_kind: 'general',
        // The slmAdapter mock returns latencyMs: 7, backend: 'wasm-simd'.
        latency_ms: 7,
        model_id: 'wasm-simd',
        prompt_token_count: 0,
      }),
    );
  });

  it('does NOT track slm.query.offline when the online path succeeds (forceOnline=true)', async () => {
    setNavigatorOnline(true);

    // Stub fetch so the online path returns a non-null payload.
    const localFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'online-ok' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', localFetchMock);

    await ask({ prompt: 'online wins' }, { forceOnline: true });
    await new Promise((r) => setTimeout(r, 0));

    // slm.query.online fires; slm.query.offline must NOT.
    const calls = analyticsTrackMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain('slm.query.online');
    expect(calls).not.toContain('slm.query.offline');

    vi.unstubAllGlobals();
  });

  it('tracks slm.query.online with the documented props on online success', async () => {
    setNavigatorOnline(true);

    const localFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'gemini-stub' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', localFetchMock);

    await ask({ prompt: 'online success' }, { forceOnline: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(analyticsTrackMock).toHaveBeenCalledWith(
      'slm.query.online',
      expect.objectContaining({
        query_kind: 'general',
        prompt_token_count: 0,
        success: true,
        // Online responses set backend: 'gemini' on the SLMResponse.
        model_id: 'gemini',
      }),
    );

    vi.unstubAllGlobals();
  });
});

describe('orchestrator — tryGetIdToken truthy-guard (Run #2 #2)', () => {
  // We pin the `typeof token === 'string' && token.length > 0` guard by
  // observing the Authorization header that `callOnlineBackend`
  // attaches. The fetch spy receives the headers — we read them out of
  // `fetchMock.mock.calls[0][1].headers`.
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(slmCompleteMock).mockClear();
    analyticsTrackMock.mockReset();
    firebaseAuthMock.currentUser = null;

    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'ok' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    firebaseAuthMock.currentUser = null;
  });

  it('attaches Authorization: Bearer <token> when getIdToken returns a non-empty string', async () => {
    firebaseAuthMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue('token-123'),
    };

    setNavigatorOnline(true);
    await ask({ prompt: 'auth path' }, { forceOnline: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // Pins the truthy branch — `length > 0` AND `=== 'string'` both true.
    expect(headers.Authorization).toBe('Bearer token-123');
  });

  it('omits Authorization header when currentUser is null (no Firebase user)', async () => {
    firebaseAuthMock.currentUser = null;

    setNavigatorOnline(true);
    await ask({ prompt: 'no user' }, { forceOnline: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // The optional-chain on `auth.currentUser?.getIdToken()` returns
    // undefined; `typeof undefined === 'string'` is false → no header.
    expect(headers.Authorization).toBeUndefined();
  });

  it('omits Authorization header when getIdToken resolves to empty string (length > 0 guard)', async () => {
    // Pins the `length > 0` half of the guard. A mutation flipping `>` to
    // `>=` would pass empty-string here as a header — we'd see
    // `Authorization: 'Bearer '` and this test would catch it.
    firebaseAuthMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue(''),
    };

    setNavigatorOnline(true);
    await ask({ prompt: 'empty token' }, { forceOnline: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('orchestrator — response-shape coalescing (Run #2 #3, line 162)', () => {
  // Pins `data.response ?? data.answer ?? ''`. The 2 surviving
  // LogicalOperator mutants flip `??` chains to `&&`/empty-string
  // patterns; covering all three input shapes (response, answer, none)
  // forces the canonical chain to remain intact.
  beforeEach(() => {
    vi.mocked(slmCompleteMock).mockClear();
    analyticsTrackMock.mockReset();
    firebaseAuthMock.currentUser = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns text === data.response when the server uses the {response: ...} shape', async () => {
    setNavigatorOnline(true);
    const localFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'X' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', localFetchMock);

    const out = await ask({ prompt: 'shape A' }, { forceOnline: true });
    expect(out.text).toBe('X');
    expect(out.backend).toBe('gemini');
  });

  it('returns text === data.answer when the server uses the legacy {answer: ...} shape', async () => {
    setNavigatorOnline(true);
    const localFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Y' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', localFetchMock);

    const out = await ask({ prompt: 'shape B' }, { forceOnline: true });
    // The `??` chain falls through to data.answer.
    expect(out.text).toBe('Y');
    expect(out.backend).toBe('gemini');
  });

  it('returns text === "" when the server returns neither response nor answer', async () => {
    setNavigatorOnline(true);
    const localFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as unknown as Response);
    vi.stubGlobal('fetch', localFetchMock);

    const out = await ask({ prompt: 'shape C' }, { forceOnline: true });
    // Both `??` arms fall through to the literal '' default.
    expect(out.text).toBe('');
    expect(out.backend).toBe('gemini');
  });
});
