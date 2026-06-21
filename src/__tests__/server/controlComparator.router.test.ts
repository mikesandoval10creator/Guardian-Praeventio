// Real-router supertest for the Control Comparator HTTP surface
// (src/server/routes/controlComparator.ts). Four stateless endpoints over the
// pure engines in src/services/controlComparator/{controlComparator,
// controlFailureLibrary}.ts:
//
//   POST /:projectId/controls/compare           → { comparison }
//   POST /:projectId/controls/failures/lookup    → { patterns }
//   POST /:projectId/controls/failures/suggest    → { actions }
//   GET  /:projectId/controls/failures/summary    → { summary }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engines themselves run UNMOCKED, so every 200 re-derives its expected
// output by invoking the same real engine function the handler calls — the
// assertions pin actual output rather than reimplementing the math.

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

import controlComparatorRouter from '../../server/routes/controlComparator.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  compareControls,
  type ControlHistoricalRecord,
} from '../../services/controlComparator/controlComparator.js';
import {
  lookupFailurePatterns,
  suggestCorrectiveActions,
  summarizeFailureLibrary,
} from '../../services/controlComparator/controlFailureLibrary.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', controlComparatorRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// Two real historical records. controlA (engineering) clearly outperforms
// controlB (epp) on incidents/near-miss/compliance, so the engine returns
// overallFavors='A'. Used verbatim in both the request body and the local
// re-derivation, so the assertion is against real engine output.
const controlA: ControlHistoricalRecord = {
  controlId: 'CTRL-A-baranda',
  controlKind: 'engineering',
  deployedAt: '2026-01-01T00:00:00.000Z',
  monthlyData: [
    {
      period: '2026-01',
      incidentsBefore: 10,
      incidentsAfter: 2,
      nearMissCount: 5,
      complianceScore: 60,
      operatingCostClp: 1_000_000,
      maintenanceHours: 10,
    },
    {
      period: '2026-02',
      incidentsBefore: 10,
      incidentsAfter: 1,
      nearMissCount: 3,
      complianceScore: 90,
      operatingCostClp: 1_000_000,
      maintenanceHours: 8,
    },
  ],
};
const controlB: ControlHistoricalRecord = {
  controlId: 'CTRL-B-epp',
  controlKind: 'epp',
  deployedAt: '2026-01-01T00:00:00.000Z',
  monthlyData: [
    {
      period: '2026-01',
      incidentsBefore: 10,
      incidentsAfter: 8,
      nearMissCount: 20,
      complianceScore: 50,
      operatingCostClp: 200_000,
      maintenanceHours: 2,
    },
    {
      period: '2026-02',
      incidentsBefore: 10,
      incidentsAfter: 7,
      nearMissCount: 18,
      complianceScore: 55,
      operatingCostClp: 200_000,
      maintenanceHours: 2,
    },
  ],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/controls/compare', () => {
  const url = '/api/p1/controls/compare';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ controlA, controlB });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine comparison (re-derived from the same engine)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlA, controlB });
    expect(res.status).toBe(200);
    // The handler calls compareControls(controlA, controlB). Re-derive the
    // expected output from the REAL engine and assert byte-equality.
    const expected = compareControls(controlA, controlB);
    expect(res.body.comparison).toEqual(expected);
    // Pin the high-signal outputs explicitly so a degraded engine still trips.
    expect(res.body.comparison.overallFavors).toBe('A');
    expect(res.body.comparison.confidenceScore).toBe(61);
    expect(res.body.comparison.metricResults).toHaveLength(6);
    const prevented = res.body.comparison.metricResults.find(
      (m: { metric: string }) => m.metric === 'incidents_prevented',
    );
    expect(prevented).toMatchObject({ valueA: 17, valueB: 5, favors: 'A' });
    expect(res.body.comparison.recommendation).toContain('CTRL-A-baranda');
  });

  it('400 when controlA is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlB });
    expect(res.status).toBe(400);
  });

  it('400 when monthlyData is empty (schema min(1))', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlA: { ...controlA, monthlyData: [] }, controlB });
    expect(res.status).toBe(400);
  });

  it('400 when complianceScore is out of the 0..100 range', async () => {
    const bad = {
      ...controlA,
      monthlyData: [{ ...controlA.monthlyData[0], complianceScore: 150 }],
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlA: bad, controlB });
    expect(res.status).toBe(400);
  });

  it('400 when period does not match the YYYY-MM regex', async () => {
    const bad = {
      ...controlA,
      monthlyData: [{ ...controlA.monthlyData[0], period: '2026/01' }],
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlA: bad, controlB });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/controls/compare')
      .set(uid)
      .send({ controlA, controlB });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/controls/compare')
      .set(uid)
      .send({ controlA, controlB });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/controls/failures/lookup', () => {
  const url = '/api/p1/controls/failures/lookup';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ controlKind: 'epp' });
    expect(res.status).toBe(401);
  });

  it('200 returns the real library patterns for a controlKind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlKind: 'epp' });
    expect(res.status).toBe(200);
    // Re-derive from the real library — every 'epp' entry, in order.
    expect(res.body.patterns).toEqual(lookupFailurePatterns('epp'));
    expect(res.body.patterns).toHaveLength(7);
    expect(
      res.body.patterns.every((p: { controlKind: string }) => p.controlKind === 'epp'),
    ).toBe(true);
  });

  it('200 applies the industry filter (incl. cross-industry passthrough)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlKind: 'epp', industry: 'construction' });
    expect(res.status).toBe(200);
    expect(res.body.patterns).toEqual(lookupFailurePatterns('epp', 'construction'));
    expect(res.body.patterns).toHaveLength(4);
  });

  it('200 applies the symptom substring filter (case-insensitive)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlKind: 'epp', symptom: 'CASCO' });
    expect(res.status).toBe(200);
    expect(res.body.patterns).toEqual(
      lookupFailurePatterns('epp', undefined, 'CASCO'),
    );
    expect(res.body.patterns).toHaveLength(1);
    expect(res.body.patterns[0].id).toBe('epp-casco-not-used');
  });

  it('400 when controlKind is not in the enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ controlKind: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('400 when controlKind is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/controls/failures/lookup')
      .set(uid)
      .send({ controlKind: 'epp' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/controls/failures/suggest', () => {
  const url = '/api/p1/controls/failures/suggest';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ failureMode: 'not_used', controlKind: 'epp' });
    expect(res.status).toBe(401);
  });

  it('200 returns the real de-duplicated corrective actions', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ failureMode: 'not_used', controlKind: 'epp' });
    expect(res.status).toBe(200);
    // Re-derive: union of standardCorrectiveActions across matching entries.
    const expected = suggestCorrectiveActions('not_used', 'epp');
    expect(res.body.actions).toEqual(expected);
    expect(res.body.actions).toHaveLength(8);
    // Engine de-dupes — the returned list has no repeats.
    expect(new Set(res.body.actions).size).toBe(res.body.actions.length);
  });

  it('200 returns an empty array for a combination with no library match', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      // No 'elimination' + 'no_available' entry exists in the library.
      .send({ failureMode: 'no_available', controlKind: 'elimination' });
    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual([]);
  });

  it('400 when failureMode is not in the enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ failureMode: 'exploded', controlKind: 'epp' });
    expect(res.status).toBe(400);
  });

  it('400 when controlKind is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ failureMode: 'not_used' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/controls/failures/suggest')
      .set(uid)
      .send({ failureMode: 'not_used', controlKind: 'epp' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('GET /:projectId/controls/failures/summary', () => {
  const url = '/api/p1/controls/failures/summary';

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('200 returns the real library summary', async () => {
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual(summarizeFailureLibrary());
    // Pin the headline counts so a library regression is caught directly.
    expect(res.body.summary.totalEntries).toBe(33);
    expect(res.body.summary.byControlKind.epp).toBe(7);
    expect(res.body.summary.byControlKind.administrative).toBe(11);
    // The per-kind / per-mode buckets must sum to the total.
    const kindSum = Object.values<number>(res.body.summary.byControlKind).reduce(
      (a, b) => a + b,
      0,
    );
    expect(kindSum).toBe(res.body.summary.totalEntries);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .get('/api/p2/controls/failures/summary')
      .set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .get('/api/ghost/controls/failures/summary')
      .set(uid);
    expect(res.status).toBe(403);
  });
});
