// Praeventio Guard — noopErrorTrackingAdapter browser stub.
//
// Vite resolve.alias redirects `./noopErrorTrackingAdapter` to this file
// in the browser bundle so the real Node `AsyncLocalStorage` import
// stays out of client. Server runtime resolves the real file normally
// (server.ts is NOT Vite-bundled).
//
// In the browser, observability calls land in `logger.error()` (the
// existing structured logger maps to console at INFO+ in dev), so
// errors are still surfaced — they just don't get the dedup/grouping
// that AsyncLocalStorage-based per-request user context would give on
// the server. Browser surfaces should also wire @sentry/react via
// `src/lib/sentry.ts` for proper client telemetry.

import { logger } from '../../utils/logger';
import type {
  Breadcrumb,
  ErrorContext,
  ErrorTrackingAdapter,
  ErrorTrackingInitOptions,
} from './types';

function noopEventId(): string {
  return `noop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Browser-only "ALS shim" — single mutable slot. Browsers are
// single-threaded per tab, so correct nesting of .run() invocations is
// all we need. NOT concurrency-safe across workers (a Web Worker has
// its own module instance anyway).
class SimpleStore<T> {
  private current: T | undefined = undefined;
  run<R>(store: T, fn: () => R): R {
    const previous = this.current;
    this.current = store;
    try {
      return fn();
    } finally {
      this.current = previous;
    }
  }
  getStore(): T | undefined {
    return this.current;
  }
}

const userContextStore = new SimpleStore<{
  userId?: string;
  props?: Record<string, unknown>;
}>();

export const noopErrorTrackingAdapter: ErrorTrackingAdapter = {
  name: 'noop',
  isAvailable: true,

  init(_options: ErrorTrackingInitOptions): void {
    logger.debug('observability:noop:init', {
      message: 'browser noopErrorTrackingAdapter active — events route to logger',
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
    const stored = userContextStore.getStore();
    if (stored) {
      stored.userId = userId;
      if (additionalProps) {
        stored.props = { ...stored.props, ...additionalProps };
      }
    }
  },

  async flush(_timeout?: number): Promise<void> {
    /* nothing to flush */
  },
};

// Tests import these — keep parity with the server file's surface.
export const __test__ = { userContextStore };
export function __resetNoopErrorTrackerStateForTests(): void {
  const stored = userContextStore.getStore();
  if (stored) {
    stored.userId = undefined;
    stored.props = undefined;
  }
}
