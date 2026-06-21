// Real-router supertest for the Explainability HTTP surface
// (src/server/routes/explainability.ts). Two stateless POST endpoints over the
// pure engine in src/services/explainability/recommendationExplainer.ts:
//
//   POST /:projectId/explainability/recommendation → { explained }
//   POST /:projectId/explainability/batch          → { actionable, needsReview }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real explainer output.
//
// Happy-path assertions re-derive the engine's output by calling the REAL
// `explainRecommendation` / `partitionByActionability` on the same input the
// HTTP body carries — never by reimplementing the explainer's logic inline.

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

import explainabilityRouter from '../../server/routes/explainability.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  explainRecommendation,
  explainBatch,
  partitionByActionability,
  type ExplainInput,
} from '../../services/explainability/recommendationExplainer.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', explainabilityRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A recommendation backed by 3 deterministic evidences and 0 LLM → the engine
// computes confidence='high', isFullyDeterministic=true, llmShare=0.
const highConfidenceInput: ExplainInput = {
  recommendation: {
    id: 'rec-1',
    action: 'Detener excavación hasta verificar talud',
    responsibleRole: 'Supervisor de Terreno',
    validUntil: '2026-12-31',
    category: 'geotecnia',
  },
  evidences: [
    {
      id: 'ev-1',
      kind: 'legal_rule',
      description: 'DS 132 art. 132 exige verificación de estabilidad de taludes',
      citation: '(DS-132)',
    },
    {
      id: 'ev-2',
      kind: 'sensor_reading',
      description: 'Inclinómetro registra desplazamiento de 12mm/h',
      citation: '(zk:incl-7)',
    },
    {
      id: 'ev-3',
      kind: 'historical_pattern',
      description: 'Patrón de deslizamiento previo en faena adyacente',
      citation: '(zk:hist-3)',
    },
  ],
};

// A recommendation dominated by LLM inference (no deterministic evidence) → the
// engine computes confidence='low' and the batch route routes it to needsReview.
const lowConfidenceInput: ExplainInput = {
  recommendation: {
    id: 'rec-2',
    action: 'Considerar rotación de turnos por fatiga',
    category: 'fatiga',
  },
  evidences: [
    {
      id: 'ev-4',
      kind: 'llm_inference',
      description: 'El modelo sugiere correlación entre horas extra y microsueños',
      citation: '(llm:fatigue-1)',
    },
  ],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db!._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db!._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/explainability/recommendation', () => {
  const url = '/api/p1/explainability/recommendation';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(highConfidenceInput);
    expect(res.status).toBe(401);
  });

  it('200 returns the real explainer output (high confidence, fully deterministic)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(highConfidenceInput);
    expect(res.status).toBe(200);

    // Re-derive the expected shape from the REAL engine on the same input.
    const expected = explainRecommendation(highConfidenceInput);
    expect(res.body.explained.confidence).toBe('high');
    expect(res.body.explained.confidence).toBe(expected.confidence);
    expect(res.body.explained.isFullyDeterministic).toBe(true);
    expect(res.body.explained.llmInferenceShare).toBe(0);
    expect(res.body.explained.llmInferenceShareExact).toBe(0);
    // Citations are deduped in input order by the engine.
    expect(res.body.explained.citations).toEqual(expected.citations);
    expect(res.body.explained.citations).toEqual(['(DS-132)', '(zk:incl-7)', '(zk:hist-3)']);
    // Markdown carries the action heading + the responsible role from the rec.
    expect(res.body.explained.rationaleMarkdown).toBe(expected.rationaleMarkdown);
    expect(res.body.explained.rationaleMarkdown).toContain('Detener excavación hasta verificar talud');
    expect(res.body.explained.rationaleMarkdown).toContain('Supervisor de Terreno');
    // whyEvidences echoes back exactly the evidences supplied.
    expect(res.body.explained.whyEvidences).toHaveLength(3);
  });

  it('200 low confidence when evidence is LLM-only', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(lowConfidenceInput);
    expect(res.status).toBe(200);
    const expected = explainRecommendation(lowConfidenceInput);
    expect(res.body.explained.confidence).toBe('low');
    expect(res.body.explained.confidence).toBe(expected.confidence);
    expect(res.body.explained.isFullyDeterministic).toBe(false);
    expect(res.body.explained.llmInferenceShareExact).toBe(1);
  });

  it('400 on invalid body (missing recommendation)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ evidences: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an evidence with an unknown kind (enum violation)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        recommendation: highConfidenceInput.recommendation,
        evidences: [
          { id: 'x', kind: 'not_a_real_kind', description: 'd', citation: '(c)' },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when evidences exceed the max of 50', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: `e${i}`,
      kind: 'graph_node' as const,
      description: 'd',
      citation: '(c)',
    }));
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ recommendation: highConfidenceInput.recommendation, evidences: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/explainability/recommendation')
      .set(uid)
      .send(highConfidenceInput);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/explainability/recommendation')
      .set(uid)
      .send(highConfidenceInput);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/explainability/batch', () => {
  const url = '/api/p1/explainability/batch';
  const batchBody = { recommendations: [highConfidenceInput, lowConfidenceInput] };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(batchBody);
    expect(res.status).toBe(401);
  });

  it('200 partitions actionable vs needsReview using the real engine', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(batchBody);
    expect(res.status).toBe(200);

    // Re-derive the partition from the REAL engine on the same inputs.
    const explained = explainBatch(batchBody.recommendations);
    const expected = partitionByActionability(explained);
    expect(res.body.actionable).toHaveLength(expected.actionable.length);
    expect(res.body.needsReview).toHaveLength(expected.needsReview.length);
    // The high-confidence rec is actionable; the LLM-only one needs review.
    expect(res.body.actionable).toHaveLength(1);
    expect(res.body.needsReview).toHaveLength(1);
    expect(res.body.actionable[0].recommendation.id).toBe('rec-1');
    expect(res.body.actionable[0].confidence).toBe('high');
    expect(res.body.needsReview[0].recommendation.id).toBe('rec-2');
    expect(res.body.needsReview[0].confidence).toBe('low');
  });

  it('400 when recommendations is empty (min 1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ recommendations: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when recommendations is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a nested recommendation entry is malformed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ recommendations: [{ recommendation: { id: 'r' }, evidences: [] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/explainability/batch')
      .set(uid)
      .send(batchBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
