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

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// Stricter per-user rate limit for expensive AI calls
export const geminiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => (req as any).user?.uid || req.ip || 'anonymous',
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
  keyGenerator: (req: Request) => (req as any).user?.uid || req.ip || 'anonymous',
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
  keyGenerator: (req: Request) => (req as any).user?.uid || req.ip || 'anonymous',
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
  keyGenerator: (req: Request) => (req as any).user?.uid || req.ip || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_register_attempts', retryAfterMs: 60_000 },
});
