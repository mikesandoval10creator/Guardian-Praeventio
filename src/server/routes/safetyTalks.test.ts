// Praeventio Guard — safetyTalks router behavioral tests (real router +
// supertest). The router exposes one pure-compute endpoint:
//
//   POST /:projectId/safety-talks/suggest   { signals }  → { suggestions }
//
// It is gated by verifyAuth (401), validate(suggestSchema) (400) and
// assertProjectMember (403). The compute itself is the deterministic
// `suggestTalks` engine, so the 200 assertions pin the REAL ranking output
// (no Math.random, no Firestore writes).
//
// Exercises every status the route emits: 401 (no token), 400 (bad payload),
// 403 (non-member), 200 (happy path with real seeded signals).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@example.com`,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import safetyTalksRouter from './safetyTalks.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/safety-talks', safetyTalksRouter);
  return app;
}

const PROJECT_ID = 'p-st-test';
const MEMBER_UID = 'uid-st-member';
const NON_MEMBER_UID = 'uid-st-stranger';
const TENANT_ID = 't-st-1';

const path = `/api/safety-talks/${PROJECT_ID}/safety-talks/suggest`;

// A minimal valid signals payload (all required fields present).
function validSignals(overrides: Record<string, unknown> = {}) {
  return {
    recentIncidents: [],
    activeRisks: [],
    todaysTaskCategories: [],
    openFindingsByCategory: {},
    newWorkersCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Safety Talks Test Project',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

describe('safetyTalksRouter — POST /:projectId/safety-talks/suggest', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(path)
      .send({ signals: validSignals() });
    expect(res.status).toBe(401);
  });

  it('400 when the body is missing the signals object', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a signal field violates the schema (severity enum)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        signals: validSignals({
          recentIncidents: [{ kind: 'caida de altura', severity: 'catastrophic' }],
        }),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ signals: validSignals() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/safety-talks/p-does-not-exist/safety-talks/suggest`)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: validSignals() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns the REAL ranked suggestions for a member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        signals: validSignals({
          // Highest single trigger in the catalog: confined-space task today (75).
          todaysTaskCategories: ['trabajo en espacio confinado', 'trabajo en altura'],
          // Altura: active risk (50) + task today (70) + recent incident (60) = 180.
          activeRisks: ['riesgo de altura', 'electricidad'],
          recentIncidents: [{ kind: 'caida de altura', severity: 'high' }],
          weather: { uvIndex: 9 },
          newWorkersCount: 2,
        }),
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    // suggestTalks returns top-3 sorted by score desc.
    expect(res.body.suggestions.length).toBe(3);

    const byId = Object.fromEntries(
      res.body.suggestions.map((s: { topicId: string }) => [s.topicId, s]),
    );

    // Altura accumulates the most points (active risk + task + incident).
    const altura = byId['altura'];
    expect(altura).toBeDefined();
    expect(altura.score).toBe(180);
    expect(altura.title).toBe('Trabajo en altura: arnés, línea de vida y rescate');
    expect(altura.durationMinutes).toBe(10);
    expect(altura.rationale).toEqual(
      expect.arrayContaining([
        'Riesgo de altura activo en el proyecto',
        'Tareas en altura programadas hoy',
        'Incidente reciente relacionado con altura',
      ]),
    );

    // Confined space (task today = 75) and UV (uvIndex>=7 = 60) also rank in.
    expect(byId['confinado']?.score).toBe(75);
    expect(byId['uv']?.score).toBe(60);

    // First entry is the highest score (altura, 180) — ranking is real.
    expect(res.body.suggestions[0].topicId).toBe('altura');
    expect(
      res.body.suggestions[0].score >= res.body.suggestions[1].score,
    ).toBe(true);
  });

  it('200 returns an empty suggestion list when no signals fire', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: validSignals() });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });
});
