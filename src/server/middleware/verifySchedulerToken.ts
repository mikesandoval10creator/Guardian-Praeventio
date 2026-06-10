// SPDX-License-Identifier: MIT
// Sprint 27 (audit P0 H14) — gate Cloud Scheduler endpoints.
// Ola 1 (AUDIT-2026-06 B19) — accept Google OIDC identity tokens.
//
// Cloud Scheduler hits internal jobs with an OIDC token; on Cloud Run we
// can rely on per-service IAM to deny anonymous traffic. But when the
// service is deployed with `--allow-unauthenticated` (so the SPA + public
// /vault/share endpoints can reach it), the scheduler endpoints need an
// explicit auth gate at the application layer too — otherwise they
// become world-callable HTTP probes that can drain Firestore quotas or
// trigger maintenance reapers from anywhere.
//
// Two accepted credentials (either passes):
//   1. Shared bearer secret in `SCHEDULER_SHARED_SECRET` (Secret Manager),
//      compared constant-time. Useful for manual ops replays.
//   2. A Google-signed OIDC identity token whose `email` claim equals the
//      pinned scheduler service account. This is what deploy.yml actually
//      provisions (`gcloud scheduler jobs … --oidc-service-account-email`);
//      before this path existed every scheduled tick died with 401 and no
//      cron ever ran in production. The SA is pinned via
//      `SCHEDULER_SERVICE_ACCOUNT`, falling back to the deploy.yml default
//      `climate-scan-sa@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com`.
//      Audience must match `SCHEDULER_OIDC_AUDIENCE` (or the request's own
//      origin — Cloud Scheduler is provisioned with the service URL).
//      Pinning the exact SA email is what makes this safe: ANY service
//      account in ANY GCP project can mint an OIDC token with an arbitrary
//      audience, so a suffix check alone would be world-callable again.

import type { Request, RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { logger } from '../../utils/logger.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Module-level client: caches Google's public certs across invocations.
let oidcClient: OAuth2Client | null = null;
function getOidcClient(): OAuth2Client {
  if (!oidcClient) oidcClient = new OAuth2Client();
  return oidcClient;
}

/** Exact service-account email allowed to invoke scheduler endpoints, or
 * null when OIDC auth is unconfigurable in this environment. */
function pinnedServiceAccount(): string | null {
  const exact = process.env.SCHEDULER_SERVICE_ACCOUNT?.trim();
  if (exact) return exact.toLowerCase();
  const project = (
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    ''
  ).trim();
  if (project) return `climate-scan-sa@${project}.iam.gserviceaccount.com`;
  return null;
}

/** Audience the OIDC token must be minted for. deploy.yml provisions jobs
 * with `--oidc-token-audience=$URL` (the Cloud Run service URL), so the
 * request's own origin is the correct default; an explicit env wins. */
function expectedAudience(req: Request): string {
  const env = process.env.SCHEDULER_OIDC_AUDIENCE?.trim();
  if (env) return env;
  const proto = (req.header('x-forwarded-proto') ?? req.protocol ?? 'https')
    .split(',')[0]
    .trim();
  const host = (req.header('x-forwarded-host') ?? req.header('host') ?? '')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

async function isPinnedSchedulerOidc(req: Request, token: string): Promise<boolean> {
  const sa = pinnedServiceAccount();
  if (!sa) return false;
  try {
    const ticket = await getOidcClient().verifyIdToken({
      idToken: token,
      audience: expectedAudience(req),
    });
    const payload = ticket.getPayload();
    if (!payload) return false;
    const email = (payload.email ?? '').toLowerCase();
    if (payload.email_verified !== true || email !== sa) {
      logger.warn('verifySchedulerToken: OIDC token rejected (SA mismatch)', {
        presentedSa: email || '(none)',
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('verifySchedulerToken: OIDC verification failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Non-responding probe: true when the request carries a valid scheduler
 * credential (shared secret OR pinned-SA Google OIDC token). Exported for
 * composition (`verifySchedulerOrFallback`).
 */
export async function trySchedulerAuth(req: Request): Promise<boolean> {
  const auth = req.header('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!presented) return false;
  const secret = process.env.SCHEDULER_SHARED_SECRET ?? '';
  if (secret && safeEqual(presented, secret)) return true;
  // Only JWT-shaped bearers go down the OIDC path; this keeps the shared
  // secret out of Google's verifier and keeps non-JWT failures synchronous.
  if (presented.split('.').length === 3) return isPinnedSchedulerOidc(req, presented);
  return false;
}

/**
 * Express middleware that gates a route behind a scheduler credential.
 * Fails closed (503) when NEITHER auth method is configurable, so a
 * missing secret never silently exposes the endpoint.
 *
 * NOTE: deliberately not declared `async` — the shared-secret and
 * fail-closed paths resolve synchronously (existing callers/tests rely on
 * that); only the OIDC verification awaits.
 */
export const verifySchedulerToken: RequestHandler = (req, res, next) => {
  const secretConfigured = Boolean(process.env.SCHEDULER_SHARED_SECRET);
  const oidcConfigured = pinnedServiceAccount() !== null;
  if (!secretConfigured && !oidcConfigured) {
    logger.error(
      'verifySchedulerToken: no SCHEDULER_SHARED_SECRET nor pinnable scheduler SA — denying'
    );
    return res.status(503).json({ error: 'scheduler_token_not_configured' });
  }
  const auth = req.header('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!presented) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const secret = process.env.SCHEDULER_SHARED_SECRET ?? '';
  if (secret && safeEqual(presented, secret)) {
    req.schedulerInvocation = true;
    next();
    return undefined;
  }
  if (oidcConfigured && presented.split('.').length === 3) {
    void isPinnedSchedulerOidc(req, presented).then((ok) => {
      if (ok) {
        req.schedulerInvocation = true;
        next();
      } else {
        res.status(401).json({ error: 'unauthorized' });
      }
    });
    return undefined;
  }
  return res.status(401).json({ error: 'unauthorized' });
};

/**
 * Composition gate for endpoints that serve BOTH Cloud Scheduler and a
 * human operator (e.g. `/api/admin/replicate-critical`, weekly-digest and
 * climate-scan replays from the ops dashboard): scheduler credentials
 * short-circuit with `req.schedulerInvocation = true`; anything else is
 * delegated to the provided human-auth middleware (verifyAuth), after
 * which handlers keep enforcing their admin-role checks.
 */
export function verifySchedulerOrFallback(fallback: RequestHandler): RequestHandler {
  return (req, res, next) => {
    let settled = false;
    const once = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    void trySchedulerAuth(req)
      .then((ok) => {
        if (ok) {
          once(() => {
            req.schedulerInvocation = true;
            next();
          });
          return;
        }
        once(() => fallback(req, res, next));
      })
      .catch((err) => {
        logger.error('verifySchedulerOrFallback: unexpected failure', err);
        once(() =>
          res.status(500).json({
            error:
              process.env.NODE_ENV === 'production'
                ? 'Internal server error'
                : err instanceof Error
                  ? err.message
                  : String(err),
          })
        );
      });
  };
}
