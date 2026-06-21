// Real-router supertest for the Privacy Shield HTTP surface
// (src/server/routes/privacyShield.ts). The sibling unit test only exercises
// the pure engine in piiClassifier.ts; this mounts the REAL router and drives
// the three stateless endpoints through their full middleware chain.
//
// What runs UNMOCKED here (intentional — the point is real coverage):
//   - validate(Zod) — so 400 paths exercise the actual schemas (enum bounds,
//     string length, array caps).
//   - guard() / assertProjectMember — driven against the in-memory fakeFirestore
//     so 403 (non-member / missing project) and 200 (seeded member) are REAL.
//   - the piiClassifier engine (classifyField / detectGaps / reapExpiredRecords)
//     — 200 assertions check the engine's real output shape, not a re-impl.
//
// Mocked = infra only: firebase-admin (fakeFirestore), verifyAuth, logger,
// captureRouteError.
//
// Privacy/security focus (life-safety + Ley 19.628 / GDPR Art. 9): every route
// takes a projectId and MUST gate on membership BEFORE returning data — these
// tests prove a non-member gets 403 and never sees a classification report.

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
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import psRouter from '../../server/routes/privacyShield.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  // Raise the body cap so the over-cap array tests reach the Zod `.max()`
  // guard (express defaults to 100kb → 413 before validation otherwise).
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/privacy', psRouter);
  return app;
}

const MEMBER = 'worker1';
const NON_MEMBER = 'stranger9';

beforeEach(() => {
  H.db = createFakeFirestore();
  // worker1 is a member of p1; stranger9 is not.
  H.db._seed('projects/p1', { members: [MEMBER], createdBy: 'owner1' });
});

const post = (path: string, uid: string | null, body: unknown) => {
  const req = request(buildApp()).post(path);
  if (uid) req.set('x-test-uid', uid);
  return req.send(body as object);
};

// ────────────────────────────────────────────────────────────────────────
// 1. classify-field
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/privacy-shield/classify-field', () => {
  const URL = '/api/privacy/p1/privacy-shield/classify-field';

  it('401 without a token', async () => {
    const res = await post(URL, null, {
      field: { fieldPath: 'worker.dni', category: 'identity', encrypted: true },
    });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a project member (no report leaks)', async () => {
    const res = await post(URL, NON_MEMBER, {
      field: { fieldPath: 'worker.healthRecord', category: 'health', encrypted: false },
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(res.body.report).toBeUndefined();
  });

  it('5xx (NOT a hang) when the membership check hits a Firestore outage', async () => {
    // assertProjectMember reads projects/{projectId}; force that read to throw
    // (infra outage). guard() re-throws non-ProjectMembershipError, so in
    // Express 4 the reject would be an unhandled promise rejection and the
    // request would HANG with no response. The fix moves guard() inside the
    // route try/catch → the reject maps to a clean 500. If this test ever
    // times out instead of returning, the pre-try guard regression is back.
    H.db!._failReads('projects/p1');
    const res = await post(URL, MEMBER, {
      field: { fieldPath: 'worker.dni', category: 'identity', encrypted: true },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    // Clean body — no internals leaked (CLAUDE.md #8): the Firestore path /
    // stack / 'forced read failure' message must NOT reach the client.
    expect(res.body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res.body)).not.toContain('forced read failure');
    expect(JSON.stringify(res.body)).not.toContain('projects/p1');
    expect(res.body.report).toBeUndefined();
  });

  it('403 when the project does not exist (membership read finds nothing)', async () => {
    const res = await post('/api/privacy/ghost/privacy-shield/classify-field', MEMBER, {
      field: { fieldPath: 'x', category: 'identity', encrypted: true },
    });
    expect(res.status).toBe(403);
  });

  it('400 on an unknown PII category (real Zod enum guard)', async () => {
    const res = await post(URL, MEMBER, {
      field: { fieldPath: 'x', category: 'astrological_sign', encrypted: true },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when the field object is missing entirely', async () => {
    const res = await post(URL, MEMBER, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 classifies a special-category health field with the engine output', async () => {
    const res = await post(URL, MEMBER, {
      field: { fieldPath: 'worker.healthRecord', category: 'health', encrypted: false },
    });
    expect(res.status).toBe(200);
    // Assert the REAL engine contract (GDPR Art. 9 → special_category).
    expect(res.body.report).toEqual({
      fieldPath: 'worker.healthRecord',
      category: 'health',
      sensitivity: 'special_category',
      retentionDays: 365 * 10,
      requiresExplicitConsent: true,
      mustEncryptAtRest: true,
      mustMaskInLogs: true,
    });
  });

  it('200 classifies a low-sensitivity observation (no masking, short retention)', async () => {
    const res = await post(URL, MEMBER, {
      field: { fieldPath: 'note.behavior', category: 'observation', encrypted: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({
      sensitivity: 'low',
      retentionDays: 365,
      requiresExplicitConsent: false,
      mustEncryptAtRest: false,
      mustMaskInLogs: false, // only observation escapes log-masking
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. detect-gaps
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/privacy-shield/detect-gaps', () => {
  const URL = '/api/privacy/p1/privacy-shield/detect-gaps';

  it('401 without a token', async () => {
    const res = await post(URL, null, { fields: [] });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    const res = await post(URL, NON_MEMBER, { fields: [] });
    expect(res.status).toBe(403);
    expect(res.body.gaps).toBeUndefined();
  });

  it('400 when fields is not an array', async () => {
    const res = await post(URL, MEMBER, { fields: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when fields exceeds the 2000 cap', async () => {
    const fields = Array.from({ length: 2001 }, (_, i) => ({
      fieldPath: `f${i}`,
      category: 'contact',
      encrypted: true,
    }));
    const res = await post(URL, MEMBER, { fields });
    expect(res.status).toBe(400);
  });

  it('200 flags the real compliance gaps (unencrypted special-cat + missing role gate)', async () => {
    const res = await post(URL, MEMBER, {
      fields: [
        // unencrypted health: triggers BOTH unencrypted_special_category AND
        // missing_role_restriction_on_health.
        { fieldPath: 'w.health', category: 'health', encrypted: false },
        // unencrypted financial → unencrypted_high.
        { fieldPath: 'w.bank', category: 'financial', encrypted: false },
        // encrypted judicial with no roles → missing_role_restriction_on_judicial only.
        { fieldPath: 'w.record', category: 'judicial', encrypted: true, authorizedRoles: [] },
        // fully compliant identity: no gap.
        { fieldPath: 'w.name', category: 'identity', encrypted: true },
      ],
    });
    expect(res.status).toBe(200);
    const gapTypes = (res.body.gaps as Array<{ fieldPath: string; gap: string }>).map(
      (g) => `${g.fieldPath}:${g.gap}`,
    );
    expect(gapTypes).toContain('w.health:unencrypted_special_category');
    expect(gapTypes).toContain('w.health:missing_role_restriction_on_health');
    expect(gapTypes).toContain('w.bank:unencrypted_high');
    expect(gapTypes).toContain('w.record:missing_role_restriction_on_judicial');
    // The compliant identity field must produce NO gap.
    expect(gapTypes.some((g) => g.startsWith('w.name:'))).toBe(false);
    // Each gap carries a remediation string.
    for (const g of res.body.gaps as Array<{ remediation: string }>) {
      expect(typeof g.remediation).toBe('string');
      expect(g.remediation.length).toBeGreaterThan(0);
    }
  });

  it('200 with no gaps when everything is encrypted and role-gated', async () => {
    const res = await post(URL, MEMBER, {
      fields: [
        { fieldPath: 'w.health', category: 'health', encrypted: true, authorizedRoles: ['medical_staff'] },
        { fieldPath: 'w.name', category: 'identity', encrypted: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.gaps).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. reap-expired
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/privacy-shield/reap-expired', () => {
  const URL = '/api/privacy/p1/privacy-shield/reap-expired';

  it('401 without a token', async () => {
    const res = await post(URL, null, { records: [] });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    const res = await post(URL, NON_MEMBER, { records: [] });
    expect(res.status).toBe(403);
    expect(res.body.result).toBeUndefined();
  });

  it('400 when records exceeds the 10000 cap', async () => {
    const records = Array.from({ length: 10_001 }, (_, i) => ({
      id: `r${i}`,
      category: 'contact',
      createdAt: '2000-01-01T00:00:00.000Z',
    }));
    const res = await post(URL, MEMBER, { records });
    expect(res.status).toBe(400);
  });

  it('400 when a record is missing createdAt', async () => {
    const res = await post(URL, MEMBER, {
      records: [{ id: 'r1', category: 'contact' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 reaps only records past their category retention window', async () => {
    const now = '2026-06-20T00:00:00.000Z';
    const nowMs = Date.parse(now);
    const day = 86_400_000;
    const res = await post(URL, MEMBER, {
      nowIso: now,
      records: [
        // observation: 365-day window. 400 days old → reap.
        { id: 'obs-old', category: 'observation', createdAt: new Date(nowMs - 400 * day).toISOString() },
        // observation just inside the window (300 days) → keep.
        { id: 'obs-fresh', category: 'observation', createdAt: new Date(nowMs - 300 * day).toISOString() },
        // health: 10-year window. 4000 days old (~11y) → reap.
        { id: 'health-old', category: 'health', createdAt: new Date(nowMs - 4000 * day).toISOString() },
        // health 1 year old → keep (well inside 10y).
        { id: 'health-fresh', category: 'health', createdAt: new Date(nowMs - 365 * day).toISOString() },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.result.toReap.sort()).toEqual(['health-old', 'obs-old']);
    expect(res.body.result.countsByCategory.observation).toBe(1);
    expect(res.body.result.countsByCategory.health).toBe(1);
    expect(res.body.result.countsByCategory.identity).toBe(0);
  });

  it('200 with an empty reap set when nothing is expired', async () => {
    const res = await post(URL, MEMBER, {
      nowIso: '2026-06-20T00:00:00.000Z',
      records: [{ id: 'r1', category: 'identity', createdAt: '2026-06-19T00:00:00.000Z' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.result.toReap).toEqual([]);
  });
});
