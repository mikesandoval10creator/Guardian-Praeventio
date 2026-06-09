// Real-router supertest for src/server/routes/ergonomics.ts.
// Drives every status code the reba/rula endpoints emit, and specifically the
// classifier added in B3: engine validation throws (RangeError / 'REBA:'|'RULA:'
// prefix) → 400 invalid_input; genuine internal faults → 500 internal_error.
// Mounted at /api/sprint-k in server.ts.
//
// Pattern mirrors src/__tests__/server/adminBurden.test.ts (real router,
// fakeFirestore, mocked verifyAuth). The engines are mocked ONLY to assert the
// route's catch-block classification — the engines' own throw behaviour is
// unit-tested in src/services/ergonomics/{reba,rula}.test.ts. The happy-path
// 200 cases pass through to the REAL REBA/RULA scoring.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  rebaThrows: null as null | Error,
  rulaThrows: null as null | Error,
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
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// Engine mock: pass through to the REAL engines unless a test arms a throw,
// so the happy-path 200 still exercises real REBA/RULA scoring.
vi.mock('../../services/ergonomics/reba.js', async (orig) => {
  const real = await orig<typeof import('../../services/ergonomics/reba.js')>();
  return {
    ...real,
    calculateReba: (i: unknown) => {
      if (H.rebaThrows) throw H.rebaThrows;
      return real.calculateReba(i as never);
    },
  };
});
vi.mock('../../services/ergonomics/rula.js', async (orig) => {
  const real = await orig<typeof import('../../services/ergonomics/rula.js')>();
  return {
    ...real,
    calculateRula: (i: unknown) => {
      if (H.rulaThrows) throw H.rulaThrows;
      return real.calculateRula(i as never);
    },
  };
});

import ergonomicsRouter from '../../server/routes/ergonomics.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', ergonomicsRouter);
  return app;
}

const PROJECT_ID = 'p-ergo';
const UID = 'uid-ergo-member';

const validReba = {
  trunk: { flexionDeg: 10 },
  neck: { flexionDeg: 5 },
  legs: { bilateralSupport: true, kneeFlexionDeg: 10 },
  upperArm: { flexionDeg: 30 },
  lowerArm: { flexionDeg: 80 },
  wrist: { flexionDeg: 5 },
  load: { kg: 3 },
  coupling: 'good',
  activity: {},
};
const validRula = {
  upperArm: { flexionDeg: 30 },
  lowerArm: { flexionDeg: 80 },
  wrist: { flexionDeg: 5 },
  wristTwist: 'mid',
  neck: { flexionDeg: 5 },
  trunk: { flexionDeg: 5 },
  legs: { supportedAndBalanced: true },
  muscleUse: {},
  force: { kg: 1, pattern: 'intermittent' },
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.rebaThrows = null;
  H.rulaThrows = null;
  H.db._seed(`projects/${PROJECT_ID}`, { name: 'Ergo', members: [UID], createdBy: UID });
});

describe('POST /:projectId/ergonomics/calculate-reba', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/ergonomics/calculate-reba`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(validReba);
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload on zod-invalid input (existing barrier)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({ ...validReba, coupling: 'not_a_coupling' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp()).post(url).set('x-test-uid', 'stranger').send(validReba);
    expect(res.status).toBe(403);
  });

  it('200 happy path runs the REAL REBA engine', async () => {
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(validReba);
    expect(res.status).toBe(200);
    expect(typeof res.body.result.finalScore).toBe('number');
    expect(res.body.result.actionLevel).toBeDefined();
  });

  it('400 invalid_input when the engine raises a REBA validation Error', async () => {
    H.rebaThrows = new Error('REBA: trunk.flexionDeg (999) is out of range [-180, 180]');
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(validReba);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });

  it('500 internal_error on a genuine internal fault (no internals leaked)', async () => {
    H.rebaThrows = new TypeError('cannot read property of undefined');
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(validReba);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
    expect(JSON.stringify(res.body)).not.toContain('cannot read property');
  });
});

describe('POST /:projectId/ergonomics/calculate-rula', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/ergonomics/calculate-rula`;

  it('200 happy path runs the REAL RULA engine', async () => {
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(validRula);
    expect(res.status).toBe(200);
    expect(typeof res.body.result.finalScore).toBe('number');
  });

  it('400 invalid_input when the engine raises a RangeError (RULA validation)', async () => {
    H.rulaThrows = new RangeError('RULA: upperArm flexionDeg=999° outside [-180, 180]');
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(validRula);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });

  it('500 internal_error on a genuine internal fault', async () => {
    H.rulaThrows = new TypeError('boom');
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(validRula);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
