// Real-router supertest for the Research Mode (root-cause investigation) HTTP
// surface (src/server/routes/researchMode.ts). Four stateless POST endpoints
// over the pure deterministic engine in
// src/services/researchMode/researchMode.ts:
//
//   POST /:projectId/research-mode/find-root-branches            → { branches }
//   POST /:projectId/research-mode/summarize-tree                → { summary }
//   POST /:projectId/research-mode/compare-trees                 → { scores }
//   POST /:projectId/research-mode/detect-failed-control-patterns→ { signals }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + captureRouteError are
// mocked; the engine, the Zod schemas (`validate`) and the membership check run
// unmocked so every 200 asserts real engine output.
//
// The 200 expectations are RE-DERIVED here from the engine's documented
// algorithm (tree traversal, Jaccard similarity, frequency thresholds), not
// copied from the handler — so they pin actual behavior, including the money-
// adjacent score rounding (Math.round of a 0..1 weighted Jaccard × 100).

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

import researchModeRouter from '../../server/routes/researchMode.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type {
  CauseNode,
  RootCauseTree,
} from '../../services/researchMode/researchMode.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', researchModeRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// ── Fixtures ──────────────────────────────────────────────────────────────
// Two-level tree: n1 (top "why", people) → n2 (root cause, process, points at
// failed control C1). The leaf is isRoot=true so the branch path is [n1, n2].
function makeNode(over: Partial<CauseNode> & Pick<CauseNode, 'id'>): CauseNode {
  return {
    text: 'why something happened',
    category: 'process',
    isRoot: false,
    proposedByUid: 'u1',
    ...over,
  };
}

function primaryTree(): RootCauseTree {
  return {
    incidentId: 'inc-1',
    nodes: [
      makeNode({ id: 'n1', category: 'people', isRoot: false }),
      makeNode({
        id: 'n2',
        category: 'process',
        isRoot: true,
        parentId: 'n1',
        failedControlId: 'C1',
      }),
    ],
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. find-root-branches
// ────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/research-mode/find-root-branches', () => {
  const url = '/api/p1/research-mode/find-root-branches';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ tree: primaryTree() });
    expect(res.status).toBe(401);
  });

  it('200 returns the real branch path from leaf back up to the top "why"', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ tree: primaryTree() });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.branches)).toBe(true);
    expect(res.body.branches).toHaveLength(1);
    const [branch] = res.body.branches;
    // The traversal unshifts parents, so the path is ordered root-first.
    expect(branch.path.map((n: CauseNode) => n.id)).toEqual(['n1', 'n2']);
    expect(branch.depth).toBe(2);
    // n2 carries failedControlId C1, so the branch is flagged.
    expect(branch.hasFailedControl).toBe(true);
  });

  it('200 returns no branches when no node is marked isRoot', async () => {
    const tree: RootCauseTree = {
      incidentId: 'inc-x',
      nodes: [makeNode({ id: 'n1', isRoot: false })],
    };
    const res = await request(buildApp()).post(url).set(uid).send({ tree });
    expect(res.status).toBe(200);
    expect(res.body.branches).toEqual([]);
  });

  it('400 on invalid body (missing tree)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an unknown cause category (Zod enum reject)', async () => {
    const tree = {
      incidentId: 'inc-1',
      nodes: [{ ...makeNode({ id: 'n1' }), category: 'gremlins' }],
    };
    const res = await request(buildApp()).post(url).set(uid).send({ tree });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/research-mode/find-root-branches')
      .set(uid)
      .send({ tree: primaryTree() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/research-mode/find-root-branches')
      .set(uid)
      .send({ tree: primaryTree() });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. summarize-tree
// ────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/research-mode/summarize-tree', () => {
  const url = '/api/p1/research-mode/summarize-tree';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ tree: primaryTree() });
    expect(res.status).toBe(401);
  });

  it('200 returns a real category histogram + depth from the engine', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ tree: primaryTree() });
    expect(res.status).toBe(200);
    const { summary } = res.body;
    expect(summary.totalNodes).toBe(2);
    expect(summary.rootCount).toBe(1);
    expect(summary.maxDepth).toBe(2);
    // n1=people, n2=process; all other buckets zero.
    expect(summary.byCategory).toEqual({
      people: 1,
      process: 1,
      environment: 0,
      equipment: 0,
      materials: 0,
      measurement: 0,
      management: 0,
    });
    expect(summary.failedControlsIdentified).toEqual(['C1']);
  });

  it('400 when nodes is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tree: { incidentId: 'inc-1', nodes: 'nope' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/research-mode/summarize-tree')
      .set(uid)
      .send({ tree: primaryTree() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. compare-trees
// ────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/research-mode/compare-trees', () => {
  const url = '/api/p1/research-mode/compare-trees';

  // primary cats = {people, process}; primary controls = {C1}.
  // other-A: cats {people, process} (C1) → catJaccard=2/2=1, ctrlJaccard=1/1=1
  //   → round((1*0.4 + 1*0.6)*100) = 100.
  // other-B: cats {people, process} but control C2 → catJaccard=1,
  //   ctrlJaccard = 0/2 = 0 → round((0.4 + 0)*100) = 40.
  function otherA(): RootCauseTree {
    return {
      incidentId: 'inc-A',
      nodes: [
        makeNode({ id: 'a1', category: 'people', isRoot: false }),
        makeNode({ id: 'a2', category: 'process', isRoot: true, parentId: 'a1', failedControlId: 'C1' }),
      ],
    };
  }
  function otherB(): RootCauseTree {
    return {
      incidentId: 'inc-B',
      nodes: [
        makeNode({ id: 'b1', category: 'people', isRoot: false }),
        makeNode({ id: 'b2', category: 'process', isRoot: true, parentId: 'b1', failedControlId: 'C2' }),
      ],
    };
  }

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ primary: primaryTree(), others: [] });
    expect(res.status).toBe(401);
  });

  it('200 scores + ranks others by weighted Jaccard (real engine math)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ primary: primaryTree(), others: [otherB(), otherA()] });
    expect(res.status).toBe(200);
    const { scores } = res.body;
    // Both score > 0, sorted descending: A (100) before B (40).
    expect(scores.map((s: { otherIncidentId: string }) => s.otherIncidentId)).toEqual([
      'inc-A',
      'inc-B',
    ]);
    expect(scores[0]).toMatchObject({
      otherIncidentId: 'inc-A',
      score: 100,
      matchingFailedControls: ['C1'],
    });
    expect(new Set(scores[0].matchingCategories)).toEqual(new Set(['people', 'process']));
    expect(scores[1]).toMatchObject({
      otherIncidentId: 'inc-B',
      score: 40,
      matchingFailedControls: [],
    });
  });

  it('200 drops zero-score incidents (no overlapping categories or controls)', async () => {
    const disjoint: RootCauseTree = {
      incidentId: 'inc-Z',
      nodes: [
        makeNode({ id: 'z1', category: 'equipment', isRoot: true, failedControlId: 'C9' }),
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ primary: primaryTree(), others: [disjoint] });
    expect(res.status).toBe(200);
    expect(res.body.scores).toEqual([]);
  });

  it('400 when others is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ primary: primaryTree(), others: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/research-mode/compare-trees')
      .set(uid)
      .send({ primary: primaryTree(), others: [otherA()] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. detect-failed-control-patterns
// ────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/research-mode/detect-failed-control-patterns', () => {
  const url = '/api/p1/research-mode/detect-failed-control-patterns';

  // 10 trees: C1 fails in 4 (40% → critical), C2 fails in 2 (20% → warning),
  // C3 fails in 1 (10% → low; >10 is false at exactly 10). Sorted by freq desc.
  function treeWithControls(id: string, controls: string[]): RootCauseTree {
    return {
      incidentId: id,
      nodes: controls.map((c, i) =>
        makeNode({ id: `${id}-n${i}`, isRoot: true, failedControlId: c }),
      ),
    };
  }
  function tenTrees(): RootCauseTree[] {
    const trees: RootCauseTree[] = [];
    for (let i = 0; i < 4; i++) trees.push(treeWithControls(`t${i}`, ['C1', 'C2'].slice(0, i < 2 ? 2 : 1)));
    // t0,t1 → [C1,C2]; t2,t3 → [C1]. So C1 in 4, C2 in 2.
    for (let i = 4; i < 9; i++) trees.push(treeWithControls(`t${i}`, []));
    trees.push(treeWithControls('t9', ['C3'])); // C3 in 1
    return trees;
  }

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ trees: [] });
    expect(res.status).toBe(401);
  });

  it('200 computes frequency + severity thresholds across incidents', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ trees: tenTrees() });
    expect(res.status).toBe(200);
    const { signals } = res.body;
    // C1: 4/10 = 40% critical; C2: 2/10 = 20% warning; C3: 1/10 = 10% low.
    expect(signals).toEqual([
      { controlId: 'C1', failureCount: 4, frequencyPercent: 40, severity: 'critical' },
      { controlId: 'C2', failureCount: 2, frequencyPercent: 20, severity: 'warning' },
      { controlId: 'C3', failureCount: 1, frequencyPercent: 10, severity: 'low' },
    ]);
  });

  it('200 counts a control once per incident even if repeated within one tree', async () => {
    const dupe: RootCauseTree = {
      incidentId: 'inc-dupe',
      nodes: [
        makeNode({ id: 'd1', isRoot: true, failedControlId: 'C1' }),
        makeNode({ id: 'd2', isRoot: true, failedControlId: 'C1' }),
      ],
    };
    const res = await request(buildApp()).post(url).set(uid).send({ trees: [dupe] });
    expect(res.status).toBe(200);
    // De-duped per tree: failureCount stays 1, 1/1 = 100% → critical.
    expect(res.body.signals).toEqual([
      { controlId: 'C1', failureCount: 1, frequencyPercent: 100, severity: 'critical' },
    ]);
  });

  it('200 returns no signals when no failed controls are present', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ trees: [treeWithControls('clean', [])] });
    expect(res.status).toBe(200);
    expect(res.body.signals).toEqual([]);
  });

  it('400 when trees is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ trees: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/research-mode/detect-failed-control-patterns')
      .set(uid)
      .send({ trees: tenTrees() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
