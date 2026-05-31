// Real-router supertest for POST /api/ai/feedback and GET /api/ai/feedback/summary.
// Coverage campaign — exercises the REAL aiFeedback route code so v8 counts it.
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ─── hoisted mock state ───────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ─── firebase-admin (main package: FieldValue.serverTimestamp, apps, etc.) ───
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ─── firebase-admin/firestore (getFirestore dynamic import inside route) ─────
vi.mock('firebase-admin/firestore', async () => {
  return {
    getFirestore: () => H.db!,
  };
});

// ─── verifyAuth — inject req.user from x-test-uid header ─────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@test.com`,
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
}));

// ─── limiters — pass-through in tests ────────────────────────────────────────
vi.mock('../../server/middleware/limiters.js', () => ({
  aiFeedbackLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ─── observability ────────────────────────────────────────────────────────────
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_n: string, _c: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// ─── import REAL router AFTER mocks ──────────────────────────────────────────
import aiFeedbackRouter from '../../server/routes/aiFeedback.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiFeedbackRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const asAdmin = (uid: string) => ({ 'x-test-uid': uid, 'x-test-admin': 'true' });

const validBody = {
  messageId: 'msg-001',
  vote: 'up' as const,
  response: 'La temperatura en el sitio es de 25 grados.',
  rationale: 'Respuesta útil',
  domain: 'climate',
  sessionLengthMs: 12000,
};

beforeEach(() => {
  H.db = createFakeFirestore();
});

// =============================================================================
// POST /api/ai/feedback
// =============================================================================
describe('POST /api/ai/feedback', () => {
  it('401 when no auth token provided', async () => {
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when body fails schema validation (missing vote)', async () => {
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .set(asUser('user1'))
      .send({ messageId: 'msg-001', response: 'some text' }); // missing vote
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when vote is an invalid enum value', async () => {
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .set(asUser('user1'))
      .send({ messageId: 'msg-001', vote: 'maybe', response: 'some text' });
    expect(res.status).toBe(400);
  });

  it('400 when messageId is empty string', async () => {
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .set(asUser('user1'))
      .send({ messageId: '', vote: 'up', response: 'some text' });
    expect(res.status).toBe(400);
  });

  it('200 happy path: writes doc to fakeFirestore + audit_logs row', async () => {
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .set(asUser('user1'))
      .send(validBody);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe('msg-001');
    expect(typeof body.sanitized).toBe('boolean');
    expect(body.override).toBe(false);

    // The doc should be written at ai_feedback/{tenantId}/items/{messageId}
    const docPath = 'ai_feedback/user1/items/msg-001';
    const stored = H.db!._store.get(docPath);
    expect(stored).toBeDefined();
    expect(stored!.vote).toBe('up');
    expect(stored!.status).toBe('pending_review');
    expect(stored!.tenantId).toBe('user1');

    // Audit log row must exist
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBeGreaterThanOrEqual(1);
    const auditDoc = H.db!._store.get(auditKeys[0])!;
    expect(auditDoc.action).toBe('ai_feedback.voted');
    expect(auditDoc.userId).toBe('user1');
  });

  it('200 down vote stored correctly', async () => {
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .set(asUser('user2'))
      .send({ ...validBody, messageId: 'msg-down', vote: 'down' });
    expect(res.status).toBe(200);
    const stored = H.db!._store.get('ai_feedback/user2/items/msg-down');
    expect(stored!.vote).toBe('down');
  });

  it('200 PII in response is redacted before storage', async () => {
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .set(asUser('user3'))
      .send({
        messageId: 'msg-pii',
        vote: 'up',
        response: 'Contactar a juan@example.com para info',
      });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).sanitized).toBe(true);
    const stored = H.db!._store.get('ai_feedback/user3/items/msg-pii');
    expect(stored!.response).toBe('Contactar a [EMAIL] para info');
    expect(stored!.responseHadPII).toBe(true);
  });

  it('409 on duplicate vote without ?force=true', async () => {
    // Seed an existing vote
    H.db!._seed('ai_feedback/user1/items/msg-dup', {
      vote: 'up',
      messageId: 'msg-dup',
      status: 'pending_review',
      tenantId: 'user1',
    });
    const res = await request(buildApp())
      .post('/api/ai/feedback')
      .set(asUser('user1'))
      .send({ ...validBody, messageId: 'msg-dup' });
    expect(res.status).toBe(409);
    expect((res.body as Record<string, unknown>).error).toBe('already_voted');
    expect((res.body as Record<string, unknown>).existing).toBe('up');
  });

  it('200 with ?force=true allows overriding an existing vote', async () => {
    H.db!._seed('ai_feedback/user1/items/msg-dup2', {
      vote: 'up',
      messageId: 'msg-dup2',
      status: 'pending_review',
      tenantId: 'user1',
      createdAt: 1000,
    });
    const res = await request(buildApp())
      .post('/api/ai/feedback?force=true')
      .set(asUser('user1'))
      .send({ ...validBody, messageId: 'msg-dup2', vote: 'down' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).override).toBe(true);
    const stored = H.db!._store.get('ai_feedback/user1/items/msg-dup2');
    expect(stored!.vote).toBe('down');
  });
});

// =============================================================================
// GET /api/ai/feedback/summary
// =============================================================================
describe('GET /api/ai/feedback/summary', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get('/api/ai/feedback/summary?tenantId=t1');
    expect(res.status).toBe(401);
  });

  it('403 when authenticated but not admin', async () => {
    const res = await request(buildApp())
      .get('/api/ai/feedback/summary?tenantId=t1')
      .set(asUser('worker1'));
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 returns null summary when doc does not exist in Firestore', async () => {
    const res = await request(buildApp())
      .get('/api/ai/feedback/summary?tenantId=t1&week=2026-W22')
      .set(asAdmin('admin1'));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.summary).toBeNull();
    expect(body.week).toBe('2026-W22');
    expect(body.tenantId).toBe('t1');
  });

  it('200 returns summary doc when it exists', async () => {
    const summaryData = {
      week: '2026-W22',
      tenantId: 't1',
      total: 10,
      upPct: 0.7,
      downPct: 0.3,
      topRationales: [],
      byDomain: {},
      avgSessionLengthMs: 5000,
    };
    H.db!._seed('ai_feedback_summaries/2026-W22/tenants/t1', summaryData);

    const res = await request(buildApp())
      .get('/api/ai/feedback/summary?tenantId=t1&week=2026-W22')
      .set(asAdmin('admin1'));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect((body.summary as Record<string, unknown>).total).toBe(10);
    expect(body.tenantId).toBe('t1');
  });

  it('200 uses req.user.uid when tenantId query param is absent', async () => {
    const res = await request(buildApp())
      .get('/api/ai/feedback/summary')
      .set(asAdmin('admin1'));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.tenantId).toBe('admin1');
  });
});
