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
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

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

/**
 * In-flight claim lifecycle. The cache doc is created BEFORE the handler
 * runs (atomic claim, first writer wins) and completed with the captured
 * response afterwards. P0 VIDA: without this, two concurrent requests with
 * the same key both observe a cache miss and both execute the handler —
 * double FCM fan-out for one SOS event.
 */
export const IDEMPOTENCY_STATE_IN_FLIGHT = 'in_flight';
export const IDEMPOTENCY_STATE_COMPLETED = 'completed';

/**
 * A claim older than this is considered abandoned (the owner crashed or the
 * process died between claim and response write) and may be taken over by a
 * fresh request instead of leaving the key 409-blocked forever.
 */
export const IN_FLIGHT_STALE_MS = 30_000;

/**
 * Same-process completion bridge for the pre-handler claim. The durable
 * Firestore row remains authoritative across instances; this map only lets a
 * request in the same Node process await the owner's already-running cache
 * completion instead of observing the transient in_flight row and returning
 * a false conflict during a sequential transport retry.
 */
const inFlightWrites = new Map<string, Promise<void>>();

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
  firestore?: () => Firestore;
}

interface CachedResponse {
  status: number;
  body: unknown;
  /**
   * Lifecycle marker: 'in_flight' while the handler runs, 'completed' once
   * the response has been captured. Docs written before this field existed
   * carry no state and are treated as completed.
   */
  state?: 'in_flight' | 'completed';
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
  expiresAt: Timestamp;
}

/** Sentry capture mirror used elsewhere in the middleware folder. */
function sentryCapture(
  err: unknown,
  context: { endpoint?: string; tags?: Record<string, string> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context,
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
  const firestore = opts.firestore ?? (() => getFirestore());

  return async function idempotencyKeyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const rawKey = (req.headers[IDEMPOTENCY_HEADER] ??
      req.get('Idempotency-Key')) as string | undefined;

    // Header absent â†’ request flows through normally. NO cache write.
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
        let entry = snap.data() as (CachedResponse & { claimedAtMs?: number }) | undefined;
        // ── In-flight claim guard (P0 VIDA): another request with this key
        // owns the claim and has not responded yet. If the owner is in this
        // process, await its completion and then re-read the durable row so a
        // sequential retry can replay instead of seeing a transient 409.
        if (entry?.state === IDEMPOTENCY_STATE_IN_FLIGHT) {
          const pending = inFlightWrites.get(cacheKey);
          if (pending) {
            await pending;
            const completed = await ref.get();
            entry = completed.exists
              ? (completed.data() as (CachedResponse & { claimedAtMs?: number }) | undefined)
              : undefined;
          }
          if (entry?.state === IDEMPOTENCY_STATE_IN_FLIGHT) {
            const claimedAtMs = typeof entry.claimedAtMs === 'number' ? entry.claimedAtMs : 0;
            const stale = now().getTime() - claimedAtMs > IN_FLIGHT_STALE_MS;
            if (!stale) {
              res.setHeader('Retry-After', '2');
              res.setHeader('Idempotency-State', IDEMPOTENCY_STATE_IN_FLIGHT);
              return res.status(409).json({ error: 'idempotency_in_flight' });
            }
            // Owner died before completing the response — release the stale
            // claim so this request can take it over below (fresh claim).
            try {
              await ref.delete();
            } catch {
              /* best effort — the claim create below guards the race */
            }
            entry = undefined;
          }
        }
        const data = entry as CachedResponse | undefined;
        if (data && data.expiresAt) {
          // Firestore TTL policy will eventually delete expired docs, but
          // we double-check on read so a TTL that hasn't run yet doesn't
          // hand back stale data.
          const expMs =
            typeof (data.expiresAt as { toMillis?: () => number }).toMillis === 'function'
              ? (data.expiresAt as { toMillis: () => number }).toMillis()
              : // legacy rows deserialized expiresAt as an ISO string / epoch
                // even though the static type says Timestamp — widen via
                // unknown (the toMillis guard above already handled the
                // Timestamp case).
                new Date(
                  data.expiresAt as unknown as string | number | Date,
                ).getTime();
          if (expMs > now().getTime()) {
            cached = data;
          }
        }
      }
    } catch (err) {
      // Cache lookup failed â†’ log+Sentry, fall through and run the handler
      // normally. Idempotency is a SAFETY net; failing it should never
      // break the actual request path.
      logger.warn?.('idempotency_cache_read_failed', {
        route: routeLabel,
        message: (err as Error)?.message,
      });
      sentryCapture(err, { endpoint: 'idempotencyKey.read', tags: { route: routeLabel } });
      return next();
    }

    // â”€â”€ Step 2: cache hit â†’ replay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Step 3: cache miss â†’ wrap res.json/.send to capture response â”€â”€
    // We monkey-patch `res.json` and `res.send` on a per-request basis
    // (NOT globally) so the handler stays untouched. Only 2xx responses
    // are cached: a 4xx/5xx is an error we want the client to be allowed
    // to retry against fresh state.

    // ── Step 3a: atomic claim — first writer wins (P0 VIDA) ──────────────
    // The cache doc is created HERE, before the handler runs, so a second
    // concurrent request with the same key cannot observe a miss and execute
    // the handler again (double fan-out). The loser gets a retryable 409;
    // once the winner's response is cached, the retry replays it.
    let claimed = false;
    try {
      claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        const claim = {
          state: IDEMPOTENCY_STATE_IN_FLIGHT,
          fingerprint,
          claimedAtMs: now().getTime(),
          expiresAt: Timestamp.fromMillis(now().getTime() + ttlSec * 1000),
        } as unknown as Record<string, unknown>;
        if (!fresh.exists) {
          tx.create(ref, claim);
          return true;
        }

        const existing = fresh.data() as
          | (CachedResponse & { claimedAtMs?: number })
          | undefined;
        const existingExpiry = existing?.expiresAt;
        const expiryMs =
          typeof (existingExpiry as { toMillis?: () => number } | undefined)?.toMillis === 'function'
            ? (existingExpiry as { toMillis: () => number }).toMillis()
            : new Date(
                existingExpiry as unknown as string | number | Date,
              ).getTime();
        const staleClaim =
          existing?.state === IDEMPOTENCY_STATE_IN_FLIGHT &&
          typeof existing.claimedAtMs === 'number' &&
          now().getTime() - existing.claimedAtMs > IN_FLIGHT_STALE_MS;
        if (expiryMs <= now().getTime() || staleClaim) {
          // A completed TTL-expired row or abandoned claim is reclaimable.
          // `set` replaces the old response so stale status/body cannot be
          // replayed while the new handler is running.
          tx.set(ref, claim);
          return true;
        }
        return false;
      });
    } catch (err) {
      // `create()` threw. Two very different cases:
      //   • ALREADY_EXISTS (code 6 / 'ALREADY_EXISTS') — another request won
      //     the claim race between our get() and create(). That is a normal
      //     loss: retryable 409, the winner will complete the cache row.
      //   • anything else — infrastructure failure. Fail OPEN like the cache
      //     read above: log and run the handler normally. Idempotency is a
      //     SAFETY net; failing it must never break the request path.
      const code = (err as { code?: number | string }).code;
      const isAlreadyExists =
        code === 6 ||
        code === 'ALREADY_EXISTS' ||
        /already exists/i.test((err as Error)?.message ?? '');
      if (isAlreadyExists) {
        res.setHeader('Retry-After', '2');
        res.setHeader('Idempotency-State', IDEMPOTENCY_STATE_IN_FLIGHT);
        return res.status(409).json({ error: 'idempotency_in_flight' });
      }
      logger.warn?.('idempotency_claim_failed', {
        route: routeLabel,
        message: (err as Error)?.message,
      });
      sentryCapture(err, { endpoint: 'idempotencyKey.claim', tags: { route: routeLabel } });
      return next();
    }
    if (!claimed) {
      // Lost the claim race to an in-flight (or just-completed) request.
      // Retryable: once the winner completes, the retry replays the response.
      res.setHeader('Retry-After', '2');
      res.setHeader('Idempotency-State', IDEMPOTENCY_STATE_IN_FLIGHT);
      return res.status(409).json({ error: 'idempotency_in_flight' });
    }

    let captured = false;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const writeCache = async (status: number, body: unknown) => {
      if (status < 200 || status >= 300) {
        // Non-2xx: do not cache the response (the client may retry against
        // fresh state) but DO release the claim so the retry is not stuck
        // behind an in-flight doc until the stale timeout.
        try {
          await ref.delete();
        } catch {
          /* best effort */
        }
        return;
      }
      if (captured) return;
      captured = true;
      const expiresMs = now().getTime() + ttlSec * 1000;
      const payload: CachedResponse = {
        status,
        body,
        headers: safeReplayHeaders(res),
        fingerprint,
        capturedAtMs: now().getTime(),
        expiresAt: Timestamp.fromMillis(expiresMs),
      };
      try {
        // Transaction: first writer wins. A second concurrent caller
        // who reaches this point sees the doc already exists and skips
        // its own write.
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(ref);
          const record = {
            ...payload,
            state: IDEMPOTENCY_STATE_COMPLETED,
          } as unknown as Record<string, unknown>;
          if (fresh.exists) {
            // Complete our own in-flight claim with the captured response.
            tx.update(ref, record as unknown as { [field: string]: any });
          } else {
            tx.set(ref, record);
          }
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

    let cacheWriteStarted = false;
    const trackCacheWrite = (body: unknown) => {
      if (cacheWriteStarted) return;
      cacheWriteStarted = true;
      const writePromise = writeCache(res.statusCode, body);
      inFlightWrites.set(cacheKey, writePromise);
      void writePromise.then(
        () => {
          if (inFlightWrites.get(cacheKey) === writePromise) {
            inFlightWrites.delete(cacheKey);
          }
        },
        () => {
          if (inFlightWrites.get(cacheKey) === writePromise) {
            inFlightWrites.delete(cacheKey);
          }
        },
      );
    };

    (res as any).json = (body: unknown) => {
      trackCacheWrite(body);
      return originalJson(body);
    };
    (res as any).send = (body: unknown) => {
      trackCacheWrite(body);
      return originalSend(body);
    };

    return next();
  };
}
