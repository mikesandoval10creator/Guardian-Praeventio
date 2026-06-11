// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// Shared observability helper for the billing route modules. Moved VERBATIM
// from `src/server/routes/billing.ts` (it sat above the route definitions and
// was used by every provider handler). No behavior change — this split is
// movement-only because it touches the payment path.

import { getErrorTracker } from '../../../services/observability/index.js';

// Sentry capture helper — additive to logger.error. Wrapped so observability
// failures never crash the request path.
export function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}
