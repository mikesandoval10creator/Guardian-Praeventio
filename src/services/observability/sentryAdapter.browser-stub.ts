// Praeventio Guard — sentryAdapter browser stub.
//
// Vite resolve.alias redirects `./sentryAdapter` to this file in the
// browser bundle so the real `@sentry/node` adapter (which transitively
// imports `node:diagnostics_channel`, `node:async_hooks`, etc.) never
// reaches Rollup. Server runtime (server.ts is NOT Vite-bundled, it
// runs directly under tsx / Node) resolves the original `sentryAdapter.ts`
// normally.
//
// Browser-side, `@sentry/react` (src/lib/sentry.ts) is the canonical
// SDK — this stub exists ONLY so `services/observability/index.ts`
// can statically import a `sentryAdapter` symbol without dragging
// `@sentry/node` into the client bundle. Calls land in the noop
// adapter via `index.ts:getErrorTracker()` fallback because
// `isAvailable === false`.

import type {
  Breadcrumb,
  ErrorContext,
  ErrorTrackingAdapter,
  ErrorTrackingInitOptions,
} from './types';

export const sentryAdapter: ErrorTrackingAdapter = {
  name: 'sentry',
  // ALWAYS unavailable in browser. `getErrorTracker()` sees this and
  // falls back to noop, which routes through `logger`. Browser-side
  // user-visible errors should use `@sentry/react` directly via
  // `src/lib/sentry.ts`.
  isAvailable: false,

  init(_options: ErrorTrackingInitOptions): void {
    // No-op. The browser does not use the @sentry/node adapter.
  },

  captureException(_error: Error, _context?: ErrorContext): string {
    return '';
  },

  captureMessage(
    _message: string,
    _level: 'info' | 'warning' | 'error',
    _context?: ErrorContext,
  ): string {
    return '';
  },

  addBreadcrumb(_b: Breadcrumb): void {
    /* no-op */
  },

  setUserContext(_userId: string, _additionalProps?: Record<string, unknown>): void {
    /* no-op */
  },

  async flush(_timeout?: number): Promise<void> {
    /* no-op */
  },
};
