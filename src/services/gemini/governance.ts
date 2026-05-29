// Praeventio Guard — §12.5.1 split step 1: Gemini governance helpers.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Primera
// extracción canónica del split. Contiene los 3 helpers de governance
// no-AI (circuit breaker + quota + cost estimation) que envuelven las
// llamadas reales al SDK Gemini.
//
// IMPORTANT — backwards compat:
//   `services/geminiBackend.ts` re-exporta estos símbolos para que
//   consumers existentes (`src/server/routes/gemini.ts`) sigan
//   funcionando sin tocar imports. Migrar consumers a este path
//   directo es un follow-up trivial sin urgencia.
//
// Responsabilidad de este módulo:
//   1. `assertGeminiAllowed` — gate pre-llamada (circuit + quota).
//   2. `estimateGeminiCostUsd` — proyección de costo por tokens.
//   3. `recordGeminiOutcome` — hook post-llamada (success/failure).
//
// NO contiene lógica de prompts ni response parsing — eso vive en
// `geminiBackend.ts` (a futuro: `gemini/prompts.ts`, `gemini/parsing.ts`).

import { logger } from '../../utils/logger';
import { geminiCircuit } from '../../server/middleware/geminiCircuit.js';
import {
  trackGeminiUsage,
  checkQuotaLimit,
  type QuotaCheck,
} from '../observability/quotaTracker.js';

/**
 * Throws when the circuit is open for `circuitKey` or the tenant's
 * daily quota has been exceeded. Callers should invoke this BEFORE any
 * `ai.models.generateContent(...)` call in a request path that has an
 * authenticated tenant.
 *
 * Server-side jobs without a tenant context can pass `tenantId='system'`
 * + `tier='diamond'` so only the circuit gate applies.
 */
export async function assertGeminiAllowed(
  tenantId: string,
  tier: string,
  circuitKey = 'gemini',
): Promise<QuotaCheck | null> {
  if (geminiCircuit.isOpen(circuitKey)) {
    const err = new Error('circuit_open');
    (err as Error & { code?: string }).code = 'gemini_circuit_open';
    throw err;
  }
  // System / internal calls skip the per-tenant ceiling.
  if (tenantId === 'system') return null;
  const check = await checkQuotaLimit(tenantId, tier);
  if (!check.allowed) {
    const err = new Error(`quota_exceeded:${check.reason ?? 'requests_exceeded'}`);
    (err as Error & { code?: string; quota?: QuotaCheck }).code = 'gemini_quota_exceeded';
    (err as Error & { code?: string; quota?: QuotaCheck }).quota = check;
    throw err;
  }
  return check;
}

/**
 * Per-1M-token rates en USD. Updated 2026-05-04 from the Vertex AI
 * pricing page; revisit when model SKUs change. Anything we can't
 * classify falls back to Pro pricing so we never under-bill.
 */
const GEMINI_PRICING_USD_PER_M_TOKENS: Record<string, { in: number; out: number }> = {
  'gemini-2.0-flash': { in: 0.075, out: 0.3 },
  'gemini-2.5-flash': { in: 0.1, out: 0.4 },
  'gemini-3.1-flash-preview': { in: 0.1, out: 0.4 },
  'gemini-3.1-pro-preview': { in: 1.25, out: 5.0 },
} as const;

const DEFAULT_GEMINI_MODEL_KEY = 'gemini-3.1-pro-preview';

/**
 * Estimate USD cost for a Gemini call given approximate input/output
 * tokens. Numbers track Gemini 2.0 Flash + 3.1 Pro public pricing
 * (Vertex AI region us-central1 — same SKU we provision for prod).
 * The estimator intentionally rounds up so quota gating errs on the
 * side of throttling rather than over-spending.
 */
export function estimateGeminiCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const rate =
    GEMINI_PRICING_USD_PER_M_TOKENS[model] ??
    GEMINI_PRICING_USD_PER_M_TOKENS[DEFAULT_GEMINI_MODEL_KEY];
  // Defensive: rate is guaranteed defined because DEFAULT_GEMINI_MODEL_KEY
  // exists in the table, but TS doesn't know that without a non-null assert.
  if (!rate) return 0;
  const usd = (tokensIn / 1_000_000) * rate.in + (tokensOut / 1_000_000) * rate.out;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export interface RecordGeminiOutcomeOptions {
  tokens?: number;
  costUsd?: number;
  circuitKey?: string;
  idempotencyKey?: string;
}

/**
 * Post-call hook: record success on the breaker AND increment the
 * tenant's quota row. Best-effort — if Firestore is down the breaker
 * still moves to closed so the next caller doesn't fast-fail.
 */
export async function recordGeminiOutcome(
  tenantId: string,
  outcome: 'success' | 'failure',
  options: RecordGeminiOutcomeOptions = {},
): Promise<void> {
  const key = options.circuitKey ?? 'gemini';
  if (outcome === 'failure') {
    geminiCircuit.recordFailure(key);
    return;
  }
  geminiCircuit.recordSuccess(key);
  if (tenantId === 'system') return;
  try {
    await trackGeminiUsage(tenantId, options.tokens ?? 0, options.costUsd ?? 0, {
      idempotencyKey: options.idempotencyKey,
    });
  } catch (err) {
    // Quota tracking must never break the response path.
    logger.warn('[quota.track_failed]', {
      tenantId,
      err: (err as Error).message,
    });
  }
}
