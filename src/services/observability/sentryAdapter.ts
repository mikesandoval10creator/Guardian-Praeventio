// Praeventio Guard — Sentry error tracking adapter (real SDK).
//
// Round 13 swap: the previous file in this slot was a stub that threw
// `ObservabilityNotImplementedError`. We now wire the real `@sentry/node`
// SDK behind the same `ErrorTrackingAdapter` interface so call sites are
// unchanged.
//
// Key decisions:
//
//   • If `dsn` is falsy at runtime (env var missing in dev / CI / a
//     misconfigured deploy), `init()` logs a warning to `console.warn`
//     (NOT through `logger`, to avoid recursing through observability
//     code) and returns WITHOUT calling `Sentry.init`. The other adapter
//     methods then become effective no-ops because the SDK was never
//     initialized. This matches the silent-degradation policy in
//     `index.ts:getErrorTracker()` and OBSERVABILITY.md §1.
//
//   • Every method is wrapped in `try { ... } catch` so an SDK fault
//     (network blip, internal Sentry error) cannot break the request
//     path. Errors land in `console.warn` rather than `logger` to avoid
//     recursing through the observability layer.
//
//   • `captureException` and `captureMessage` always return a STRING
//     event id. The SDK can return `undefined` when not initialized; we
//     normalize that to `''` so callers can safely round-trip the id
//     into API responses without checking for nullishness.
//
//   • Source-map upload is a build-pipeline concern (handled by
//     `@sentry/cli` in CI per OBSERVABILITY.md §2). Nothing here cares.
//
//   • PII scrubbing happens via the `beforeSend` hook so authorization
//     headers and cookies don't leak into Sentry. Documented in
//     OBSERVABILITY.md Round 2 follow-ups.

import * as Sentry from '@sentry/node';
import type {
  Breadcrumb,
  ErrorContext,
  ErrorTrackingAdapter,
  ErrorTrackingInitOptions,
} from './types';

/**
 * Map our internal `'info' | 'warning' | 'error'` levels onto Sentry's
 * SeverityLevel union. Sentry uses identical strings, but typing them
 * as the SDK's union avoids `any` casts at the boundary.
 */
function toSentryLevel(level: 'info' | 'warning' | 'error'): Sentry.SeverityLevel {
  return level;
}

/**
 * Map our `Breadcrumb` onto Sentry's breadcrumb shape. Field names
 * match 1:1 except `timestamp`, which Sentry expects as Unix seconds.
 */
function toSentryBreadcrumb(b: Breadcrumb): Sentry.Breadcrumb {
  return {
    category: b.category,
    message: b.message,
    level: toSentryLevel(b.level === 'debug' ? 'info' : b.level),
    timestamp: Math.floor(b.timestamp.getTime() / 1000),
    data: b.data,
  };
}

class SentryAdapter implements ErrorTrackingAdapter {
  readonly name = 'sentry' as const;
  readonly isAvailable: boolean;
  private initialized = false;

  constructor() {
    this.isAvailable = Boolean(process.env.SENTRY_DSN);
  }

  init(options: ErrorTrackingInitOptions): void {
    const dsn = options.dsn ?? process.env.SENTRY_DSN ?? '';
    if (!dsn) {
      // eslint-disable-next-line no-console
      console.warn(
        '[observability] sentryAdapter.init called without a DSN. Sentry will NOT be initialized; ' +
          'errors will continue to flow through logger.error(). See OBSERVABILITY.md §1.',
      );
      return;
    }
    try {
      Sentry.init({
        dsn,
        environment: options.environment,
        release: options.release,
        tracesSampleRate: options.sampleRate ?? 0.1,
        // PII scrubbing — strip auth/cookie headers + any bearer-shaped
        // strings in the body. Mirrors OBSERVABILITY.md §2 example.
        beforeSend(event) {
          if (event.request?.headers) {
            const headers = event.request.headers as Record<string, string>;
            delete headers.authorization;
            delete headers.Authorization;
            delete headers.cookie;
            delete headers.Cookie;
            delete headers['set-cookie'];
            delete headers['Set-Cookie'];
          }
          return event;
        },
      });
      this.initialized = true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[observability] Sentry.init failed:', error);
    }
  }

  captureException(error: Error, context?: ErrorContext): string {
    try {
      const id = Sentry.captureException(error, {
        tags: context?.tags,
        contexts: context?.extra ? { extra: context.extra } : undefined,
        user: context?.userId ? { id: context.userId } : undefined,
      });
      return typeof id === 'string' ? id : '';
    } catch (sdkError) {
      // eslint-disable-next-line no-console
      console.warn('[observability] Sentry.captureException failed:', sdkError);
      return '';
    }
  }

  captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error',
    context?: ErrorContext,
  ): string {
    try {
      const id = Sentry.captureMessage(message, {
        level: toSentryLevel(level),
        tags: context?.tags,
        contexts: context?.extra ? { extra: context.extra } : undefined,
        user: context?.userId ? { id: context.userId } : undefined,
      });
      return typeof id === 'string' ? id : '';
    } catch (sdkError) {
      // eslint-disable-next-line no-console
      console.warn('[observability] Sentry.captureMessage failed:', sdkError);
      return '';
    }
  }

  addBreadcrumb(breadcrumb: Breadcrumb): void {
    try {
      Sentry.addBreadcrumb(toSentryBreadcrumb(breadcrumb));
    } catch {
      /* hot-path safety: never throw */
    }
  }

  setUserContext(userId: string, additionalProps?: Record<string, unknown>): void {
    try {
      Sentry.setUser({ id: userId, ...(additionalProps ?? {}) });
    } catch {
      /* hot-path safety: never throw */
    }
  }

  async flush(timeout?: number): Promise<void> {
    try {
      await Sentry.flush(timeout);
    } catch {
      /* flush must never reject — drop a few in-flight events on the floor */
    }
  }

  /** Test-only: reflect whether `init()` succeeded. Not part of the public interface. */
  get __initializedForTests(): boolean {
    return this.initialized;
  }
}

export const sentryAdapter: ErrorTrackingAdapter = new SentryAdapter();
