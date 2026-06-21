// Praeventio Guard — riskRanking router behavioral tests (real router +
// supertest). Covers the four stateless ranker endpoints over the engine in
// `src/services/riskRanking/riskRankingEngine.ts`:
//
//   POST /:projectId/risk-ranking/risks
//   POST /:projectId/risk-ranking/weak-controls
//   POST /:projectId/risk-ranking/zones
//   POST /:projectId/risk-ranking/tasks
//
// Each route is verifyAuth → validate(schema) → assertProjectMember guard →
// pure compute. We exercise every status code the routes emit: 401 (no token),
// 400 (bad payload), 403 (non-member of the project), 200 (happy path with REAL
// engine output whose ordering/score we assert against the real engine, not a
// reimplementation).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as
    | ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore>
    | null,
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

import riskRankingRouter from './riskRanking.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import {
  rankRisks,
  rankWeakControls,
  rankZonesByFindings,
  rankTasksByRisk,
} from '../../services/riskRanking/riskRankingEngine';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/risk', riskRankingRouter);
  return app;
}

const PROJECT_ID = 'p-rr-test';
const MEMBER_UID = 'uid-rr-member';
const NON_MEMBER_UID = 'uid-rr-stranger';

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Risk Ranking Test Project',
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

// ────────────────────────────────────────────────────────────────────────
// 1. risks
// ────────────────────────────────────────────────────────────────────────

describe('riskRankingRouter — POST /:projectId/risk-ranking/risks', () => {
  const path = `/api/risk/${PROJECT_ID}/risk-ranking/risks`;

  const records = [
    {
      id: 'r-low',
      projectId: PROJECT_ID,
      category: 'noise',
      severity: 'low' as const,
      exposedWorkerCount: 1,
      recentFindingCount: 0,
      linkedIncidentCount: 0,
      overdueActionCount: 0,
    },
    {
      id: 'r-crit',
      projectId: PROJECT_ID,
      category: 'altura',
      severity: 'critical' as const,
      exposedWorkerCount: 20,
      recentFindingCount: 4,
      linkedIncidentCount: 3,
      overdueActionCount: 2,
    },
    {
      id: 'r-med',
      projectId: PROJECT_ID,
      category: 'electric',
      severity: 'medium' as const,
      exposedWorkerCount: 5,
      recentFindingCount: 1,
      linkedIncidentCount: 0,
      overdueActionCount: 0,
    },
  ];

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({ records });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (bad severity enum)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ records: [{ ...records[0], severity: 'catastrophic' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ records });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns ranking ordered by real engine score', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ records });
    expect(res.status).toBe(200);

    const expected = rankRisks(records);
    expect(res.body.ranking).toEqual(expected);
    // critical risk must rank above the low one (real score ordering).
    expect(res.body.ranking[0].id).toBe('r-crit');
    expect(res.body.ranking[res.body.ranking.length - 1].id).toBe('r-low');
    // each item carries the computed score field the engine adds.
    expect(typeof res.body.ranking[0].score).toBe('number');
  });

  it('200 honors topN to cap the ranking length', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ records, topN: 1 });
    expect(res.status).toBe(200);
    expect(res.body.ranking).toHaveLength(1);
    expect(res.body.ranking[0].id).toBe('r-crit');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. weak-controls
// ────────────────────────────────────────────────────────────────────────

describe('riskRankingRouter — POST /:projectId/risk-ranking/weak-controls', () => {
  const path = `/api/risk/${PROJECT_ID}/risk-ranking/weak-controls`;

  const records = [
    {
      id: 'c-ok',
      projectId: PROJECT_ID,
      label: 'Guardrail inspection',
      verificationCount: 10,
      failureCount: 0,
      daysSinceLastVerification: 2,
    },
    {
      id: 'c-never',
      projectId: PROJECT_ID,
      label: 'Lockout/tagout audit',
      verificationCount: 0,
      failureCount: 0,
      daysSinceLastVerification: 90,
    },
    {
      id: 'c-failing',
      projectId: PROJECT_ID,
      label: 'Harness check',
      verificationCount: 4,
      failureCount: 3,
      daysSinceLastVerification: 45,
    },
  ];

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({ records });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (missing label)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        records: [
          {
            id: 'c1',
            projectId: PROJECT_ID,
            verificationCount: 1,
            failureCount: 0,
            daysSinceLastVerification: 1,
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ records });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns weakness ranking matching the real engine', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ records });
    expect(res.status).toBe(200);

    const expected = rankWeakControls(records);
    expect(res.body.ranking).toEqual(expected);
    // The healthy control (0 failures, recently verified) must rank last.
    const ids = res.body.ranking.map((c: { controlId: string }) => c.controlId);
    expect(ids[ids.length - 1]).toBe('c-ok');
    // weaknessScore is the field the engine emits, not the raw input shape.
    expect(typeof res.body.ranking[0].weaknessScore).toBe('number');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. zones
// ────────────────────────────────────────────────────────────────────────

describe('riskRankingRouter — POST /:projectId/risk-ranking/zones', () => {
  const path = `/api/risk/${PROJECT_ID}/risk-ranking/zones`;

  const zones = [
    { zoneId: 'z-quiet', findingsCount: 0, incidentsCount: 0, workersAssigned: 2 },
    { zoneId: 'z-hot', findingsCount: 12, incidentsCount: 3, workersAssigned: 8 },
    { zoneId: 'z-mid', findingsCount: 4, incidentsCount: 0, workersAssigned: 3 },
  ];

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({ zones });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (negative findingsCount)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ zones: [{ zoneId: 'z1', findingsCount: -1, incidentsCount: 0, workersAssigned: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ zones });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns zone ranking ordered by real engine score', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ zones });
    expect(res.status).toBe(200);

    const expected = rankZonesByFindings(zones);
    expect(res.body.ranking).toEqual(expected);
    expect(res.body.ranking[0].zoneId).toBe('z-hot');
    expect(res.body.ranking[res.body.ranking.length - 1].zoneId).toBe('z-quiet');
    expect(typeof res.body.ranking[0].score).toBe('number');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. tasks
// ────────────────────────────────────────────────────────────────────────

describe('riskRankingRouter — POST /:projectId/risk-ranking/tasks', () => {
  const path = `/api/risk/${PROJECT_ID}/risk-ranking/tasks`;

  const tasks = [
    { taskId: 't-safe', riskCategory: 'admin', workersAssigned: 1, incidentHistory: 0, missingCriticalControls: 0 },
    { taskId: 't-danger', riskCategory: 'altura', workersAssigned: 6, incidentHistory: 2, missingCriticalControls: 3 },
    { taskId: 't-mid', riskCategory: 'electric', workersAssigned: 4, incidentHistory: 0, missingCriticalControls: 1 },
  ];

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({ tasks });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (missing taskId)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ tasks: [{ riskCategory: 'altura', workersAssigned: 1, incidentHistory: 0, missingCriticalControls: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ tasks });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns task ranking ordered by real engine score', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ tasks });
    expect(res.status).toBe(200);

    const expected = rankTasksByRisk(tasks);
    expect(res.body.ranking).toEqual(expected);
    expect(res.body.ranking[0].taskId).toBe('t-danger');
    expect(res.body.ranking[res.body.ranking.length - 1].taskId).toBe('t-safe');
    expect(typeof res.body.ranking[0].score).toBe('number');
  });
});
