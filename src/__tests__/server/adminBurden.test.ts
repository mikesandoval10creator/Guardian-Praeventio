// Real-router supertest for src/server/routes/adminBurden.ts
// (Plan v3 Fase 1 — Sprint 51 §259-260, 2 pure-compute POST endpoints,
//  0 Firestore writes).
//
// The route is mounted at /api/sprint-k in server.ts. Both endpoints are
// POST /:projectId/admin-burden/<sub-path> behind verifyAuth +
// validate(zodSchema) + guard(assertProjectMember). We seed
// `projects/<id>` in fakeFirestore so assertProjectMember passes, then drive
// every status code the route can emit: 401 (no token), 400 (schema fail),
// 403 (project guard), 200 (happy path) plus the missing-report-field probe
// that verifies the z.unknown()→z.record() fix.

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
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import adminBurdenRouter from '../../server/routes/adminBurden.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', adminBurdenRouter);
  return app;
}

const PROJECT_ID = 'p-ab-test';
const CALLER_UID = 'uid-ab-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Admin Burden Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// A minimal valid time entry for the /report endpoint.
const minEntry = {
  taskKind: 'data_entry',
  workerUid: CALLER_UID,
  timeSpentMinutes: 120,
  periodWeek: '2026-W18',
  automatable: true,
};

// A valid AdminBurdenReport shape (as produced by buildAdminBurdenReport).
const validReport = {
  totalMinutesPerWeek: 120,
  totalHoursPerMonth: 8.7,
  pctOfWorkWeek: 5,
  byKind: [{ kind: 'data_entry', minutes: 120, pct: 100 }],
  automatableMinutesPerWeek: 120,
  workerRanking: [{ workerUid: CALLER_UID, minutesPerWeek: 120, pct: 5 }],
  verdict: 'healthy',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/admin-burden/report
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/admin-burden/report', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/admin-burden/report`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ entries: [minEntry] });
    expect(res.status).toBe(401);
  });

  it('400 when entries is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when an entry has an invalid taskKind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entries: [{ ...minEntry, taskKind: 'not_a_valid_kind' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when an entry has a negative timeSpentMinutes', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entries: [{ ...minEntry, timeSpentMinutes: -5 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when an entry has an invalid periodWeek format', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entries: [{ ...minEntry, periodWeek: '2026-18' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ entries: [minEntry] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/admin-burden/report`)
      .set('x-test-uid', CALLER_UID)
      .send({ entries: [minEntry] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 with empty entries returns healthy zero report', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entries: [] });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: Record<string, unknown> };
    expect(report.totalMinutesPerWeek).toBe(0);
    expect(report.totalHoursPerMonth).toBe(0);
    expect(report.pctOfWorkWeek).toBe(0);
    expect(report.verdict).toBe('healthy');
    expect(Array.isArray(report.byKind)).toBe(true);
    expect((report.byKind as unknown[]).length).toBe(0);
    expect(Array.isArray(report.workerRanking)).toBe(true);
  });

  it('200 single entry returns correct aggregates', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entries: [minEntry] });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: Record<string, unknown> };
    expect(report.totalMinutesPerWeek).toBe(120);
    expect(report.automatableMinutesPerWeek).toBe(120);
    expect(Array.isArray(report.byKind)).toBe(true);
    const byKind = report.byKind as Array<Record<string, unknown>>;
    expect(byKind[0].kind).toBe('data_entry');
    expect(byKind[0].minutes).toBe(120);
    const workerRanking = report.workerRanking as Array<Record<string, unknown>>;
    expect(workerRanking).toHaveLength(1);
    expect(workerRanking[0].workerUid).toBe(CALLER_UID);
  });

  it('200 multi-week entries average correctly per week', async () => {
    // 2 weeks × 60 min → avg 60 min/week
    const entries = [
      { ...minEntry, periodWeek: '2026-W18', timeSpentMinutes: 60 },
      { ...minEntry, periodWeek: '2026-W19', timeSpentMinutes: 60 },
    ];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entries });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: Record<string, unknown> };
    expect(report.totalMinutesPerWeek).toBe(60);
  });

  it('200 verdict escalates to extreme for high burden', async () => {
    // 1700 min of data_entry in one week → ~70.8% of work week → extreme
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        entries: [{ ...minEntry, timeSpentMinutes: 1700 }],
      });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: Record<string, unknown> };
    expect(report.verdict).toBe('extreme');
  });

  it('400 validation_error from engine when taskKind is unrecognised post-schema cast', async () => {
    // The Zod schema uses z.enum(ADMIN_TASK_KINDS) so this is caught at schema level.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entries: [{ ...minEntry, taskKind: 'illegal_kind' }] });
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/admin-burden/suggest-automations
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/admin-burden/suggest-automations', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/admin-burden/suggest-automations`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ report: validReport });
    expect(res.status).toBe(401);
  });

  it('400 when report field is missing (z.record fix: was 500, now 400)', async () => {
    // This is the z.unknown()→z.record() bug probe.
    // Before the fix, validate() passed (z.unknown() accepts undefined),
    // then suggestAutomations(undefined) dereferenced undefined.byKind → TypeError → 500.
    // After the fix, z.record() rejects undefined → 400 invalid_payload.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when report is null (non-object rejected by z.record)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when report is a string (non-object rejected by z.record)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ report: validReport });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/admin-burden/suggest-automations`)
      .set('x-test-uid', CALLER_UID)
      .send({ report: validReport });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 empty byKind → no suggestions, totalSaved=0', async () => {
    const emptyReport = { ...validReport, byKind: [] };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: emptyReport });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions).toHaveLength(0);
    expect(res.body.totalSavedMinutesPerWeek).toBe(0);
  });

  it('200 data_entry kind produces an Importador Excel suggestion', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: validReport });
    expect(res.status).toBe(200);
    const { suggestions, totalSavedMinutesPerWeek } = res.body as {
      suggestions: Array<Record<string, unknown>>;
      totalSavedMinutesPerWeek: number;
    };
    expect(suggestions.length).toBeGreaterThan(0);
    const dataEntrySuggestion = suggestions.find((s) => s.forKind === 'data_entry');
    expect(dataEntrySuggestion).toBeDefined();
    expect(dataEntrySuggestion!.replacementFeature).toContain('Excel');
    expect(typeof dataEntrySuggestion!.savedMinutesPerWeek).toBe('number');
    expect((dataEntrySuggestion!.savedMinutesPerWeek as number)).toBeGreaterThan(0);
    expect(typeof totalSavedMinutesPerWeek).toBe('number');
    expect(totalSavedMinutesPerWeek).toBeGreaterThan(0);
  });

  it('200 suggestions are sorted desc by savedMinutesPerWeek', async () => {
    // Build a report with multiple kinds so ordering is observable.
    const multiKindReport = {
      ...validReport,
      byKind: [
        { kind: 'inbox_triage', minutes: 50, pct: 41.7 },    // savedRatio 0.5 → 25 saved
        { kind: 'data_entry', minutes: 120, pct: 58.3 },      // savedRatio 0.85 → 102 saved
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: multiKindReport });
    expect(res.status).toBe(200);
    const { suggestions } = res.body as { suggestions: Array<Record<string, unknown>> };
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    // First suggestion must have higher or equal savedMinutesPerWeek than the second.
    const first = suggestions[0].savedMinutesPerWeek as number;
    const second = suggestions[1].savedMinutesPerWeek as number;
    expect(first).toBeGreaterThanOrEqual(second);
  });

  it('200 signature_collection kind produces a QR Acknowledgement suggestion', async () => {
    const sigReport = {
      ...validReport,
      byKind: [{ kind: 'signature_collection', minutes: 90, pct: 100 }],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: sigReport });
    expect(res.status).toBe(200);
    const { suggestions } = res.body as { suggestions: Array<Record<string, unknown>> };
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].forKind).toBe('signature_collection');
    expect(suggestions[0].replacementFeature).toContain('QR');
    expect(suggestions[0].confidence).toBe(0.95);
  });
});
