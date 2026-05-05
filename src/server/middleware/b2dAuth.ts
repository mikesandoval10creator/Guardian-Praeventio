// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB — B2D API authentication middleware.
//
// Validates the `Authorization: Bearer pk_*` header carried by every B2D
// API request, resolves the customer + tier, and enforces:
//
//   1. Key existence + status (active, not expired).
//   2. Required scope (or `suite.all` blanket grant).
//   3. Per-tenant daily quota check against `quotaTracker`. The B2D layer
//      reuses the same backing collection so spend is visible from the
//      same ops dashboard as Gemini usage. Tier translation:
//        - `*-pro`  / `suite-pro`   → quotaTier 'gold'
//        - `*-base` / `suite-base`  → quotaTier 'silver'
//        - free / unknown            → quotaTier 'bronze'
//
// On success the request continues with `req.b2dKey` populated. The caller
// is then expected to call `trackB2dUsage(record)` (see usage.ts) AFTER
// the work completes so we only count successful requests against quota
// tail.
//
// Privacy boundary: this middleware NEVER reads tenant Zettelkasten data.
// The api key resolves to a customerId opaque to the rest of the system.

import type { Request, Response, NextFunction } from 'express';

import {
  verifyApiKey,
  type B2dApiKey,
  type B2dScope,
} from '../../services/b2d/apiKeyService.js';
import { checkQuotaLimit } from '../../services/observability/quotaTracker.js';
import { logger } from '../../utils/logger.js';

/** Express request augmentation — attached after a successful auth pass. */
export interface B2dRequest extends Request {
  b2dKey?: B2dApiKey;
}

/**
 * Returns an Express middleware that requires an active B2D API key with
 * the specified scope. Use one per route:
 *
 * ```ts
 * router.get('/climate/current', b2dAuth('climate.read'), handler);
 * ```
 */
export function b2dAuth(requiredScope: B2dScope) {
  return async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const auth = req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer pk_')) {
      return res.status(401).json({ error: 'missing_api_key' });
    }
    const rawKey = auth.slice('Bearer '.length).trim();
    if (!rawKey) {
      return res.status(401).json({ error: 'missing_api_key' });
    }

    let record: B2dApiKey | null = null;
    try {
      record = await verifyApiKey(rawKey);
    } catch (err) {
      logger.error('[b2dAuth] verifyApiKey threw', { error: (err as Error)?.message });
      return res.status(500).json({ error: 'auth_check_failed' });
    }

    if (!record) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }

    const hasScope =
      record.scopes.includes(requiredScope) || record.scopes.includes('suite.all');
    if (!hasScope) {
      return res.status(403).json({ error: 'scope_required', required: requiredScope });
    }

    // Quota gate (per-customer, per-day).
    let quota;
    try {
      quota = await checkQuotaLimit(record.customerId, record.tier);
    } catch (err) {
      logger.error('[b2dAuth] checkQuotaLimit threw', { error: (err as Error)?.message });
      return res.status(500).json({ error: 'quota_check_failed' });
    }

    if (!quota.allowed) {
      // Surface RateLimit-style headers so SDK clients can back off.
      res.setHeader('X-RateLimit-Limit', String(quota.limit));
      // Quota windows roll at UTC midnight.
      const resetEpoch = Math.floor(
        new Date(`${quota.usage.date}T23:59:59Z`).getTime() / 1000,
      );
      res.setHeader('X-RateLimit-Reset', String(resetEpoch));
      return res
        .status(429)
        .json({ error: 'quota_exceeded', tier: record.tier, reason: quota.reason });
    }

    // Communicate remaining budget on every successful request.
    if (Number.isFinite(quota.limit)) {
      res.setHeader('X-RateLimit-Limit', String(quota.limit));
      const remaining = Math.max(0, quota.limit - quota.usage.geminiRequests);
      res.setHeader('X-RateLimit-Remaining', String(remaining));
    }

    (req as B2dRequest).b2dKey = record;
    return next();
  };
}
