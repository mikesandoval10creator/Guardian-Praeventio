// Real-router supertest for escalation SLA engine endpoints.
// Sprint 50 §206-210 — five pure-compute POST endpoints under /:projectId/escalation/*.
// No Firestore writes in handlers; assertProjectMember reads the projects collection.
// Engine functions run real (pure compute, no deps to mock).

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
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import escalationRouter from '../../server/routes/escalation.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', escalationRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

// ────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj1';
const MEMBER_UID = 'user-member';
const NONMEMBER_UID = 'user-stranger';

/** Minimal valid WorkflowItem (incident, high, open, well within SLA). */
const baseItem = {
  id: 'item-001',
  kind: 'incident',
  severity: 'high',
  status: 'open',
  createdAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute old (SLA=24h)
};

/** Minimal valid EscalationChain (3 levels). */
const baseChain = {
  level1: { primary: 'uid-sup1', label: 'Supervisor 1' },
  level2: { primary: 'uid-sup2', label: 'Supervisor 2' },
  level3: { primary: 'uid-manager', label: 'Manager' },
};

/** A valid EscalationDecision (no escalation needed). */
const baseDecision = {
  shouldEscalate: false,
  detail: 'Within SLA.',
  chainExhausted: false,
};

function seedMember() {
  H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: 'owner-uid' });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedMember();
});

// ════════════════════════════════════════════════════════════════════════
// POST /:projectId/escalation/sla-minutes
// ════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/escalation/sla-minutes', () => {
  const url = `/${PROJECT_ID}/escalation/sla-minutes`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(url).send({ kind: 'incident', severity: 'high' });
    expect(res.status).toBe(401);
  });

  it('403 — non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ kind: 'incident', severity: 'high' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 — invalid body (missing severity)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ kind: 'incident' });
    expect(res.status).toBe(400);
  });

  it('400 — invalid kind enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ kind: 'unknown_kind', severity: 'high' });
    expect(res.status).toBe(400);
  });

  it('200 — returns correct slaMinutes for incident/high (24h = 1440 min)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ kind: 'incident', severity: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.slaMinutes).toBe(60 * 24); // 1440
  });

  it('200 — returns correct slaMinutes for sos_alert/critical (1 min)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ kind: 'sos_alert', severity: 'critical' });
    expect(res.status).toBe(200);
    expect(res.body.slaMinutes).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// POST /:projectId/escalation/assess-sla
// ════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/escalation/assess-sla', () => {
  const url = `/${PROJECT_ID}/escalation/assess-sla`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(url).send({ item: baseItem });
    expect(res.status).toBe(401);
  });

  it('403 — non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ item: baseItem });
    expect(res.status).toBe(403);
  });

  it('400 — item missing required field (id)', async () => {
    const { id: _omit, ...itemNoId } = baseItem;
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item: itemNoId });
    expect(res.status).toBe(400);
  });

  it('200 — returns assessment with state=within_sla for fresh item', async () => {
    const now = new Date();
    const item = { ...baseItem, createdAt: new Date(now.getTime() - 60_000).toISOString() };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item, now: now.toISOString() });
    expect(res.status).toBe(200);
    const assessment = res.body.assessment as Record<string, unknown>;
    expect(assessment.state).toBe('within_sla');
    expect(typeof assessment.slaMinutes).toBe('number');
    expect(typeof assessment.ageMinutes).toBe('number');
    expect(typeof assessment.minutesUntilBreach).toBe('number');
    expect(typeof assessment.consumedFraction).toBe('number');
  });

  it('200 — returns state=breached for very old item', async () => {
    // SLA for incident/high is 1440 min; create item 3000 min ago
    const now = new Date();
    const item = {
      ...baseItem,
      createdAt: new Date(now.getTime() - 3000 * 60_000).toISOString(),
    };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item, now: now.toISOString() });
    expect(res.status).toBe(200);
    const assessment = res.body.assessment as Record<string, unknown>;
    expect(assessment.state).toBe('breached');
  });
});

// ════════════════════════════════════════════════════════════════════════
// POST /:projectId/escalation/decide
// ════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/escalation/decide', () => {
  const url = `/${PROJECT_ID}/escalation/decide`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(url).send({ item: baseItem, chain: baseChain });
    expect(res.status).toBe(401);
  });

  it('403 — non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ item: baseItem, chain: baseChain });
    expect(res.status).toBe(403);
  });

  it('400 — missing chain', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item: baseItem });
    expect(res.status).toBe(400);
  });

  it('400 — chain missing required level2', async () => {
    const { level2: _omit, ...incompleteChain } = baseChain;
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item: baseItem, chain: incompleteChain });
    expect(res.status).toBe(400);
  });

  it('200 — within-SLA item → shouldEscalate=false', async () => {
    const now = new Date();
    const item = { ...baseItem, createdAt: new Date(now.getTime() - 60_000).toISOString() };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item, chain: baseChain, now: now.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.decision.shouldEscalate).toBe(false);
    expect(res.body.decision.chainExhausted).toBe(false);
  });

  it('200 — manual escalation option → shouldEscalate=true', async () => {
    const now = new Date();
    const item = { ...baseItem, createdAt: new Date(now.getTime() - 60_000).toISOString() };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({
        item,
        chain: baseChain,
        now: now.toISOString(),
        options: { manualEscalation: true },
      });
    expect(res.status).toBe(200);
    const decision = res.body.decision as Record<string, unknown>;
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reason).toBe('manual_escalation');
    expect(decision.toUid).toBe('uid-sup2'); // level1 → level2
  });

  it('200 — closed item → shouldEscalate=false regardless', async () => {
    const item = { ...baseItem, status: 'closed' as const };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item, chain: baseChain, options: { manualEscalation: true } });
    expect(res.status).toBe(200);
    expect(res.body.decision.shouldEscalate).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// POST /:projectId/escalation/apply
// ════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/escalation/apply', () => {
  const url = `/${PROJECT_ID}/escalation/apply`;

  const escalateDecision = {
    shouldEscalate: true,
    toLevel: 2 as const,
    toUid: 'uid-sup2',
    reason: 'sla_breach' as const,
    detail: 'Escalation by sla_breach → level 2.',
    chainExhausted: false,
  };

  it('401 — no auth token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ item: baseItem, decision: baseDecision });
    expect(res.status).toBe(401);
  });

  it('403 — non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ item: baseItem, decision: baseDecision });
    expect(res.status).toBe(403);
  });

  it('400 — decision missing required detail field', async () => {
    const { detail: _omit, ...decisionNoDetail } = baseDecision;
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item: baseItem, decision: decisionNoDetail });
    expect(res.status).toBe(400);
  });

  it('200 — no-escalation decision returns item unchanged', async () => {
    const now = new Date();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item: baseItem, decision: baseDecision, now: now.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.item.id).toBe(baseItem.id);
    // No escalation applied — assignedToUid stays undefined
    expect(res.body.item.assignedToUid).toBeUndefined();
  });

  it('200 — escalate decision updates item assignedToUid + history', async () => {
    const now = new Date();
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ item: baseItem, decision: escalateDecision, now: now.toISOString() });
    expect(res.status).toBe(200);
    const item = res.body.item as Record<string, unknown>;
    expect(item.assignedToUid).toBe('uid-sup2');
    expect(item.currentLevel).toBe(2);
    const history = item.history as Array<Record<string, unknown>>;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(1);
    expect(history[0].reason).toBe('sla_breach');
    expect(history[0].toUid).toBe('uid-sup2');
  });
});

// ════════════════════════════════════════════════════════════════════════
// POST /:projectId/escalation/process-batch
// ════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/escalation/process-batch', () => {
  const url = `/${PROJECT_ID}/escalation/process-batch`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ items: [baseItem], chain: baseChain });
    expect(res.status).toBe(401);
  });

  it('403 — non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ items: [baseItem], chain: baseChain });
    expect(res.status).toBe(403);
  });

  it('400 — missing items array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ chain: baseChain });
    expect(res.status).toBe(400);
  });

  it('400 — items is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ items: 'not-an-array', chain: baseChain });
    expect(res.status).toBe(400);
  });

  it('200 — empty items array returns zeros', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ items: [], chain: baseChain });
    expect(res.status).toBe(200);
    const result = res.body.result as Record<string, unknown>;
    expect(result.evaluated).toBe(0);
    expect(result.escalated).toBe(0);
    expect(Array.isArray(result.decisions)).toBe(true);
    expect((result.decisions as unknown[]).length).toBe(0);
  });

  it('200 — single within-SLA item: evaluated=1, escalated=0', async () => {
    const now = new Date();
    const item = { ...baseItem, createdAt: new Date(now.getTime() - 60_000).toISOString() };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ items: [item], chain: baseChain, now: now.toISOString() });
    expect(res.status).toBe(200);
    const result = res.body.result as Record<string, unknown>;
    expect(result.evaluated).toBe(1);
    expect(result.escalated).toBe(0);
    const decisions = result.decisions as Array<Record<string, unknown>>;
    expect(decisions[0].itemId).toBe(item.id);
    expect((decisions[0].decision as Record<string, unknown>).shouldEscalate).toBe(false);
  });

  it('200 — breached item escalates: escalated=1, decision.reason=sla_breach', async () => {
    const now = new Date();
    // incident/high SLA=1440min; 3000min old → breached
    const item = {
      ...baseItem,
      id: 'item-breach',
      createdAt: new Date(now.getTime() - 3000 * 60_000).toISOString(),
    };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ items: [item], chain: baseChain, now: now.toISOString() });
    expect(res.status).toBe(200);
    const result = res.body.result as Record<string, unknown>;
    expect(result.evaluated).toBe(1);
    expect(result.escalated).toBe(1);
    const decision = (result.decisions as Array<Record<string, unknown>>)[0]
      .decision as Record<string, unknown>;
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reason).toBe('sla_breach');
  });

  it('200 — multiple items: counts aggregate correctly', async () => {
    const now = new Date();
    const freshItem = {
      ...baseItem,
      id: 'fresh',
      createdAt: new Date(now.getTime() - 60_000).toISOString(),
    };
    const breachedItem = {
      ...baseItem,
      id: 'breached',
      createdAt: new Date(now.getTime() - 3000 * 60_000).toISOString(),
    };
    const closedItem = {
      ...baseItem,
      id: 'closed',
      status: 'closed' as const,
      createdAt: new Date(now.getTime() - 3000 * 60_000).toISOString(),
    };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ items: [freshItem, breachedItem, closedItem], chain: baseChain, now: now.toISOString() });
    expect(res.status).toBe(200);
    const result = res.body.result as Record<string, unknown>;
    expect(result.evaluated).toBe(3);
    // breached item escalates; fresh and closed do not
    expect(result.escalated).toBe(1);
  });
});
