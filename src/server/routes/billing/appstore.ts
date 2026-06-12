// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// App Store Server Notifications (SSN v2) domain route, moved VERBATIM from
// `src/server/routes/billing.ts` (handler untouched — imports only):
//   • POST /api/billing/webhook/apple
//
// The synchronous App Store receipt-validation stub lives in
// `./iapReceipts.ts` (Sprint 21 Bucket T pair with the Google Play one).

import type { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';

// Sprint 28 Bucket B3 — transversal Zod validation factory. See
// src/server/middleware/validate.ts for the contract.
import { validate } from '../../middleware/validate.js';
import { logger } from '../../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing on the billing dispatch path.
import { tracedAsync } from '../../../services/observability/tracing.js';
import { withIdempotency } from '../../../services/billing/idempotency.js';
import { auditServerEvent } from '../../middleware/auditLog.js';
import {
  verifyAndDecodeAppleSsn,
  applyAppleEntitlement,
  buildAppleSsnAuditRow,
  AppleSsnVerificationError,
} from '../../../services/billing/appleSsn.js';
import { sentryCapture } from './shared.js';

// ────────────────────────────────────────────────────────────────────────────
// POST /api/billing/webhook/apple — App Store Server Notifications v2.
//
// Sprint 27 audit P0 fix H2 — closes the iOS entitlement gap. Apple
// posts `{ signedPayload: "<JWS>" }`; we verify the JWS, decode the
// nested transactionInfo / renewalInfo blobs, and dispatch to the
// shared entitlement helper in services/billing/appleSsn.ts.
//
// Mirrors the Google Play RTDN handler at /api/billing/webhook:
//   • idempotent on Apple's `notificationUUID` via `processed_apple_ssn`
//     (using the same `withIdempotency` lock-then-complete helper),
//   • ALWAYS ACK 200 except when the JWS itself fails verification
//     (401) — Apple retries on 5xx for ~24h; we suppress retries for
//     anything we've already accepted by writing the lock doc,
//   • writes `apple_ssn_attempts/{auto}` for every accepted
//     notification with `verified_chain: false` (intermediate mode —
//     see the file header in services/billing/appleSsn.ts for the
//     follow-up to ship full Apple Root G3 chain verification).
//
// Why no shared-secret token like the RTDN handler? Apple SSN v2 is
// authenticated via the JWS signature alone — Apple's docs explicitly
// recommend AGAINST adding a query-string token because it ends up in
// CDN logs. The cryptographic signature is the auth boundary.
// ────────────────────────────────────────────────────────────────────────────
// Sprint 28 Bucket B3 — Zod-gated payload before JWS verify.
// Sprint 29 H17: legacy `typeof signedPayload !== 'string'` guard removed
// — Zod schema is the single source of truth for shape.
const appleWebhookSchema = z.object({
  signedPayload: z.string().min(1),
});

export function registerAppleSsnRoutes(billingApiRouter: Router): void {
  billingApiRouter.post('/webhook/apple', validate(appleWebhookSchema), async (req, res) => {
    const { signedPayload } = req.body as { signedPayload: string };

    let verifiedChain = false;
    let payload;
    try {
      const verified = await verifyAndDecodeAppleSsn(signedPayload);
      payload = verified.payload;
      verifiedChain = verified.verifiedChain;
    } catch (err) {
      if (err instanceof AppleSsnVerificationError) {
        // Auth failure — never ACK 200 on these. Apple WILL retry,
        // but a forged-JWS replay in a tight loop would be a DoS we
        // want to drop hard.
        logger.warn('apple_ssn_verification_failed', { reason: err.message });
        return res.status(401).json({ error: 'invalid_signature' });
      }
      logger.error('apple_ssn_verify_unexpected', err);
      sentryCapture(err, { endpoint: '/api/billing/webhook/apple', tags: { method: 'POST', phase: 'verify' } });
      return res.status(500).json({ error: 'verify_failed' });
    }

    const db = admin.firestore();

    try {
      const outcome = await withIdempotency(
        db,
        { collection: 'processed_apple_ssn', key: payload.notificationUUID },
        async () => {
          logger.info('apple_ssn_received', {
            notificationType: payload.notificationType,
            subtype: payload.subtype ?? null,
            notificationUUID: payload.notificationUUID,
            // Never log the inner JWTs or appAccountToken — both are
            // bearer-equivalent material in the App Store Server API.
          });

          const result = await tracedAsync(
            'billing.webhook.apple',
            {
              notificationType: payload.notificationType ?? null,
              subtype: payload.subtype ?? null,
              verifiedChain,
            },
            () => applyAppleEntitlement({
              payload,
              db: db as any,
            }),
          );

          await db
            .collection('apple_ssn_attempts')
            .add(buildAppleSsnAuditRow({ payload, result, verifiedChain }));

          return { ok: true, action: result.action, userId: result.userId };
        },
      );

      if (outcome.kind === 'in-flight') {
        logger.info('apple_ssn_in_progress_skip', {
          notificationUUID: payload.notificationUUID,
        });
      } else if (outcome.kind === 'stale-retry') {
        logger.warn('apple_ssn_stale_lock_stealing', {
          notificationUUID: payload.notificationUUID,
        });
      }

      // Sprint 28 H18 — audit replay vs success for Apple SSN webhooks.
      if (outcome.kind === 'duplicate') {
        await auditServerEvent(req, 'billing.webhook.replay', 'billing', {
          replay: true,
          source: 'apple',
          txn: payload.notificationUUID,
          notificationType: payload.notificationType,
        }).then((ok: boolean) => {
          // P0 informe 2026-06-12: auditServerEvent nunca lanza — boolean.
          if (!ok) logger.error('billing_audit_write_failed', new Error('audit_write_failed'), { event: 'billing.webhook.replay', source: 'apple', txn: payload.notificationUUID });
        });
      } else if (
        outcome.kind === 'fresh-success' ||
        outcome.kind === 'stale-retry'
      ) {
        await auditServerEvent(req, 'billing.webhook.success', 'billing', {
          source: 'apple',
          txn: payload.notificationUUID,
          notificationType: payload.notificationType,
          outcome: outcome.kind,
        }).then((ok: boolean) => {
          if (!ok) logger.error('billing_audit_write_failed', new Error('audit_write_failed'), { event: 'billing.webhook.success', source: 'apple', txn: payload.notificationUUID });
        });
      }

      // All four outcomes ACK 200 — see contract notes in idempotency.ts.
      return res.status(200).json({ ok: true });
    } catch (error) {
      logger.error('apple_ssn_webhook_failed', error, {
        notificationUUID: payload.notificationUUID,
      });
      sentryCapture(error, { endpoint: '/api/billing/webhook/apple', tags: { method: 'POST', notificationUUID: payload.notificationUUID } });
      return res.status(500).json({ error: 'webhook_processing_failed' });
    }
  });
}
