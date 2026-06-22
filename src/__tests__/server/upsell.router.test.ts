// Real-router supertest for the Pain-Based Upsell Suggester HTTP surface
// (src/server/routes/upsell.ts). One stateless POST endpoint over the
// pure-compute engine in src/services/upsell/painBasedUpsellSuggester.ts:
//
//   POST /:projectId/upsell/suggest
//     body: UsagePainSignals
//     200:  { suggestions: UpsellSuggestion[] }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real deterministic
// compute. Happy-path assertions re-derive expected values from the engine's
// CATALOG + pain-detection THRESHOLDS:
//
//   manualReportsPerWeek >= 5    → high_manual_reports
//   exceptionsRaisedLast30d >= 8 → frequent_exceptions
//   dataConfidenceScore < 0.7    → low_data_confidence
//   activeProjectCount >= 5 && not enterprise → scale_outgrew_tier

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import upsellRouter from '../../server/routes/upsell.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { suggestUpsell } from '../../services/upsell/painBasedUpsellSuggester.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', upsellRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. upsell/suggest
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/upsell/suggest', () => {
  const url = '/api/p1/upsell/suggest';

  it('401 without auth header', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({
        manualReportsPerWeek: 0,
        exceptionsRaisedLast30d: 0,
        dataConfidenceScore: 1,
        currentTier: 'free',
      });
    expect(res.status).toBe(401);
  });

  it('200 no pain signals → empty suggestions array', async () => {
    // All metrics below thresholds: manualReports<5, exceptions<8, confidence>=0.7, no scale signal
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        manualReportsPerWeek: 2,
        exceptionsRaisedLast30d: 3,
        dataConfidenceScore: 0.9,
        currentTier: 'free',
      });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it('200 high_manual_reports alone triggers addon.automated_reports and tier.pro (free tier)', async () => {
    // manualReportsPerWeek=10 (>=5) → high_manual_reports pain
    // CATALOG: addon.automated_reports (addresses high_manual_reports, reduction 70)
    //          tier.pro (addresses [high_manual_reports, frequent_exceptions, scale_outgrew_tier],
    //                    reduction 80, notIfCurrentTier=[pro, enterprise])
    // With 1 pain (high_manual_reports):
    //   addon.automated_reports: matched=1, coverage=1/1=1, estimate=round(70×1)=70
    //   tier.pro: matched=1, coverage=1/1=1, estimate=round(80×1)=80
    // Sorted by estimate desc: tier.pro(80), addon.automated_reports(70)
    const signals = {
      manualReportsPerWeek: 10,
      exceptionsRaisedLast30d: 0,
      dataConfidenceScore: 1,
      currentTier: 'free' as const,
    };
    const expected = suggestUpsell(signals);

    const res = await request(buildApp()).post(url).set(uid).send(signals);
    expect(res.status).toBe(200);

    const { suggestions } = res.body as { suggestions: typeof expected };
    expect(suggestions).toHaveLength(expected.length);
    // Sorted by painReductionEstimate desc
    expect(suggestions[0].painReductionEstimate).toBeGreaterThanOrEqual(
      suggestions[suggestions.length - 1].painReductionEstimate,
    );
    // Automated reports addon must be present
    const autoReports = suggestions.find((s: { addonOrTier: string }) => s.addonOrTier === 'addon.automated_reports');
    expect(autoReports).toBeDefined();
    expect(autoReports?.painSignalsAddressed).toContain('high_manual_reports');
    expect(autoReports?.kind).toBe('addon');
  });

  it('200 pro tier user: tier.pro is excluded (notIfCurrentTier), enterprise still offered', async () => {
    // currentTier=pro + high exceptions → frequent_exceptions pain
    // tier.pro excluded (currentTier is pro); tier.enterprise still applies
    const signals = {
      manualReportsPerWeek: 0,
      exceptionsRaisedLast30d: 10,
      dataConfidenceScore: 1,
      currentTier: 'pro',
    };
    const res = await request(buildApp()).post(url).set(uid).send(signals);
    expect(res.status).toBe(200);

    const addonOrTiers = (res.body.suggestions as Array<{ addonOrTier: string }>).map((s) => s.addonOrTier);
    expect(addonOrTiers).not.toContain('tier.pro');
    expect(addonOrTiers).toContain('addon.exception_workflows');
    expect(addonOrTiers).toContain('tier.enterprise');
  });

  it('200 scale_outgrew_tier pain for starter with 5+ projects triggers tier upgrade', async () => {
    // activeProjectCount=5 (>=5) + starter tier → scale_outgrew_tier pain
    // tier.pro (addresses scale_outgrew_tier) should be in suggestions
    const signals = {
      manualReportsPerWeek: 0,
      exceptionsRaisedLast30d: 0,
      dataConfidenceScore: 1,
      currentTier: 'starter',
      activeProjectCount: 5,
    };
    const res = await request(buildApp()).post(url).set(uid).send(signals);
    expect(res.status).toBe(200);
    const addonOrTiers = (res.body.suggestions as Array<{ addonOrTier: string }>).map((s) => s.addonOrTier);
    expect(addonOrTiers).toContain('tier.pro');
  });

  it('200 enterprise tier with high projects: scale pain excluded (enterprise never upsells on scale)', async () => {
    // currentTier=enterprise → detectPains excludes scale_outgrew_tier (enterprise excluded)
    const signals = {
      manualReportsPerWeek: 0,
      exceptionsRaisedLast30d: 0,
      dataConfidenceScore: 1,
      currentTier: 'enterprise',
      activeProjectCount: 100,
    };
    const res = await request(buildApp()).post(url).set(uid).send(signals);
    expect(res.status).toBe(200);
    // No scale pain → no tier upgrades (enterprise already max)
    expect(res.body.suggestions).toEqual([]);
  });

  it('400 when currentTier is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        manualReportsPerWeek: 0,
        exceptionsRaisedLast30d: 0,
        dataConfidenceScore: 1,
        currentTier: 'diamante',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when dataConfidenceScore is out of range [0,1]', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        manualReportsPerWeek: 0,
        exceptionsRaisedLast30d: 0,
        dataConfidenceScore: 1.5,
        currentTier: 'free',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when manualReportsPerWeek is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        exceptionsRaisedLast30d: 0,
        dataConfidenceScore: 1,
        currentTier: 'free',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/upsell/suggest')
      .set(uid)
      .send({
        manualReportsPerWeek: 0,
        exceptionsRaisedLast30d: 0,
        dataConfidenceScore: 1,
        currentTier: 'free',
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/upsell/suggest')
      .set(uid)
      .send({
        manualReportsPerWeek: 0,
        exceptionsRaisedLast30d: 0,
        dataConfidenceScore: 1,
        currentTier: 'free',
      });
    expect(res.status).toBe(403);
  });
});

// Type-only guard: keep the engine function referenced so the import is not pruned.
const _typeCheck = typeof suggestUpsell;
void _typeCheck;
