// Real-router supertest for the TMERT/PREXOR assessment persistence surface
// added to src/server/routes/protocols.ts (B-protocols: "TMERT/PREXOR
// invisibles" — engines without persistence/UI).
//
//   POST /:projectId/protocols/tmert/assessments   → compute + persist + audit
//   POST /:projectId/protocols/prexor/assessments  → compute + persist + audit
//   GET  /:projectId/protocols/assessments         → per-project history
//
// Pattern mirrors src/__tests__/server/ergonomics.test.ts (real router,
// fakeFirestore, mocked verifyAuth). The engines run REAL — the persisted
// `result` must be computed server-side from the inputs; nothing the client
// sends as `result`/`metadata` may be trusted (identity-from-token, F3).

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
      email: `${uid}@test.cl`,
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

import protocolsRouter from '../../server/routes/protocols.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', protocolsRouter);
  return app;
}

const PROJECT_ID = 'p-protocols';
const UID = 'uid-prevencionista';

const tmertHighRiskInput = {
  repetitividad: { A: true, B: false, C: false },
  fuerza: { A: false, B: true, C: false },
  posturaForzada: { A: true, B: false, C: false },
  otros: { A: false, B: false, C: false },
  exposureHoursPerDay: 8,
};

const prexorMeasurements = [
  { durationHours: 8, levelDbA: 90 }, // dose ≈ 317% → alto
];

function dumpCollection(prefix: string) {
  return Object.entries(H.db!._dump()).filter(([k]) => k.startsWith(`${prefix}/`));
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Faena Norte',
    members: [UID],
    createdBy: UID,
  });
});

// ── TMERT persistence ───────────────────────────────────────────────────

describe('POST /:projectId/protocols/tmert/assessments', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/protocols/tmert/assessments`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ input: tmertHighRiskInput, taskName: 'Ensacado manual' });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger')
      .send({ input: tmertHighRiskInput, taskName: 'Ensacado manual' });
    expect(res.status).toBe(403);
  });

  it('400 invalid_payload when taskName is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({ input: tmertHighRiskInput });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload on out-of-range exposure hours', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({
        input: { ...tmertHighRiskInput, exposureHoursPerDay: 30 },
        taskName: 'Ensacado manual',
      });
    expect(res.status).toBe(400);
  });

  it('201 computes via the REAL engine, persists, and stamps the author from the token', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({
        input: tmertHighRiskInput,
        taskName: 'Ensacado manual',
        workerId: 'worker-7',
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    // 3 factors at risk → alto (engine truth, computed server-side).
    expect(res.body.result.overallRisk).toBe('alto');
    expect(res.body.result.requiresMedicalEvaluation).toBe(true);

    const docs = dumpCollection('protocol_assessments');
    expect(docs).toHaveLength(1);
    const [, doc] = docs[0];
    expect(doc.projectId).toBe(PROJECT_ID);
    expect(doc.protocol).toBe('TMERT');
    expect(doc.taskName).toBe('Ensacado manual');
    expect(doc.workerId).toBe('worker-7');
    expect((doc.result as { overallRisk: string }).overallRisk).toBe('alto');
    expect((doc.metadata as { author: string }).author).toBe(UID);
    expect((doc.metadata as { signedAt: unknown }).signedAt).toBeNull();
    expect(typeof doc.computedAt).toBe('string');
  });

  it('201 ignores a client-spoofed result/metadata — server recomputes and re-stamps', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({
        input: {
          repetitividad: { A: false, B: false, C: false },
          fuerza: { A: false, B: false, C: false },
          posturaForzada: { A: false, B: false, C: false },
          otros: { A: false, B: false, C: false },
          exposureHoursPerDay: 4,
        },
        taskName: 'Tarea liviana',
        result: { overallRisk: 'alto' },
        metadata: { author: 'attacker-uid' },
      });
    expect(res.status).toBe(201);
    expect(res.body.result.overallRisk).toBe('bajo');
    const [, doc] = dumpCollection('protocol_assessments')[0];
    expect((doc.result as { overallRisk: string }).overallRisk).toBe('bajo');
    expect((doc.metadata as { author: string }).author).toBe(UID);
  });

  it('writes an audit_logs row with the server-stamped actor', async () => {
    await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({ input: tmertHighRiskInput, taskName: 'Ensacado manual' });
    const audits = dumpCollection('audit_logs');
    expect(audits).toHaveLength(1);
    const [, row] = audits[0];
    expect(row.action).toBe('protocols.tmert.assessment_recorded');
    expect(row.module).toBe('protocols');
    expect(row.userId).toBe(UID);
    expect(row.projectId).toBe(PROJECT_ID);
    expect((row.details as { overallRisk: string }).overallRisk).toBe('alto');
  });
});

// ── PREXOR persistence ──────────────────────────────────────────────────

describe('POST /:projectId/protocols/prexor/assessments', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/protocols/prexor/assessments`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ measurements: prexorMeasurements, taskName: 'Sala chancado' });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger')
      .send({ measurements: prexorMeasurements, taskName: 'Sala chancado' });
    expect(res.status).toBe(403);
  });

  it('400 invalid_payload on negative dB(A)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({
        measurements: [{ durationHours: 2, levelDbA: -5 }],
        taskName: 'Sala chancado',
      });
    expect(res.status).toBe(400);
  });

  it('201 computes the REAL dose, persists, and stamps author + audit row', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({ measurements: prexorMeasurements, taskName: 'Sala chancado' });
    expect(res.status).toBe(201);
    // 8h @ 90 dB(A), Q=3 → dose ≈ 317.5% → alto, exceeds the legal limit.
    expect(res.body.result.riskLevel).toBe('alto');
    expect(res.body.result.exceedsLegalLimit).toBe(true);
    expect(res.body.result.dosePercent).toBeGreaterThan(300);

    const [, doc] = dumpCollection('protocol_assessments')[0];
    expect(doc.protocol).toBe('PREXOR');
    expect(doc.projectId).toBe(PROJECT_ID);
    expect((doc.metadata as { author: string }).author).toBe(UID);
    expect((doc.result as { riskLevel: string }).riskLevel).toBe('alto');

    const audits = dumpCollection('audit_logs');
    expect(audits).toHaveLength(1);
    const [, row] = audits[0];
    expect(row.action).toBe('protocols.prexor.assessment_recorded');
    expect(row.userId).toBe(UID);
    expect(row.projectId).toBe(PROJECT_ID);
  });
});

// ── History list ────────────────────────────────────────────────────────

describe('GET /:projectId/protocols/assessments', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/protocols/assessments`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp()).get(url).set('x-test-uid', 'stranger');
    expect(res.status).toBe(403);
  });

  it('400 on an unknown protocol filter', async () => {
    const res = await request(buildApp())
      .get(`${url}?protocol=PLANESI`)
      .set('x-test-uid', UID);
    expect(res.status).toBe(400);
  });

  it('200 lists only this project, newest first, with optional protocol filter', async () => {
    const app = buildApp();
    // Two TMERT + one PREXOR in-project, one TMERT in another project.
    await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/protocols/tmert/assessments`)
      .set('x-test-uid', UID)
      .send({ input: tmertHighRiskInput, taskName: 'Tarea 1' });
    await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/protocols/prexor/assessments`)
      .set('x-test-uid', UID)
      .send({ measurements: prexorMeasurements, taskName: 'Tarea 2' });
    H.db!._seed('protocol_assessments/foreign', {
      projectId: 'p-other',
      protocol: 'TMERT',
      taskName: 'Ajeno',
      computedAt: '2099-01-01T00:00:00.000Z',
      metadata: { author: 'someone', signedAt: null },
    });

    const all = await request(app).get(url).set('x-test-uid', UID);
    expect(all.status).toBe(200);
    expect(all.body.assessments).toHaveLength(2);
    expect(
      all.body.assessments.every(
        (a: { projectId: string }) => a.projectId === PROJECT_ID,
      ),
    ).toBe(true);
    // Newest first.
    const dates = all.body.assessments.map((a: { computedAt: string }) => a.computedAt);
    expect([...dates].sort().reverse()).toEqual(dates);

    const onlyTmert = await request(app)
      .get(`${url}?protocol=TMERT`)
      .set('x-test-uid', UID);
    expect(onlyTmert.status).toBe(200);
    expect(onlyTmert.body.assessments).toHaveLength(1);
    expect(onlyTmert.body.assessments[0].protocol).toBe('TMERT');
    expect(onlyTmert.body.assessments[0].taskName).toBe('Tarea 1');
  });
});
