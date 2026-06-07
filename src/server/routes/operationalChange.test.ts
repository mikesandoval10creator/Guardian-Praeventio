// Praeventio Guard — operationalChange router: real-router supertest (B13).
//
// Replaces the router.stack contract test with a behavioural supertest that
// drives the full MOC workflow through the AUDITED endpoints with an in-memory
// FakeFirestore + the REAL adapter + engine:
//   declare → submit-for-review → decide(approve) → activate → verify, + revert.
// Asserts the audit gap is closed: every transition writes audit_logs, the
// approval role comes from the VERIFIED token (no role → 403), and identity is
// stamped server-side.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
  audit: vi.fn(),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
    } as import('express').Request['user'];
    next();
  },
}));
vi.mock('../middleware/validate.js', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../middleware/auditLog.js', () => ({
  auditServerEvent: (...args: unknown[]) => H.audit(...args),
}));

import operationalChangeRouter from './operationalChange';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/sprint-k';
const PROJECT = 'p1';
const TENANT = 't1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, operationalChangeRouter);
  return app;
}

const asUser = (uid: string, role?: string) => {
  const h: Record<string, string> = { 'x-test-uid': uid };
  if (role) h['x-test-role'] = role;
  return h;
};

const declareBody = {
  kind: 'procedure',
  whatChanged: 'Nuevo procedimiento de bloqueo de energías',
  previousValue: 'procedimiento viejo',
  newValue: 'procedimiento nuevo',
  rationale: 'Actualización requerida por hallazgo de auditoría interna 2026.',
  impact: 'low',
  affectedWorkerUids: [],
  declaredByRole: 'supervisor',
  effectiveFrom: '2020-01-01T00:00:00.000Z', // in the past → activate allowed
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.audit.mockReset().mockResolvedValue(true);
  H.db._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: ['sup-1', 'hse-1', 'op-1'] });
});

const moc = `${PREFIX}/${PROJECT}/moc`;

async function declare(): Promise<string> {
  const res = await request(buildApp()).post(`${moc}/declare`).set(asUser('sup-1', 'supervisor')).send(declareBody);
  expect(res.status).toBe(201);
  expect(res.body.change.status).toBe('draft');
  return res.body.change.id as string;
}

describe('operationalChange MOC workflow (audited)', () => {
  it('401 without a token; 403 for a non-member', async () => {
    expect((await request(buildApp()).post(`${moc}/declare`).send(declareBody)).status).toBe(401);
    expect(
      (await request(buildApp()).post(`${moc}/declare`).set(asUser('outsider', 'supervisor')).send(declareBody)).status,
    ).toBe(403);
  });

  it('drives declare → submit → approve → activate → verify, auditing each transition', async () => {
    const id = await declare();

    const submit = await request(buildApp()).post(`${moc}/${id}/submit-for-review`).set(asUser('sup-1', 'supervisor')).send({});
    expect(submit.status).toBe(200);
    expect(submit.body.change.status).toBe('pending_review');

    // Approval role is taken from the VERIFIED token. A 'prevencionista' (HSE)
    // approval meets quorum for a low-impact change.
    const approve = await request(buildApp())
      .post(`${moc}/${id}/decide`)
      .set(asUser('hse-1', 'prevencionista'))
      .send({ decision: 'approved', comment: 'Aprobado: cumple el estándar de bloqueo.' });
    expect(approve.status).toBe(200);
    expect(approve.body.change.status).toBe('approved');

    const activate = await request(buildApp()).post(`${moc}/${id}/activate`).set(asUser('sup-1', 'supervisor')).send({});
    expect(activate.status).toBe(200);
    expect(activate.body.change.status).toBe('in_effect');

    const verify = await request(buildApp())
      .post(`${moc}/${id}/verify`)
      .set(asUser('hse-1', 'prevencionista'))
      .send({ effective: true, observations: 'Verificado en terreno una semana sin desviaciones ni incidentes.' });
    expect(verify.status).toBe(200);
    expect(verify.body.change.status).toBe('verified');

    // Every state change wrote an audit_logs event.
    const auditedActions = H.audit.mock.calls.map((c) => c[1]);
    expect(auditedActions).toEqual(
      expect.arrayContaining(['moc.declare', 'moc.submit_for_review', 'moc.decide', 'moc.activate', 'moc.verify']),
    );
  });

  it('rejects an approval decision without a verified role claim (403)', async () => {
    const id = await declare();
    await request(buildApp()).post(`${moc}/${id}/submit-for-review`).set(asUser('sup-1', 'supervisor')).send({});

    const res = await request(buildApp())
      .post(`${moc}/${id}/decide`)
      .set(asUser('sup-1')) // no x-test-role
      .send({ decision: 'approved', comment: 'sin rol verificado' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('role_required');
  });

  it('reverts a change with a reason and audits it', async () => {
    const id = await declare();
    const res = await request(buildApp())
      .post(`${moc}/${id}/revert`)
      .set(asUser('sup-1', 'supervisor'))
      .send({ reason: 'Se revierte por error en el alcance declarado.' });
    expect(res.status).toBe(200);
    expect(res.body.change.status).toBe('reverted');
    expect(H.audit.mock.calls.map((c) => c[1])).toContain('moc.revert');
  });

  it('enforces the engine state machine — cannot activate a draft (400)', async () => {
    const id = await declare();
    const res = await request(buildApp()).post(`${moc}/${id}/activate`).set(asUser('sup-1', 'supervisor')).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});
