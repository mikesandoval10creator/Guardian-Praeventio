// Real-router supertest for the RACI Matrix HTTP surface
// (src/server/routes/raciMatrix.ts). Six stateless POST endpoints over the
// pure engine in src/services/raciMatrix/raciMatrixEngine.ts:
//
//   POST /:projectId/raci-matrix/build              → { matrix }
//   POST /:projectId/raci-matrix/validate           → { result }
//   POST /:projectId/raci-matrix/detect-overload    → { report }
//   POST /:projectId/raci-matrix/find-critical-gaps → { gaps }
//   POST /:projectId/raci-matrix/list-uids          → { uids }
//   POST /:projectId/raci-matrix/summarize-health   → { summary }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked so every 200 asserts real engine output.
//
// Happy-path expectations are re-derived from the REAL engine functions
// (imported below) rather than hard-coded, so the assertions pin actual output
// instead of reimplementing the RACI rules.

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

import raciMatrixRouter from '../../server/routes/raciMatrix.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  buildRaciMatrix,
  validateRaci,
  detectRoleOverload,
  findCriticalGaps,
  listUidsInMatrices,
  summarizeRaciHealth,
  type RaciMatrix,
  type TaskRoleAssignment,
} from '../../services/raciMatrix/raciMatrixEngine.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', raciMatrixRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// A complete, schema-valid RACI matrix (1 accountable + 1 responsible), with
// the `valid`/`violations` fields the matrixSchema requires on the wire.
function validMatrix(taskId = 't1'): RaciMatrix {
  const assignments: TaskRoleAssignment[] = [
    { taskId, uid: 'alice', role: 'accountable' },
    { taskId, uid: 'bob', role: 'responsible' },
  ];
  return {
    taskId,
    taskTitle: `Inspect ${taskId}`,
    assignments,
    valid: true,
    violations: [],
  };
}

describe('POST /:projectId/raci-matrix/build', () => {
  const url = '/api/p1/raci-matrix/build';
  const body = {
    taskId: 't1',
    taskTitle: 'Inspect scaffold',
    critical: true,
    assignments: [
      { taskId: 't1', uid: 'alice', role: 'accountable' },
      { taskId: 't1', uid: 'bob', role: 'responsible' },
      // duplicate (uid,role) — the engine collapses it
      { taskId: 't1', uid: 'bob', role: 'responsible' },
      // foreign taskId — the engine filters it out
      { taskId: 'OTHER', uid: 'zed', role: 'informed' },
    ],
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine matrix (dedup + foreign-task filter)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    const expected = buildRaciMatrix(
      body.taskId,
      body.taskTitle,
      body.assignments as TaskRoleAssignment[],
      { critical: true },
    );
    expect(res.body.matrix).toEqual(expected);
    // Sanity-pin the real-engine consequences so a hollow mock can't pass:
    // dup collapsed + foreign filtered → exactly the two own assignments.
    expect(res.body.matrix.assignments).toHaveLength(2);
    // critical task without 'consulted' → invalid with that one violation.
    expect(res.body.matrix.valid).toBe(false);
    expect(res.body.matrix.violations).toEqual([
      {
        kind: 'consulted_missing_for_critical',
        detail: expect.stringContaining('consulted'),
      },
    ]);
  });

  it('200 a non-critical complete matrix is valid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        taskId: 't9',
        taskTitle: 'Routine check',
        assignments: [
          { taskId: 't9', uid: 'alice', role: 'accountable' },
          { taskId: 't9', uid: 'bob', role: 'responsible' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.matrix.valid).toBe(true);
    expect(res.body.matrix.violations).toEqual([]);
  });

  it('400 on invalid body (missing taskTitle)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ taskId: 't1', assignments: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an assignment with an unknown role (enum reject)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        taskId: 't1',
        taskTitle: 'X',
        assignments: [{ taskId: 't1', uid: 'a', role: 'bogus' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/raci-matrix/build')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/raci-matrix/build')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/raci-matrix/validate', () => {
  const url = '/api/p1/raci-matrix/validate';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ matrix: validMatrix() });
    expect(res.status).toBe(401);
  });

  it('200 valid for a complete matrix', async () => {
    const matrix = validMatrix();
    const res = await request(buildApp()).post(url).set(uid).send({ matrix });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(validateRaci(matrix));
    expect(res.body.result.valid).toBe(true);
    expect(res.body.result.violations).toEqual([]);
  });

  it('200 surfaces the real violations for a critical matrix missing roles', async () => {
    const matrix: RaciMatrix = {
      taskId: 't2',
      taskTitle: 'Hot work',
      critical: true,
      assignments: [{ taskId: 't2', uid: 'a', role: 'accountable' }],
      valid: true,
      violations: [],
    };
    const res = await request(buildApp()).post(url).set(uid).send({ matrix });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(validateRaci(matrix));
    expect(res.body.result.valid).toBe(false);
    const kinds = res.body.result.violations.map(
      (v: { kind: string }) => v.kind,
    );
    expect(kinds).toContain('no_responsible');
    expect(kinds).toContain('consulted_missing_for_critical');
  });

  it('400 when matrix is missing required fields (no valid/violations)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrix: { taskId: 't1', taskTitle: 'X', assignments: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/raci-matrix/validate')
      .set(uid)
      .send({ matrix: validMatrix() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/raci-matrix/detect-overload', () => {
  const url = '/api/p1/raci-matrix/detect-overload';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ matrices: [], uid: 'bob' });
    expect(res.status).toBe(401);
  });

  it('200 reports the real per-role breakdown for a uid', async () => {
    const matrices = [validMatrix('t1'), validMatrix('t2')];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices, uid: 'bob' });
    expect(res.status).toBe(200);
    expect(res.body.report).toEqual(detectRoleOverload(matrices, 'bob'));
    // bob is 'responsible' in both matrices → 2 responsible, not overloaded.
    expect(res.body.report.byRole.responsible).toBe(2);
    expect(res.body.report.totalRoles).toBe(2);
    expect(res.body.report.overloaded).toBe(false);
  });

  it('400 when uid is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/raci-matrix/detect-overload')
      .set(uid)
      .send({ matrices: [], uid: 'bob' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/raci-matrix/find-critical-gaps', () => {
  const url = '/api/p1/raci-matrix/find-critical-gaps';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ matrices: [] });
    expect(res.status).toBe(401);
  });

  it('200 returns gaps re-derived from the real engine', async () => {
    const incomplete: RaciMatrix = {
      taskId: 't3',
      taskTitle: 'Confined space',
      critical: true,
      assignments: [{ taskId: 't3', uid: 'a', role: 'accountable' }],
      valid: false,
      violations: [],
    };
    const matrices = [validMatrix('t1'), incomplete];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices });
    expect(res.status).toBe(200);
    expect(res.body.gaps).toEqual(findCriticalGaps(matrices));
    // Only the incomplete critical matrix has gaps (responsible + consulted).
    expect(res.body.gaps).toEqual([
      { taskId: 't3', missingRoles: ['responsible', 'consulted'] },
    ]);
  });

  it('400 when matrices is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/raci-matrix/find-critical-gaps')
      .set(uid)
      .send({ matrices: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/raci-matrix/list-uids', () => {
  const url = '/api/p1/raci-matrix/list-uids';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ matrices: [] });
    expect(res.status).toBe(401);
  });

  it('200 returns the sorted unique uids from the real engine', async () => {
    const matrices = [validMatrix('t1'), validMatrix('t2')];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices });
    expect(res.status).toBe(200);
    expect(res.body.uids).toEqual(listUidsInMatrices(matrices));
    // alice + bob appear across both matrices, deduped + sorted.
    expect(res.body.uids).toEqual(['alice', 'bob']);
  });

  it('400 when matrices is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices: {} });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/raci-matrix/list-uids')
      .set(uid)
      .send({ matrices: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/raci-matrix/summarize-health', () => {
  const url = '/api/p1/raci-matrix/summarize-health';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ matrices: [] });
    expect(res.status).toBe(401);
  });

  it('200 aggregates project RACI health from the real engine', async () => {
    const incomplete: RaciMatrix = {
      taskId: 't3',
      taskTitle: 'Confined space',
      critical: true,
      assignments: [{ taskId: 't3', uid: 'a', role: 'accountable' }],
      valid: false,
      violations: [],
    };
    const matrices = [validMatrix('t1'), incomplete];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual(summarizeRaciHealth(matrices));
    // 2 matrices, 1 marked valid on the wire, 1 critical gap, no overload.
    expect(res.body.summary.totalMatrices).toBe(2);
    expect(res.body.summary.validMatrices).toBe(1);
    expect(res.body.summary.criticalGapCount).toBe(1);
    expect(res.body.summary.overloadedUids).toEqual([]);
  });

  it('400 when matrices is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrices: 42 });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/raci-matrix/summarize-health')
      .set(uid)
      .send({ matrices: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
