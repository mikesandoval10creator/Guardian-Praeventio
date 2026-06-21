// Real-router supertest for the reports-automation endpoints (Sprint K §267-270).
// Mounts the REAL router so v8 coverage counts route code. This router had NO
// dedicated test before (router-test-ratchet baseline listed it UNCOVERED).
//
// Three stateless POST endpoints over the pure-compute engine under
// `src/services/reportsAutomation/reportsAutomation.ts`:
//   POST /:projectId/reports-automation/validate   -> { validation }
//   POST /:projectId/reports-automation/render      -> { report } | 400 { error }
//   POST /:projectId/reports-automation/check-due   -> { decision }
//
// Each route runs verifyAuth -> validate(Zod) -> guard(assertProjectMember) ->
// engine. The engine + Zod + assertProjectMember run UNMOCKED; only infra
// (firebase-admin / verifyAuth / logger / captureRouteError) is mocked. The
// 200 assertions check the REAL engine output shape, not router internals.

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
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import reportsAutomationRouter from '../../server/routes/reportsAutomation.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  validateReportData,
  renderReport,
  checkReportDue,
  type ReportTemplate,
  type ReportData,
} from '../../services/reportsAutomation/reportsAutomation.js';

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', reportsAutomationRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const PROJECT_ID = 'proj-reports';
const MEMBER_UID = 'user-member';
const NONMEMBER_UID = 'user-stranger';

/** Seed projects/{id} so assertProjectMember (reads the projects collection) passes. */
function seedProject(): void {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

// A complete template + data that satisfies all required sections.
const template: ReportTemplate = {
  id: 'monthly-client',
  audience: 'client',
  period: 'monthly',
  sections: [
    { key: 'executive_summary', title: 'Resumen ejecutivo', required: true },
    { key: 'kpis', title: 'KPIs', required: true },
    { key: 'next_period', title: 'Próximo período', required: false },
  ],
};

const completeData: ReportData = {
  contents: {
    executive_summary: 'Sin incidentes graves este período.',
    kpis: 'LTIFR 0.4, TRIR 0.9',
    // next_period omitted on purpose — it is optional
  },
};

const incompleteData: ReportData = {
  contents: {
    executive_summary: 'Solo el resumen, faltan KPIs.',
  },
};

beforeEach(() => {
  H.db = createFakeFirestore();
});

// =============================================================================
// POST /:projectId/reports-automation/validate
// =============================================================================

describe('POST /:projectId/reports-automation/validate', () => {
  const url = `/${PROJECT_ID}/reports-automation/validate`;

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(url).send({ template, data: completeData });
    expect(res.status).toBe(401);
  });

  it('400 when body is invalid (missing data)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ template });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when template.period is not an allowed enum', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ template: { ...template, period: 'weekly' }, data: completeData });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ template, data: completeData });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('403 when the project does not exist (assertProjectMember denies)', async () => {
    // no seedProject() — projects/{id} absent
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ template, data: completeData });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 returns isValid=true for complete data (matches the real engine)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ template, data: completeData });
    expect(res.status).toBe(200);
    const body = res.body as { validation: ReturnType<typeof validateReportData> };
    expect(body.validation).toEqual(validateReportData(template, completeData));
    expect(body.validation).toEqual({
      templateId: 'monthly-client',
      isValid: true,
      missingSections: [],
    });
  });

  it('200 reports the missing required sections for incomplete data', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ template, data: incompleteData });
    expect(res.status).toBe(200);
    const body = res.body as { validation: ReturnType<typeof validateReportData> };
    // engine: 'kpis' is required and absent -> isValid false, missing=['kpis']
    expect(body.validation).toEqual(validateReportData(template, incompleteData));
    expect(body.validation.isValid).toBe(false);
    expect(body.validation.missingSections).toEqual(['kpis']);
  });
});

// =============================================================================
// POST /:projectId/reports-automation/render
// =============================================================================

describe('POST /:projectId/reports-automation/render', () => {
  const url = `/${PROJECT_ID}/reports-automation/render`;

  const renderBody = {
    template,
    data: completeData,
    periodLabel: '2026-05',
    reportId: 'rep-001',
    publishedAt: '2026-06-01T00:00:00.000Z',
    distributedTo: ['cliente@example.com'],
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(url).send(renderBody);
    expect(res.status).toBe(401);
  });

  it('400 when body is invalid (publishedAt too short)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ ...renderBody, publishedAt: 'short' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send(renderBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('400 when required sections are missing (engine returns { error })', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ ...renderBody, data: incompleteData });
    expect(res.status).toBe(400);
    // The engine emits a Spanish-CL message listing the missing section keys.
    expect((res.body as Record<string, unknown>).error).toBe(
      'Faltan secciones obligatorias: kpis',
    );
  });

  it('200 returns the rendered PublishedReport (matches the real engine)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send(renderBody);
    expect(res.status).toBe(200);
    const body = res.body as { report: Exclude<ReturnType<typeof renderReport>, { error: string }> };
    // Whole-shape parity with the pure engine on the same inputs.
    expect(body.report).toEqual(renderReport(renderBody));
    expect(body.report.id).toBe('rep-001');
    expect(body.report.templateId).toBe('monthly-client');
    expect(body.report.audience).toBe('client');
    expect(body.report.period).toBe('monthly');
    expect(body.report.periodLabel).toBe('2026-05');
    expect(body.report.distributedTo).toEqual(['cliente@example.com']);
    // Only the two provided sections are rendered (optional next_period -> '').
    expect(body.report.renderedSections).toEqual([
      { key: 'executive_summary', title: 'Resumen ejecutivo', content: completeData.contents.executive_summary },
      { key: 'kpis', title: 'KPIs', content: completeData.contents.kpis },
      { key: 'next_period', title: 'Próximo período', content: '' },
    ]);
  });
});

// =============================================================================
// POST /:projectId/reports-automation/check-due
// =============================================================================

describe('POST /:projectId/reports-automation/check-due', () => {
  const url = `/${PROJECT_ID}/reports-automation/check-due`;

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ templateId: 'monthly-client', period: 'monthly' });
    expect(res.status).toBe(401);
  });

  it('400 when period is not an allowed enum', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ templateId: 'monthly-client', period: 'weekly' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ templateId: 'monthly-client', period: 'monthly' });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 isDue=true when no lastPublishedAt was ever recorded', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ templateId: 'monthly-client', period: 'monthly' });
    expect(res.status).toBe(200);
    const body = res.body as { decision: ReturnType<typeof checkReportDue> };
    expect(body.decision.templateId).toBe('monthly-client');
    expect(body.decision.isDue).toBe(true);
    // Sentinel for "never published" — the engine maps Infinity -> 999999.
    expect(body.decision.daysSinceLast).toBe(999999);
    expect(typeof body.decision.nextDueAt).toBe('string');
  });

  it('200 isDue=false when the last monthly report is recent (deterministic vs engine)', async () => {
    seedProject();
    // 5 days ago < 30-day monthly cadence -> not due. Pin "now" to compare
    // against the engine on the same clock.
    const now = Date.now();
    const lastPublishedAt = new Date(now - 5 * 86_400_000).toISOString();
    const input = { templateId: 'monthly-client', period: 'monthly' as const, lastPublishedAt };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send(input);
    expect(res.status).toBe(200);
    const body = res.body as { decision: ReturnType<typeof checkReportDue> };
    expect(body.decision.isDue).toBe(false);
    expect(body.decision.daysSinceLast).toBe(5);
    // nextDueAt = lastPublishedAt + 30 days (engine is deterministic given a
    // fixed lastPublishedAt; nowIso only affects daysSinceLast, asserted above).
    const expectedNextDue = new Date(Date.parse(lastPublishedAt) + 30 * 86_400_000).toISOString();
    expect(body.decision.nextDueAt).toBe(expectedNextDue);
  });

  it('200 isDue=true when an annual report is overdue', async () => {
    seedProject();
    const now = Date.now();
    const lastPublishedAt = new Date(now - 400 * 86_400_000).toISOString();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ templateId: 'annual-regulatory', period: 'annual', lastPublishedAt });
    expect(res.status).toBe(200);
    const body = res.body as { decision: ReturnType<typeof checkReportDue> };
    // 400 days >= 365-day annual cadence -> due.
    expect(body.decision.isDue).toBe(true);
    expect(body.decision.daysSinceLast).toBe(400);
  });
});
