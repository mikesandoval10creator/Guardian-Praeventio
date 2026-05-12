// Test for centralized `captureRouteError` helper.
//
// Codex P2 on PR #91 flagged that local per-route `captureRouteError`
// helpers passed `{endpoint, ...extra}` as TOP-LEVEL `ErrorContext`
// properties, but `sentryAdapter.captureException` only reads
// `context.tags`, `context.extra`, `context.userId`. Result: the
// `endpoint` tag (and `callerUid`, `tenantId`, `projectId`) were
// silently dropped before reaching Sentry.
//
// This test pins the bridge behavior of the centralized helper so the
// regression cannot reappear.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureExceptionMock = vi.fn();

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({
    captureException: captureExceptionMock,
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { captureRouteError } from './captureRouteError.js';
import { logger } from '../../utils/logger.js';

describe('captureRouteError (centralized helper)', () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
    (logger.warn as ReturnType<typeof vi.fn>).mockReset();
  });

  it('forwards endpoint as a Sentry tag (Codex P2 regression guard)', () => {
    captureRouteError(new Error('boom'), 'POST /api/projects/:projectId/insights');

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [err, context] = captureExceptionMock.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
    expect(context.tags).toEqual({ endpoint: 'POST /api/projects/:projectId/insights' });
    expect(context.endpoint).toBe('POST /api/projects/:projectId/insights');
  });

  it('maps scalar extras (string/number/boolean) to tags', () => {
    captureRouteError(new Error('x'), '/ep', {
      callerUid: 'uid-1',
      projectId: 'p-42',
      attempt: 3,
      retried: true,
    });

    const ctx = captureExceptionMock.mock.calls[0][1];
    expect(ctx.tags).toEqual({
      endpoint: '/ep',
      callerUid: 'uid-1',
      projectId: 'p-42',
      attempt: '3',
      retried: 'true',
    });
  });

  it('promotes callerUid to top-level userId', () => {
    captureRouteError(new Error('x'), '/ep', { callerUid: 'uid-99' });
    const ctx = captureExceptionMock.mock.calls[0][1];
    expect(ctx.userId).toBe('uid-99');
    expect(ctx.tags.callerUid).toBe('uid-99');
  });

  it('promotes tenantId to top-level tenantId', () => {
    captureRouteError(new Error('x'), '/ep', { tenantId: 'tnt-7' });
    const ctx = captureExceptionMock.mock.calls[0][1];
    expect(ctx.tenantId).toBe('tnt-7');
  });

  it('routes non-scalar values to extra and omits extra when empty', () => {
    const detail = { items: [1, 2, 3] };
    captureRouteError(new Error('x'), '/ep', { detail, label: 'a' });
    const ctx = captureExceptionMock.mock.calls[0][1];
    expect(ctx.extra).toEqual({ detail });
    expect(ctx.tags).toEqual({ endpoint: '/ep', label: 'a' });

    captureExceptionMock.mockReset();
    captureRouteError(new Error('x'), '/ep', { label: 'a' });
    const ctx2 = captureExceptionMock.mock.calls[0][1];
    expect(ctx2.extra).toBeUndefined();
  });

  it('drops null and undefined values', () => {
    captureRouteError(new Error('x'), '/ep', {
      a: null,
      b: undefined,
      c: 'kept',
    });
    const ctx = captureExceptionMock.mock.calls[0][1];
    expect(ctx.tags).toEqual({ endpoint: '/ep', c: 'kept' });
    expect(ctx.extra).toBeUndefined();
  });

  it('wraps non-Error throwables into Error instances', () => {
    captureRouteError('plain string', '/ep');
    const err = captureExceptionMock.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('plain string');
  });

  it('swallows tracker failures and logs warn (hot-path safety)', () => {
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error('tracker exploded');
    });
    expect(() => captureRouteError(new Error('x'), '/ep')).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      'observability.capture_failed',
      expect.objectContaining({ endpoint: '/ep' }),
    );
  });
});
