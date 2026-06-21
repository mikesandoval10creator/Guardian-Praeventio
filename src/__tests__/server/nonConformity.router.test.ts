// Real-router supertest for the Non-Conformity engine HTTP surface
// (src/server/routes/nonConformity.ts). Three stateless POST endpoints over the
// pure engine in src/services/nonConformity/nonConformityEngine.ts:
//
//   POST /:projectId/non-conformity/link-to-action
//   POST /:projectId/non-conformity/evaluate-cycle-stage
//   POST /:projectId/non-conformity/bulk-classify-by-pattern
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
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import nonConformityRouter from '../../server/routes/nonConformity.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', nonConformityRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A valid NonConformity body for the ncSchema (id/source/detectedAt/description/
// severity/status all required, the rest optional).
function nc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'nc-1',
    source: 'audit',
    detectedAt: '2026-05-01T08:00:00Z',
    description: 'Falta de bloqueo y etiquetado en el equipo',
    severity: 'major',
    status: 'open',
    ...overrides,
  };
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    ownerUid: 'u2',
    createdAt: '2026-05-02T08:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/non-conformity/link-to-action', () => {
  const url = '/api/p1/non-conformity/link-to-action';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ nc: nc(), action: action() });
    expect(res.status).toBe(401);
  });

  it('200 links the action and returns the real engine shape', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ nc: nc(), action: action(), now: '2026-05-03T10:00:00Z' });
    expect(res.status).toBe(200);
    // Real engine output: nc gets the action id appended, status promoted to
    // 'action_planned', actionPlannedAt stamped with `now`, plus a link record.
    expect(res.body.nc.correctiveActionIds).toEqual(['act-1']);
    expect(res.body.nc.status).toBe('action_planned');
    expect(res.body.nc.actionPlannedAt).toBe('2026-05-03T10:00:00Z');
    expect(res.body.link).toEqual({
      ncId: 'nc-1',
      actionId: 'act-1',
      linkedAt: '2026-05-03T10:00:00Z',
    });
  });

  it('400 on invalid body (missing action)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ nc: nc() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid enum (bad severity)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ nc: nc({ severity: 'catastrophic' }), action: action() });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/non-conformity/link-to-action')
      .set(uid)
      .send({ nc: nc(), action: action() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/non-conformity/link-to-action')
      .set(uid)
      .send({ nc: nc(), action: action() });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/non-conformity/evaluate-cycle-stage', () => {
  const url = '/api/p1/non-conformity/evaluate-cycle-stage';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ nc: nc() });
    expect(res.status).toBe(401);
  });

  it('200 returns the derived stage (open with no evidence)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ nc: nc() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'open' });
  });

  it('200 derives action_planned from linked corrective actions', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ nc: nc({ correctiveActionIds: ['act-9'] }) });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('action_planned');
  });

  it('200 efficacyReviewedAt wins precedence over closedAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        nc: nc({
          status: 'closed',
          closedAt: '2026-05-10T00:00:00Z',
          efficacyReviewedAt: '2026-06-01T00:00:00Z',
        }),
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('efficacy_reviewed');
  });

  it('400 on missing nc', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/non-conformity/evaluate-cycle-stage')
      .set(uid)
      .send({ nc: nc() });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/non-conformity/bulk-classify-by-pattern', () => {
  const url = '/api/p1/non-conformity/bulk-classify-by-pattern';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ ncs: [] });
    expect(res.status).toBe(401);
  });

  it('200 buckets by rootCauseKind sorted by count then severity', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ncs: [
          nc({ id: 'a', rootCauseKind: 'epp', severity: 'minor' }),
          nc({ id: 'b', rootCauseKind: 'epp', severity: 'critical' }),
          nc({ id: 'c', rootCauseKind: 'procedimiento', severity: 'major' }),
          nc({ id: 'd' }), // no rootCauseKind → 'unclassified'
        ],
      });
    expect(res.status).toBe(200);
    const buckets = res.body.buckets as Array<{
      rootCauseKind: string;
      count: number;
      ncIds: string[];
      severityIndex: number;
    }>;
    // 'epp' has 2 NCs → first; severityIndex = (1+3)/2 = 2.
    expect(buckets[0].rootCauseKind).toBe('epp');
    expect(buckets[0].count).toBe(2);
    expect(buckets[0].ncIds.sort()).toEqual(['a', 'b']);
    expect(buckets[0].severityIndex).toBe(2);
    // The two 1-count buckets keep alphabetical order as a stable tiebreaker.
    expect(buckets.map((b) => b.rootCauseKind)).toEqual([
      'epp',
      'procedimiento',
      'unclassified',
    ]);
  });

  it('200 honours the `top` cap', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ncs: [
          nc({ id: 'a', rootCauseKind: 'epp' }),
          nc({ id: 'b', rootCauseKind: 'epp' }),
          nc({ id: 'c', rootCauseKind: 'procedimiento' }),
        ],
        top: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.buckets).toHaveLength(1);
    expect(res.body.buckets[0].rootCauseKind).toBe('epp');
  });

  it('200 empty input yields an empty bucket list (honest empty)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ ncs: [] });
    expect(res.status).toBe(200);
    expect(res.body.buckets).toEqual([]);
  });

  it('400 when ncs is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ ncs: 'nope' });
    expect(res.status).toBe(400);
  });

  it('400 when top is negative', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ncs: [nc()], top: -1 });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/non-conformity/bulk-classify-by-pattern')
      .set(uid)
      .send({ ncs: [nc()] });
    expect(res.status).toBe(403);
  });
});
