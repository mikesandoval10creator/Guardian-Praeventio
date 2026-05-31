// Real-router supertest for src/server/routes/deduplication.ts
// (Plan v3 Fase 1 — server lever, coverage campaign wave).
//
// The route is mounted at /api/sprint-k in server.ts. Both endpoints are
// POST /:projectId/deduplication/<sub-path> behind verifyAuth +
// validate(zodSchema) + guard(assertProjectMember). We seed
// `projects/<id>` in fakeFirestore so assertProjectMember passes, then drive
// every status code the route can emit: 401 (no token), 400 (schema fail),
// 403 (project guard), 200 (happy-path dedup logic).
//
// Tech-debt fix exercised here:
//   Previously `duplicateCandidateSchema = z.unknown()` let `candidate:
//   undefined` pass validate() and crash the handler at runtime (500 instead
//   of 400). The schema was replaced with a structured z.object(); this suite
//   confirms the fix with a dedicated missing-candidate test.

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

import deduplicationRouter from '../../server/routes/deduplication.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', deduplicationRouter);
  return app;
}

const PROJECT_ID = 'p-dedup-test';
const CALLER_UID = 'uid-dedup-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Dedup Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// ---------------------------------------------------------------------------
// Reusable fixtures
// ---------------------------------------------------------------------------

/** A minimal valid DedupRecord */
const rec = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: 'worker' as const,
  name,
  createdAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

/** A minimal valid DuplicateCandidate (output of detectDuplicates). */
const candidate = (primaryId: string, duplicateIds: string[]) => ({
  primaryId,
  duplicateIds,
  confidence: 0.85,
  reasons: ['email_exact'],
  recommendedAction: 'suggest_merge' as const,
});

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/deduplication/detect
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/deduplication/detect', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/deduplication/detect`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ records: [] });
    expect(res.status).toBe(401);
  });

  it('400 when records field is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when records is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ records: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a record item is missing required id', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [{ kind: 'worker', name: 'Alice', createdAt: '2025-01-01T00:00:00.000Z' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a record item has invalid kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [{ id: 'r1', kind: 'invalid_kind', name: 'Alice', createdAt: '2025-01-01T00:00:00.000Z' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ records: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/deduplication/detect`)
      .set('x-test-uid', CALLER_UID)
      .send({ records: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 empty records → no candidates', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ records: [] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
    expect(res.body.candidates).toHaveLength(0);
  });

  it('200 distinct records → no candidates (no matches)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [
          rec('r1', 'Alice Smith', { email: 'alice@example.com' }),
          rec('r2', 'Bob Jones', { email: 'bob@example.com' }),
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(0);
  });

  it('200 same email → candidate detected with email_exact reason', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [
          rec('r1', 'Alice Smith', { email: 'alice@acme.com', createdAt: '2025-01-01T00:00:00.000Z' }),
          rec('r2', 'Alice Smith', { email: 'alice@acme.com', createdAt: '2025-06-01T00:00:00.000Z' }),
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    const c = res.body.candidates[0] as { primaryId: string; duplicateIds: string[]; reasons: string[]; recommendedAction: string };
    expect(c.primaryId).toBe('r1');       // older record is primary
    expect(c.duplicateIds).toContain('r2');
    expect(c.reasons).toContain('email_exact');
  });

  it('200 same canonical key → confidence=1 auto_merge recommended', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [
          rec('r1', 'Worker One', { canonicalKey: '12345678-9', createdAt: '2025-01-01T00:00:00.000Z' }),
          rec('r2', 'Trabajador Uno', { canonicalKey: '12345678-9', createdAt: '2025-03-01T00:00:00.000Z' }),
        ],
      });
    expect(res.status).toBe(200);
    const c = res.body.candidates[0] as { confidence: number; recommendedAction: string };
    expect(c.confidence).toBe(1);
    expect(c.recommendedAction).toBe('auto_merge');
  });

  it('200 fuzzy name match → candidate detected (name_fuzzy reason)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [
          rec('r1', 'Carlos Perez', { createdAt: '2025-01-01T00:00:00.000Z' }),
          rec('r2', 'Carlos Pérez', { createdAt: '2025-06-01T00:00:00.000Z' }),  // accent diff → levenshtein <=2 after normalize
        ],
      });
    expect(res.status).toBe(200);
    // Fuzzy match: normalized 'carlos perez' === 'carlos perez' (accents stripped)
    // so this becomes name_exact_case_insensitive
    const c = res.body.candidates[0] as { reasons: string[] };
    expect(c).toBeDefined();
    expect(c.reasons.some((r: string) => r.startsWith('name_'))).toBe(true);
  });

  it('200 different kinds → no match (worker vs equipment)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [
          { id: 'r1', kind: 'worker', name: 'Grúa X200', createdAt: '2025-01-01T00:00:00.000Z' },
          { id: 'r2', kind: 'equipment', name: 'Grúa X200', createdAt: '2025-01-01T00:00:00.000Z' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(0);
  });

  it('200 optional threshold params accepted without error', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        records: [],
        reviewThreshold: 0.6,
        suggestThreshold: 0.8,
        autoMergeThreshold: 0.97,
      });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
  });

  it('400 when threshold is out of range (>1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ records: [], reviewThreshold: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/deduplication/build-merge-plan
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/deduplication/build-merge-plan', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/deduplication/build-merge-plan`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ candidate: candidate('r1', ['r2']), records: [] });
    expect(res.status).toBe(401);
  });

  // ── Tech-debt bug confirmation: z.unknown() → z.object() fix ──────────
  it('400 when candidate field is missing (was 500 before schema fix)', async () => {
    // Before the fix, z.unknown() accepted undefined and the handler did
    // body.candidate.primaryId → TypeError → 500 internal_error.
    // After the fix, z.object({...}) rejects undefined → 400 invalid_payload.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ records: [] }); // no candidate field
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when candidate is missing required primaryId', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        candidate: { duplicateIds: ['r2'], confidence: 0.9, reasons: [], recommendedAction: 'suggest_merge' },
        records: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when candidate.recommendedAction is not a valid enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        candidate: { primaryId: 'r1', duplicateIds: [], confidence: 0.9, reasons: [], recommendedAction: 'delete_all' },
        records: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when records field is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ candidate: candidate('r1', ['r2']) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ candidate: candidate('r1', ['r2']), records: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/ghost-project/deduplication/build-merge-plan`)
      .set('x-test-uid', CALLER_UID)
      .send({ candidate: candidate('r1', ['r2']), records: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — plan reflects primary + duplicateIds', async () => {
    const records = [
      rec('r1', 'Alice Smith', { email: 'alice@acme.com', createdAt: '2025-01-01T00:00:00.000Z' }),
      rec('r2', 'Alice Smith', { email: 'alice@acme.com', createdAt: '2025-06-01T00:00:00.000Z' }),
    ];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ candidate: candidate('r1', ['r2']), records });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: Record<string, unknown> };
    expect(plan.primaryId).toBe('r1');
    expect(plan.duplicateIds).toContain('r2');
    expect(Array.isArray(plan.fieldsToPromote)).toBe(true);
    expect(typeof plan.edgeReassignmentCount).toBe('number');
  });

  it('200 promotes email from duplicate when primary lacks it', async () => {
    const records = [
      rec('r1', 'Carlos Ruiz', { createdAt: '2025-01-01T00:00:00.000Z' }), // no email
      rec('r2', 'Carlos Ruiz', { email: 'carlos@example.com', createdAt: '2025-06-01T00:00:00.000Z' }),
    ];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ candidate: candidate('r1', ['r2']), records });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: { fieldsToPromote: string[] } };
    expect(plan.fieldsToPromote).toContain('email');
  });

  it('200 does NOT promote email when primary already has it', async () => {
    const records = [
      rec('r1', 'Carlos Ruiz', { email: 'carlos@example.com', createdAt: '2025-01-01T00:00:00.000Z' }),
      rec('r2', 'Carlos Ruiz', { email: 'carlos@example.com', createdAt: '2025-06-01T00:00:00.000Z' }),
    ];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ candidate: candidate('r1', ['r2']), records });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: { fieldsToPromote: string[] } };
    expect(plan.fieldsToPromote).not.toContain('email');
  });

  it('200 edgeReassignmentCount sums edges on duplicates', async () => {
    const records = [
      rec('r1', 'Ana López', { createdAt: '2025-01-01T00:00:00.000Z' }),
      rec('r2', 'Ana López', { createdAt: '2025-06-01T00:00:00.000Z' }),
      rec('r3', 'Ana López', { createdAt: '2025-09-01T00:00:00.000Z' }),
    ];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        candidate: candidate('r1', ['r2', 'r3']),
        records,
        edgesOnDuplicates: { r2: 5, r3: 3 },
      });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: { edgeReassignmentCount: number } };
    expect(plan.edgeReassignmentCount).toBe(8);
  });

  it('200 candidate not in records list → plan still returns with empty fieldsToPromote', async () => {
    // primary not in records[] → no promotion possible, but no crash
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ candidate: candidate('ghost-id', ['ghost-dup']), records: [] });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: { fieldsToPromote: string[]; edgeReassignmentCount: number } };
    expect(plan.fieldsToPromote).toHaveLength(0);
    expect(plan.edgeReassignmentCount).toBe(0);
  });
});
