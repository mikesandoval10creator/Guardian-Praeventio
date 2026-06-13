// Real-router supertest pinning the Bucket X under-billing fix on /api/gemini.
//
// THE BUG (before this fix): the dispatcher's post-call quota accounting
// charged EVERY whitelisted RPC at `AI_MODEL_FAST_STABLE` (the cheapest Flash
// SKU), even for actions that run on `AI_MODEL_REASONING` (Gemini Pro, ~17× the
// per-token rate). That under-meters real spend and lets a tenant blow past
// their cost ceiling before the quota gate trips.
//
// THE CONTRACT pinned here: with an IDENTICAL flat token estimate (same args +
// same result size for both actions), a REASONING-backed action
// (`analyzeRiskCorrelations` → predictionBackend) must be billed strictly more
// than a FLASH-backed action (`getNutritionSuggestion` → AI_MODEL_FAST_STABLE).
//
// We exercise the REAL router + the REAL `estimateGeminiCostUsd` (pure pricing
// from gemini/governance.ts) and capture the `costUsd` the dispatcher passes to
// `recordGeminiOutcome`. Only the per-SKU RATE differs between the two calls —
// the token estimate is held constant by returning the same backend payload.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  assertAllowed: vi.fn(),
  record: vi.fn(),
  // Fixed payload so the flat token estimate is IDENTICAL across actions —
  // isolating the model RATE as the only variable in costUsd.
  backendResult: { ok: true, note: 'fixed-size-payload' } as unknown,
}));

// Partially mock geminiBackend.js: keep the REAL pure pricing
// (`estimateGeminiCostUsd`) so the model→rate mapping is exercised for real,
// but stub the gate, the recorder (to capture costUsd) and the dispatched
// action handlers (no real LLM call).
vi.mock('../../services/geminiBackend.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/geminiBackend.js')>(
    '../../services/geminiBackend.js',
  );
  const handler = async () => H.backendResult;
  return {
    assertGeminiAllowed: (...a: unknown[]) => H.assertAllowed(...a),
    recordGeminiOutcome: (...a: unknown[]) => H.record(...a),
    // REAL pricing — this is the code under test downstream of modelForAction.
    estimateGeminiCostUsd: actual.estimateGeminiCostUsd,
    // Two whitelisted actions backed by DIFFERENT internal models:
    analyzeRiskCorrelations: handler, // predictionBackend → AI_MODEL_REASONING (Pro)
    getNutritionSuggestion: handler, // geminiBackend → AI_MODEL_FAST_STABLE (Flash)
  };
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = { uid, tier: 'bronze' };
    next();
  },
}));
vi.mock('../../server/middleware/limiters.js', () => ({
  geminiLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  geminiGlobalDailyLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => true),
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_n: string, _c: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import geminiRouter from '../../server/routes/gemini.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', geminiRouter);
  return app;
}
const uid = { 'x-test-uid': 'u-meter' };

/** Capture the costUsd passed to recordGeminiOutcome on the success call. */
function lastRecordedCost(): number {
  const successCall = H.record.mock.calls.find((c) => c[1] === 'success');
  expect(successCall, 'recordGeminiOutcome should be called with success').toBeTruthy();
  const opts = successCall![2] as { costUsd?: number; tokens?: number };
  expect(typeof opts.costUsd).toBe('number');
  return opts.costUsd as number;
}
function lastRecordedTokens(): number {
  const successCall = H.record.mock.calls.find((c) => c[1] === 'success');
  const opts = successCall![2] as { tokens?: number };
  return opts.tokens as number;
}

beforeEach(() => {
  H.assertAllowed.mockReset().mockResolvedValue(undefined);
  H.record.mockReset().mockResolvedValue(undefined);
  H.backendResult = { ok: true, note: 'fixed-size-payload' };
  process.env.GEMINI_API_KEY = 'test-key-fake';
  delete process.env.E2E_MODE;
});

describe('POST /api/gemini — per-action cost metering (Bucket X under-billing fix)', () => {
  it('bills a REASONING action at Pro rates — strictly more than a FLASH action with identical tokens', async () => {
    // Identical args (→ identical input token estimate) and identical backend
    // result (→ identical output token estimate) for both actions.
    const args = [{ projectId: 'p-meter' }];

    const proRes = await request(buildApp())
      .post('/api/gemini')
      .set(uid)
      .send({ action: 'analyzeRiskCorrelations', args });
    expect(proRes.status).toBe(200);
    const proCost = lastRecordedCost();
    const proTokens = lastRecordedTokens();

    H.record.mockReset().mockResolvedValue(undefined);

    const flashRes = await request(buildApp())
      .post('/api/gemini')
      .set(uid)
      .send({ action: 'getNutritionSuggestion', args });
    expect(flashRes.status).toBe(200);
    const flashCost = lastRecordedCost();
    const flashTokens = lastRecordedTokens();

    // The flat token estimate is unchanged by the fix and equal across actions.
    expect(proTokens).toBe(flashTokens);
    expect(proTokens).toBeGreaterThan(0);

    // The reasoning (Pro) action must cost MORE than the flash action — the
    // exact bug: before the fix both were billed at AI_MODEL_FAST_STABLE and
    // these were equal.
    expect(proCost).toBeGreaterThan(flashCost);
    expect(flashCost).toBeGreaterThan(0);

    // Pro pricing is ~16.7× Flash (1.25/0.075 in, 5.0/0.3 out per governance.ts)
    // — well above the flat Flash rate. Sanity-bound the ratio so a future
    // pricing edit that accidentally re-flattens the rate fails here.
    expect(proCost / flashCost).toBeGreaterThan(5);
  });

  it('a FLASH-tier action keeps the cheapest stable rate (no over-charge regression)', async () => {
    const res = await request(buildApp())
      .post('/api/gemini')
      .set(uid)
      .send({ action: 'getNutritionSuggestion', args: [3, 'Operario'] });
    expect(res.status).toBe(200);
    const cost = lastRecordedCost();
    const tokens = lastRecordedTokens();
    // Recompute the expected FLASH_20 cost independently (in 0.075 / out 0.3
    // per 1M tokens). We don't know the in/out split here, so bound it: the
    // cost must not exceed the all-output Flash ceiling for these tokens.
    const flashOutCeilingUsd = (tokens / 1_000_000) * 0.3;
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(flashOutCeilingUsd + 1e-9);
  });
});
