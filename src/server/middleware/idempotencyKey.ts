// Praeventio Guard — Sprint 35 Bucket (Audit P1 §1.3).
//
// `idempotencyKey()` Express middleware. Stripe-pattern: a client may attach
// `Idempotency-Key: <opaque-token>` to any mutating route opt-in to the
// middleware. The first request executes the handler and we cache the
// resulting (status + headers + body) keyed by `(uid|tenantId, key)` for
// `ttlSec` seconds (default 24 h, Stripe convention). Subsequent requests
// with the same key replay the cached response WITHOUT re-running the
// handler — protecting flaky-mobile-network double-submits from creating
// duplicate crews / nodes / DTEs / aptitude certs.
//
// Why a NEW middleware instead of reusing `withIdempotency` (the lock-then-
// complete helper used by Google Play RTDN + Webpay)?
//
//   • `withIdempotency` is shaped for at-least-once webhook delivery: it
//     returns an `IdempotencyOutcome<T>` discriminated union the caller
//     branches on (`fresh-success` | `duplicate` | `in-flight` |
//     `stale-retry`). Every billing-webhook caller hand-codes the response
//     mapping. That's the right shape for webhooks because they need to
//     decide "do I 200 the producer to suppress redelivery, or 500 to make
//     them retry?".
//   • Authenticated mutating routes don't have a producer-redelivery
//     contract. They just need: "if I see this key again, return exactly
//     what I returned last time, don't run the handler". That's a thin
//     Express middleware shaped like Stripe's idempotency layer, with the
//     full Response replay (status + body + headers) handled here so
//     individual routes need only `idempotencyKey()` in the middleware
//     chain — no per-route response-replay code.
//
// Both helpers cache on Firestore and both honour TTL via Firestore TTL
// policy on `expiresAt` (configure once in the Firestore console for the
// `system_idempotency_cache` collection — same operator step as for the
// existing `processed_pubsub` / `processed_webpay` collections).
//
// Concurrency:
//   Two simultaneous requests with the same key both miss the cache, both
//   run the handler. We use `runTransaction` to claim the cache slot so
//   exactly one writes the captured response; the other races to write
//   first or no-ops (its handler-side effects already happened, so we
//   accept that "first write wins" is a soft guarantee, same as the
//   `withIdempotency` set-merge note). The post-handler write is the
//   point where a second concurrent caller sees the cache populated.
//   For STRICT serialization, place the rate-limiter middleware before
//   this one — concurrent dupes from a single client are already 429-d.
//
// Audit log fields:
//   • `idempotency.cache_hit`   — replay path, action runs ZERO times
//   • `idempotency.cache_write` — fresh path, response captured for replay
// Both rows carry { route, scope, key (hashed for PII), uid|tenantId }.
//
// Opt-in policy: middleware is applied per-route, NOT globally. A blanket
// app.use() would cache GETs (semantically wrong — GET responses can
// contain time-varying data) and webhook responses (already covered by
// `withIdempotency`). Keep the surface explicit.

import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';

/**
 * Default TTL for cached responses. Stripe uses 24 h — long enough for
 * a phone with intermittent connectivity to retry over multiple sessions,
 * short enough that a stale "ok" response can't pollute the user's view
 * of subscription / aptitude state forever.
 */
export const IDEMPOTENCY_DEFAULT_TTL_SEC = 24 * 60 * 60;

/** Firestore collection for the response cache. */
export const IDEMPOTENCY_CACHE_COLLECTION = 'system_idempotency_cache';

/** Header name (RFC-style — Stripe / IETF idempotency-key draft). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface IdempotencyKeyOptions {
  /** TTL for cached entries. Default 24 h. */
  ttlSec?: number;
  /**
   * Cache scope:
   *   • `uid`    — keys live under the authenticated user (default).
   *               Two different users sending the same key are isolated.
   *   • `tenant` — keys live under the user's tenantId (uid in the
   *               current single-tenant-per-uid model). Same-uid by
   *               construction; the alias exists so future multi-tenant
   *               rewrites have a one-line migration target.
   */
  scope?: 'uid' | 'tenant';
  /** Override the route label used in audit/logs. Defaults to `req.originalUrl`. */
  routeLabel?: string;
  /** Injected clock for tests. */
  now?: () => Date;
  /** Injected Firestore instance for tests. */
  firestore?: () => admin.firestore.Firestore;
}

interface CachedResponse {
  status: number;
  body: unknown;
  /**
   * Headers we replay. We deliberately filter out hop-by-hop / sensitive
   * headers at write time (see `safeReplayHeaders`); this is the typed
   * shape on read.
   */
  headers: Record<string, string>;
  /**
   * Captured request fingerprint (sha256 of method+path+body). On replay,
   * if the fingerprint mismatches, we 422 — Stripe's behaviour: same key
   * with different params is a client bug we refuse to silently mask.
   */
  fingerprint: string;
  capturedAtMs: number;
  expiresAt: admin.firestore.Timestamp;
}

/** Sentry capture mirror used elsewhere in the middleware folder. */
function sentryCapture(
  err: unknown,
  context: { endpoint?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    // Observability MUST NEVER break the request path.
    logger.warn?.('idempotency_sentry_capture_failed', { message: (e as Error)?.message });
  }
}

/**
 * Compose cache document id. Hash the user-provided key so PII / tokens
 * never land in Firestore document ids (which appear in admin tooling
 * URLs). Hash inputs include scope+id+rawKey so a key collision across
 * scopes is statistically impossible.
 */
function composeCacheKey(scopeId: string, rawKey: string): string {
  return createHash('sha256').update(`${scopeId}:${rawKey}`).digest('hex');
}

/**
 * Fingerprint = sha256(method + path + canonical-body-json). We use a
 * canonical JSON.stringify (object key sort) so re-ordered payloads from
 * different clients still hash equal.
 */
function computeFingerprint(req: Request): string {
  const method = (req.method ?? 'POST').toUpperCase();
  const path = req.originalUrl ?? req.url ?? '';
  let bodyStr = '';
  try {
    bodyStr = canonicalStringify(req.body ?? null);
  } catch {
    // Body not JSON-serializable — fall back to "" so the fingerprint is
    // still deterministic. Mismatches against a previously-cached call
    // will then trigger the 422 path, which is the safe direction.
    bodyStr = '';
  }
  return createHash('sha256').update(`${method}|${path}|${bodyStr}`).digest('hex');
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/** Allowed headers to capture+replay (lowercased). Sensitive / hop-by-hop excluded. */
const REPLAY_HEADER_ALLOWLIST = new Set([
  'content-type',
  'content-language',
  'cache-control',
  'location',
  'etag',
  'last-modified',
  'x-request-id',
]);

function safeReplayHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of REPLAY_HEADER_ALLOWLIST) {
    const v = res.getHeader(name);
    if (typeof v === 'string') out[name] = v;
    else if (typeof v === 'number') out[name] = String(v);
  }
  return out;
}

/**
 * Express middleware factory. Attach to a specific mutating route:
 *
 *   router.post('/checkout',
 *     verifyAuth,
 *     idempotencyKey(),
 *     async (req, res) => { ... });
 */
export function idempotencyKey(opts: IdempotencyKeyOptions = {}) {
  const ttlSec = opts.ttlSec ?? IDEMPOTENCY_DEFAULT_TTL_SEC;
  const scope = opts.scope ?? 'uid';
  const now = opts.now ?? (() => new Date());
  const firestore = opts.firestore ?? (() => admin.firestore());

  return async function idempotencyKeyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const rawKey = (req.headers[IDEMPOTENCY_HEADER] ??
      (req.headers as any)['Idempotency-Key']) as string | undefined;

    // Header absent → request flows through normally. NO cache write.
    if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      return next();
    }

    // Defensive bound: refuse absurdly long keys (DoS guard against a
    // client that stuffs an entire payload into the header).
    if (rawKey.length > 256) {
      return res.status(400).json({ error: 'idempotency_key_too_long' });
    }

    const user = req.user as { uid?: string; tenantId?: string } | undefined;
    if (!user || !user.uid) {
      // verifyAuth must run BEFORE this middleware. If we got here without
      // a uid the route is misconfigured — fail closed.
      return res.status(401).json({ error: 'idempotency_key_requires_auth' });
    }

    const scopeId = scope === 'tenant' ? user.tenantId ?? user.uid : user.uid;
    const cacheKey = composeCacheKey(scopeId, rawKey);
    const fingerprint = computeFingerprint(req);
    const routeLabel = opts.routeLabel ?? req.originalUrl ?? req.url ?? 'unknown';

    const db = firestore();
    const ref = db.collection(IDEMPOTENCY_CACHE_COLLECTION).doc(cacheKey);

    // â”€â”€ Step 1: read existing cache entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let cached: CachedResponse | undefined;
    try {
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data() as CachedResponse | undefined;
        if (data && data.expiresAt) {
          // Firestore TTL policy will eventually delete expired docs, but
          // we double-check on read so a TTL that hasn't run yet doesn't
          // hand back stale data.
          const expMs =
            typeof (data.expiresAt as any).toMillis === 'function'
              ? (data.expiresAt as any).toMillis()
              : new Date(data.expiresAt as any).getTime();
          if (expMs > now().getTime()) {
            cached = data;
          }
        }
      }
    } catch (err) {
      // Cache lookup failed → log+Sentry, fall through and run the handler
      // normally. Idempotency is a SAFETY net; failing it should never
      // break the actual request path.
      logger.warn?.('idempotency_cache_read_failed', {
        route: routeLabel,
        message: (err as Error)?.message,
      });
      sentryCapture(err, { endpoint: 'idempotencyKey.read', tags: { route: routeLabel } });
      return next();
    }

    // â”€â”€ Step 2: cache hit → replay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        // Same key, different request body. Stripe returns 422; we mirror.
        logger.warn?.('idempotency_fingerprint_mismatch', {
          route: routeLabel,
          uid: user.uid,
        });
        return res.status(422).json({
          error: 'idempotency_key_reused_with_different_params',
        });
      }
      logger.info?.('idempotency.cache_hit', {
        route: routeLabel,
        uid: user.uid,
        scope,
      });
      for (const [name, value] of Object.entries(cached.headers ?? {})) {
        try {
          res.setHeader(name, value);
        } catch {
          /* ignore header set errors during replay */
        }
      }
      res.setHeader('Idempotent-Replayed', 'true');
      return res.status(cached.status).send(cached.body);
    }

    // â”€â”€ Step 3: cache miss → wrap res.json/.send to capture response â”€â”€
    // We monkey-patch `res.json` and `res.send` on a per-request basis
    // (NOT globally) so the handler stays untouched. Only 2xx responses
    // are cached: a 4xx/5xx is an error we want the client to be allowed
    // to retry against fresh state.

    let captured = false;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const writeCache = async (status: number, body: unknown) => {
      if (status < 200 || status >= 300) return;
      if (captured) return;
      captured = true;
      const expiresMs = now().getTime() + ttlSec * 1000;
      const payload: CachedResponse = {
        status,
        body,
        headers: safeReplayHeaders(res),
        fingerprint,
        capturedAtMs: now().getTime(),
        expiresAt: admin.firestore.Timestamp.fromMillis(expiresMs),
      };
      try {
        // Transaction: first writer wins. A second concurrent caller
        // who reaches this point sees the doc already exists and skips
        // its own write.
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(ref);
          if (fresh.exists) return; // race lost, that's fine
          tx.set(ref, payload as unknown as Record<string, unknown>);
        });
        logger.info?.('idempotency.cache_write', {
          route: routeLabel,
          uid: user.uid,
          scope,
          status,
        });
      } catch (err) {
        // Cache write failed: handler already produced a response, so we
        // MUST NOT throw. Log + Sentry. Worst case is a duplicate run on
        // the next retry, which is the same risk as no-idempotency-at-all.
        logger.warn?.('idempotency_cache_write_failed', {
          route: routeLabel,
          uid: user.uid,
          message: (err as Error)?.message,
        });
        sentryCapture(err, { endpoint: 'idempotencyKey.write', tags: { route: routeLabel } });
      }
    };

    (res as any).json = (body: unknown) => {
      // Fire-and-forget: do not await before letting the response go out.
      // The cache write is best-effort post-response side effect.
      void writeCache(res.statusCode, body);
      return originalJson(body);
    };
    (res as any).send = (body: unknown) => {
      void writeCache(res.statusCode, body);
      return originalSend(body);
    };

    return next();
  };
}
