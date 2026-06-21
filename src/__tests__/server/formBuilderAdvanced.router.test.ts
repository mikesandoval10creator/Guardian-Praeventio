// Real-router supertest for the Form Builder ADVANCED HTTP surface
// (src/server/routes/formBuilderAdvanced.ts). Five stateless POST endpoints
// over the deterministic engine in
// src/services/formBuilderAdvanced/advancedFieldEngine.ts:
//
//   POST /:projectId/forms-advanced/evaluate-computed-field → { value }
//   POST /:projectId/forms-advanced/validate-cross-field     → { findings }
//   POST /:projectId/forms-advanced/detect-circular-deps     → { cyclic }
//   POST /:projectId/forms-advanced/topo-sort                → { order } | 400
//   POST /:projectId/forms-advanced/evaluate-all-computed    → { values } | 400
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + captureRouteError are
// mocked infra; the engine itself runs UNMOCKED so every 200 asserts the real
// recursive-descent evaluator output (re-derived here, not copied from the
// handler).

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
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import formBuilderAdvancedRouter from '../../server/routes/formBuilderAdvanced.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  evaluateComputedField,
  validateCrossFieldRules,
  detectCircularDependencies,
  topologicalSortFields,
  evaluateAllComputed,
  type ComputedFieldFormula,
  type CrossFieldValidationRule,
  type AdvancedFormResponse,
} from '../../services/formBuilderAdvanced/advancedFieldEngine.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', formBuilderAdvancedRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };
// Fixed clock so any date helper in an expression is deterministic.
const NOW = '2026-05-01T00:00:00.000Z';

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of p1; p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. evaluate-computed-field
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/forms-advanced/evaluate-computed-field', () => {
  const url = '/api/p1/forms-advanced/evaluate-computed-field';
  const formula: ComputedFieldFormula = {
    fieldId: 'total',
    expression: '${a} + ${b}',
    dependencies: ['a', 'b'],
    resultKind: 'number',
  };
  const responses: AdvancedFormResponse[] = [
    { fieldId: 'a', value: 2 },
    { fieldId: 'b', value: 3 },
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ formula, responses });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine value for an arithmetic formula', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formula, responses });
    expect(res.status).toBe(200);
    // Re-derive from the real engine — 2 + 3 = 5, coerced to number.
    const expected = evaluateComputedField(formula, responses);
    expect(expected).toBe(5);
    expect(res.body.value).toBe(expected);
  });

  it('200 honors the injected now() for date helpers (deterministic)', async () => {
    const dateFormula: ComputedFieldFormula = {
      fieldId: 'edad',
      expression: 'yearsBetween(${birth}, now())',
      dependencies: ['birth'],
      resultKind: 'number',
    };
    const birthResponses: AdvancedFormResponse[] = [
      { fieldId: 'birth', value: '2000-05-01T00:00:00.000Z' },
    ];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formula: dateFormula, responses: birthResponses, now: NOW });
    expect(res.status).toBe(200);
    const expected = evaluateComputedField(dateFormula, birthResponses, {
      now: new Date(NOW),
    });
    expect(expected).toBe(26);
    expect(res.body.value).toBe(expected);
  });

  it('400 when the expression is an invalid sub-language string (AdvancedFieldError)', async () => {
    // A bare identifier is rejected by the parser → AdvancedFieldError, which
    // the router maps to 400 with { error, code }.
    const badFormula: ComputedFieldFormula = {
      fieldId: 'x',
      expression: 'foo',
      dependencies: [],
      resultKind: 'number',
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formula: badFormula, responses: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('parse_bare_identifier');
    expect(typeof res.body.error).toBe('string');
  });

  it('400 on an invalid body (formula missing required keys)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formula: { fieldId: 'x' }, responses: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/forms-advanced/evaluate-computed-field')
      .set(uid)
      .send({ formula, responses });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/forms-advanced/evaluate-computed-field')
      .set(uid)
      .send({ formula, responses });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. validate-cross-field
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/forms-advanced/validate-cross-field', () => {
  const url = '/api/p1/forms-advanced/validate-cross-field';
  const rules: CrossFieldValidationRule[] = [
    {
      ruleId: 'r1',
      fields: ['min', 'max'],
      predicate: '${min} < ${max}',
      errorMessage: 'min debe ser menor que max',
    },
    {
      ruleId: 'r2',
      fields: ['min', 'max'],
      predicate: '${max} < ${min}',
      errorMessage: 'esta regla no se cumple',
    },
  ];
  const responses: AdvancedFormResponse[] = [
    { fieldId: 'min', value: 1 },
    { fieldId: 'max', value: 10 },
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ rules, responses });
    expect(res.status).toBe(401);
  });

  it('200 returns real findings (one pass, one fail with errorMessage)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ rules, responses });
    expect(res.status).toBe(200);
    const expected = validateCrossFieldRules(rules, responses);
    expect(expected).toEqual([
      { ruleId: 'r1', passed: true, errorMessage: undefined },
      { ruleId: 'r2', passed: false, errorMessage: 'esta regla no se cumple' },
    ]);
    // JSON drops the `undefined` errorMessage on the passing rule.
    expect(res.body.findings).toEqual([
      { ruleId: 'r1', passed: true },
      { ruleId: 'r2', passed: false, errorMessage: 'esta regla no se cumple' },
    ]);
  });

  it('400 on an invalid body (rules not an array)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ rules: 'nope', responses });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/forms-advanced/validate-cross-field')
      .set(uid)
      .send({ rules, responses });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. detect-circular-deps
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/forms-advanced/detect-circular-deps', () => {
  const url = '/api/p1/forms-advanced/detect-circular-deps';
  const cyclicFormulas: ComputedFieldFormula[] = [
    { fieldId: 'a', expression: '${b}', dependencies: ['b'], resultKind: 'number' },
    { fieldId: 'b', expression: '${a}', dependencies: ['a'], resultKind: 'number' },
  ];
  const acyclicFormulas: ComputedFieldFormula[] = [
    { fieldId: 'a', expression: '${b} + 1', dependencies: ['b'], resultKind: 'number' },
    { fieldId: 'b', expression: '2', dependencies: [], resultKind: 'number' },
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ formulas: cyclicFormulas });
    expect(res.status).toBe(401);
  });

  it('200 reports the field IDs in a cycle', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas: cyclicFormulas });
    expect(res.status).toBe(200);
    const expected = detectCircularDependencies(cyclicFormulas);
    expect(expected).toEqual(['a', 'b']);
    expect(res.body.cyclic.slice().sort()).toEqual(['a', 'b']);
  });

  it('200 returns an empty cyclic list for an acyclic graph', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas: acyclicFormulas });
    expect(res.status).toBe(200);
    expect(res.body.cyclic).toEqual([]);
  });

  it('400 on an invalid body (formulas not an array)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/forms-advanced/detect-circular-deps')
      .set(uid)
      .send({ formulas: cyclicFormulas });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. topo-sort
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/forms-advanced/topo-sort', () => {
  const url = '/api/p1/forms-advanced/topo-sort';
  // a depends on b; b has no deps → b must be ordered before a.
  const formulas: ComputedFieldFormula[] = [
    { fieldId: 'a', expression: '${b} + 1', dependencies: ['b'], resultKind: 'number' },
    { fieldId: 'b', expression: '2', dependencies: [], resultKind: 'number' },
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ formulas });
    expect(res.status).toBe(401);
  });

  it('200 returns a dependency-respecting evaluation order', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas });
    expect(res.status).toBe(200);
    const expected = topologicalSortFields(formulas);
    expect(expected).toEqual(['b', 'a']);
    expect(res.body.order).toEqual(['b', 'a']);
  });

  it('400 when the graph has a cycle (AdvancedFieldError topo_cycle)', async () => {
    const cyclic: ComputedFieldFormula[] = [
      { fieldId: 'a', expression: '${b}', dependencies: ['b'], resultKind: 'number' },
      { fieldId: 'b', expression: '${a}', dependencies: ['a'], resultKind: 'number' },
    ];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas: cyclic });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('topo_cycle');
    expect(typeof res.body.error).toBe('string');
  });

  it('400 on an invalid body (formulas missing)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/forms-advanced/topo-sort')
      .set(uid)
      .send({ formulas });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. evaluate-all-computed
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/forms-advanced/evaluate-all-computed', () => {
  const url = '/api/p1/forms-advanced/evaluate-all-computed';
  // total = a + b; doubled = ${total} * 2 (depends on the computed `total`).
  const formulas: ComputedFieldFormula[] = [
    {
      fieldId: 'total',
      expression: '${a} + ${b}',
      dependencies: ['a', 'b'],
      resultKind: 'number',
    },
    {
      fieldId: 'doubled',
      expression: '${total} * 2',
      dependencies: ['total'],
      resultKind: 'number',
    },
  ];
  const responses: AdvancedFormResponse[] = [
    { fieldId: 'a', value: 4 },
    { fieldId: 'b', value: 6 },
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ formulas, responses });
    expect(res.status).toBe(401);
  });

  it('200 evaluates all computed fields, propagating upstream results', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas, responses, otherFieldIds: ['a', 'b'] });
    expect(res.status).toBe(200);
    // Re-derive from the real engine: total = 10, doubled = 20.
    const expected = evaluateAllComputed(formulas, responses, {
      otherFieldIds: ['a', 'b'],
    });
    expect(expected).toEqual({ total: 10, doubled: 20 });
    expect(res.body.values).toEqual({ total: 10, doubled: 20 });
  });

  it('400 when the graph has a cycle (AdvancedFieldError topo_cycle)', async () => {
    const cyclic: ComputedFieldFormula[] = [
      { fieldId: 'a', expression: '${b}', dependencies: ['b'], resultKind: 'number' },
      { fieldId: 'b', expression: '${a}', dependencies: ['a'], resultKind: 'number' },
    ];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas: cyclic, responses: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('topo_cycle');
  });

  it('400 on an invalid body (responses not an array)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ formulas, responses: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/forms-advanced/evaluate-all-computed')
      .set(uid)
      .send({ formulas, responses });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
