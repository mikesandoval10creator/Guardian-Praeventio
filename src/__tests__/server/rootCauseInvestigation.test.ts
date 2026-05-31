// Praeventio Guard — Real-router supertest for
// src/server/routes/rootCauseInvestigation.ts (Plan v3 Fase 1).
//
// Route is mounted at /api/sprint-k in server.ts (line 1007).
// 4 pure-compute POST endpoints behind verifyAuth + validate(zod) + guard():
//   POST /:projectId/investigations/build-tree
//   POST /:projectId/investigations/extract-chain
//   POST /:projectId/investigations/classify-category
//   POST /:projectId/investigations/is-shallow-answer
//
// NOTE on z.record() fix (lines ~77-78 of the route):
//   `nodeInputSchema` and `treeSchema` were `z.unknown()` which accepted
//   undefined, causing validate() to pass and the engine to throw TypeError
//   → 500 when the field was absent. Both schemas are now z.record(z.string(),
//   z.unknown()), which requires an object, so a missing field is rejected by
//   validate() with 400 / invalid_payload before the engine is reached.
//   Fixed at: src/server/routes/rootCauseInvestigation.ts:77-78.

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

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import rootCauseInvestigationRouter from '../../server/routes/rootCauseInvestigation.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// Mirror the mount point from server.ts line 1007:
// app.use('/api/sprint-k', rootCauseInvestigationRouter);
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', rootCauseInvestigationRouter);
  return app;
}

const PROJECT_ID = 'p-rci-test';
const CALLER_UID = 'uid-rci-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'RCI Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// Minimal valid NodeInput for build-tree
const minRoot = {
  id: 'n1',
  question: '¿Por qué falló el equipo?',
  answer: 'El motor de la máquina sufrió sobrecalentamiento por falta de mantención preventiva y lubricación adecuada',
};

// A valid InvestigationTree (pre-built) for extract-chain tests
const minTree = {
  incidentId: 'INC-001',
  rootQuestion: '¿Por qué ocurrió el accidente?',
  root: {
    id: 'n1',
    question: '¿Por qué falló el equipo?',
    answer: 'El motor de la máquina sufrió sobrecalentamiento por falta de mantención preventiva',
    category: 'machine' as const,
    depth: 0,
    shallow: false,
    children: [],
  },
  coveredCategories: ['machine' as const],
  nextQuestion: null,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/investigations/build-tree
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/investigations/build-tree', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/investigations/build-tree`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ incidentId: 'INC-001', rootQuestion: '¿Por qué?', root: minRoot });
    expect(res.status).toBe(401);
  });

  it('400 when incidentId is missing (real zod validate catches it)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ rootQuestion: '¿Por qué?', root: minRoot }); // no incidentId
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when rootQuestion is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ incidentId: 'INC-001', root: minRoot }); // no rootQuestion
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ incidentId: 'INC-001', rootQuestion: '¿Por qué?', root: minRoot });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/investigations/build-tree`)
      .set('x-test-uid', CALLER_UID)
      .send({ incidentId: 'INC-001', rootQuestion: '¿Por qué?', root: minRoot });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — returns tree with correct shape', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ incidentId: 'INC-001', rootQuestion: '¿Por qué falló el sistema?', root: minRoot });
    expect(res.status).toBe(200);
    const { tree } = res.body as { tree: Record<string, unknown> };
    expect(tree.incidentId).toBe('INC-001');
    expect(tree.rootQuestion).toBe('¿Por qué falló el sistema?');
    expect(typeof tree.root).toBe('object');
    expect(Array.isArray(tree.coveredCategories)).toBe(true);
    // nextQuestion is null or an object (deterministic)
    expect(tree).toHaveProperty('nextQuestion');
  });

  it('200 root node is classified and shallow field is populated', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ incidentId: 'INC-002', rootQuestion: '¿Por qué falló?', root: minRoot });
    expect(res.status).toBe(200);
    const { tree } = res.body as { tree: { root: Record<string, unknown>; coveredCategories: string[] } };
    expect(tree.root.id).toBe('n1');
    expect(tree.root.depth).toBe(0);
    expect(typeof tree.root.category).toBe('string');
    expect(typeof tree.root.shallow).toBe('boolean');
    // "máquina" keyword → machine category
    expect(tree.root.category).toBe('machine');
    // Long, specific answer → not shallow
    expect(tree.root.shallow).toBe(false);
    // covered categories includes machine
    expect(tree.coveredCategories).toContain('machine');
  });

  it('200 shallow answer detected when answer is generic', async () => {
    const shallowRoot = {
      id: 'n-shallow',
      question: '¿Por qué ocurrió?',
      answer: 'error humano', // known shallow term
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ incidentId: 'INC-003', rootQuestion: '¿Por qué?', root: shallowRoot });
    expect(res.status).toBe(200);
    const { tree } = res.body as { tree: { root: { shallow: boolean }; nextQuestion: Record<string, unknown> | null } };
    expect(tree.root.shallow).toBe(true);
    // nextQuestion should suggest drilling deeper into the shallow node
    expect(tree.nextQuestion).not.toBeNull();
    expect(tree.nextQuestion!.reason).toBe('shallow_answer');
    expect(tree.nextQuestion!.targetNodeId).toBe('n-shallow');
  });

  it('200 nested children processed correctly', async () => {
    const deepRoot = {
      id: 'n1',
      question: '¿Por qué falló el equipo?',
      answer: 'El motor de la máquina principal sufrió daños por sobrecalentamiento excesivo',
      children: [
        {
          id: 'n2',
          question: '¿Por qué el motor se sobrecalentó?',
          answer: 'El procedimiento de inspección del ventilador no se siguió correctamente en la rutina',
        },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ incidentId: 'INC-004', rootQuestion: '¿Por qué falló?', root: deepRoot });
    expect(res.status).toBe(200);
    const { tree } = res.body as { tree: { root: { children: unknown[] }; coveredCategories: string[] } };
    expect(tree.root.children).toHaveLength(1);
    expect(tree.coveredCategories.length).toBeGreaterThanOrEqual(1);
  });

  it('400 engine InvestigationValidationError on duplicate node id', async () => {
    // The engine throws InvestigationValidationError('DUPLICATE_ID', ...) → route maps to 400
    const dupRoot = {
      id: 'dup-id',
      question: '¿Por qué?',
      answer: 'El motor de la máquina tuvo una falla técnica grave inesperada',
      children: [
        {
          id: 'dup-id', // duplicate!
          question: '¿Por qué 2?',
          answer: 'El supervisor del área no verificó el estado del equipo antes del turno',
        },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ incidentId: 'INC-005', rootQuestion: '¿Por qué?', root: dupRoot });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('DUPLICATE_ID');
    expect(res.body.code).toBe('DUPLICATE_ID');
  });

  // ── z.record() fix probe ─────────────────────────────────────────────────
  // nodeInputSchema is now z.record(z.string(), z.unknown()) which requires an
  // object. When `root` is absent from the body, validate() rejects with 400
  // before the engine is ever called — no more TypeError → 500.
  // FIXED at: src/server/routes/rootCauseInvestigation.ts:77
  it('400 missing root field → validate() rejects with invalid_payload (z.record requires object)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        incidentId: 'INC-BUG',
        rootQuestion: '¿Por qué falló?',
        // `root` field intentionally omitted — z.record rejects undefined → 400
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/investigations/extract-chain
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/investigations/extract-chain', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/investigations/extract-chain`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ tree: minTree });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ tree: minTree });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns chain from deepest branch (single node)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ tree: minTree });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.chain)).toBe(true);
    expect(res.body.chain).toHaveLength(1);
    expect(res.body.chain[0]).toBe('¿Por qué falló el equipo?');
  });

  it('200 returns chain following deepest branch for nested tree', async () => {
    const deepTree = {
      ...minTree,
      root: {
        ...minTree.root,
        children: [
          {
            id: 'n2',
            question: '¿Por qué el motor se sobrecalentó?',
            answer: 'Falta de mantención preventiva del sistema de refrigeración',
            category: 'method' as const,
            depth: 1,
            shallow: false,
            children: [
              {
                id: 'n3',
                question: '¿Por qué no se hizo la mantención?',
                answer: 'No había procedimiento documentado para la frecuencia de mantención',
                category: 'method' as const,
                depth: 2,
                shallow: false,
                children: [],
              },
            ],
          },
        ],
      },
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ tree: deepTree });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.chain)).toBe(true);
    // chain should include root + deepest path nodes' questions
    expect(res.body.chain).toHaveLength(3);
    expect(res.body.chain[0]).toBe('¿Por qué falló el equipo?');
    expect(res.body.chain[1]).toBe('¿Por qué el motor se sobrecalentó?');
    expect(res.body.chain[2]).toBe('¿Por qué no se hizo la mantención?');
  });

  // ── z.record() fix probe for tree field ─────────────────────────────────
  // treeSchema is now z.record(z.string(), z.unknown()) which requires an
  // object. When `tree` is absent from the body, validate() rejects with 400
  // before extractDeepestChain is ever called — no more TypeError → 500.
  // FIXED at: src/server/routes/rootCauseInvestigation.ts:78
  it('400 missing tree field → validate() rejects with invalid_payload (z.record requires object)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({}); // tree field intentionally missing — z.record rejects undefined → 400
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/investigations/classify-category
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/investigations/classify-category', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/investigations/classify-category`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ text: 'falla en máquina' });
    expect(res.status).toBe(401);
  });

  it('400 when text is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({}); // no text
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when text is empty string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when text exceeds 2000 chars', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ text: 'falla en la máquina' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 machine keyword → machine category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'falla en la máquina principal del proceso' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('machine');
  });

  it('200 method keyword → method category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'el procedimiento no estaba documentado correctamente' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('method');
  });

  it('200 material keyword → material category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'el material utilizado era de baja calidad' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('material');
  });

  it('200 environment keyword → environment category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'el clima lluvioso y la temperatura baja afectaron la operación' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('environment');
  });

  it('200 man keyword → man category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'el trabajador tenía fatiga acumulada y falta de capacitación' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('man');
  });

  it('200 measurement keyword → measurement category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'la medición del sensor estaba descalibrada fuera del rango' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('measurement');
  });

  it('200 no keyword match → defaults to man', async () => {
    // When no keyword matches, classifyCategory defaults to 'man'
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ text: 'algo ocurrió en algún lugar sin detalles específicos' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('man');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/investigations/is-shallow-answer
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/investigations/is-shallow-answer', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/investigations/is-shallow-answer`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ answer: 'error humano' });
    expect(res.status).toBe(401);
  });

  it('400 when answer is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when answer is empty string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ answer: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ answer: 'error humano' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 "error humano" → shallow=true (known shallow term)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ answer: 'error humano' });
    expect(res.status).toBe(200);
    expect(res.body.shallow).toBe(true);
  });

  it('200 "descuido" → shallow=true (known shallow term)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ answer: 'fue por descuido del operador' });
    expect(res.status).toBe(200);
    expect(res.body.shallow).toBe(true);
  });

  it('200 very short answer (≤4 words) → shallow=true', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ answer: 'se cayó solo' }); // 3 words
    expect(res.status).toBe(200);
    expect(res.body.shallow).toBe(true);
  });

  it('200 detailed answer (>4 words, no shallow terms) → shallow=false', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        answer:
          'El sello del cilindro hidráulico presentó desgaste prematuro debido a la presencia de contaminantes abrasivos en el fluido hidráulico',
      });
    expect(res.status).toBe(200);
    expect(res.body.shallow).toBe(false);
  });

  it('200 "no se sabe" → shallow=true (known shallow term)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ answer: 'no se sabe exactamente por qué pasó' });
    expect(res.status).toBe(200);
    expect(res.body.shallow).toBe(true);
  });

  it('200 "mala suerte" → shallow=true', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ answer: 'fue pura mala suerte que pasó' });
    expect(res.status).toBe(200);
    expect(res.body.shallow).toBe(true);
  });

  it('200 "siempre pasa" → shallow=true', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ answer: 'esto siempre pasa en este turno de trabajo' });
    expect(res.status).toBe(200);
    expect(res.body.shallow).toBe(true);
  });
});
