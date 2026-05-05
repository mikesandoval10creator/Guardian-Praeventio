// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB — B2D usage tracking helper.
//
// Thin wrapper around `quotaTracker.trackGeminiUsage` so B2D routes can
// register a successful request with a single call. We piggy-back on the
// Gemini usage doc shape because it's the same per-tenant per-day
// counter; ops dashboards therefore show B2D + Gemini cost in one row.
//
// Cost convention: every B2D request counts as 1 unit. We pass costUsd=0
// because the API surface is sold by-quota, not by-token; the financial
// model is in `aiTier.calculateApiCost`. Counting requests (not tokens)
// keeps the daily ceiling aligned with `requestsPerMonth/30`.

import { trackGeminiUsage } from '../observability/quotaTracker.js';
import { logger } from '../../utils/logger.js';

/**
 * Increment the per-customer daily counter by 1 request. Failures are
 * swallowed — the request has already succeeded; we don't want to fail the
 * response just because Firestore is briefly unavailable.
 */
export async function trackB2dUsage(customerId: string, idempotencyKey?: string): Promise<void> {
  try {
    await trackGeminiUsage(customerId, 0, 0, {
      requests: 1,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  } catch (err) {
    logger.warn('[b2d.usage] trackB2dUsage failed', {
      customerId,
      error: (err as Error)?.message,
    });
  }
}
