// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Per-route rate limiters extracted from server.ts. Each limiter is a thin
// `express-rate-limit` instance with route-appropriate `max` and key strategy.
//
//   • geminiLimiter — stricter per-uid bucket for expensive AI calls
//     (/api/gemini, /api/ask-guardian). 30 req / 15 min keyed on uid.
//   • invoiceStatusLimiter — per-uid polling bucket for /api/billing/invoice/:id.
//     Pricing.tsx polls at ~1Hz while waiting for payment; 600 req / 15 min â‰ˆ
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
// peers. Without it, express-rate-limit â‰¥7.5 fires its `ERR_ERL_KEY_GEN_IPV6`
// validation error (a bare `req.ip` lets IPv6 users bypass per-IP buckets
// because each /128 looks unique). After this change a server restart no
// longer logs the `ERR_ERL_KEY_GEN_IPV6` warning.
import rateLimit, { ipKeyGenerator, type Store } from 'express-rate-limit';
import type { Request } from 'express';
import admin from 'firebase-admin';
import { makeLazyFirestoreRateLimitStore } from '../rateLimit/firestoreRateLimitStore.js';

// ─────────────────────────────────────────────────────────────────────────
// Multi-replica IA spend cap (audit: ia-limiters-store).
//
// `geminiLimiter`, `b2dFreeLimiter` y `geminiGlobalDailyLimiter` controlan
// gasto de IA. Con MemoryStore default, cada réplica de Cloud Run lleva su
// PROPIO contador → el presupuesto efectivo es N× (N = número de pods). Para
// el cap GLOBAL diario eso es especialmente grave: el límite "1000 req/día
// total" se vuelve "1000 × N".
//
// Igual que `server.ts` hace con los limiters `csp:` / `api:`, montamos un
// store Firestore (transaccional, compartido entre pods) con prefijo propio
// por limiter — express-rate-limit exige un store por limiter, NO se pueden
// compartir instancias.
//
// Diferencia clave vs. `server.ts`: estos singletons se construyen al EVALUAR
// el módulo (import time), y los routers que los importan (gemini, b2d) son
// imports estáticos de `server.ts`, así que este módulo corre ANTES de
// `admin.initializeApp()`. Por eso usamos `makeLazyFirestoreRateLimitStore`,
// que difiere `admin.firestore()` al primer request (cuando Admin ya existe).
//
// Fallback dev: en dev single-process Admin no se inicializa (sin
// credenciales), y un store Firestore perezoso fallaría-soft en CADA request
// (totalHits:1 siempre → el limiter NUNCA dispara). Eso es PEOR que el
// MemoryStore default, que al menos cuenta dentro del único proceso. Por eso
// solo adjuntamos el store Firestore cuando esperamos Admin: en producción
// `server.ts` GARANTIZA `admin.initializeApp()` (si falla, `process.exit(1)`).
// En no-producción devolvemos `undefined` → MemoryStore (correcto single-proc).
//
// Test override: PRAEVENTIO_FORCE_IA_FS_STORE=1 fuerza el store Firestore para
// poder pinear la inyección en tests sin levantar NODE_ENV=production.
// ─────────────────────────────────────────────────────────────────────────
export function makeIaRateLimitStore(prefix: string): Store | undefined {
  const expectAdmin =
    process.env.NODE_ENV === 'production' ||
    process.env.PRAEVENTIO_FORCE_IA_FS_STORE === '1';
  if (!expectAdmin) return undefined;
  // `FirestoreRateLimitStore` ahora declara `implements Store`, así que el
  // handle es directamente asignable al contrato de express-rate-limit — sin
  // doble cast `as unknown as Store`.
  return makeLazyFirestoreRateLimitStore(
    () => {
      // Resuelto per-request (no en import time): para entonces `server.ts`
      // ya corrió `admin.initializeApp()`. Si por algún motivo no está listo,
      // lanzamos y el store lo atrapa fail-soft (deja pasar el request — mejor
      // que tumbar la app si Firestore parpadea).
      if (admin.apps.length === 0) {
        throw new Error('firebase-admin not initialized — IA limiter store unavailable');
      }
      return admin.firestore();
    },
    { prefix },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared keyGenerator strategies. Extracted (2026-05-29) from the inline
// copies that were repeated verbatim across the limiters below. Behavior is
// byte-identical — this is a pure DRY extraction whose only purpose is to make
// the branch logic (`req.user?.uid ||`, the IPv6-safe IP fallback, and the
// constant default) directly unit-testable. Inline arrows are invisible to
// unit tests because express-rate-limit closes over them; named exports are
// not. See limiters.test.ts for the per-branch coverage.
// ─────────────────────────────────────────────────────────────────────────

/** Per-uid bucket key; falls back to an IPv6-safe IP key, then 'anonymous'.
 *  Used by limiters mounted AFTER verifyAuth (uid is normally present). */
export function uidOrIpKey(req: Request): string {
  return req.user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous';
}

/** IP-only bucket key (unauthenticated endpoints), default 'anonymous'. */
export function ipOnlyKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '') || 'anonymous';
}

/** IP-only bucket key for the Google Play webhook; default 'unknown'. */
export function googlePlayWebhookKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '') || 'unknown';
}

/** B2D free-tier bucket key: the 12-char API-key prefix when a `Bearer pk_`
 *  key is present (keeps the bucket out of plaintext-secret territory while
 *  staying stable per key), otherwise the IPv6-safe IP key, then a default. */
export function b2dFreeKey(req: Request): string {
  const auth = req.header('authorization') ?? '';
  if (auth.startsWith('Bearer pk_')) {
    return auth.slice('Bearer '.length, 'Bearer '.length + 12);
  }
  return ipKeyGenerator(req.ip ?? '') || 'b2d-anonymous';
}

// Stricter per-user rate limit for expensive AI calls.
// Firestore-backed store (prefijo propio) para que el cap sea compartido entre
// réplicas de Cloud Run — sin esto cada pod tenía su propia cuota de 30.
export const geminiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: uidOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de consultas IA alcanzado. Intenta de nuevo en 15 minutos.' },
  store: makeIaRateLimitStore('gemini-uid:'),
});

// Per-user invoice-status polling rate limit. Pricing.tsx polls this
// endpoint at ~1Hz while waiting for a payment to settle, which would blow
// past the global /api/* limit (100 req / 15 min) in seconds. We bump to 600
// req / 15 min keyed on uid (â‰ˆ1 req/sec sustained) to support polling
// without inviting abuse. Pattern mirrors `geminiLimiter` above.
export const invoiceStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keyGenerator: uidOrIpKey,
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
  keyGenerator: uidOrIpKey,
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
  keyGenerator: uidOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_register_attempts', retryAfterMs: 60_000 },
});

// Sprint E backend debt (2026-05-16) — per-IP limiter for the public
// SUSESO verify endpoint (`GET /api/suseso/verify/:folio`). The route
// is UNAUTHENTICATED by design (anyone can verify a DIAT/DIEP folio
// signed by the empresa, that's the public-verifiability promise of
// the WebAuthn-signed PDF). But "anyone" includes attackers who would:
//
//   1. Enumerate folios sequentially to learn folio cardinality
//      (sensitivity: incident counts of an empresa). Folios are not
//      randomized in the current implementation — they're monotonic
//      per-tenant. Without rate-limiting, a sequential scan is trivial.
//   2. DoS the Firestore reads behind verifyFolio() — every miss is
//      still 1 read.
//
// 30 req/min per IP is well above any legitimate use case (a fiscalizador
// checking a single folio takes ~1 second). The window is 1 min so a
// burst doesn't lock out a legitimate user for long.
//
// We DO NOT cache responses inside the limiter — verifyFolio() is the
// canonical source-of-truth and may return revoked status as soon as
// the empresa cancels the folio.
export const susesoVerifyLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30,
  keyGenerator: ipOnlyKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { valid: false, reason: 'verify_rate_limited' },
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
  keyGenerator: googlePlayWebhookKey,
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
// keyGenerator can read `req.user.uid`. Falls back to req.ip â†’ 'anonymous'
// purely as a defensive default — under normal control flow `req.user.uid`
// is always set because verifyAuth would have rejected the request first.
export const zettelkastenWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: uidOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas escrituras de nodos. Intenta de nuevo en 15 minutos.' },
});

// Sprint 33 — per-uid rate limiter for POST /api/ai/feedback. The global
// /api/* bucket (100 req / 15 min) is too loose for the RLHF feedback
// surface: a Bearer-bearing attacker doesn't need high QPS to inflate the
// `up` count and skew the dataset (low-and-slow bias attack). The replay
// guard inside the handler stops same-`messageId` overwrites; this
// limiter bounds the rate at which DIFFERENT messageIds can be voted on
// from the same uid. 30 votes / 5 min is well above legitimate
// AsesorChat session traffic (a chatty user lands maybe 5–10 votes per
// session) while choking automated dataset poisoning. Mirrors the
// `zettelkastenWriteLimiter` shape; mounted AFTER `verifyAuth` so the
// keyGenerator can read `req.user.uid`.
export const aiFeedbackLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: uidOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ai_feedback_rate_limited', retryAfterMs: 5 * 60 * 1000 },
});

// Per-uid rate limiter for the ERP sync mock (POST /api/erp/sync).
// 30 req/min keyed on the authenticated uid (verifyAuth runs first, so
// req.user.uid is always present in the steady state); falls back to
// req.ip for safety. Tight enough to catch run-away clients without
// hampering legitimate batch syncs.
export const erpSyncLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: uidOrIpKey,
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
// MemoryStore in express-rate-limit â‰¥7.5 validates it against the
// signed-32-bit timer ceiling (~24.8 days, 2_147_483_647 ms). 30 days
// would crash the boot with ERR_ERL_WINDOW_MS. The window stays at 24 days
// even with the Firestore store below: the limiter is constructed
// unconditionally and falls back to MemoryStore in dev (no Admin), whose
// validator still runs at construction. Closing the last ~6 days to a true
// monthly window would need the MemoryStore path gone entirely.
//
// Firestore-backed store (prefijo propio): el cap free-tier de B2D ahora es
// compartido entre réplicas de Cloud Run. Antes, con MemoryStore default, cada
// pod permitía 1000 req → el cap real era 1000×N.
export const b2dFreeLimiter = rateLimit({
  windowMs: 24 * 24 * 60 * 60 * 1000, // 24-day rolling window — see note above
  max: parseInt(process.env.B2D_FREE_CAP ?? '1000', 10),
  keyGenerator: b2dFreeKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'b2d_free_cap_reached', resetAfterDays: 30 },
  store: makeIaRateLimitStore('b2d-free:'),
});

// Firestore-backed store (prefijo propio): el cap GLOBAL diario de IA es el más
// crítico de los tres — con MemoryStore default, "1000 req/día total" se volvía
// "1000 × N pods". El store compartido hace que TODO el tráfico (clave fija
// `gemini-global-bucket`) cuente contra un único contador en Firestore.
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
  store: makeIaRateLimitStore('gemini-global:'),
});
