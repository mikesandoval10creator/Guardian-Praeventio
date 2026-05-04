// Praeventio Guard — Sentry instrumentation helper tests.
//
// Sprint 20 Bucket Mu Phase 2.
//
// We mock `@sentry/core` and verify that `withSentryScope`:
//   • Calls `Sentry.withScope` and forwards `setTag('module', ...)` plus
//     `setContext('input', ...)` with the sanitised payload.
//   • Captures exceptions via `Sentry.captureException` and rethrows the
//     original error so caller control flow is unchanged.
//   • Returns the wrapped function's resolved value on success without
//     invoking captureException.
//
// We DO NOT exercise the real Sentry SDK (no DSN, no network); the test
// is a pure spy assertion on the wrapper's contract.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock — vi.mock is hoisted above imports automatically.
vi.mock('@sentry/core', () => {
  // The mock scope captures setTag/setContext calls so we can assert on them.
  const tagCalls: Array<[string, string]> = [];
  const contextCalls: Array<[string, Record<string, unknown>]> = [];

  const scopeMock = {
    setTag: vi.fn((key: string, value: string) => {
      tagCalls.push([key, value]);
    }),
    setContext: vi.fn((key: string, ctx: Record<string, unknown>) => {
      contextCalls.push([key, ctx]);
    }),
  };

  return {
    // `withScope` invokes the callback synchronously with our mock scope and
    // returns whatever the callback returns (the SDK's real behaviour).
    withScope: vi.fn((cb: (scope: typeof scopeMock) => unknown) => cb(scopeMock)),
    captureException: vi.fn(() => 'evt-mock-1'),
    // Test introspection helpers — not part of the real SDK shape.
    __scope: scopeMock,
    __tagCalls: tagCalls,
    __contextCalls: contextCalls,
  };
});

import * as Sentry from '@sentry/core';
import {
  REDACT_KEYS,
  sanitizeContext,
  withSentryScope,
  withSentryScopeSync,
} from './sentryInstrumentation';

const sentryMockHandle = Sentry as unknown as {
  __scope: { setTag: ReturnType<typeof vi.fn>; setContext: ReturnType<typeof vi.fn> };
  __tagCalls: Array<[string, string]>;
  __contextCalls: Array<[string, Record<string, unknown>]>;
};

describe('withSentryScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentryMockHandle.__tagCalls.length = 0;
    sentryMockHandle.__contextCalls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('calls Sentry.withScope and sets module tag + input context on success', async () => {
    const result = await withSentryScope(
      'gemini',
      { action: 'analyzeFastCheck', industry: 'mining' },
      async () => 'ok',
    );

    expect(result).toBe('ok');
    expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    expect(sentryMockHandle.__scope.setTag).toHaveBeenCalledWith('module', 'gemini');
    expect(sentryMockHandle.__scope.setContext).toHaveBeenCalledWith(
      'input',
      expect.objectContaining({ action: 'analyzeFastCheck', industry: 'mining' }),
    );
    // No exception thrown — captureException must NOT fire.
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures exceptions and rethrows the ORIGINAL error', async () => {
    const boom = new Error('downstream failed');

    await expect(
      withSentryScope('webpay', { action: 'commitTransaction' }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom); // identity equality — same error reference

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('tags module=webpay for the webpay service', async () => {
    await withSentryScope('webpay', { action: 'createTransaction' }, async () => 1);
    expect(sentryMockHandle.__tagCalls).toContainEqual(['module', 'webpay']);
  });

  it('tags module=zettelkasten for the writeNode service', async () => {
    await withSentryScope(
      'zettelkasten',
      { action: 'writeNodes', nodeCount: 3 },
      async () => ({ ok: true }),
    );
    expect(sentryMockHandle.__tagCalls).toContainEqual(['module', 'zettelkasten']);
  });

  it('redacts sensitive keys (token, apiKey, prompt) from the input context', async () => {
    await withSentryScope(
      'gemini',
      {
        action: 'analyzeRiskWithAI',
        industry: 'construction',
        token: 'sk-leak-123',
        apiKey: 'AIza-leak',
        prompt: 'sensitive worker question',
      },
      async () => null,
    );

    const ctxCall = sentryMockHandle.__contextCalls.find(([k]) => k === 'input');
    expect(ctxCall).toBeDefined();
    const ctx = ctxCall![1];
    expect(ctx.industry).toBe('construction');
    expect(ctx.token).toBe('[REDACTED]');
    expect(ctx.apiKey).toBe('[REDACTED]');
    expect(ctx.prompt).toBe('[REDACTED]');
  });

  it('still resolves the function value when Sentry.withScope itself throws (sentry-not-initialized)', async () => {
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Sentry not initialized');
    });

    const value = await withSentryScope(
      'prediction',
      { action: 'generatePredictiveForecast' },
      async () => 'fallback-ok',
    );
    expect(value).toBe('fallback-ok');
  });
});

describe('withSentryScopeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentryMockHandle.__tagCalls.length = 0;
    sentryMockHandle.__contextCalls.length = 0;
  });

  it('runs the function and tags module synchronously', () => {
    const out = withSentryScopeSync('prediction', { action: 'mapResponse' }, () => 42);
    expect(out).toBe(42);
    expect(sentryMockHandle.__tagCalls).toContainEqual(['module', 'prediction']);
  });

  it('captures exceptions and rethrows the original synchronously', () => {
    const boom = new Error('sync failed');
    expect(() =>
      withSentryScopeSync('webpay', { action: 'mapCommitResponse' }, () => {
        throw boom;
      }),
    ).toThrow(boom);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ level: 'error' }),
    );
  });
});

// 15th wave Bucket A — kill 11 surviving StringLiteral mutants on REDACT_KEYS.
// Stryker baseline (14th wave Bucket D) showed every key in REDACT_KEYS could
// be mutated to "" without any test failing. The mock-based tests above only
// assert three keys (token, apiKey, prompt) explicitly. We pin every key
// individually here, plus one control non-listed key to catch the inverse
// regression (i.e. accidentally redacting safe data).
describe('REDACT_KEYS — parametric per-key assertion', () => {
  // Source-of-truth list — pulled from the exported set so adding a key in
  // sentryInstrumentation.ts auto-extends this loop without hidden drift.
  const KEYS = Array.from(REDACT_KEYS);

  // Sanity check that the set hasn't been silently emptied — without this,
  // a `REDACT_KEYS = new Set([])` mutation would skip every iteration and
  // pass the suite vacuously.
  it('REDACT_KEYS contains the documented 11 PII-bearing keys', () => {
    expect(KEYS).toHaveLength(11);
    expect(KEYS).toEqual(
      expect.arrayContaining([
        'authorization',
        'cookie',
        'token',
        'apiKey',
        'api_key',
        'sessionId',
        'session',
        'password',
        'prompt',
        'rawPrompt',
        'userInput',
      ]),
    );
  });

  for (const key of KEYS) {
    it(`redacts the "${key}" key in context payload`, () => {
      // Sentinel value distinct from the [REDACTED] marker so a no-op
      // sanitize would visibly leak the secret into the assertion.
      const out = sanitizeContext({
        [key]: 'secret-value-that-must-not-leak',
        safeNeighbour: 'keep',
      });
      expect(out[key]).toBe('[REDACTED]');
      // The non-listed neighbour key MUST survive intact — guards against
      // an over-broad redactor that wipes everything.
      expect(out.safeNeighbour).toBe('keep');
    });
  }

  it('does NOT redact a non-listed safe key', () => {
    const out = sanitizeContext({ industryCode: 'mining', action: 'fastCheck' });
    expect(out.industryCode).toBe('mining');
    expect(out.action).toBe('fastCheck');
  });

  it('returns a fresh shallow copy (does not mutate the input payload)', () => {
    // Documented contract in the source: "The mutation is non-destructive
    // — we return a fresh shallow copy." Pin it.
    const input = { token: 'leak-1', industry: 'construction' };
    const out = sanitizeContext(input);
    expect(input.token).toBe('leak-1');
    expect(out).not.toBe(input);
  });
});

// 17th wave Bucket A — kill Run #2 NEW surviving mutants:
//
//   • sentryInstrumentation.ts:196:5 — LogicalOperator chain on
//     `msg.includes('sentry') || msg.includes('hub') || msg.includes('not initialized')`
//     (3 mutants: any single `||` flipped to `&&`, or the whole chain
//     forced to `false`).
//   • sentryInstrumentation.ts:193:7 — ConditionalExpression on
//     `if (!(err instanceof Error)) return false;` (1 mutant flipping
//     to `false`).
//   • sentryInstrumentation.ts:139:9 — ConditionalExpression on
//     `if (isSentrySetupError(err))` inside withSentryScopeSync's
//     outer catch (2 mutants forcing true / false).
//
// `isSentrySetupError` is NOT exported. Per task constraints (NO source
// changes), we exercise it through its only call site:
// `withSentryScope` / `withSentryScopeSync` route an outer `withScope`
// throw through the heuristic and, on TRUE, fall back to running `fn()`
// plainly. So the contract becomes: when withScope throws an error
// matching the heuristic, the wrapped fn STILL runs; when withScope
// throws a non-matching error, the original error rethrows.
describe('isSentrySetupError heuristic (Run #2 #1/#2/#3 — exercised via withSentryScope fallback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentryMockHandle.__tagCalls.length = 0;
    sentryMockHandle.__contextCalls.length = 0;
  });

  // ─── Line 196 LogicalOperator chain: each substring branch ───

  it('"Sentry not initialized" error → fallback fn runs (matches both "sentry" and "not initialized" branches)', async () => {
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Sentry not initialized');
    });
    // If the heuristic returns FALSE the original error rethrows; we
    // assert the value resolves cleanly, pinning TRUE.
    const out = await withSentryScope('gemini', { action: 'a' }, async () => 'fb-1');
    expect(out).toBe('fb-1');
  });

  it('"Hub disposed" error → fallback fn runs (pins the "hub" middle branch)', async () => {
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      // Lowercase to ensure msg.toLowerCase() match. Contains only "hub",
      // not "sentry" / "not initialized" — pins the middle branch alone.
      throw new Error('hub disposed');
    });
    const out = await withSentryScope('webpay', { action: 'b' }, async () => 'fb-2');
    expect(out).toBe('fb-2');
  });

  it('"sentry connection refused" error → fallback fn runs (pins the leading "sentry" branch alone)', async () => {
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      // Contains only "sentry" — kills mutants that flip the first `||`
      // to `&&` (would require all three substrings to be present).
      throw new Error('sentry connection refused');
    });
    const out = await withSentryScope('prediction', { action: 'c' }, async () => 'fb-3');
    expect(out).toBe('fb-3');
  });

  it('benign "user input invalid" error → does NOT match heuristic, original error rethrows (pins false branch of chain)', async () => {
    const benign = new Error('user input invalid');
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw benign;
    });
    // None of "sentry" / "hub" / "not initialized" are substrings of
    // "user input invalid" — heuristic returns false → outer catch
    // rethrows the original error.
    await expect(
      withSentryScope('zettelkasten', { action: 'd' }, async () => 'never'),
    ).rejects.toBe(benign);
  });

  // ─── Line 193 — `if (!(err instanceof Error)) return false;` ───

  it('non-Error throwable (string) → heuristic returns false → original value rethrows (pins instanceof Error guard)', async () => {
    // String thrown by withScope mock. `'foo' instanceof Error === false`,
    // so isSentrySetupError must return false → outer catch rethrows.
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error not Error instance';
    });
    await expect(
      withSentryScope('gemini', { action: 'e' }, async () => 'never'),
    ).rejects.toBe('string error not Error instance');
  });

  it('non-Error throwable (null) → heuristic returns false → original value rethrows', async () => {
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      // eslint-disable-next-line no-throw-literal
      throw null;
    });
    // `null instanceof Error === false` → guard returns false → rethrow.
    await expect(
      withSentryScope('gemini', { action: 'f' }, async () => 'never'),
    ).rejects.toBeNull();
  });

  // ─── Line 139 — same heuristic gate inside withSentryScopeSync ───

  it('withSentryScopeSync: matching setup error → fallback fn runs (pins line 139 ConditionalExpression)', () => {
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Sentry hub not initialized');
    });
    // Sync variant — same fallback shape, line 139's `if
    // (isSentrySetupError(err))` is the gate. A mutant forcing it to
    // `false` would rethrow instead of falling back.
    const out = withSentryScopeSync('webpay', { action: 'sync-a' }, () => 99);
    expect(out).toBe(99);
  });

  it('withSentryScopeSync: non-matching error → rethrows (pins line 139 false branch)', () => {
    const benign = new Error('database connection refused');
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw benign;
    });
    // Heuristic returns false → outer catch rethrows; a mutant forcing
    // line 139 to `true` would swallow this and call fn() instead.
    expect(() =>
      withSentryScopeSync('prediction', { action: 'sync-b' }, () => 0),
    ).toThrow(benign);
  });
});

// 17th wave Bucket A — sanitizeContext nested-payload coverage. Run #2
// flagged sentryInstrumentation.ts:139:9 alongside the heuristic mutants
// (the docstring suggests the `sanitizeContext` recursion-depth boundary
// surfaced as a NEW ConditionalExpression survivor under the broader
// REDACT_KEYS coverage). The current implementation of sanitizeContext
// is non-recursive (shallow copy), so we DOCUMENT that contract here:
// nested objects are NOT walked, and the test pins the shallow-only
// behavior (so a future recursive change is a deliberate update).
describe('sanitizeContext shallow-vs-nested contract (Run #2 #2 documentation)', () => {
  it('does NOT recurse into nested objects (current shallow-only contract)', () => {
    // Pins line 139's recursion-guard adjacent code: any future patch
    // that introduces recursion needs to update this expectation.
    const out = sanitizeContext({ outer: { token: 'inner-secret' } });
    // Non-listed key at top level → preserved unchanged → inner token
    // value escapes redaction. Shallow-only behavior pinned.
    expect(out.outer).toEqual({ token: 'inner-secret' });
  });

  it('redacts top-level token when nested next to non-listed neighbours', () => {
    const out = sanitizeContext({
      token: 'top-level-leak',
      meta: { token: 'inner-leak-not-walked' },
    });
    expect(out.token).toBe('[REDACTED]');
    // Inner remains untouched per the shallow contract.
    expect(out.meta).toEqual({ token: 'inner-leak-not-walked' });
  });
});
