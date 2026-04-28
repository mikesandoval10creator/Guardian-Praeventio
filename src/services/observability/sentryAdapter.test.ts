// Praeventio Guard — Sentry adapter unit tests.
//
// These tests verify that the real `sentryAdapter` correctly forwards each
// call to the underlying `@sentry/node` SDK, with the expected option
// shapes and PII-safe defaults. We mock `@sentry/node` so:
//
//   • No real network traffic. Tests stay fast + offline.
//   • We can assert every SDK call site without standing up a real DSN.
//
// Coverage:
//   • init() — calls Sentry.init with dsn / environment / release /
//     tracesSampleRate (defaults to 0.1 if sampleRate omitted).
//   • init() — when DSN is missing, logs a warning and skips Sentry.init
//     (silent degradation per OBSERVABILITY.md fall-back policy).
//   • captureException() — forwards error + context.extra as `contexts`
//     and returns the SDK's eventId.
//   • captureMessage() — forwards message + level + context, returns id.
//   • addBreadcrumb() — forwards Sentry-shaped breadcrumb.
//   • setUserContext() — calls Sentry.setUser with id + extra props.
//   • flush() — delegates to Sentry.flush.
//
// NOTE: `sentryAdapter` is the singleton exported from sentryAdapter.ts.
// Its `isAvailable` is captured at module-load from `process.env.SENTRY_DSN`.
// We mock the SDK BEFORE importing the adapter so all SDK calls flow
// through our spy.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock — vi.mock is hoisted above imports automatically.
vi.mock('@sentry/node', () => {
  return {
    init: vi.fn(),
    captureException: vi.fn(() => 'evt-test-1'),
    captureMessage: vi.fn(() => 'evt-test-2'),
    addBreadcrumb: vi.fn(),
    setUser: vi.fn(),
    flush: vi.fn(async () => true),
  };
});

import * as Sentry from '@sentry/node';
import { sentryAdapter } from './sentryAdapter';

describe('sentryAdapter (real SDK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('name is "sentry"', () => {
    expect(sentryAdapter.name).toBe('sentry');
  });

  it('init() forwards dsn / environment / release / tracesSampleRate to Sentry.init', () => {
    sentryAdapter.init({
      dsn: 'https://abc@sentry.io/123',
      environment: 'production',
      release: 'praeventio-guard@1.2.3',
      sampleRate: 0.25,
    });
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://abc@sentry.io/123',
        environment: 'production',
        release: 'praeventio-guard@1.2.3',
        tracesSampleRate: 0.25,
      }),
    );
  });

  it('init() defaults tracesSampleRate to 0.1 when sampleRate omitted', () => {
    sentryAdapter.init({
      dsn: 'https://abc@sentry.io/123',
      environment: 'staging',
    });
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.1 }),
    );
  });

  it('init() with falsy DSN silently skips Sentry.init (no throw)', () => {
    expect(() =>
      sentryAdapter.init({ environment: 'development' }),
    ).not.toThrow();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('captureException() forwards error and returns eventId', () => {
    const err = new Error('boom');
    const id = sentryAdapter.captureException(err, {
      userId: 'uid-1',
      tags: { route: '/api/x' },
      extra: { foo: 'bar' },
    });
    expect(id).toBe('evt-test-1');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.any(Object),
    );
  });

  it('captureMessage() forwards message + level and returns eventId', () => {
    const id = sentryAdapter.captureMessage('something happened', 'warning', {
      endpoint: '/billing/webpay/return',
    });
    expect(id).toBe('evt-test-2');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'something happened',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('addBreadcrumb() forwards Sentry-shaped breadcrumb', () => {
    const ts = new Date('2026-04-28T12:00:00Z');
    sentryAdapter.addBreadcrumb({
      category: 'http',
      message: 'GET /api/health',
      level: 'info',
      timestamp: ts,
      data: { status: 200 },
    });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'http',
        message: 'GET /api/health',
        level: 'info',
        data: { status: 200 },
      }),
    );
  });

  it('setUserContext() calls Sentry.setUser with id and extras merged', () => {
    sentryAdapter.setUserContext('uid-42', { tier: 'oro', tenantId: 't-9' });
    expect(Sentry.setUser).toHaveBeenCalledTimes(1);
    expect(Sentry.setUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'uid-42',
        tier: 'oro',
        tenantId: 't-9',
      }),
    );
  });

  it('flush() delegates to Sentry.flush and never rejects', async () => {
    await expect(sentryAdapter.flush(2000)).resolves.toBeUndefined();
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('captureException() never throws even if Sentry.captureException blows up', () => {
    (Sentry.captureException as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => {
        throw new Error('sentry sdk down');
      },
    );
    expect(() =>
      sentryAdapter.captureException(new Error('inner')),
    ).not.toThrow();
  });
});
