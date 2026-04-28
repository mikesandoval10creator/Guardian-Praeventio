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
 * In-process user context. Real SDKs maintain this in async-local storage
 * so each request's context is isolated; the noop just keeps the last set
 * value as a single global because this adapter is only meant for dev/CI
 * and serial test runs.
 */
let currentUserContext: { userId?: string; props?: Record<string, unknown> } = {};

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
    logger.error('observability:captured-exception', error, {
      eventId: id,
      ...(currentUserContext.userId ? { userId: currentUserContext.userId } : {}),
      ...(context ?? {}),
    });
    return id;
  },

  captureMessage(message, level, context): string {
    const id = noopEventId();
    const meta = {
      eventId: id,
      ...(currentUserContext.userId ? { userId: currentUserContext.userId } : {}),
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
    currentUserContext = { userId, props: additionalProps };
  },

  async flush(_timeout?: number): Promise<void> {
    /* nothing to flush — events were written synchronously to logger */
  },
};

/**
 * Test-only helper. Resets the in-process user context so each test starts
 * clean. Mirrors `__resetNoopSiiAdapterStateForTests`.
 */
export function __resetNoopErrorTrackerStateForTests(): void {
  currentUserContext = {};
}
