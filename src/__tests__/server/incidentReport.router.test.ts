// Real-router supertest for the official incident report endpoint
// (src/server/routes/incidentReport.ts) — P0 SUSESO fabrication guard.
//
// Mounted at /api/sprint-k per server.ts (incidentReportRouter).
// Single endpoint:
//   POST /:projectId/incidents/:incidentId/report
//
// Covers: 401 (no token), 404 (no incident), 403 (non-member),
// 403 (cross-project smuggling), 200 (official reconstruction with
// X-Report-Sha256 + X-Praeventio-Doc-Tier=official). The body is a
// compressed PDF so the test asserts on response headers + the
// X-Report-Sha256 (server-computed) + the PDF magic number. Full text
// assertions are covered by the lower-level test-server suite
// (reports.test.ts) where the body is a plain-text stub.

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
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// assertProjectMember runs for real against the fakeFirestore-backed
// `projects/{id}` doc; seed with members[] to make it pass / fail
// realistically per test.

import incidentReportRouter from '../../server/routes/incidentReport.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/sprint-k', incidentReportRouter);
  return app;
}

function seedProjectAndIncident() {
  H.db!._seed('projects/p-off', {
    tenantId: 't-off',
    members: ['w1'],
    createdBy: 'w1',
    name: 'Oficial Test',
  });
  H.db!._seed('incidents/inc-real', {
    projectId: 'p-off',
    tenantId: 't-off',
    occurredAt: '2026-07-15T10:00:00.000Z',
    reportedAt: '2026-07-15T10:05:00.000Z',
    reportedByUid: 'w1',
    severity: 'high',
    summary: 'Resumen autoritativo del incidente',
    description: 'Descripción autoritativa',
    location: { site: 'Faena Norte' },
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('POST /api/sprint-k/:projectId/incidents/:incidentId/report — official reconstruction', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p-off/incidents/inc-real/report')
      .send({});
    expect(res.status).toBe(401);
  });

  it('403 when the project does not exist (default-deny prevents existence leak)', async () => {
    H.db!._seed('incidents/inc-x', {
      projectId: 'p-missing',
      occurredAt: '2026-07-15T10:00:00.000Z',
      summary: 'orphan',
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p-missing/incidents/inc-x/report')
      .set('x-test-uid', 'w1')
      .send({});
    // assertProjectMember rejects the caller before we ever look at
    // the project doc or the incident — default-deny first.
    expect(res.status).toBe(403);
  });

  it('404 when the incident does not exist (caller IS a member of the project)', async () => {
    H.db!._seed('projects/p-off', {
      tenantId: 't-off',
      members: ['w1'],
      createdBy: 'w1',
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p-off/incidents/inc-ghost/report')
      .set('x-test-uid', 'w1')
      .send({});
    expect(res.status).toBe(404);
  });

  it('403 when the caller is not a project member (cross-tenant prevention)', async () => {
    H.db!._seed('projects/p-iso', {
      tenantId: 't-iso',
      members: ['someone-else'],
      createdBy: 'someone-else',
    });
    H.db!._seed('incidents/inc-iso', {
      projectId: 'p-iso',
      tenantId: 't-iso',
      occurredAt: '2026-07-15T10:00:00.000Z',
      reportedByUid: 'someone-else',
      severity: 'medium',
      summary: 'aislado',
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p-iso/incidents/inc-iso/report')
      .set('x-test-uid', 'stranger')
      .send({});
    expect(res.status).toBe(403);
  });

  it('404 when the incident belongs to a different project (existence-leak protection)', async () => {
    H.db!._seed('projects/p-real', {
      tenantId: 't-real',
      members: ['w1'],
      createdBy: 'w1',
    });
    H.db!._seed('incidents/inc-smuggle', {
      projectId: 'p-other',
      tenantId: 't-other',
      occurredAt: '2026-07-15T10:00:00.000Z',
      reportedByUid: 'somebody-else',
      severity: 'low',
      summary: 'belongs to p-other',
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p-real/incidents/inc-smuggle/report')
      .set('x-test-uid', 'w1')
      .send({});
    // loadCanonicalIncident returns null when projectId in the
    // incident doc does not match the URL — same response as 404 to
    // avoid leaking the existence of a foreign incident.
    expect(res.status).toBe(404);
  });

  it('200 reconstructs from canonical incident and returns a signed PDF', async () => {
    seedProjectAndIncident();
    const res = await request(buildApp())
      .post('/api/sprint-k/p-off/incidents/inc-real/report')
      .set('x-test-uid', 'w1')
      .send({
        title: 'TITULO INYECTADO',
        content: 'CONTENIDO INYECTADO',
        metadata: { fake: 'data' },
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-praeventio-doc-tier']).toBe('official');
    expect(res.headers['x-report-incident-id']).toBe('inc-real');
    expect(res.headers['x-report-sha256']).toMatch(/^[a-f0-9]{64}$/);
    // The PDF magic number must be present.
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(500);
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
