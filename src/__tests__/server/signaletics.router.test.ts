// Real-router supertest for the Signaletics HTTP surface
// (src/server/routes/signaletics.ts). Three stateless POST endpoints over the
// pure engine in src/services/signaletics/signageValidator.ts:
//
//   POST /:projectId/signaletics/audit-zone        → { result }
//   POST /:projectId/signaletics/rank-site          → { ranking }
//   POST /:projectId/signaletics/evacuation-paths   → { paths }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real engine output.
//
// The expected scores / weights / distances below are captured from the REAL
// engine (deterministic given the fixed inputs), so the happy-path assertions
// pin actual output rather than reimplementing the validator.

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

import signaleticsRouter from '../../server/routes/signaletics.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  auditZoneSignage,
  type SignageZoneAudit,
  type EvacuationNode,
} from '../../services/signaletics/signageValidator.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(signaleticsRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db!._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db!._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ───────────────────────────────────────────────────────────────────────────
// POST /:projectId/signaletics/audit-zone
// ───────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/signaletics/audit-zone', () => {
  const url = '/p1/signaletics/audit-zone';
  // An `office` zone with only the emergency-exit sign placed. The engine
  // requires E001 + F001 + E004 → missing F001 (w10) + E004 (w7).
  const auditBody: SignageZoneAudit = {
    zoneId: 'z-office',
    zoneKind: 'office',
    placedSignage: [
      {
        id: 's1',
        code: 'E001_emergency_exit_left',
        category: 'safe_condition',
        position: { lat: -33.4, lng: -70.6 },
        installedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(auditBody);
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine audit result (missing required signage)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(auditBody);
    expect(res.status).toBe(200);
    expect(res.body.result.zoneId).toBe('z-office');
    expect(res.body.result.zoneKind).toBe('office');
    // Deterministic engine output: F001 (w10) + E004 (w7) missing.
    expect(res.body.result.gaps).toHaveLength(2);
    const byCode = Object.fromEntries(
      res.body.result.gaps.map((g: { code: string; kind: string; weight: number }) => [
        g.code,
        g,
      ]),
    );
    expect(byCode['F001_fire_extinguisher']).toMatchObject({
      kind: 'missing_required',
      weight: 10,
    });
    expect(byCode['E004_emergency_phone']).toMatchObject({
      kind: 'missing_required',
      weight: 7,
    });
    // round(100 - (17/27)*100) = 37 — pinned to the real compute.
    expect(res.body.result.complianceScore).toBe(37);
    // A missing fire-extinguisher (weight 10 ≥ 8) flags critical intervention.
    expect(res.body.result.criticalIntervention).toBe(true);
  });

  it('200 full compliance scores 100 with no gaps', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        zoneId: 'z-restricted',
        zoneKind: 'restricted_area',
        placedSignage: [
          {
            id: 'a',
            code: 'P004_no_thoroughfare',
            category: 'prohibition',
            position: { lat: 0, lng: 0 },
            installedAt: '2026-06-15T00:00:00.000Z',
          },
          {
            id: 'b',
            code: 'M001_general_mandatory',
            category: 'mandatory',
            position: { lat: 0, lng: 0 },
            installedAt: '2026-06-15T00:00:00.000Z',
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.result.gaps).toHaveLength(0);
    expect(res.body.result.complianceScore).toBe(100);
    expect(res.body.result.criticalIntervention).toBe(false);
  });

  it('400 on invalid body (unknown zoneKind)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...auditBody, zoneKind: 'not_a_real_zone' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body (missing zoneId)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ zoneKind: 'office', placedSignage: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/p2/signaletics/audit-zone')
      .set(uid)
      .send(auditBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/ghost/signaletics/audit-zone')
      .set(uid)
      .send(auditBody);
    expect(res.status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// POST /:projectId/signaletics/rank-site
// ───────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/signaletics/rank-site', () => {
  const url = '/p1/signaletics/rank-site';
  // Build the audits from the REAL engine so the ranking is derived, not faked.
  const realAudit = auditZoneSignage(
    {
      zoneId: 'z-office',
      zoneKind: 'office',
      placedSignage: [
        {
          id: 's1',
          code: 'E001_emergency_exit_left',
          category: 'safe_condition',
          position: { lat: -33.4, lng: -70.6 },
          installedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    },
    new Date('2026-06-20T00:00:00.000Z'),
  );

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ audits: [realAudit] });
    expect(res.status).toBe(401);
  });

  it('200 ranks the site from real audit results', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ audits: [realAudit] });
    expect(res.status).toBe(200);
    expect(res.body.ranking.zonesByPriority).toHaveLength(1);
    expect(res.body.ranking.zonesByPriority[0]).toMatchObject({
      zoneId: 'z-office',
      zoneKind: 'office',
      gapsCount: 2,
      totalWeight: 17,
      complianceScore: 37,
    });
    // Patterns sorted by totalWeight desc: F001 (10) before E004 (7).
    expect(res.body.ranking.topPatterns[0]).toMatchObject({
      code: 'F001_fire_extinguisher',
      occurrences: 1,
      totalWeight: 10,
    });
    expect(res.body.ranking.criticalZones).toEqual(['z-office']);
  });

  it('400 on empty audits array (min 1)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ audits: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when audits is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ audits: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/p2/signaletics/rank-site')
      .set(uid)
      .send({ audits: [realAudit] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// POST /:projectId/signaletics/evacuation-paths
// ───────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/signaletics/evacuation-paths', () => {
  const url = '/p1/signaletics/evacuation-paths';
  // A→B→EXIT linear graph. distanceMeters from the real haversine-ish compute
  // is 222 (deterministic).
  const nodes: EvacuationNode[] = [
    { id: 'A', position: { lat: 0, lng: 0 }, connectsTo: ['B'] },
    { id: 'B', position: { lat: 0, lng: 0.001 }, connectsTo: ['EXIT'] },
    { id: 'EXIT', position: { lat: 0, lng: 0.002 }, isExit: true, connectsTo: [] },
  ];
  const pathsBody = { nodes, startId: 'A' };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(pathsBody);
    expect(res.status).toBe(401);
  });

  it('200 returns the real evacuation path with computed distance', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(pathsBody);
    expect(res.status).toBe(200);
    expect(res.body.paths).toHaveLength(1);
    expect(res.body.paths[0].nodes).toEqual(['A', 'B', 'EXIT']);
    expect(res.body.paths[0].distanceMeters).toBe(222);
    expect(res.body.paths[0].riskyZonesTouched).toEqual([]);
  });

  it('200 returns an empty list when no exit is reachable', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        nodes: [
          { id: 'A', position: { lat: 0, lng: 0 }, connectsTo: ['B'] },
          { id: 'B', position: { lat: 0, lng: 0.001 }, connectsTo: [] },
        ],
        startId: 'A',
      });
    expect(res.status).toBe(200);
    expect(res.body.paths).toEqual([]);
  });

  it('400 on too few nodes (min 2)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        nodes: [{ id: 'A', position: { lat: 0, lng: 0 }, connectsTo: [] }],
        startId: 'A',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on missing startId', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ nodes });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/p2/signaletics/evacuation-paths')
      .set(uid)
      .send(pathsBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
