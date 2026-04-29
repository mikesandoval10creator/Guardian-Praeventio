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
