// Praeventio Guard — cloudErrorReportingAdapter browser stub.
//
// Same rationale as `sentryAdapter.browser-stub.ts`: Vite resolve.alias
// redirects `./cloudErrorReportingAdapter` to this file in the browser
// bundle so `@google-cloud/error-reporting` (Node-only) stays out of
// client. Server runtime resolves the real adapter.

import type {
  Breadcrumb,
  ErrorContext,
  ErrorTrackingAdapter,
  ErrorTrackingInitOptions,
} from './types';

export const cloudErrorReportingAdapter: ErrorTrackingAdapter = {
  name: 'cloud-error-reporting',
  isAvailable: false,

  init(_options: ErrorTrackingInitOptions): void {
    /* no-op */
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
