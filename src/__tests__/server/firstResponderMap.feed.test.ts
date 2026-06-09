// Real-router supertest for the responder-feed endpoint in
// src/server/routes/firstResponderMap.ts. Exercises the ACTUAL handler:
// guard (assertProjectMember) → resolveTenantId → roster read →
// emergency_alerts position read → pure buildResponderFeed → analyzeCoverage.
// Mirrors the emergencyBrigade.test.ts real-router pattern (NOT router.stack).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import('../helpers/fakeFirestore').createFakeFirestore
  > | null,
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
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn().mockResolvedValue(true),
}));

import firstResponderMapRouter from '../../server/routes/firstResponderMap.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { auditServerEvent } from '../../server/middleware/auditLog.js';

const PREFIX = '/api/sprint-k';
const PROJECT_ID = 'proj-1';
const TENANT_ID = 'tenant-1';
const CALLER = 'user-admin-1';
const W_WITH_POS = 'worker-pos';
const W_NO_POS = 'worker-nopos';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, firstResponderMapRouter);
  return app;
}

function seedBase() {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [CALLER, W_WITH_POS, W_NO_POS],
    createdBy: CALLER,
  });
  H.db!._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade/m1`,
    {
      docType: 'member',
      workerUid: W_WITH_POS,
      role: 'first_aid',
      trainedAt: '2026-01-01T00:00:00.000Z',
      trainingValidYears: 2,
      active: true,
    },
  );
  H.db!._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade/m2`,
    {
      docType: 'member',
      workerUid: W_NO_POS,
      role: 'fire_response',
      trainedAt: '2026-01-01T00:00:00.000Z',
      trainingValidYears: 2,
      active: true,
    },
  );
  // REAL last-known position for W_WITH_POS only (recent SOS/position ping).
  H.db!._seed(`tenants/${TENANT_ID}/emergency_alerts/a1`, {
    type: 'sos',
    uid: W_WITH_POS,
    projectId: PROJECT_ID,
    geo: { lat: -33.45, lng: -70.66 },
    createdAt: new Date().toISOString(),
  });
  H.db!._seed(`users/${W_WITH_POS}`, { displayName: 'Ana Paramedica' });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.clearAllMocks();
});

const endpoint = `${PREFIX}/${PROJECT_ID}/first-responder-map/responder-feed`;

describe('GET responder-feed (real router)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get(endpoint);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    seedBase();
    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', 'stranger');
    expect(res.status).toBe(403);
  });

  it('maps a REAL ping → real position and leaves a position-less member honestly unavailable', async () => {
    seedBase();
    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', CALLER);
    expect(res.status).toBe(200);
    const withPos = res.body.responders.find(
      (r: { uid: string }) => r.uid === W_WITH_POS,
    );
    const noPos = res.body.responders.find(
      (r: { uid: string }) => r.uid === W_NO_POS,
    );
    expect(withPos.currentPosition).toEqual({ lat: -33.45, lng: -70.66 });
    expect(withPos.name).toBe('Ana Paramedica');
    expect(withPos.roles).toContain('first_aid_certified');
    expect(noPos.currentPosition).toBeUndefined(); // NO fabricated location
    expect(res.body.coverageGaps).toBeInstanceOf(Array);
    expect(auditServerEvent).toHaveBeenCalledTimes(1);
  });

  it('drops a STALE position ping (older than 30 min) — never drives dispatch on stale data', async () => {
    seedBase();
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    H.db!._seed(`tenants/${TENANT_ID}/emergency_alerts/a1`, {
      type: 'sos',
      uid: W_WITH_POS,
      projectId: PROJECT_ID,
      geo: { lat: -33.45, lng: -70.66 },
      createdAt: stale,
    });
    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', CALLER);
    const withPos = res.body.responders.find(
      (r: { uid: string }) => r.uid === W_WITH_POS,
    );
    expect(withPos.currentPosition).toBeUndefined();
  });
});
