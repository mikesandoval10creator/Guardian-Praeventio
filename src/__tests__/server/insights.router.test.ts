// Real-router supertest for GET /api/insights/* endpoints.
// Exercises the REAL route code so v8 coverage counts it.
// Covers:
//   GET /:projectId/risk-ranking
//   GET /:projectId/safety-talks
//   GET /:projectId/role-view
// Per endpoint: 401 (no token), 403 (non-member), 200 (happy path), 500 (Firestore throws).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ──────────────────────────────────────────────────────────
// Hoisted holder: db assigned per-beforeEach so the mock
// factory (created once at module parse time) always reads
// the live instance via the getter.
// ──────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// Inject req.user; no uid → 401.
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    const role = req.header('x-test-role') ?? 'worker';
    const email = req.header('x-test-email') ?? null;
    (req as Request & { user: Record<string, unknown> }).user = { uid, role, email };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import insightsRouter from '../../server/routes/insights.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ──────────────────────────────────────────────────────────
// App factory — mounts the REAL router
// ──────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/insights', insightsRouter);
  return app;
}

// Header helpers
const asUser = (uid: string, role = 'worker', email?: string) => {
  const h: Record<string, string> = { 'x-test-uid': uid, 'x-test-role': role };
  if (email) h['x-test-email'] = email;
  return h;
};

const PROJECT_ID = 'proj-alpha';
const MEMBER_UID = 'user-member';
const OUTSIDER_UID = 'user-outsider';

// ──────────────────────────────────────────────────────────
// beforeEach: fresh store with a project the member belongs to.
// ──────────────────────────────────────────────────────────
beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
    faenaState: 'operativa',
    complianceScore: 85,
  });
});

// ══════════════════════════════════════════════════════════
// GET /:projectId/risk-ranking
// ══════════════════════════════════════════════════════════
describe('GET /api/insights/:projectId/risk-ranking', () => {
  it('401 when no auth token is sent', async () => {
    const res = await request(buildApp()).get(`/api/insights/${PROJECT_ID}/risk-ranking`);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/risk-ranking`)
      .set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 happy path — empty collections return empty arrays + computedAt', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/risk-ranking`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.topRisks)).toBe(true);
    expect(Array.isArray(body.weakControls)).toBe(true);
    expect(typeof body.computedAt).toBe('string');
  });

  it('200 happy path — seeded risks and controls are ranked and returned', async () => {
    H.db!._seed(`risks/r1`, {
      id: 'r1', projectId: PROJECT_ID, category: 'altura', severity: 'critical',
      exposedWorkerCount: 10, recentFindingCount: 5, linkedIncidentCount: 2, overdueActionCount: 1,
    });
    H.db!._seed(`risks/r2`, {
      id: 'r2', projectId: PROJECT_ID, category: 'electricidad', severity: 'medium',
      exposedWorkerCount: 3, recentFindingCount: 1, linkedIncidentCount: 0, overdueActionCount: 0,
    });
    H.db!._seed(`controls/c1`, {
      id: 'c1', projectId: PROJECT_ID, label: 'Arnés inspección',
      verificationCount: 0, failureCount: 0, daysSinceLastVerification: 45,
    });

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/risk-ranking?topN=2`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const topRisks = body.topRisks as Array<Record<string, unknown>>;
    const weakControls = body.weakControls as Array<Record<string, unknown>>;

    // r1 should rank first (critical score > medium)
    expect(topRisks.length).toBeGreaterThan(0);
    expect(topRisks[0].id).toBe('r1');
    expect(typeof topRisks[0].score).toBe('number');

    expect(weakControls.length).toBe(1);
    expect(weakControls[0].controlId).toBe('c1');
  });

  it('200 topN clamped: topN=0 falls back to default 5 (falsy || 5), topN=999 → capped at 20', async () => {
    for (let i = 0; i < 25; i++) {
      H.db!._seed(`risks/r${i}`, {
        id: `r${i}`, projectId: PROJECT_ID, category: 'other', severity: 'low',
        exposedWorkerCount: i, recentFindingCount: 0, linkedIncidentCount: 0, overdueActionCount: 0,
      });
    }

    // topN=0 → Number('0') is 0 (falsy) → 0 || 5 → default 5; Math.max(5,1)=5; Math.min(5,20)=5
    const resClampZero = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/risk-ranking?topN=0`)
      .set(asUser(MEMBER_UID));
    expect(resClampZero.status).toBe(200);
    expect((resClampZero.body as Record<string, unknown[]>).topRisks.length).toBe(5);

    // topN=999 → Math.max(999,1)=999; Math.min(999,20)=20
    const resClampHigh = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/risk-ranking?topN=999`)
      .set(asUser(MEMBER_UID));
    expect(resClampHigh.status).toBe(200);
    expect((resClampHigh.body as Record<string, unknown[]>).topRisks.length).toBe(20);
  });

  it('500 when Firestore throws unexpectedly', async () => {
    // Replace db with one that throws on collection access
    const brokenDb = createFakeFirestore();
    brokenDb._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    // Intercept collection calls after project lookup succeeds
    const originalCollection = brokenDb.collection.bind(brokenDb);
    let callCount = 0;
    (brokenDb as any).collection = (path: string) => {
      callCount++;
      // First call is projects (membership check) - let it pass
      // 2nd+ calls (risks/controls) - throw
      if (callCount > 1) throw new Error('Firestore exploded');
      return originalCollection(path);
    };
    H.db = brokenDb as any;

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/risk-ranking`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('internal_error');
  });
});

// ══════════════════════════════════════════════════════════
// GET /:projectId/top-risks  (B2 🔵 — real Zettelkasten source)
// ══════════════════════════════════════════════════════════
describe('GET /api/insights/:projectId/top-risks', () => {
  const TENANT_ID = 'tenant-alpha';
  const url = `/api/insights/${PROJECT_ID}/top-risks`;
  // Canonical source: the top-level `nodes` collection (where the IPER Matrix
  // and the Bernoulli generators actually land), NOT the unwritten
  // `tenants/{tid}/zettelkasten_nodes` subcollection. Mirrors §2.15.
  const zkPath = `nodes`;

  beforeEach(() => {
    // Re-seed the project WITH a tenantId so resolveTenantId succeeds.
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [MEMBER_UID],
      createdBy: MEMBER_UID,
      tenantId: TENANT_ID,
    });
  });

  function seedRiskNode(
    id: string,
    probabilidad: number,
    severidad: number,
    over: Record<string, unknown> = {},
  ) {
    H.db!._seed(`${zkPath}/${id}`, {
      type: 'Riesgo', // NodeType.RISK
      title: `Riesgo ${id}`,
      projectId: PROJECT_ID,
      metadata: { probabilidad, severidad, riesgo: 'caída de altura', ...over },
    });
  }

  it('401 when no token is sent', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp()).get(url).set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
  });

  it('404 when the project has no resolvable tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    const res = await request(buildApp()).get(url).set(asUser(MEMBER_UID));
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_not_found');
  });

  it('200 empty — no RISK nodes yet', async () => {
    const res = await request(buildApp()).get(url).set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as { topRisks: unknown[]; total: number };
    expect(body.topRisks).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('200 ranks RISK nodes by DS44 IPER score and ignores non-RISK nodes', async () => {
    seedRiskNode('low', 1, 1); // score 1
    seedRiskNode('high', 5, 5); // score 25
    seedRiskNode('mid', 3, 3); // score 9
    // A non-RISK node in the same project must be excluded.
    H.db!._seed(`${zkPath}/note1`, { type: 'Nota', title: 'no es riesgo', projectId: PROJECT_ID });
    // A RISK node from a DIFFERENT project must be excluded.
    H.db!._seed(`${zkPath}/other`, {
      type: 'Riesgo', title: 'otro proyecto', projectId: 'proj-beta',
      metadata: { probabilidad: 5, severidad: 5 },
    });

    const res = await request(buildApp()).get(`${url}?topN=2`).set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as {
      topRisks: Array<{ id: string; iperScore: number; criticidad: string; iperLevel: string }>;
      total: number;
    };
    expect(body.total).toBe(3); // 3 RISK nodes in this project
    expect(body.topRisks).toHaveLength(2); // topN=2
    expect(body.topRisks[0]!.id).toBe('high');
    expect(body.topRisks[0]!.iperScore).toBe(25);
    expect(body.topRisks[0]!.criticidad).toBe('Crítica');
    expect(body.topRisks[1]!.id).toBe('mid');
    expect(body.topRisks[1]!.iperLevel).toBe('moderado');
  });
});

// ══════════════════════════════════════════════════════════
// GET /:projectId/weak-controls  (B2 🔵 — control_validations source)
// ══════════════════════════════════════════════════════════
describe('GET /api/insights/:projectId/weak-controls', () => {
  const url = `/api/insights/${PROJECT_ID}/weak-controls`;
  const cvPath = `projects/${PROJECT_ID}/control_validations`;

  function seedValidation(
    id: string,
    controlId: string,
    present: boolean,
    validatedAt: string,
  ) {
    H.db!._seed(`${cvPath}/${id}`, { controlId, present, validatedAt, projectId: PROJECT_ID });
  }

  it('401 when no token is sent', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp()).get(url).set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
  });

  it('200 empty — no validations yet', async () => {
    const res = await request(buildApp()).get(url).set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as { weakControls: unknown[]; total: number };
    expect(body.weakControls).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('200 ranks controls by weakness (failure rate) with resolved labels', () => {
    return (async () => {
      // alt-eng-baranda: 1 verified, 1 failure → 100% failure rate.
      seedValidation('v1', 'alt-eng-baranda', false, '2026-06-04T10:00:00Z');
      // alt-eng-linea: 2 clean verifications → 0% failure.
      seedValidation('v2', 'alt-eng-linea', true, '2026-06-04T10:00:00Z');
      seedValidation('v3', 'alt-eng-linea', true, '2026-06-03T10:00:00Z');

      const res = await request(buildApp()).get(`${url}?topN=5`).set(asUser(MEMBER_UID));
      expect(res.status).toBe(200);
      const body = res.body as {
        weakControls: Array<{ controlId: string; label: string; failureRate: number }>;
        total: number;
      };
      expect(body.total).toBe(2); // 2 distinct controls
      expect(body.weakControls[0]!.controlId).toBe('alt-eng-baranda');
      expect(body.weakControls[0]!.failureRate).toBe(1);
      // Label resolved from the controls library.
      expect(body.weakControls[0]!.label).toBe('Barandas perimetrales');
    })();
  });
});

// ══════════════════════════════════════════════════════════
// GET /:projectId/risk-timeseries  (B2 🔵 — findings trend, Zettelkasten)
// ══════════════════════════════════════════════════════════
describe('GET /api/insights/:projectId/risk-timeseries', () => {
  const TENANT_ID = 'tenant-ts';
  const url = `/api/insights/${PROJECT_ID}/risk-timeseries`;
  // Canonical source: top-level `nodes` (see top-risks note). NOT the unwritten
  // tenant subcollection.
  const zkPath = `nodes`;

  beforeEach(() => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [MEMBER_UID],
      createdBy: MEMBER_UID,
      tenantId: TENANT_ID,
    });
  });

  function seedFinding(id: string, createdAt: string, critical: boolean) {
    H.db!._seed(`${zkPath}/${id}`, {
      type: 'Hallazgo', // NodeType.FINDING
      title: `Hallazgo ${id}`,
      projectId: PROJECT_ID,
      createdAt,
      metadata: { criticidad: critical ? 'Alta' : 'Baja' },
    });
  }

  it('401 when no token is sent', async () => {
    expect((await request(buildApp()).get(url)).status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    expect((await request(buildApp()).get(url).set(asUser(OUTSIDER_UID))).status).toBe(403);
  });

  it('200 returns a continuous daily series (gaps filled) and ignores non-FINDING nodes', async () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    seedFinding('f1', today, true);
    seedFinding('f2', today, false);
    seedFinding('f3', yesterday, false);
    // A RISK node must be excluded from the findings trend.
    H.db!._seed(`${zkPath}/r1`, {
      type: 'Riesgo', title: 'no es hallazgo', projectId: PROJECT_ID, createdAt: today,
      metadata: { probabilidad: 5, severidad: 5 },
    });

    const res = await request(buildApp()).get(`${url}?days=7`).set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as {
      series: Array<{ date: string; totalFindings: number; criticalFindings: number }>;
      total: number;
    };
    expect(body.series).toHaveLength(7); // continuous 7-day window
    expect(body.total).toBe(3); // 3 FINDING nodes (RISK excluded)
    const todayBucket = body.series[body.series.length - 1]!;
    expect(todayBucket.totalFindings).toBe(2);
    expect(todayBucket.criticalFindings).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// GET /:projectId/safety-talks
// ══════════════════════════════════════════════════════════
describe('GET /api/insights/:projectId/safety-talks', () => {
  it('401 when no auth token is sent', async () => {
    const res = await request(buildApp()).get(`/api/insights/${PROJECT_ID}/safety-talks`);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/safety-talks`)
      .set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
  });

  it('200 happy path — empty collections, no suggestions but signalsSummary present', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/safety-talks`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.suggestions)).toBe(true);
    const summary = body.signalsSummary as Record<string, Record<string, number>>;
    expect(typeof summary.counts.incidents).toBe('number');
    expect(typeof summary.counts.risks).toBe('number');
    expect(typeof summary.counts.tasks).toBe('number');
    expect(typeof summary.counts.findings).toBe('number');
  });

  it('200 seeded data — altura risk triggers charla "altura" suggestion', async () => {
    H.db!._seed('risks/r1', { projectId: PROJECT_ID, category: 'altura' });
    H.db!._seed('incidents/i1', {
      projectId: PROJECT_ID,
      kind: 'caida_altura',
      severity: 'high',
      occurredAt: new Date().toISOString(),
    });

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/safety-talks`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const suggestions = (res.body as { suggestions: Array<{ topicId: string }> }).suggestions;
    expect(suggestions.some((s) => s.topicId === 'altura')).toBe(true);
    // signalsSummary counts should reflect seeded docs
    const counts = (res.body as { signalsSummary: { counts: Record<string, number> } }).signalsSummary.counts;
    expect(counts.risks).toBe(1);
    expect(counts.incidents).toBe(1);
  });

  it('200 findings counted by category, epp findings trigger epp suggestion', async () => {
    for (let i = 0; i < 4; i++) {
      H.db!._seed(`findings/f${i}`, { projectId: PROJECT_ID, status: 'open', category: 'epp' });
    }

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/safety-talks`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const suggestions = (res.body as { suggestions: Array<{ topicId: string }> }).suggestions;
    expect(suggestions.some((s) => s.topicId === 'epp')).toBe(true);
  });

  it('500 when Firestore throws after membership check', async () => {
    const brokenDb = createFakeFirestore();
    brokenDb._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    const originalCollection = brokenDb.collection.bind(brokenDb);
    let callCount = 0;
    (brokenDb as any).collection = (path: string) => {
      callCount++;
      if (callCount > 1) throw new Error('Firestore is down');
      return originalCollection(path);
    };
    H.db = brokenDb as any;

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/safety-talks`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('internal_error');
  });
});

// ══════════════════════════════════════════════════════════
// GET /:projectId/role-view
// ══════════════════════════════════════════════════════════
describe('GET /api/insights/:projectId/role-view', () => {
  it('401 when no auth token is sent', async () => {
    const res = await request(buildApp()).get(`/api/insights/${PROJECT_ID}/role-view`);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
  });

  it('200 happy path — worker role, returns state + cards + userEmail', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID, 'worker', 'member@test.com'));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.state).toBe('object');
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.userEmail).toBe('member@test.com');

    const state = body.state as Record<string, unknown>;
    expect(state.userUid).toBe(MEMBER_UID);
    expect(state.userRole).toBe('worker');
    expect(state.faenaState).toBe('operativa'); // from seeded project
    expect(state.complianceScore).toBe(85);

    // Worker always gets the SOS card
    const cards = body.cards as Array<{ id: string }>;
    expect(cards.some((c) => c.id === 'w-sos')).toBe(true);
  });

  it('200 site_chief role — overdue actions card appears when seeded', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    // Seed overdue corrective action
    H.db!._seed('corrective_actions/ca1', {
      projectId: PROJECT_ID,
      status: 'open',
      dueDate: yesterday,
    });

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID, 'site_chief'));
    expect(res.status).toBe(200);
    const cards = (res.body as { cards: Array<{ id: string }> }).cards;
    expect(cards.some((c) => c.id === 'sc-overdue')).toBe(true);
  });

  it('200 management role — compliance card present when complianceScore set', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID, 'management'));
    expect(res.status).toBe(200);
    const cards = (res.body as { cards: Array<{ id: string }> }).cards;
    expect(cards.some((c) => c.id === 'mg-compliance')).toBe(true);
    expect(cards.some((c) => c.id === 'mg-faena')).toBe(true);
  });

  it('200 prevention role — compliance + site_chief cards combined', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID, 'prevention'));
    expect(res.status).toBe(200);
    const cards = (res.body as { cards: Array<{ id: string }> }).cards;
    // prevention builds on site_chief + compliance card prepended
    expect(cards.some((c) => c.id === 'p-compliance')).toBe(true);
  });

  it('200 unknown role is coerced to worker', async () => {
    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID, 'supreme_overlord'));
    expect(res.status).toBe(200);
    const state = (res.body as { state: Record<string, unknown> }).state;
    expect(state.userRole).toBe('worker');
  });

  it('200 todaysTasks count reflected in worker card', async () => {
    const today = new Date().toISOString().slice(0, 10);
    H.db!._seed('tasks/t1', {
      projectId: PROJECT_ID,
      assignedToUid: MEMBER_UID,
      scheduledFor: today,
    });

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID, 'worker'));
    expect(res.status).toBe(200);
    const cards = (res.body as { cards: Array<{ id: string; count?: number }> }).cards;
    const taskCard = cards.find((c) => c.id === 'w-tasks');
    expect(taskCard).toBeDefined();
    expect(taskCard!.count).toBe(1);
  });

  it('200 missing project doc falls back gracefully (faenaState=operativa default)', async () => {
    // Project doc exists (for membership check) but has no faenaState
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID, 'worker'));
    expect(res.status).toBe(200);
    const state = (res.body as { state: Record<string, unknown> }).state;
    expect(state.faenaState).toBe('operativa');
  });

  it('500 when Firestore throws after membership check', async () => {
    const brokenDb = createFakeFirestore();
    brokenDb._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    const originalCollection = brokenDb.collection.bind(brokenDb);
    let callCount = 0;
    (brokenDb as any).collection = (path: string) => {
      callCount++;
      if (callCount > 1) throw new Error('DB offline');
      return originalCollection(path);
    };
    H.db = brokenDb as any;

    const res = await request(buildApp())
      .get(`/api/insights/${PROJECT_ID}/role-view`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('internal_error');
  });
});
