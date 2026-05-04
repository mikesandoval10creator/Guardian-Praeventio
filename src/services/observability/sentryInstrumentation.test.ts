// Praeventio Guard — Sentry instrumentation helper tests.
//
// Sprint 20 Bucket Mu Phase 2.
//
// We mock `@sentry/node` and verify that `withSentryScope`:
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
vi.mock('@sentry/node', () => {
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

import * as Sentry from '@sentry/node';
import { withSentryScope, withSentryScopeSync } from './sentryInstrumentation';

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
