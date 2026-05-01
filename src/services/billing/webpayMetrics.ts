// Praeventio Guard — Webpay return latency histogram emitter.
//
// Records the wall-clock latency of `/billing/webpay/return` so we can:
//
//   • Alert on p95 > 7 s (revenue path; user is staring at a redirect).
//   • Spot upstream Webpay flakiness (commit RPC slowdowns).
//   • Distinguish between successful commits, card declines, and
//     malformed/invalid token requests via the `outcome` label.
//
// Metric: `praeventio/webpay/return_latency_ms`
// Labels: `outcome` ∈ { 'success', 'failure', 'invalid' } — KEEP THIS
// LOW-CARDINALITY. NEVER add `userId`, `tokenWs`, `invoiceId`, or any
// per-request value to the labels — that explodes Cloud Monitoring's
// per-metric series cap (and cost). The label key MUST match the
// Terraform metric descriptor in `infrastructure/terraform/monitoring.tf`
// (resource `webpay_return_latency`) — descriptor labels are immutable
// post-apply, so this contract is fragile.
//
// The function is wrapped in `try { ... } catch` because it's called from
// the request hot path in `server.ts`. Any failure here MUST NOT break
// the user's checkout redirect — we degrade silently and log via the
// structured `logger.warn`. This mirrors the defensive policy used by
// `getErrorTracker()` / `getMetrics()` (see OBSERVABILITY.md §1).

import { logger } from '../../utils/logger';
import { getMetrics } from '../observability';

/**
 * Status classes for the Webpay return histogram. Mirror the three exit
 * paths in the `/billing/webpay/return` handler:
 *
 *   • 'success' — Webpay AUTHORIZED, invoice marked paid.
 *   • 'failure' — Webpay REJECTED (card decline) or FAILED (transient
 *                 infra error), or an exception propagated up to the
 *                 catch block.
 *   • 'invalid' — Missing or malformed `token_ws` query param (400).
 */
export type WebpayReturnOutcome = 'success' | 'failure' | 'invalid';

const HISTOGRAM_NAME = 'praeventio/webpay/return_latency_ms';

interface RecordOptions {
  outcome: WebpayReturnOutcome;
  latencyMs: number;
}

/**
 * Emit a single observation onto the Webpay return latency histogram.
 *
 * Defensive: NEVER throws. If the underlying metrics adapter is
 * unavailable, the call is logged at `warn` level and swallowed — the
 * caller (server.ts) MUST be able to fire-and-forget without a
 * try/catch wrapper at every call site.
 */
export function recordWebpayReturnLatency({
  outcome,
  latencyMs,
}: RecordOptions): void {
  try {
    getMetrics()
      .histogram(HISTOGRAM_NAME, { outcome })
      .observe(latencyMs);
  } catch (error) {
    // Observability path must never break the request.
    logger.warn('webpay_metric_emit_failed', {
      metric: HISTOGRAM_NAME,
      outcome,
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
