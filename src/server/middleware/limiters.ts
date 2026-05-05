// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Per-route rate limiters extracted from server.ts. Each limiter is a thin
// `express-rate-limit` instance with route-appropriate `max` and key strategy.
//
//   • geminiLimiter — stricter per-uid bucket for expensive AI calls
//     (/api/gemini, /api/ask-guardian). 30 req / 15 min keyed on uid.
//   • invoiceStatusLimiter — per-uid polling bucket for /api/billing/invoice/:id.
//     Pricing.tsx polls at ~1Hz while waiting for payment; 600 req / 15 min ≈
//     1 req/sec sustained, well above the global /api/* 100 req / 15 min cap.
//   • refereeLimiter — public-IP bucket for the unauthenticated referee
//     magic-link endpoints (/api/curriculum/referee/:token). 30 req / 15 min;
//     defends against token enumeration even though the tokens carry 256
//     bits of entropy.
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18 — these limiters are also imported
// by routes that remain inline in server.ts for now.

// Round 21 B4 (R20 R6 MEDIUM #2): pull in `ipKeyGenerator` so our custom
// keyGenerators can fall back to a properly normalized IP key for IPv6
// peers. Without it, express-rate-limit ≥7.5 fires its `ERR_ERL_KEY_GEN_IPV6`
// validation error (a bare `req.ip` lets IPv6 users bypass per-IP buckets
// because each /128 looks unique). After this change a server restart no
// longer logs the `ERR_ERL_KEY_GEN_IPV6` warning.
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

// Stricter per-user rate limit for expensive AI calls
export const geminiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => (req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de consultas IA alcanzado. Intenta de nuevo en 15 minutos.' },
});

// Per-user invoice-status polling rate limit. Pricing.tsx polls this
// endpoint at ~1Hz while waiting for a payment to settle, which would blow
// past the global /api/* limit (100 req / 15 min) in seconds. We bump to 600
// req / 15 min keyed on uid (≈1 req/sec sustained) to support polling
// without inviting abuse. Pattern mirrors `geminiLimiter` above.
export const invoiceStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keyGenerator: (req: Request) => (req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Polling muy frecuente. Intenta de nuevo en unos segundos.' },
});

// Stricter rate limit for the public referee endpoints — they are
// unauthenticated and the magic-link tokens, while 256 bits of entropy,
// should not be enumerable at unbounded rates.
export const refereeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
});

// Round 19 R6 (close-out of R18 R6 MEDIUM #1): per-uid rate limiter for
// POST /api/auth/webauthn/verify. The /verify endpoint already enforces
// single-use challenges + monotonic-counter replay prevention, but a
// flooding attacker who somehow obtained a valid Bearer token could still
// burn through challenges in a tight loop. A 5/min ceiling keyed on the
// authenticated uid (NOT the IP — many corporate users sit behind NAT)
// caps brute-force replay churn while leaving plenty of headroom for the
// legitimate ceremony, which sends one /verify per /challenge round-trip
// and is gated by user gesture (Touch ID / Face ID / security key tap).
//
// IMPORTANT: this limiter is mounted AFTER `verifyAuth` so the
// keyGenerator can read `req.user.uid` (set by verifyAuth). If routed
// before verifyAuth, every unauthenticated caller would share the same
// keyGenerator branch (req.ip), which would conflate honest 401-due-to-no-token
// traffic with abuse. Falls back to req.ip then 'anonymous' purely as a
// defensive default — under normal control flow `req.user.uid` is set
// because verifyAuth would have rejected the request otherwise.
export const webauthnVerifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute sliding window
  max: 5, // 5 verify attempts per uid per window
  keyGenerator: (req: Request) => (req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_verify_attempts', retryAfterMs: 60_000 },
});

// Round 20 R5 — per-uid rate limiter for the WebAuthn registration
// ceremony (POST /api/auth/webauthn/register/options + /verify). Tighter
// than `webauthnVerifyLimiter` (5/min) because registration is a rare
// event — a worker enrolls a security key once on a device, not 5 times
// per minute. 3/min keyed on the authenticated uid puts a hard ceiling
// on credential-storage thrash even if a Bearer token is compromised.
//
// The single-use challenge layer + idempotent `registerCredential()` keep
// the cryptographic line of defense; this limiter is just a request-rate
// ceiling that protects Firestore writes + spammy CBOR-decode CPU.
//
// IMPORTANT: mounted AFTER `verifyAuth` so the keyGenerator can read
// `req.user.uid` (set by verifyAuth). Falls back to req.ip then
// 'anonymous' purely as a defensive default — under normal control flow
// `req.user.uid` is always set because verifyAuth would have rejected
// the request otherwise.
export const webauthnRegisterLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute sliding window
  max: 3, // 3 register attempts per uid per window — tighter than verify
  keyGenerator: (req: Request) => (req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_register_attempts', retryAfterMs: 60_000 },
});

// Per-IP rate limiter for the Google Play RTDN webhook (POST
// /api/billing/webhook). The endpoint is already shared-secret gated
// (?token=) and idempotent on messageId, but a flooder who somehow
// learned the token could still burn Firestore reads/writes in a tight
// loop. 10 req/min keyed on remote IP is well above legitimate Pub/Sub
// push retry rates while capping abuse. We key on `req.ip` here (not
// uid) because Pub/Sub deliveries are unauthenticated — the gate is the
// shared secret, not a Bearer token.
export const googlePlayWebhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? '') || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// Sprint 11 — per-uid rate limiter for the Zettelkasten node-write
// endpoint (POST /api/zettelkasten/nodes). The 15 Bernoulli generators on
// the client (HazmatStorageDesigner, StructuralCalculator, VisionAnalyzer,
// BioAnalysis) emit nodes whenever the user changes inputs. With the
// 2-second debounce on the client a normal interactive session lands ~30
// writes / 15 min comfortably; bursty test sessions or a buggy debounce
// regression would still be capped here. Mirrors the geminiLimiter shape
// (30 req / 15 min, keyed on uid). Mounted AFTER `verifyAuth` so the
// keyGenerator can read `req.user.uid`. Falls back to req.ip → 'anonymous'
// purely as a defensive default — under normal control flow `req.user.uid`
// is always set because verifyAuth would have rejected the request first.
export const zettelkastenWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => (req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas escrituras de nodos. Intenta de nuevo en 15 minutos.' },
});

// Per-uid rate limiter for the ERP sync mock (POST /api/erp/sync).
// 30 req/min keyed on the authenticated uid (verifyAuth runs first, so
// req.user.uid is always present in the steady state); falls back to
// req.ip for safety. Tight enough to catch run-away clients without
// hampering legitimate batch syncs.
export const erpSyncLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req: Request) => (req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

/**
 * Round 22 R1 — global daily cap on /api/gemini and /api/ask-guardian
 * across ALL users. Per-uid limiter (geminiLimiter) caps individual abuse;
 * this caps aggregate spend regardless of who is calling.
 *
 * Default: 1000 req/day total. Override with GEMINI_DAILY_GLOBAL_CAP.
 *
 * Mounted BEFORE geminiLimiter on the router so the cheaper check runs
 * first on every request. When the cap is hit, returns 503 (Service
 * Unavailable) to signal it's a quota issue, not auth or rate-limit.
 */
/**
 * Sprint 23 Bucket BB — B2D free-tier limiter.
 *
 * Mounted at the root of the `/api/b2d/v1` surface BEFORE `b2dAuth`, so
 * even unauthenticated probes (or free-tier customers without a paid key)
 * are capped. The per-bucket key is the API key prefix when available,
 * falling back to the IP. Real paid tiers (`climate-base`, etc.) get their
 * MUCH higher per-tier rate limits enforced by `b2dAuth` + `quotaTracker`
 * after this limiter passes.
 *
 * Defaults: 1.000 req / 30 days per bucket. Override with B2D_FREE_CAP.
 * (1.000 was the cap floated by the user for free-tier in
 * `project_b2d_api_model.md`.)
 */
// Sprint 25 (CI fix) — windowMs is capped to 24 days because the
// MemoryStore in express-rate-limit ≥7.5 validates it against the
// signed-32-bit timer ceiling (~24.8 days, 2_147_483_647 ms). 30 days
// would crash the boot with ERR_ERL_WINDOW_MS. In production we'll
// lift this with a Redis store; for now the practical "free tier
// monthly cap" is 24 days, which is close enough to "monthly" for the
// integration probe path and lets CI smoke through cleanly.
export const b2dFreeLimiter = rateLimit({
  windowMs: 24 * 24 * 60 * 60 * 1000, // 24-day rolling window — see note above
  max: parseInt(process.env.B2D_FREE_CAP ?? '1000', 10),
  keyGenerator: (req: Request) => {
    const auth = req.header('authorization') ?? '';
    if (auth.startsWith('Bearer pk_')) {
      // Bucket per key prefix — matches the `keyPrefix` shape stored in
      // Firestore. Using just the prefix (12 chars) keeps the bucket key
      // out of plaintext-secret territory while staying stable per key.
      return auth.slice('Bearer '.length, 'Bearer '.length + 12);
    }
    return ipKeyGenerator(req.ip ?? '') || 'b2d-anonymous';
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'b2d_free_cap_reached', resetAfterDays: 30 },
});

export const geminiGlobalDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24h sliding window
  max: parseInt(process.env.GEMINI_DAILY_GLOBAL_CAP ?? '1000', 10),
  // KEY: shared key so ALL traffic counts against the same bucket
  keyGenerator: () => 'gemini-global-bucket',
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 503,
  message: {
    error: 'gemini_global_cap_reached',
    message: 'Cuota diaria global de IA alcanzada. Reintenta mañana o aumenta GEMINI_DAILY_GLOBAL_CAP.',
  },
  skipFailedRequests: true, // no contar requests fallados (4xx/5xx) hacia el cap
});
