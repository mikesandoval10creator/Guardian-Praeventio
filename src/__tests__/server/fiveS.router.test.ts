// Real-router supertest for the 5S Audit + Zone Ranking HTTP surface
// (src/server/routes/fiveS.ts). Three stateless POST endpoints over the pure
// engine in src/services/fiveS/fiveSAudit.ts:
//
//   POST /:projectId/five-s/checklist
//   POST /:projectId/five-s/build-report
//   POST /:projectId/five-s/rank-zones
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked so the response shapes are real compute.

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

import fiveSRouter from '../../server/routes/fiveS.js';
import {
  getFiveSChecklist,
  buildFiveSAuditReport,
  rankZonesBy5S,
} from '../../services/fiveS/fiveSAudit.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', fiveSRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/five-s/checklist', () => {
  const url = '/api/p1/five-s/checklist';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({});
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine checklist verbatim', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(200);
    // Must equal the REAL engine output — not a reimplemented list.
    expect(res.body.items).toEqual(getFiveSChecklist());
    // Sanity: 13 items spanning all five dimensions.
    expect(res.body.items).toHaveLength(13);
    expect(new Set(res.body.items.map((i: { dimension: string }) => i.dimension))).toEqual(
      new Set(['seiri', 'seiton', 'seiso', 'seiketsu', 'shitsuke']),
    );
  });

  it('400 on a non-empty body (strict empty schema)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ extra: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/five-s/checklist')
      .set(uid)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/five-s/checklist')
      .set(uid)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/five-s/build-report', () => {
  const url = '/api/p1/five-s/build-report';

  // A realistic partial audit: seiso fully failing (0s), the rest mixed.
  const responses = [
    { itemId: 's1-1', rating: 2 as const },
    { itemId: 's1-2', rating: 2 as const },
    { itemId: 's1-3', rating: 1 as const },
    { itemId: 's2-1', rating: 2 as const },
    { itemId: 's2-2', rating: 1 as const },
    { itemId: 's2-3', rating: 2 as const },
    { itemId: 's3-1', rating: 0 as const },
    { itemId: 's3-2', rating: 0 as const },
    { itemId: 's3-3', rating: 0 as const },
    { itemId: 's4-1', rating: 2 as const },
    { itemId: 's4-2', rating: 2 as const },
    { itemId: 's5-1', rating: 2 as const },
    { itemId: 's5-2', rating: 1 as const },
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ zoneId: 'z1', responses });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine report shape (seiso is worst at 0)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ zoneId: 'zona-bodega', responses });
    expect(res.status).toBe(200);
    // Assert against the REAL engine — never reimplement the scoring here.
    const expected = buildFiveSAuditReport('zona-bodega', responses);
    expect(res.body.report).toEqual(expected);
    // Cross-check the salient derived facts so a hollow toEqual can't hide a
    // broken engine wiring: seiso (all 0s) must be the worst dimension at 0.
    expect(res.body.report.byDimension.seiso).toBe(0);
    expect(res.body.report.worstDimension).toBe('seiso');
    expect(res.body.report.zoneId).toBe('zona-bodega');
  });

  it('200 unanswered items default to rating 0 (critical zone)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ zoneId: 'empty-zone', responses: [] });
    expect(res.status).toBe(200);
    expect(res.body.report.overallScore).toBe(0);
    expect(res.body.report.level).toBe('critical');
  });

  it('400 on missing zoneId', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ responses });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an out-of-range rating', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ zoneId: 'z1', responses: [{ itemId: 's1-1', rating: 3 }] });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/five-s/build-report')
      .set(uid)
      .send({ zoneId: 'z1', responses });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/five-s/rank-zones', () => {
  const url = '/api/p1/five-s/rank-zones';

  function report(zoneId: string, overallScore: number) {
    return {
      zoneId,
      overallScore,
      byDimension: { seiri: overallScore, seiton: overallScore, seiso: overallScore, seiketsu: overallScore, shitsuke: overallScore },
      level: 'fair' as const,
      worstDimension: 'seiso' as const,
      items: [],
    };
  }

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ reports: [] });
    expect(res.status).toBe(401);
  });

  it('200 ranks zones worst-first via the real engine', async () => {
    const reports = [report('alta', 88), report('baja', 31), report('media', 60)];
    const res = await request(buildApp()).post(url).set(uid).send({ reports });
    expect(res.status).toBe(200);
    // Assert against the REAL engine — worst (lowest score) first.
    expect(res.body.ranking).toEqual(rankZonesBy5S(reports as never));
    expect(res.body.ranking.map((r: { zoneId: string }) => r.zoneId)).toEqual([
      'baja',
      'media',
      'alta',
    ]);
    // Entries are projected (no full byDimension/items leak).
    expect(res.body.ranking[0]).toEqual({
      zoneId: 'baja',
      overallScore: 31,
      level: 'fair',
      worstDimension: 'seiso',
    });
  });

  it('200 empty input yields an empty ranking (honest empty)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ reports: [] });
    expect(res.status).toBe(200);
    expect(res.body.ranking).toEqual([]);
  });

  it('400 when reports is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ reports: 'nope' });
    expect(res.status).toBe(400);
  });

  it('400 when a report has an out-of-range overallScore', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ reports: [report('z', 150)] });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/five-s/rank-zones')
      .set(uid)
      .send({ reports: [report('z', 50)] });
    expect(res.status).toBe(403);
  });
});
