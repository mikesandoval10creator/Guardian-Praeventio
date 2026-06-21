// Praeventio Guard — predictiveAlerts router behavioral tests (real router +
// supertest). Covers BOTH stateless POST endpoints over the predictive-alert
// engine (windowedTrigger + alertScheduler).
//
// Exercises every status code the routes emit: 401 (no token), 403 (non-member),
// 400 (bad payload), 200 (happy path with REAL engine output asserted).

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

import predictiveAlertsRouter from './predictiveAlerts.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', predictiveAlertsRouter);
  return app;
}

const PROJECT_ID = 'p-pa-test';
const MEMBER_UID = 'uid-pa-member';
const NON_MEMBER_UID = 'uid-pa-stranger';

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Predictive Alerts Test Project',
    tenantId: 't-pa-1',
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

// ────────────────────────────────────────────────────────────────────────
// 1. should-fire-windowed
// ────────────────────────────────────────────────────────────────────────

describe('predictiveAlertsRouter — should-fire-windowed', () => {
  const path = `/api/${PROJECT_ID}/predictive-alerts/should-fire-windowed`;

  // currentValue(10) < threshold(20), forecast crosses 20 at index 7 → minute 8.
  // Defaults: windowMinutes 15, minLeadTimeMin 5 → 8 >= 5 → fire.
  const firingBody = {
    ctx: { currentValue: 10, threshold: 20, generatorId: 'scaffold-uplift' },
    forecastValues: [10, 11, 12, 13, 14, 15, 16, 25, 30, 35],
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send(firingBody);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send(firingBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on missing forecastValues', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ ctx: { currentValue: 10, threshold: 20, generatorId: 'g1' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on empty forecastValues array', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ ctx: { currentValue: 10, threshold: 20, generatorId: 'g1' }, forecastValues: [] });
    expect(res.status).toBe(400);
  });

  it('400 on non-finite forecast value', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ ctx: { currentValue: 10, threshold: 20, generatorId: 'g1' }, forecastValues: [10, null] });
    expect(res.status).toBe(400);
  });

  it('200 fires a lead-time alert with REAL leadTimeMin from the engine', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send(firingBody);
    expect(res.status).toBe(200);
    // Forecast first crosses threshold at index 7 → minute 8.
    expect(res.body.decision).toMatchObject({
      fire: true,
      leadTimeMin: 8,
      forecastValue: 25,
    });
    expect(typeof res.body.decision.recommendedAction).toBe('string');
  });

  it('200 does NOT fire when forecast never crosses the threshold', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        ctx: { currentValue: 5, threshold: 100, generatorId: 'scaffold-uplift' },
        forecastValues: [5, 6, 7, 8, 9, 10],
      });
    expect(res.status).toBe(200);
    expect(res.body.decision.fire).toBe(false);
    expect(res.body.decision.leadTimeMin).toBe(0);
  });

  it('200 honors a custom minLeadTimeMin (lead time too short → no fire)', async () => {
    // Crosses at minute 1; minLeadTimeMin 5 → 1 < 5 → fire false but leadTimeMin echoed.
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        ctx: { currentValue: 10, threshold: 20, generatorId: 'scaffold-uplift' },
        forecastValues: [25, 30],
        options: { minLeadTimeMin: 5 },
      });
    expect(res.status).toBe(200);
    expect(res.body.decision.fire).toBe(false);
    expect(res.body.decision.leadTimeMin).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. evaluate-probes
// ────────────────────────────────────────────────────────────────────────

describe('predictiveAlertsRouter — evaluate-probes', () => {
  const path = `/api/${PROJECT_ID}/predictive-alerts/evaluate-probes`;

  const firingProbe = {
    id: 'scaffold-uplift',
    threshold: 20,
    currentValue: 10,
    forecastValues: [10, 11, 12, 13, 14, 15, 16, 25, 30, 35], // crosses at minute 8
  };
  const quietProbe = {
    id: 'gas-leak-anomaly',
    threshold: 100,
    currentValue: 5,
    forecastValues: [5, 6, 7, 8, 9, 10], // never crosses
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({ probes: [firingProbe] });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ probes: [firingProbe] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on empty probes array', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ probes: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on probe missing required fields', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ probes: [{ id: 'p1', threshold: 20 }] });
    expect(res.status).toBe(400);
  });

  it('200 returns only the firing probe with its Spanish recommendation', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ probes: [firingProbe, quietProbe] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.alerts)).toBe(true);
    // Only the scaffold probe fires; the gas-leak probe never crosses.
    expect(res.body.alerts).toHaveLength(1);
    const alert = res.body.alerts[0];
    expect(alert.generatorId).toBe('scaffold-uplift');
    expect(alert.decision).toMatchObject({ fire: true, leadTimeMin: 8 });
    // Default Spanish-CL recommendation for scaffold-uplift is surfaced in the body.
    expect(alert.body).toContain('Asegurar el andamiaje');
    expect(typeof alert.scheduledAt).toBe('string');
  });

  it('200 returns an empty alerts array when nothing fires', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ probes: [quietProbe] });
    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
  });
});
