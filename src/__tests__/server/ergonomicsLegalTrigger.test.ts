// Real-router supertest for the DS-594 art. 110 legal trigger route added to
// src/server/routes/ergonomics.ts:
//
//   POST /:projectId/ergonomics/legal-trigger
//
// WHY this exists: the DIEP folio counter (tenants/{tid}/suseso_counters) is
// Admin-SDK-only (firestore.rules denies all clients), so the browser wizard
// (AddErgonomicsModal) CANNOT allocate a folio with the client SDK — it must
// round-trip here. Before this route the wizard called recordErgonomicAssessment
// WITHOUT folioStore+tenantId, so the legal trigger was dead code in production.
//
// These tests exercise the REAL router + REAL ergonomicLegalTrigger service +
// REAL folioGenerator against a fakeFirestore. Only verifyAuth is mocked (to
// inject the token's uid + tenant claim, exactly as the production middleware
// stamps them from the Firebase custom claim).

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

// verifyAuth shim: stamps uid + tenantId from headers, mirroring the real
// middleware that lifts them from the verified Firebase token / custom claim.
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const tenantId = req.header('x-test-tenant') || undefined;
    (req as Request & { user: Record<string, unknown> }).user = { uid, tenantId };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// Observability adapter used by the trigger's internal try/catch. No-op spy.
const captureExceptionMock = vi.fn();
vi.mock('../../services/observability', () => ({
  getErrorTracker: () => ({ captureException: captureExceptionMock }),
}));

import ergonomicsRouter from '../../server/routes/ergonomics.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', ergonomicsRouter);
  return app;
}

const PROJECT_ID = 'p-ergo';
const UID = 'uid-prev-1';
const TENANT = 'praeventio';

const baseBody = {
  assessmentId: 'assess-1',
  workerId: 'worker-1',
  computedAt: '2026-06-13T00:00:00.000Z',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  captureExceptionMock.mockClear();
  H.db._seed(`projects/${PROJECT_ID}`, { name: 'Ergo', members: [UID], createdBy: UID });
});

const url = `/api/sprint-k/${PROJECT_ID}/ergonomics/legal-trigger`;

describe('POST /:projectId/ergonomics/legal-trigger', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ ...baseBody, type: 'REBA', score: 12 });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger')
      .set('x-test-tenant', TENANT)
      .send({ ...baseBody, type: 'REBA', score: 12 });
    expect(res.status).toBe(403);
  });

  it('403 when the token carries no tenant binding (cannot allocate folio)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID) // no x-test-tenant
      .send({ ...baseBody, type: 'REBA', score: 12 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_tenant_binding');
  });

  it('400 invalid_payload on a malformed body', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .set('x-test-tenant', TENANT)
      .send({ ...baseBody, type: 'NOPE', score: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('REBA score 12 (>=11) allocates a DIEP folio + derived node + audit', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .set('x-test-tenant', TENANT)
      .send({ ...baseBody, type: 'REBA', score: 12 });
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(true);
    expect(res.body.diepFolio).toMatch(/^DIEP-/);
    expect(res.body.derivedNodeId).toMatch(/^riesgo-ergonomico-reba-assess-1$/);

    // Folio counter was actually written under the tenant (Admin-SDK path).
    const dump = H.db!._dump();
    const year = new Date().getUTCFullYear();
    expect(dump[`tenants/${TENANT}/suseso_counters/${year}-DIEP`]).toEqual({ lastSeq: 1 });

    // Audit row written with server-stamped actor (NOT from the body).
    const auditRows = Object.entries(dump).filter(([k]) => k.startsWith('audit_logs/'));
    expect(auditRows).toHaveLength(1);
    const [, audit] = auditRows[0] as [string, Record<string, unknown>];
    expect(audit.action).toBe('ergonomic.legal_threshold_crossed');
    expect(audit.userId).toBe(UID);
    expect(audit.projectId).toBe(PROJECT_ID);
  });

  it('RULA score 7 (>=7) triggers and allocates a DIEP folio', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .set('x-test-tenant', TENANT)
      .send({ ...baseBody, type: 'RULA', score: 7 });
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(true);
    expect(res.body.diepFolio).toMatch(/^DIEP-/);
    expect(res.body.derivedNodeId).toMatch(/^riesgo-ergonomico-rula-/);
  });

  it('REBA score 8 (<11) does NOT allocate a folio or write a legal audit', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .set('x-test-tenant', TENANT)
      .send({ ...baseBody, type: 'REBA', score: 8 });
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(false);

    const dump = H.db!._dump();
    const year = new Date().getUTCFullYear();
    expect(dump[`tenants/${TENANT}/suseso_counters/${year}-DIEP`]).toBeUndefined();
    const auditRows = Object.keys(dump).filter((k) => k.startsWith('audit_logs/'));
    expect(auditRows).toHaveLength(0);
  });
});
