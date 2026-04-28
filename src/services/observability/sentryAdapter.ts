// Praeventio Guard — Sentry error tracking adapter (STUB ONLY).
//
// Sentry (https://sentry.io/) is the leading error tracker for Node + React.
// This stub mirrors the structure of every other adapter in the codebase —
// see `src/services/sii/openfacturaAdapter.ts` and
// `src/services/security/kmsAdapter.ts:CloudKmsAdapter` for the same pattern.
//
// Round 2 will:
//   1. `npm install @sentry/node @sentry/react`
//   2. Replace `init()` body with `Sentry.init({ dsn, environment, release, ... })`
//   3. Replace `captureException` with `Sentry.captureException(error, { contexts: { ... } })`
//   4. Wire `Sentry.Handlers.errorHandler()` into Express middleware (server.ts)
//   5. Wire `Sentry.ErrorBoundary` around the React root
//
// Until then `init()` and `captureException()` throw
// `ObservabilityNotImplementedError` so the stub's failure mode is loud and
// actionable. `addBreadcrumb` and `setUserContext` are no-ops because they
// must never throw on the request path — losing breadcrumbs is fine, killing
// a paying user's checkout because Sentry isn't installed is not.

import {
  ObservabilityNotImplementedError,
  type Breadcrumb,
  type ErrorContext,
  type ErrorTrackingAdapter,
  type ErrorTrackingInitOptions,
} from './types';

const SENTRY_INSTALL = 'npm install @sentry/node @sentry/react';

class SentryAdapter implements ErrorTrackingAdapter {
  readonly name = 'sentry' as const;
  readonly isAvailable: boolean;

  constructor() {
    this.isAvailable = Boolean(process.env.SENTRY_DSN);
  }

  init(_options: ErrorTrackingInitOptions): void {
    throw new ObservabilityNotImplementedError('Sentry', SENTRY_INSTALL);
  }

  captureException(_error: Error, _context?: ErrorContext): string {
    throw new ObservabilityNotImplementedError('Sentry', SENTRY_INSTALL);
  }

  captureMessage(
    _message: string,
    _level: 'info' | 'warning' | 'error',
    _context?: ErrorContext,
  ): string {
    throw new ObservabilityNotImplementedError('Sentry', SENTRY_INSTALL);
  }

  /**
   * Breadcrumb / user-context calls are typically fired from hot paths
   * (every request, every navigation). They MUST NOT throw — the stub
   * silently drops these so a request handler that adds a breadcrumb
   * before the SDK is wired up doesn't kill the response.
   *
   * Once the real SDK lands these become `Sentry.addBreadcrumb(...)`.
   */
  addBreadcrumb(_breadcrumb: Breadcrumb): void {
    /* noop until SDK is installed — see SENTRY_INSTALL */
  }

  setUserContext(_userId: string, _additionalProps?: Record<string, unknown>): void {
    /* noop until SDK is installed — see SENTRY_INSTALL */
  }

  async flush(_timeout?: number): Promise<void> {
    /* noop until SDK is installed — flush of an empty buffer is a no-op anyway */
  }
}

export const sentryAdapter: ErrorTrackingAdapter = new SentryAdapter();
