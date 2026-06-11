// Real-router supertest for src/server/routes/cealSm.ts (CEAL-SM/SUSESO —
// Protocolo de Vigilancia de Riesgos Psicosociales MINSAL oct. 2022).
//
// Mounts the ACTUAL production router via fakeFirestore; the pure engine
// (src/services/protocols/cealSm.ts) runs REAL so the persisted aggregates
// are the engine's truth, never a client-supplied verdict.
//
// ANONYMITY INVARIANTS under test (constitutive for this instrument —
// answers are worker responses about their employer):
//   • Stored response docs contain `responderHash`, NEVER a raw uid.
//   • Same uid+campaign → same hash (idempotent dedup key, 409 on repeat).
//   • Aggregates are suppressed below CEAL_ANONYMITY_THRESHOLD (10).
//   • audit_logs rows never contain the answers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const TEST_PEPPER = 'test-ceal-sm-pepper-32-bytes-long!!';

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
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@test.cl`,
      role: req.header('x-test-role') ?? undefined,
      admin: req.header('x-test-admin') === 'true',
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

import cealSmRouter, { cealResponderHash } from '../../server/routes/cealSm.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { CEAL_DIMENSIONS, CEAL_SCALE_OPTIONS } from '../../services/protocols/cealSmDefinition';
import type { CealAnswers } from '../../services/protocols/cealSm';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', cealSmRouter);
  return app;
}

const PROJECT_ID = 'p-ceal';
const PREVENCIONISTA = 'uid-prev';
const WORKER = 'uid-worker';

/** Full 54-item answer set with every dimension at its minimum (riesgo bajo). */
function answersBajo(): CealAnswers {
  const answers: CealAnswers = {};
  for (const d of CEAL_DIMENSIONS) {
    for (const item of d.items) {
      const pts = CEAL_SCALE_OPTIONS[item.scale].map((o) => o.points);
      answers[item.code] = Math.min(...pts);
    }
  }
  return answers;
}

/** Every dimension at its maximum (riesgo alto). */
function answersAlto(): CealAnswers {
  const answers: CealAnswers = {};
  for (const d of CEAL_DIMENSIONS) {
    for (const item of d.items) {
      const pts = CEAL_SCALE_OPTIONS[item.scale].map((o) => o.points);
      answers[item.code] = Math.max(...pts);
    }
  }
  return answers;
}

const validCampaign = {
  title: 'Evaluación CEAL-SM 2026 Faena Norte',
  openAt: '2026-06-01T00:00:00.000Z',
  closeAt: '2099-12-31T00:00:00.000Z',
  totalWorkers: 20,
};

function dumpCollection(prefix: string) {
  return Object.entries(H.db!._dump()).filter(([k]) => k.startsWith(`${prefix}/`));
}

async function createCampaign(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await request(app)
    .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns`)
    .set('x-test-uid', PREVENCIONISTA)
    .set('x-test-role', 'prevencionista')
    .send(validCampaign);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeEach(() => {
  process.env.CULTURE_PULSE_PEPPER = TEST_PEPPER;
  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Faena Norte',
    members: [PREVENCIONISTA, WORKER],
    createdBy: PREVENCIONISTA,
  });
});

// ── Campaign creation ────────────────────────────────────────────────────

describe('POST /:projectId/ceal-sm/campaigns', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns`;

  it('401 sin token', async () => {
    const res = await request(buildApp()).post(url).send(validCampaign);
    expect(res.status).toBe(401);
  });

  it('403 si el caller no es miembro del proyecto', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger')
      .set('x-test-role', 'prevencionista')
      .send(validCampaign);
    expect(res.status).toBe(403);
  });

  it('403 forbidden_role para un worker (solo admin/prevencionista gestionan)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', WORKER)
      .set('x-test-role', 'worker')
      .send(validCampaign);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('400 invalid_payload sin totalWorkers (denominador de participación obligatorio)', async () => {
    const { totalWorkers: _omit, ...rest } = validCampaign;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', PREVENCIONISTA)
      .set('x-test-role', 'prevencionista')
      .send(rest);
    expect(res.status).toBe(400);
  });

  it('400 cuando closeAt no es posterior a openAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', PREVENCIONISTA)
      .set('x-test-role', 'prevencionista')
      .send({ ...validCampaign, closeAt: '2026-05-01T00:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  it('201 crea la campaña, estampa createdBy del token y escribe audit_logs', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', PREVENCIONISTA)
      .set('x-test-role', 'prevencionista')
      .send({ ...validCampaign, createdBy: 'attacker-uid' });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');

    const docs = dumpCollection('ceal_sm_campaigns');
    expect(docs).toHaveLength(1);
    const [, doc] = docs[0];
    expect(doc.projectId).toBe(PROJECT_ID);
    expect(doc.createdBy).toBe(PREVENCIONISTA); // identity-from-token (F3)
    expect(doc.status).toBe('open');
    expect(doc.totalWorkers).toBe(20);

    const audits = dumpCollection('audit_logs');
    expect(audits).toHaveLength(1);
    const [, row] = audits[0];
    expect(row.action).toBe('cealSm.campaign_created');
    expect(row.userId).toBe(PREVENCIONISTA);
    expect(row.projectId).toBe(PROJECT_ID);
  });
});

// ── Response submission (anonymity core) ─────────────────────────────────

describe('POST /:projectId/ceal-sm/campaigns/:id/respond', () => {
  it('401 sin token', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    const res = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .send({ answers: answersBajo() });
    expect(res.status).toBe(401);
  });

  it('403 si no es miembro', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    const res = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', 'stranger')
      .send({ answers: answersBajo() });
    expect(res.status).toBe(403);
  });

  it('404 campaña inexistente', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/nope/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: answersBajo() });
    expect(res.status).toBe(404);
  });

  it('404 cuando la campaña pertenece a otro proyecto (aislamiento de tenant)', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    H.db!._seed('projects/p-other', { name: 'Otro', members: [WORKER] });
    const res = await request(app)
      .post(`/api/sprint-k/p-other/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: answersBajo() });
    expect(res.status).toBe(404);
  });

  it('400 con un set de respuestas incompleto (ítem oficial faltante)', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    const incomplete = answersBajo();
    delete incomplete.QD1;
    const res = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: incomplete });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/QD1/);
  });

  it('400 cuando un ítem VU trae 0 (la escala oficial parte en 1)', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    const res = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: { ...answersBajo(), VU1: 0 } });
    expect(res.status).toBe(400);
  });

  it('409 fuera de ventana (campaña cerrada)', async () => {
    const app = buildApp();
    const res0 = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns`)
      .set('x-test-uid', PREVENCIONISTA)
      .set('x-test-role', 'prevencionista')
      .send({
        ...validCampaign,
        openAt: '2020-01-01T00:00:00.000Z',
        closeAt: '2020-02-01T00:00:00.000Z',
      });
    expect(res0.status).toBe(201);
    const res = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${res0.body.id}/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: answersBajo() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('campaign_closed');
  });

  it('201 persiste SOLO responderHash + answers — nunca el uid (anonimato)', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    const res = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: answersBajo() });
    expect(res.status).toBe(201);

    const expectedHash = cealResponderHash(WORKER, cid);
    const stored = H.db!._dump()[`ceal_sm_campaigns/${cid}/responses/${expectedHash}`];
    expect(stored).toBeDefined();
    expect(stored.responderHash).toBe(expectedHash);
    // The doc (and its id) must not leak the identity in any field.
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(WORKER);
    expect(serialized).not.toContain('@test.cl');
    expect(Object.keys(stored).sort()).toEqual(['answers', 'responderHash', 'submittedAt']);
  });

  it('audit row sin respuestas (solo projectId + campaignId)', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: answersAlto() });
    const audits = dumpCollection('audit_logs').filter(
      ([, r]) => r.action === 'cealSm.response_submitted',
    );
    expect(audits).toHaveLength(1);
    const [, row] = audits[0];
    expect(row.details).toEqual({ projectId: PROJECT_ID, campaignId: cid });
    expect(JSON.stringify(row.details)).not.toContain('answers');
  });

  it('409 already_responded: el hash es idempotente por uid+campaña', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    const url = `/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`;
    const first = await request(app)
      .post(url)
      .set('x-test-uid', WORKER)
      .send({ answers: answersBajo() });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(url)
      .set('x-test-uid', WORKER)
      .send({ answers: answersAlto() });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('already_responded');
  });

  it('el hash usa dominio propio: difiere del hash culture-pulse para el mismo uid+id', async () => {
    const { pulseResponderHash } = await import('../../server/routes/culturePulse.js');
    expect(cealResponderHash(WORKER, 'same-id')).not.toBe(
      pulseResponderHash(WORKER, 'same-id'),
    );
  });
});

// ── Listing ──────────────────────────────────────────────────────────────

describe('GET /:projectId/ceal-sm/campaigns', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns`;

  it('401 sin token y 403 sin membresía', async () => {
    expect((await request(buildApp()).get(url)).status).toBe(401);
    expect(
      (await request(buildApp()).get(url).set('x-test-uid', 'stranger')).status,
    ).toBe(403);
  });

  it('200 lista campañas del proyecto con conteo y hasResponded (sin respuestas crudas)', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    H.db!._seed('ceal_sm_campaigns/foreign', {
      projectId: 'p-other',
      title: 'Ajena',
      status: 'open',
      openAt: '2026-06-01T00:00:00.000Z',
      closeAt: '2099-12-31T00:00:00.000Z',
      totalWorkers: 10,
      createdAt: '2099-01-01T00:00:00.000Z',
      createdBy: 'x',
    });
    await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', WORKER)
      .send({ answers: answersBajo() });

    const asWorker = await request(app).get(url).set('x-test-uid', WORKER);
    expect(asWorker.status).toBe(200);
    expect(asWorker.body.campaigns).toHaveLength(1);
    const c = asWorker.body.campaigns[0];
    expect(c.id).toBe(cid);
    expect(c.responseCount).toBe(1);
    expect(c.participationRate).toBeCloseTo(1 / 20, 10);
    expect(c.hasResponded).toBe(true);
    expect(JSON.stringify(asWorker.body)).not.toContain('"answers"');

    const asPrev = await request(app).get(url).set('x-test-uid', PREVENCIONISTA);
    expect(asPrev.body.campaigns[0].hasResponded).toBe(false);
  });
});

// ── Results (k-gated aggregates) ─────────────────────────────────────────

describe('GET /:projectId/ceal-sm/campaigns/:id/results', () => {
  async function respondAs(
    app: ReturnType<typeof buildApp>,
    cid: string,
    uid: string,
    answers: CealAnswers,
  ) {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      name: 'Faena Norte',
      members: [PREVENCIONISTA, WORKER, uid],
      createdBy: PREVENCIONISTA,
    });
    const res = await request(app)
      .post(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/respond`)
      .set('x-test-uid', uid)
      .send({ answers });
    expect(res.status).toBe(201);
  }

  it('401/403/404 según corresponda', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    const url = `/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/results`;
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set('x-test-uid', 'stranger')).status).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/nope/results`)
          .set('x-test-uid', WORKER)
      ).status,
    ).toBe(404);
  });

  it('suprime TODO agregado bajo el umbral de anonimato (9 < 10)', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    for (let i = 0; i < 9; i++) {
      await respondAs(app, cid, `uid-w${i}`, answersAlto());
    }
    const res = await request(app)
      .get(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/results`)
      .set('x-test-uid', PREVENCIONISTA);
    expect(res.status).toBe(200);
    expect(res.body.insufficientResponses).toBe(true);
    expect(res.body.threshold).toBe(10);
    expect(res.body.result).toBeNull();
    expect(res.body.totalResponses).toBe(9);
    // Ningún agregado por dimensión puede filtrarse.
    expect(JSON.stringify(res.body)).not.toContain('centerRisk');
  });

  it('con n=10 entrega el veredicto del centro calculado por el motor REAL', async () => {
    const app = buildApp();
    const cid = await createCampaign(app);
    for (let i = 0; i < 10; i++) {
      await respondAs(app, cid, `uid-w${i}`, answersAlto());
    }
    const res = await request(app)
      .get(`/api/sprint-k/${PROJECT_ID}/ceal-sm/campaigns/${cid}/results`)
      .set('x-test-uid', PREVENCIONISTA);
    expect(res.status).toBe(200);
    expect(res.body.insufficientResponses).toBe(false);
    const result = res.body.result;
    // 10/10 en alto en las 12 dimensiones → +24 → riesgo alto (Tabla 3/4).
    expect(result.centerScore).toBe(24);
    expect(result.centerRisk).toBe('alto');
    expect(result.dimensions).toHaveLength(12);
    // Participación 10/20 = 50% < 60% → evaluación no válida (sección 9).
    expect(result.participationRate).toBeCloseTo(0.5, 10);
    expect(result.evaluationValid).toBe(false);
    expect(result.requiredActions.join(' ')).toMatch(/60%/);
    expect(result.reevaluationYears).toBe(2);
    // El payload de resultados jamás incluye respuestas individuales.
    expect(JSON.stringify(res.body)).not.toContain('"answers"');
    expect(JSON.stringify(res.body)).not.toContain('responderHash');
  });
});
