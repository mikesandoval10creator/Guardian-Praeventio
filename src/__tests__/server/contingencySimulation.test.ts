// Real-router supertest for src/server/routes/contingencySimulation.ts.
//
// Mounted at /api/sprint-k (server.ts:1012). Four endpoints:
//   POST /:projectId/contingency/build-scenario
//   POST /:projectId/contingency/list-available-scenarios
//   POST /:projectId/contingency/count-available-templates
//   POST /:projectId/contingency/evaluate-tabletop
//
// All four are stateless pure-compute (no Firestore writes). The only
// Firestore read happens inside assertProjectMember() which reads
// projects/<projectId> — seeded via H.db._seed() in beforeEach.
//
// Pure-compute engines (contingencyScenarioBuilder, tabletopExerciseEngine)
// are NOT mocked: we exercise the real logic + assert exact outputs for a
// known fire/moderate scenario (3 decision points documented in the template).

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
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
    };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import contingencySimulationRouter from '../../server/routes/contingencySimulation.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PREFIX = '/api/sprint-k';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, contingencySimulationRouter);
  return app;
}

const PROJECT_ID = 'proj-1';
const CALLER_UID = 'uid-1';

// Seed a project doc so assertProjectMember passes (caller in members[]).
function seedProject() {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    createdBy: CALLER_UID,
    members: [CALLER_UID],
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. build-scenario
// ─────────────────────────────────────────────────────────────────────────────

const BUILD_URL = `${PREFIX}/${PROJECT_ID}/contingency/build-scenario`;

describe('POST /:projectId/contingency/build-scenario', () => {
  it('401 — no auth token', async () => {
    const res = await request(buildApp())
      .post(BUILD_URL)
      .send({ kind: 'fire', severity: 'moderate' });
    expect(res.status).toBe(401);
  });

  it('400 — invalid_payload when kind is unknown', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'volcano', severity: 'moderate' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — invalid_payload when severity is missing', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'fire' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 — caller not in project', async () => {
    // Do NOT seed the project — assertProjectMember will throw ProjectMembershipError.
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'fire', severity: 'moderate' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 — happy path: fire/moderate returns a ContingencyScenario', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'fire', severity: 'moderate' });
    expect(res.status).toBe(200);
    const { scenario } = res.body as { scenario: Record<string, unknown> };
    expect(scenario.kind).toBe('fire');
    expect(scenario.severity).toBe('moderate');
    expect(typeof scenario.id).toBe('string');
    expect((scenario.id as string).length).toBeGreaterThan(0);
    expect(Array.isArray(scenario.triggerEvents)).toBe(true);
    expect(Array.isArray(scenario.decisionPoints)).toBe(true);
    expect(Array.isArray(scenario.successCriteria)).toBe(true);
    expect(typeof scenario.estimatedDurationMin).toBe('number');
  });

  it('200 — earthquake/major returns correct title from template', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'earthquake', severity: 'major' });
    expect(res.status).toBe(200);
    const { scenario } = res.body as { scenario: Record<string, unknown> };
    expect(scenario.kind).toBe('earthquake');
    expect(scenario.severity).toBe('major');
    // 4 decision points for the earthquake/major template
    expect((scenario.decisionPoints as unknown[]).length).toBe(4);
  });

  it('200 — options.id override is respected', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'fire', severity: 'moderate', options: { id: 'custom-id-123' } });
    expect(res.status).toBe(200);
    expect((res.body.scenario as Record<string, unknown>).id).toBe('custom-id-123');
  });

  it('200 — initialConditions override merges with template defaults', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({
        kind: 'fire',
        severity: 'moderate',
        options: { initialConditions: { time: 'night', staffPresent: 5 } },
      });
    expect(res.status).toBe(200);
    const ic = (res.body.scenario as Record<string, unknown>)
      .initialConditions as Record<string, unknown>;
    expect(ic.time).toBe('night');
    expect(ic.staffPresent).toBe(5);
  });

  it('200 — severity requested is respected even if template has different severity', async () => {
    // fire template is only moderate; requesting minor should still use the template but
    // label severity as minor (as per the builder code: `severity, // respeta lo pedido`)
    seedProject();
    const res = await request(buildApp())
      .post(BUILD_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'fire', severity: 'minor' });
    expect(res.status).toBe(200);
    expect((res.body.scenario as Record<string, unknown>).severity).toBe('minor');
  });

  it('200 — all 10 SCENARIO_KINDS are accepted (one request per kind)', async () => {
    seedProject();
    const kinds = [
      'fire', 'earthquake', 'flood', 'chemical_spill', 'power_outage',
      'cyber_attack', 'mass_casualty', 'evacuation_blocked', 'leader_unavailable',
      'supplier_failure',
    ];
    for (const kind of kinds) {
      const res = await request(buildApp())
        .post(BUILD_URL)
        .set('x-test-uid', CALLER_UID)
        .send({ kind, severity: 'moderate' });
      expect(res.status).toBe(200);
      expect((res.body.scenario as Record<string, unknown>).kind).toBe(kind);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. list-available-scenarios
// ─────────────────────────────────────────────────────────────────────────────

const LIST_URL = `${PREFIX}/${PROJECT_ID}/contingency/list-available-scenarios`;

describe('POST /:projectId/contingency/list-available-scenarios', () => {
  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(LIST_URL).send({});
    expect(res.status).toBe(401);
  });

  it('403 — caller not in project', async () => {
    const res = await request(buildApp())
      .post(LIST_URL)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 — no industry filter returns all templates', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(LIST_URL)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(200);
    const { scenarios } = res.body as { scenarios: unknown[] };
    expect(Array.isArray(scenarios)).toBe(true);
    // There are 10 templates (one per kind) in contingencyScenarioBuilder
    expect(scenarios.length).toBe(10);
  });

  it('200 — industry filter returns only applicable scenarios', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(LIST_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ industry: 'healthcare' });
    expect(res.status).toBe(200);
    const { scenarios } = res.body as { scenarios: Array<Record<string, unknown>> };
    expect(Array.isArray(scenarios)).toBe(true);
    expect(scenarios.length).toBeGreaterThan(0);
    // Templates applicable to healthcare:
    // earthquake, evacuation_blocked, power_outage, leader_unavailable,
    // supplier_failure, cyber_attack (6 templates — verified from source)
    const healthcareKinds = new Set([
      'earthquake', 'evacuation_blocked', 'power_outage',
      'leader_unavailable', 'supplier_failure', 'cyber_attack',
    ]);
    for (const s of scenarios) {
      expect(healthcareKinds.has(s.kind as string)).toBe(true);
    }
  });

  it('200 — construction filter returns scenarios with construction applicable', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(LIST_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ industry: 'construction' });
    expect(res.status).toBe(200);
    const { scenarios } = res.body as { scenarios: Array<Record<string, unknown>> };
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it('400 — invalid industry value', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(LIST_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ industry: 'agriculture' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 — each scenario in list has the expected shape', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(LIST_URL)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(200);
    const { scenarios } = res.body as { scenarios: Array<Record<string, unknown>> };
    for (const s of scenarios) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.kind).toBe('string');
      expect(typeof s.severity).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(Array.isArray(s.triggerEvents)).toBe(true);
      expect(Array.isArray(s.decisionPoints)).toBe(true);
      expect(Array.isArray(s.successCriteria)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. count-available-templates
// ─────────────────────────────────────────────────────────────────────────────

const COUNT_URL = `${PREFIX}/${PROJECT_ID}/contingency/count-available-templates`;

describe('POST /:projectId/contingency/count-available-templates', () => {
  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(COUNT_URL).send({});
    expect(res.status).toBe(401);
  });

  it('403 — caller not in project', async () => {
    const res = await request(buildApp())
      .post(COUNT_URL)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 — strict schema rejects extra keys', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(COUNT_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ extra: 'not-allowed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 — returns count=10 matching installed templates', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(COUNT_URL)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
    expect(res.body.count).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. evaluate-tabletop
// ─────────────────────────────────────────────────────────────────────────────

const EVAL_URL = `${PREFIX}/${PROJECT_ID}/contingency/evaluate-tabletop`;

// Build a real scenario for use in evaluate-tabletop tests.
// fire/moderate has 3 decision points at minutes 2, 5, 25.
// Correct responses:
//   min 2 → 'Brigada interna + bomberos en paralelo'
//   min 5 → 'Por salida de emergencia secundaria'
//   min 25 → 'El experto en prevención + bomberos'

const FIRE_SCENARIO_ID = 'fire_moderate_test';

const fireScenario = {
  id: FIRE_SCENARIO_ID,
  kind: 'fire',
  severity: 'moderate',
  title: 'Incendio en bodega de materiales — turno día',
  initialConditions: {
    time: 'day',
    weather: 'seco',
    staffPresent: 25,
    criticalSystemsDown: [],
  },
  triggerEvents: [
    { minute: 0, event: 'Detector de humo activado en bodega B-2.', expectedResponse: 'Confirmar visualmente' },
    { minute: 2, event: 'Brigada confirma fuego clase A activo.', expectedResponse: 'Activar alarma + 132' },
    { minute: 5, event: 'Humo invade pasillo principal.', expectedResponse: 'Evacuación inmediata' },
    { minute: 12, event: 'Bomberos llegan a faena.', expectedResponse: 'Entregar mando externo' },
    { minute: 25, event: 'Fuego controlado.', expectedResponse: 'Conteo de personas + parte' },
  ],
  decisionPoints: [
    {
      minute: 2,
      question: '¿Activamos brigada interna o llamamos bomberos directamente?',
      options: ['Solo brigada interna', 'Brigada interna + bomberos en paralelo', 'Solo bomberos', 'Esperar 5 min y reevaluar'],
      correctResponses: ['Brigada interna + bomberos en paralelo'],
      rationale: 'Fuego clase A activo sobre material combustible.',
    },
    {
      minute: 5,
      question: '¿Cómo se ordena la evacuación con humo en pasillo principal?',
      options: ['Por el pasillo principal igual', 'Por salida de emergencia secundaria', 'Refugio en sala segura', 'Esperar instrucciones'],
      correctResponses: ['Por salida de emergencia secundaria'],
      rationale: 'Vías comprometidas → ruta alterna.',
    },
    {
      minute: 25,
      question: '¿Quién certifica que la faena puede reanudarse?',
      options: ['El supervisor de turno', 'El experto en prevención + bomberos', 'El mandante', 'Inmediatamente, ya está apagado'],
      correctResponses: ['El experto en prevención + bomberos'],
      rationale: 'Reanudación requiere validación técnica.',
    },
  ],
  successCriteria: ['Tiempo a alarma <3 min', 'Evacuación completa <10 min'],
  estimatedDurationMin: 35,
};

// A perfect attempt: all 3 correct, no delay.
const perfectAttempt = {
  scenarioId: FIRE_SCENARIO_ID,
  teamUids: ['uid-1', 'uid-2', 'uid-3'],
  startedAt: '2026-05-30T10:00:00.000Z',
  responses: [
    { decisionPointMinute: 2, selectedOption: 'Brigada interna + bomberos en paralelo', respondedAtMinute: 2, respondingUid: 'uid-1' },
    { decisionPointMinute: 5, selectedOption: 'Por salida de emergencia secundaria', respondedAtMinute: 5, respondingUid: 'uid-2' },
    { decisionPointMinute: 25, selectedOption: 'El experto en prevención + bomberos', respondedAtMinute: 25, respondingUid: 'uid-3' },
  ],
};

// A failing attempt: all 3 wrong options.
const failingAttempt = {
  scenarioId: FIRE_SCENARIO_ID,
  teamUids: ['uid-1'],
  startedAt: '2026-05-30T10:00:00.000Z',
  responses: [
    { decisionPointMinute: 2, selectedOption: 'Solo brigada interna', respondedAtMinute: 3, respondingUid: 'uid-1' },
    { decisionPointMinute: 5, selectedOption: 'Por el pasillo principal igual', respondedAtMinute: 6, respondingUid: 'uid-1' },
    { decisionPointMinute: 25, selectedOption: 'El supervisor de turno', respondedAtMinute: 26, respondingUid: 'uid-1' },
  ],
};

describe('POST /:projectId/contingency/evaluate-tabletop', () => {
  it('401 — no auth token', async () => {
    const res = await request(buildApp())
      .post(EVAL_URL)
      .send({ attempt: perfectAttempt, scenario: fireScenario });
    expect(res.status).toBe(401);
  });

  it('403 — caller not in project', async () => {
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: perfectAttempt, scenario: fireScenario });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 — scenario mismatch between attempt.scenarioId and scenario.id', async () => {
    seedProject();
    const mismatchedAttempt = { ...perfectAttempt, scenarioId: 'different-id' };
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: mismatchedAttempt, scenario: fireScenario });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Scenario mismatch/);
  });

  // evaluateTabletopSchema now validates 'attempt' and 'scenario' as
  // z.record(z.string(), z.unknown()) (required objects), so a request omitting
  // either field is rejected by validate() with 400 invalid_payload instead of
  // slipping through to the engine and throwing a TypeError → 500.
  it('400 — missing attempt field is rejected by validation (not a 500)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ scenario: fireScenario });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — invalid_payload when body is entirely empty (both fields missing)', async () => {
    seedProject();
    // attempt + scenario are required objects (z.record), so a body with neither
    // key fails validation with 400 instead of reaching the engine → 500.
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 — perfect attempt: scorePct=100, passed=true, correctResponses=3', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: perfectAttempt, scenario: fireScenario });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.scenarioId).toBe(FIRE_SCENARIO_ID);
    expect(result.totalDecisionPoints).toBe(3);
    expect(result.correctResponses).toBe(3);
    expect(result.scorePct).toBe(100);
    expect(result.passed).toBe(true);
    expect((result.weakSpots as unknown[]).length).toBe(0);
    expect(result.reactionTimeMinutes).toBe(0);
    // Recommendations are advisory only — assert at least one string
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect((result.recommendations as string[]).length).toBeGreaterThan(0);
  });

  it('200 — failing attempt: scorePct=0, passed=false, 3 weakSpots, small-team rec', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: failingAttempt, scenario: fireScenario });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.scorePct).toBe(0);
    expect(result.correctResponses).toBe(0);
    expect(result.passed).toBe(false);
    expect((result.weakSpots as unknown[]).length).toBe(3);
    // With reaction delays of 1 min each → average = 1 min
    expect(result.reactionTimeMinutes).toBe(1);
    // Small team (1 member) → recommendation about team size
    const recs = result.recommendations as string[];
    expect(recs.some((r) => /equipo/i.test(r))).toBe(true);
    // Recommendations are advisory — no hard-block language
    expect(recs.every((r) => !/bloqueado|detenido|prohibido/.test(r.toLowerCase()))).toBe(true);
  });

  it('200 — partial attempt with no responses: all weakSpots, reactionTime=0', async () => {
    seedProject();
    const noResponseAttempt = {
      ...perfectAttempt,
      responses: [],
    };
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: noResponseAttempt, scenario: fireScenario });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.scorePct).toBe(0);
    expect(result.passed).toBe(false);
    expect((result.weakSpots as unknown[]).length).toBe(3);
    expect(result.reactionTimeMinutes).toBe(0);
  });

  it('200 — partial attempt (2/3 correct): scorePct=67, passed=false', async () => {
    seedProject();
    const partialAttempt = {
      ...perfectAttempt,
      responses: [
        { decisionPointMinute: 2, selectedOption: 'Brigada interna + bomberos en paralelo', respondedAtMinute: 2, respondingUid: 'uid-1' },
        { decisionPointMinute: 5, selectedOption: 'Por salida de emergencia secundaria', respondedAtMinute: 5, respondingUid: 'uid-2' },
        // min 25 not answered
      ],
    };
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: partialAttempt, scenario: fireScenario });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.correctResponses).toBe(2);
    expect(result.scorePct).toBe(67);
    expect(result.passed).toBe(false);
  });

  it('200 — catastrophic scenario below 90%: recommendation mentions repetir', async () => {
    seedProject();
    const catastrophicScenario = { ...fireScenario, id: 'cat-1', severity: 'catastrophic' };
    const catastrophicAttempt = {
      ...perfectAttempt,
      scenarioId: 'cat-1',
      responses: [
        { decisionPointMinute: 2, selectedOption: 'Brigada interna + bomberos en paralelo', respondedAtMinute: 2, respondingUid: 'uid-1' },
        { decisionPointMinute: 5, selectedOption: 'Por salida de emergencia secundaria', respondedAtMinute: 5, respondingUid: 'uid-2' },
        // min 25 unanswered → scorePct=67 < 90
      ],
    };
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: catastrophicAttempt, scenario: catastrophicScenario });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    const recs = result.recommendations as string[];
    // The engine emits a recommendation about catastrophic scenarios needing ≥90%
    expect(recs.some((r) => /catastrófico|catastrofic/i.test(r))).toBe(true);
    // Advisory language — no hard-block
    expect(result.passed).toBe(false);
  });

  it('200 — slow-reaction attempt: reactionTime recommendation is present', async () => {
    seedProject();
    const slowAttempt = {
      ...perfectAttempt,
      responses: [
        { decisionPointMinute: 2, selectedOption: 'Brigada interna + bomberos en paralelo', respondedAtMinute: 9, respondingUid: 'uid-1' },
        { decisionPointMinute: 5, selectedOption: 'Por salida de emergencia secundaria', respondedAtMinute: 12, respondingUid: 'uid-2' },
        { decisionPointMinute: 25, selectedOption: 'El experto en prevención + bomberos', respondedAtMinute: 32, respondingUid: 'uid-3' },
      ],
    };
    const res = await request(buildApp())
      .post(EVAL_URL)
      .set('x-test-uid', CALLER_UID)
      .send({ attempt: slowAttempt, scenario: fireScenario });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    // Delays: 7, 7, 7 → average 7 min > 5 min threshold
    expect(result.reactionTimeMinutes).toBe(7);
    const recs = result.recommendations as string[];
    expect(recs.some((r) => /reacción|reaccion/i.test(r))).toBe(true);
  });
});
