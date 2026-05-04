// Praeventio Guard — `@sentry/react` client init tests.
//
// Why this exists (Sprint 20 sixth-wave Bucket Psi):
//   We mock `@sentry/react` so we can verify that `initSentry()` wires the
//   browser SDK with the right knobs (replay, tracing, beforeSend) without
//   sending a single real network packet. Coverage:
//     1. `initSentry` is idempotent (only calls SDK.init once even when
//        invoked multiple times — guards against StrictMode double-mount
//        in dev re-running module side effects).
//     2. `beforeSend` redacts `event.user.email` so a misconfigured caller
//        cannot leak PII.
//     3. `beforeSend` redacts the `Cookie` request header (and similar
//        auth headers) since they include session tokens.
//     4. `initSentry` is a no-op when `VITE_SENTRY_DSN` is absent — the
//        local dev path must never crash on a missing env var.
//
// `import.meta.env.VITE_SENTRY_DSN` is captured at module-load (top of
// `sentry.ts`), so each scenario uses `vi.resetModules()` + `vi.stubEnv()`
// to re-import the module under a fresh env.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock — `vi.mock` is hoisted above imports automatically.
vi.mock('@sentry/react', () => {
  const init = vi.fn();
  const browserTracingIntegration = vi.fn(() => ({ name: 'BrowserTracing' }));
  const replayIntegration = vi.fn((opts: unknown) => ({ name: 'Replay', opts }));
  const captureException = vi.fn(() => 'evt-test-1');
  const withScope = vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() }),
  );
  return {
    init,
    browserTracingIntegration,
    replayIntegration,
    captureException,
    withScope,
  };
});

import * as Sentry from '@sentry/react';

describe('initSentry — @sentry/react client wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a no-op when VITE_SENTRY_DSN is empty (dev without DSN)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry } = await import('./sentry');

    initSentry();

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('only calls Sentry.init once even when initSentry runs twice (idempotent)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://test@sentry.io/123');
    const { initSentry, __resetForTests } = await import('./sentry');

    __resetForTests();
    initSentry();
    initSentry(); // second call must NOT re-init the SDK
    initSentry();

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://test@sentry.io/123',
        tracesSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        replaysSessionSampleRate: 0.05,
      }),
    );
  });

  it('beforeSend redacts user.email so PII never leaves the browser', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://test@sentry.io/123');
    const { initSentry, __resetForTests } = await import('./sentry');

    __resetForTests();
    initSentry();

    const initCall = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(initCall).toBeDefined();

    const event = {
      user: { id: 'usr_123', email: 'worker@example.com', username: 'jdoe', ip_address: '1.2.3.4' },
      contexts: { user: { email: 'shadow@example.com' } },
    };
    const sanitised = initCall.beforeSend(event) as typeof event;

    expect(sanitised.user.id).toBe('usr_123'); // id survives — used for correlation
    expect(sanitised.user).not.toHaveProperty('email');
    expect(sanitised.user).not.toHaveProperty('username');
    expect(sanitised.user).not.toHaveProperty('ip_address');
    expect(sanitised.contexts.user).not.toHaveProperty('email');
  });

  it('beforeSend redacts request.headers.cookie and Authorization', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://test@sentry.io/123');
    const { initSentry, __resetForTests } = await import('./sentry');

    __resetForTests();
    initSentry();

    const initCall = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
    };

    const event = {
      request: {
        url: 'https://app.example.com/api/x',
        headers: {
          Cookie: 'session=secret-abc',
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        },
        cookies: 'session=secret-abc',
      },
    };
    const sanitised = initCall.beforeSend(event) as typeof event;

    expect(sanitised.request.headers.Cookie).toBe('[redacted]');
    expect(sanitised.request.headers.authorization).toBe('[redacted]');
    expect(sanitised.request.headers['content-type']).toBe('application/json'); // benign header survives
    expect(sanitised.request.cookies).toBe('[redacted]');
  });
});
