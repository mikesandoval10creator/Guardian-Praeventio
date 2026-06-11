// Real-router supertest for POST /api/sprint-k/:projectId/driving/incidents
// (D2 slice 2 — SafeDriving on-route incident report, previously a CLIENT-side
// Firestore write that bypassed the audit-log invariant).
//
// Coverage contract (CLAUDE.md testing notes — minimum for a new route):
//   • 401 no token
//   • 403 non-member
//   • 400 invalid body (REAL zod `validate` — NOT mocked, unlike the sibling
//     drivingSafety.router.test.ts which no-ops it)
//   • 201 happy path asserting:
//       - persisted doc at projects/{pid}/driving_incidents/* with
//         reportedByUid/reportedByEmail SERVER-stamped from the verified token
//       - a body-supplied `reportedByUid` spoof is IGNORED
//       - drivingSafety audit_logs row (userId from token)
//       - RiskNetwork node ported server-side (legacy zettelkasten_nodes doc +
//         canonical nodes doc via serverWriteNodes)
//   • Idempotency-Key replay returns the cached response without a second doc.

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
    (req as Request & { user: { uid: string; email: string | null } }).user = {
      uid,
      email: `${uid}@praeventio.test`,
    };
    next();
  },
}));
// validate + idempotencyKey stay REAL — the 400 and replay tests exercise them.
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import drivingSafetyRouter from '../../server/routes/drivingSafety.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', drivingSafetyRouter);
  return app;
}

const URL = '/api/sprint-k/p1/driving/incidents';
const INCIDENTS = 'projects/p1/driving_incidents';
const uid = (u = 'u1') => ({ 'x-test-uid': u });
const VALID = { type: 'Accidente', description: 'Colisión leve en acceso norte' };

function docsUnder(prefix: string): Array<Record<string, unknown>> {
  const dump = H.db!._dump();
  return Object.keys(dump)
    .filter((k) => k.startsWith(`${prefix}/`))
    .map((k) => dump[k]);
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('POST /:projectId/driving/incidents', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(VALID);
    expect(res.status).toBe(401);
    expect(docsUnder(INCIDENTS)).toHaveLength(0);
  });

  it('403 for a non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    const res = await request(buildApp()).post(URL).set(uid()).send(VALID);
    expect(res.status).toBe(403);
    expect(docsUnder(INCIDENTS)).toHaveLength(0);
  });

  it('400 for an invalid body (bad type / missing description) — real zod', async () => {
    const badType = await request(buildApp())
      .post(URL)
      .set(uid())
      .send({ type: 'Choque Alienígena', description: 'x' });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe('invalid_payload');

    const noDesc = await request(buildApp()).post(URL).set(uid()).send({ type: 'Accidente' });
    expect(noDesc.status).toBe(400);
    expect(docsUnder(INCIDENTS)).toHaveLength(0);
  });

  it('201 happy path — persists the doc with SERVER-stamped identity, audit row and ZK node', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(uid('worker-1'))
      .send({
        ...VALID,
        location: 'Lat: -33.4489, Lng: -70.6693',
        // Spoof attempt — MUST be ignored (identity comes from the token).
        reportedByUid: 'attacker-uid',
        reportedByEmail: 'attacker@evil.cl',
      });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.incident.id).toBeTruthy();
    expect(res.body.incident.reportedByUid).toBe('worker-1');

    // 1. Persisted doc on the SAME legacy path the UI reads.
    const docs = docsUnder(INCIDENTS);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      type: 'Accidente',
      description: VALID.description,
      location: 'Lat: -33.4489, Lng: -70.6693',
      status: 'Reportado',
      projectId: 'p1',
      reportedByUid: 'worker-1',
      reportedByEmail: 'worker-1@praeventio.test',
    });
    expect(docs[0].createdAt).toBeTruthy();

    // 2. Audit row stamped with the verified actor (CLAUDE.md #3/#14).
    const audits = docsUnder('audit_logs');
    const reportAudit = audits.find((a) => a.action === 'drivingSafety.incident.report');
    expect(reportAudit).toBeDefined();
    expect(reportAudit!.userId).toBe('worker-1');
    expect(reportAudit!.projectId).toBe('p1');
    expect((reportAudit!.details as Record<string, unknown>).incidentId).toBe(
      res.body.incident.id,
    );

    // 3. RiskNetwork node ported server-side (tri-write via serverWriteNodes):
    //    legacy zettelkasten_nodes doc + canonical nodes/{t}_{p}_{id} doc.
    expect(res.body.nodeId).toBeTruthy();
    const legacy = docsUnder('zettelkasten_nodes');
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({
      type: 'incident-reported',
      severity: 'high',
      createdBy: 'worker-1',
      projectId: 'p1',
    });
    const canonical = H.db!._dump()[`nodes/t1_p1_${res.body.nodeId}`];
    expect(canonical).toBeDefined();
    expect(canonical.type).toBe('Incidente'); // NodeType.INCIDENT parity with the old client write
  });

  it('grades severity by incident type (Falla Mecánica → medium)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(uid())
      .send({ type: 'Falla Mecánica', description: 'Frenos esponjosos en bajada' });
    expect(res.status).toBe(201);
    const legacy = docsUnder('zettelkasten_nodes');
    expect(legacy[0].severity).toBe('medium');
  });

  it('Idempotency-Key replay returns the cached response without duplicating the doc', async () => {
    const app = buildApp();
    const key = 'drv-test-key-1';
    const first = await request(app).post(URL).set(uid()).set('Idempotency-Key', key).send(VALID);
    expect(first.status).toBe(201);
    const second = await request(app).post(URL).set(uid()).set('Idempotency-Key', key).send(VALID);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.incident.id).toBe(first.body.incident.id);
    expect(docsUnder(INCIDENTS)).toHaveLength(1);
  });

  it('still reports on a legacy project without tenantId (life-relevant path stays open)', async () => {
    H.db!._seed('projects/p1', { name: 'legacy, no tenant' });
    const res = await request(buildApp()).post(URL).set(uid()).send(VALID);
    expect(res.status).toBe(201);
    expect(docsUnder(INCIDENTS)).toHaveLength(1);
  });
});
