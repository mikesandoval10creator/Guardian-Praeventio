// Praeventio Guard — Noop error tracking adapter (dev / CI default).
//
// Routes every observability call through the existing structured logger
// (`src/utils/logger.ts`). No external dependency — works offline, in CI,
// and during local dev without any env config.
//
// Why this exists:
//   • Production deploys pick `sentry` or `cloud-error-reporting` via
//     `ERROR_TRACKER` env var; dev/CI default to `noop` so a missing DSN
//     never crashes the boot.
//   • The existing `logger.error()` already lands in Cloud Logging in
//     production, so even with `ERROR_TRACKER=noop` errors are still
//     captured — they just don't get the dedup/grouping/alert-routing of
//     a real error tracker.
//
// Mirrors the success-shaped fakes in `src/services/sii/siiAdapter.ts`
// (`noopSiiAdapter`) and `src/services/security/kmsAdapter.ts`
// (`noopKmsAdapter`).
//
// Per-request user context:
//   We use Node's built-in `AsyncLocalStorage` (node:async_hooks) so each
//   request's user context is isolated even when the runtime concurrently
//   serves multiple requests in the same process (Cloud Run + serverless).
//   See OBSERVABILITY.md §1 (Per-request user context with AsyncLocalStorage)
//   for the Express middleware integration pattern.

import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../../utils/logger';
import type {
  Breadcrumb,
  ErrorContext,
  ErrorTrackingAdapter,
  ErrorTrackingInitOptions,
} from './types';

/**
 * Build a deterministic-ish event ID for the noop adapter so callers that
 * round-trip the ID into API responses (`{ eventId }`) get something
 * non-empty. Format: `noop-<timestamp>-<rand>`.
 *
 * Not cryptographically random — this is dev/CI plumbing, not a token.
 */
function noopEventId(): string {
  return `noop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Per-request user context store. Real Sentry / Cloud Error Reporting SDKs
 * use the same primitive (AsyncLocalStorage) under the hood; we adopt it
 * here so:
 *
 *   1. The noop adapter is correct under serverless concurrency. Two
 *      simultaneous requests cannot leak each other's `userId` into the
 *      logs — each request lives in its own ALS scope.
 *   2. The contract matches what real adapters will offer in Round 2; no
 *      caller code changes when we swap in `sentryAdapter`.
 *
 * Express middleware wraps every request with
 *   `userContextStore.run({ userId, props }, () => next())`
 * and `setUserContext` becomes a no-op outside of a `.run(...)` scope (it
 * has nowhere to attach state — that's intentional). See OBSERVABILITY.md.
 */
const userContextStore = new AsyncLocalStorage<{
  userId?: string;
  props?: Record<string, unknown>;
}>();

export const noopErrorTrackingAdapter: ErrorTrackingAdapter = {
  name: 'noop',
  // Always available — that's the whole point. Dev/CI never has to gate
  // observability calls on `if (adapter.isAvailable)`.
  isAvailable: true,

  init(_options: ErrorTrackingInitOptions): void {
    // No SDK to initialize. Logged at debug level so a curious dev can
    // confirm the noop adapter is in fact what got picked.
    logger.debug('observability:noop:init', {
      message: 'noopErrorTrackingAdapter active — events route to logger',
    });
  },

  captureException(error: Error, context?: ErrorContext): string {
    const id = noopEventId();
    const stored = userContextStore.getStore();
    const userId = context?.userId ?? stored?.userId;
    logger.error('observability:captured-exception', error, {
      eventId: id,
      ...(userId ? { userId } : {}),
      ...(context ?? {}),
    });
    return id;
  },

  captureMessage(message, level, context): string {
    const id = noopEventId();
    const stored = userContextStore.getStore();
    const userId = context?.userId ?? stored?.userId;
    const meta = {
      eventId: id,
      ...(userId ? { userId } : {}),
      ...(context ?? {}),
    };
    if (level === 'error') {
      logger.error('observability:captured-message', new Error(message), meta);
    } else if (level === 'warning') {
      logger.warn('observability:captured-message', { message, ...meta });
    } else {
      logger.info('observability:captured-message', { message, ...meta });
    }
    return id;
  },

  addBreadcrumb(b: Breadcrumb): void {
    // Breadcrumbs are noisy in production logs (one per click, one per
    // HTTP call). Only mirror them to logger in non-production.
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('observability:breadcrumb', {
        category: b.category,
        level: b.level,
        message: b.message,
        timestamp: b.timestamp.toISOString(),
        data: b.data,
      });
    }
  },

  setUserContext(userId: string, additionalProps?: Record<string, unknown>): void {
    // For per-request isolation, attach onto the current ALS store if we're
    // inside a `userContextStore.run(...)` scope (started by the Express
    // middleware in OBSERVABILITY.md §1). If we're not in a scope (dev REPL,
    // unit tests that didn't wrap, scripts), this is a no-op — attempting to
    // create a global store retroactively would re-introduce the cross-
    // request leak we're trying to avoid.
    //
    // The Express middleware pattern is:
    //
    //   app.use((req, res, next) => userContextStore.run(
    //     { userId: req.user?.uid }, () => next()
    //   ));
    //
    // Inside that scope, additionalProps gets merged onto the existing
    // store entry so downstream `setUserContext` calls (e.g. when auth
    // upgrades from anon -> authed mid-request) are honoured.
    const stored = userContextStore.getStore();
    if (stored) {
      stored.userId = userId;
      if (additionalProps) {
        stored.props = { ...stored.props, ...additionalProps };
      }
    }
    // Outside an ALS scope: silently no-op. Logged at debug only when
    // explicitly in development to avoid noise in tests.
    else if (process.env.NODE_ENV === 'development') {
      logger.debug('observability:noop:setUserContext-outside-scope', {
        message:
          'setUserContext called without an active userContextStore.run() scope. ' +
          'Wrap request handlers in middleware. See OBSERVABILITY.md §1.',
      });
    }
  },

  async flush(_timeout?: number): Promise<void> {
    /* nothing to flush — events were written synchronously to logger */
  },
};

/**
 * Test-only export. Lets tests verify per-request behaviour by entering
 * the ALS scope explicitly via `userContextStore.run(...)`.
 *
 * Mirrors the `__test__` export pattern Sentry uses for its scope helpers.
 */
export const __test__ = { userContextStore };

/**
 * Test-only helper. Resets any ambient store (no-op when no `.run(...)` is
 * active, which is the common case). Mirrors `__resetNoopSiiAdapterStateForTests`.
 *
 * Kept as an export for backward compat with existing tests.
 */
export function __resetNoopErrorTrackerStateForTests(): void {
  // AsyncLocalStorage scopes auto-clean when their `.run(...)` callback
  // returns; nothing to reset here. The function exists so callers don't
  // have to be aware of the implementation change.
  const stored = userContextStore.getStore();
  if (stored) {
    stored.userId = undefined;
    stored.props = undefined;
  }
}
