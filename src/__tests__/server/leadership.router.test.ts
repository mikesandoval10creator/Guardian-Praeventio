// Real-router supertest for src/server/routes/leadership.ts
// (Plan v3 Fase 1 — server lever, §276-277 Bitácora de Decisiones de Supervisión + Ranking).
//
// Route is mounted at /api/sprint-k in server.ts:
//   app.use('/api/sprint-k', leadershipRouter);
//
// 3 endpoints covered:
//   GET  /:projectId/leadership/decisions[?supervisorUid=&period=]
//   POST /:projectId/leadership/decisions
//   GET  /:projectId/leadership/ranking[?period=]
//
// Storage: tenants/{tid}/projects/{pid}/leadership_decisions/{id}
// The guard() helper calls assertProjectMember + resolveTenantId internally.
// The GET ranking endpoint dynamic-imports supervisionDecisionTrail.js —
// we let the real service run (it is pure and deterministic).

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
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import leadershipRouter from '../../server/routes/leadership.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', leadershipRouter);
  return app;
}

const PROJECT_ID = 'p-ld-test';
const TENANT_ID = 'tenant-abc';
const CALLER_UID = 'uid-ld-member';
const OTHER_UID = 'uid-ld-sup2';

/** Seed a project doc with tenantId so resolveTenantId() resolves. */
function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Leadership Test Project',
    tenantId: TENANT_ID,
    members: [CALLER_UID, OTHER_UID],
    createdBy: CALLER_UID,
  });
}

/** Seed a leadership decision doc under the tenant path. */
function seedDecision(
  db: NonNullable<typeof H.db>,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const base = {
    id,
    supervisorUid: CALLER_UID,
    decidedAt: '2026-05-01T10:00:00.000Z',
    kind: 'stop_task',
    context: 'Se detectó falta de EPP en altura',
    rationale: 'Riesgo inminente de caída',
    createdAt: '2026-05-01T10:00:00.000Z',
    createdBy: CALLER_UID,
  };
  db._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/leadership_decisions/${id}`,
    { ...base, ...overrides },
  );
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:projectId/leadership/decisions
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/leadership/decisions', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/leadership/decisions`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when project has no tenantId resolvable', async () => {
    // Seed a project without tenantId and with no members subcollection
    H.db!._seed('projects/no-tenant-project', {
      name: 'No Tenant',
      members: ['uid-ld-member'],
      createdBy: 'uid-ld-member',
      // tenantId intentionally absent
    });
    const res = await request(buildApp())
      .get(`/api/sprint-k/no-tenant-project/leadership/decisions`)
      .set('x-test-uid', 'uid-ld-member');
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_not_found');
  });

  it('200 returns empty decisions array when none stored', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.decisions)).toBe(true);
    expect(body.decisions).toHaveLength(0);
  });

  it('200 returns seeded decisions sorted newest-first', async () => {
    seedDecision(H.db!, 'ld-001', { decidedAt: '2026-04-01T08:00:00.000Z' });
    seedDecision(H.db!, 'ld-002', {
      decidedAt: '2026-05-15T08:00:00.000Z',
      kind: 'reject_unsafe',
    });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { decisions } = res.body as { decisions: Record<string, unknown>[] };
    expect(decisions).toHaveLength(2);
    // Newest first
    expect(decisions[0].id).toBe('ld-002');
    expect(decisions[1].id).toBe('ld-001');
  });

  it('200 filters by supervisorUid query param', async () => {
    seedDecision(H.db!, 'ld-sup1', { supervisorUid: CALLER_UID });
    seedDecision(H.db!, 'ld-sup2', { supervisorUid: OTHER_UID });
    const res = await request(buildApp())
      .get(`${url}?supervisorUid=${OTHER_UID}`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { decisions } = res.body as { decisions: Record<string, unknown>[] };
    expect(decisions).toHaveLength(1);
    expect(decisions[0].id).toBe('ld-sup2');
    expect(decisions[0].supervisorUid).toBe(OTHER_UID);
  });

  it('200 period=30d excludes decisions older than 30 days', async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    seedDecision(H.db!, 'ld-recent', { decidedAt: recent });
    seedDecision(H.db!, 'ld-old', { decidedAt: old });
    const res = await request(buildApp())
      .get(`${url}?period=30d`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { decisions } = res.body as { decisions: Record<string, unknown>[] };
    expect(decisions).toHaveLength(1);
    expect(decisions[0].id).toBe('ld-recent');
  });

  it('200 period=all returns all decisions regardless of age', async () => {
    const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    seedDecision(H.db!, 'ld-veryold', { decidedAt: veryOld });
    const res = await request(buildApp())
      .get(`${url}?period=all`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { decisions } = res.body as { decisions: Record<string, unknown>[] };
    expect(decisions).toHaveLength(1);
    expect(decisions[0].id).toBe('ld-veryold');
  });

  it('200 period=7d excludes 90-day-old decisions', async () => {
    const sevenDayAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 60000).toISOString();
    const ninetyDayAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    seedDecision(H.db!, 'ld-7d', { decidedAt: sevenDayAgo });
    seedDecision(H.db!, 'ld-90d', { decidedAt: ninetyDayAgo });
    const res = await request(buildApp())
      .get(`${url}?period=7d`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { decisions } = res.body as { decisions: Record<string, unknown>[] };
    expect(decisions).toHaveLength(1);
    expect(decisions[0].id).toBe('ld-7d');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/leadership/decisions
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/leadership/decisions', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/leadership/decisions`;

  const minValidBody = {
    kind: 'stop_task',
    context: 'Trabajador sin casco en zona de riesgo de caída',
    rationale: 'DS 594 art. 53 exige EPP en todo momento en altura',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(minValidBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send(minValidBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('400 when kind is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ context: 'ctx', rationale: 'rat' }); // no kind
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when kind is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'invented_action', context: 'ctx', rationale: 'rat' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when context is empty string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'stop_task', context: '', rationale: 'rat' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when rationale is empty string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ kind: 'stop_task', context: 'ctx', rationale: '' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when involvedRef.kind is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minValidBody,
        involvedRef: { kind: 'UNKNOWN_KIND', id: 'task-1' },
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('201 creates a decision with auto-generated id and stamps supervisorUid=callerUid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minValidBody);
    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const decision = body.decision as Record<string, unknown>;
    expect(typeof decision.id).toBe('string');
    expect(decision.id as string).toMatch(/^ld_\d+_/);
    // supervisorUid must be the authenticated caller, never a client-supplied value
    expect(decision.supervisorUid).toBe(CALLER_UID);
    expect(decision.kind).toBe('stop_task');
    expect(decision.context).toBe(minValidBody.context);
    expect(decision.rationale).toBe(minValidBody.rationale);
  });

  it('201 persists the decision to Firestore under the correct tenant path', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minValidBody);
    expect(res.status).toBe(201);
    const decision = (res.body as Record<string, unknown>).decision as Record<string, unknown>;
    const stored = H.db!._dump();
    const key = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/leadership_decisions/${decision.id as string}`;
    expect(stored[key]).toBeDefined();
    expect(stored[key].kind).toBe('stop_task');
    expect(stored[key].supervisorUid).toBe(CALLER_UID);
  });

  it('201 accepts a caller-supplied id and decidedAt', async () => {
    const customId = 'ld_custom_id_abc';
    const customAt = '2026-03-15T09:30:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minValidBody, id: customId, decidedAt: customAt });
    expect(res.status).toBe(201);
    const decision = (res.body as Record<string, unknown>).decision as Record<string, unknown>;
    expect(decision.id).toBe(customId);
    expect(decision.decidedAt).toBe(customAt);
  });

  it('201 accepts all SUPERVISION_DECISION_KINDS', async () => {
    const kinds = [
      'authorize_work',
      'stop_task',
      'change_crew',
      'change_method',
      'reject_unsafe',
      'request_resource',
      'escalate_finding',
      'approve_exception',
      'reject_exception',
    ] as const;
    for (const kind of kinds) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ ...minValidBody, kind });
      expect(res.status).toBe(201);
      const decision = (res.body as Record<string, unknown>).decision as Record<string, unknown>;
      expect(decision.kind).toBe(kind);
    }
  });

  it('201 accepts optional involvedRef with TASK kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minValidBody,
        involvedRef: { kind: 'TASK', id: 'task-xyz-123' },
      });
    expect(res.status).toBe(201);
    const decision = (res.body as Record<string, unknown>).decision as Record<string, unknown>;
    const involvedRef = decision.involvedRef as Record<string, unknown>;
    expect(involvedRef.kind).toBe('TASK');
    expect(involvedRef.id).toBe('task-xyz-123');
  });

  it('201 accepts optional outcome with positive=true', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minValidBody,
        outcome: {
          positive: true,
          description: 'Se evitó la caída del trabajador',
          recordedAt: '2026-05-02T12:00:00.000Z',
        },
      });
    expect(res.status).toBe(201);
    const decision = (res.body as Record<string, unknown>).decision as Record<string, unknown>;
    const outcome = decision.outcome as Record<string, unknown>;
    expect(outcome.positive).toBe(true);
    expect(outcome.description).toBe('Se evitó la caída del trabajador');
  });

  it('201 all four involvedRef kinds are accepted', async () => {
    const kinds = ['TASK', 'WORKER', 'FINDING', 'EXCEPTION'] as const;
    for (const kind of kinds) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ ...minValidBody, involvedRef: { kind, id: `ref-${kind}-1` } });
      expect(res.status).toBe(201);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:projectId/leadership/ranking
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/leadership/ranking', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/leadership/ranking`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 returns empty ranking when no decisions stored', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.ranking)).toBe(true);
    expect(body.ranking).toHaveLength(0);
  });

  it('200 returns ranking with one entry per supervisor', async () => {
    seedDecision(H.db!, 'ld-r1', {
      supervisorUid: CALLER_UID,
      kind: 'reject_unsafe',
      decidedAt: '2026-05-10T08:00:00.000Z',
    });
    seedDecision(H.db!, 'ld-r2', {
      supervisorUid: OTHER_UID,
      kind: 'authorize_work',
      decidedAt: '2026-05-11T08:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { ranking } = res.body as { ranking: Record<string, unknown>[] };
    expect(ranking).toHaveLength(2);
    // reject_unsafe (30 pts) > authorize_work (5 pts) — CALLER_UID should rank first
    expect(ranking[0].supervisorUid).toBe(CALLER_UID);
    expect(ranking[0].totalImpactScore).toBe(30);
    expect(ranking[1].supervisorUid).toBe(OTHER_UID);
    expect(ranking[1].totalImpactScore).toBe(5);
  });

  it('200 ranking entry has required shape (totalDecisions, byKind, positiveOutcomeRate)', async () => {
    seedDecision(H.db!, 'ld-shape', {
      supervisorUid: CALLER_UID,
      kind: 'stop_task',
      decidedAt: '2026-05-12T08:00:00.000Z',
      outcome: { positive: true, description: 'Accidente evitado', recordedAt: '2026-05-13T08:00:00.000Z' },
    });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { ranking } = res.body as { ranking: Record<string, unknown>[] };
    expect(ranking).toHaveLength(1);
    const entry = ranking[0];
    expect(entry.supervisorUid).toBe(CALLER_UID);
    expect(entry.totalDecisions).toBe(1);
    expect(typeof entry.totalImpactScore).toBe('number');
    expect(typeof entry.positiveOutcomeRate).toBe('number');
    // stop_task has bonus 5 for positive outcome → 25 + 5 = 30
    expect(entry.totalImpactScore).toBe(30);
    expect(entry.positiveOutcomeRate).toBe(100);
    expect(typeof entry.byKind).toBe('object');
    const byKind = entry.byKind as Record<string, unknown>;
    expect(byKind.stop_task).toBe(1);
    expect(byKind.reject_unsafe).toBe(0);
  });

  it('200 period=7d excludes old decisions from ranking', async () => {
    const recentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const oldAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    seedDecision(H.db!, 'ld-rank-recent', {
      supervisorUid: CALLER_UID,
      kind: 'reject_unsafe',
      decidedAt: recentAt,
    });
    seedDecision(H.db!, 'ld-rank-old', {
      supervisorUid: OTHER_UID,
      kind: 'reject_unsafe',
      decidedAt: oldAt,
    });
    const res = await request(buildApp())
      .get(`${url}?period=7d`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { ranking } = res.body as { ranking: Record<string, unknown>[] };
    // Only the recent decision should appear — OTHER_UID's old one is excluded
    expect(ranking).toHaveLength(1);
    expect(ranking[0].supervisorUid).toBe(CALLER_UID);
  });

  it('200 period=all includes decisions older than 90d', async () => {
    const veryOldAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    seedDecision(H.db!, 'ld-rank-ancient', {
      supervisorUid: OTHER_UID,
      kind: 'stop_task',
      decidedAt: veryOldAt,
    });
    const res = await request(buildApp())
      .get(`${url}?period=all`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { ranking } = res.body as { ranking: Record<string, unknown>[] };
    expect(ranking.some((r) => (r as Record<string, unknown>).supervisorUid === OTHER_UID)).toBe(true);
  });

  it('200 multiple decisions from same supervisor accumulate impact score', async () => {
    seedDecision(H.db!, 'ld-multi-1', {
      supervisorUid: CALLER_UID,
      kind: 'reject_unsafe',
      decidedAt: '2026-05-10T08:00:00.000Z',
    });
    seedDecision(H.db!, 'ld-multi-2', {
      supervisorUid: CALLER_UID,
      kind: 'stop_task',
      decidedAt: '2026-05-11T08:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(`${url}?period=all`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { ranking } = res.body as { ranking: Record<string, unknown>[] };
    expect(ranking).toHaveLength(1);
    const entry = ranking[0];
    expect(entry.totalDecisions).toBe(2);
    // reject_unsafe=30 + stop_task=25 = 55
    expect(entry.totalImpactScore).toBe(55);
    const byKind = entry.byKind as Record<string, unknown>;
    expect(byKind.reject_unsafe).toBe(1);
    expect(byKind.stop_task).toBe(1);
  });
});
