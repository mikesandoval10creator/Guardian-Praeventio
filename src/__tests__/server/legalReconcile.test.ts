// Real-router supertest for src/server/routes/legalReconcile.ts
//
// Mounts the ACTUAL reconcile router through fakeFirestore so the real handler
// runs: verifyAuth gate, the assertProjectMember guard, the project-doc read,
// the buildProjectSeeds + reconcileObligationSeeds computation, the idempotent
// subcollection upsert, and the awaited audit_logs row.
//
// Compliance assertions:
//   • NEVER pushes to an organism — the response surface is purely the created
//     internal obligations (no external API call exists in the handler).
//   • Dotación obligations only materialise for CL projects.
//   • Idempotent: a no-op reconcile creates nothing and writes no audit row.

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
      email: req.header('x-test-email') || null,
      role: req.header('x-test-role') || undefined,
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// assertProjectMember + auditServerEvent run for real against H.db (the
// firebase-admin mock), exercising the true membership gate and audit write.

import legalReconcileRouter from '../../server/routes/legalReconcile.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PREFIX = '/api/legal';
const PROJECT_ID = 'proj-recon-1';
const CALLER_UID = 'uid-sup-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, legalReconcileRouter);
  return app;
}

const url = (projectId = PROJECT_ID) => `${PREFIX}/${projectId}/reconcile-obligations`;

/** Seed a CL project doc so assertProjectMember passes + headcount drives seeds. */
function seedProject(overrides: Record<string, unknown> = {}, projectId = PROJECT_ID) {
  H.db!._seed(`projects/${projectId}`, {
    members: [CALLER_UID],
    createdBy: CALLER_UID,
    workersCount: 30,
    country: 'CL',
    metadata: { sectorId: 'GP-CONS-RES', codigoActividadSii: 410010 },
    ...overrides,
  });
}

/** Read the obligation ids currently stored under the project subcollection. */
function storedObligationIds(projectId = PROJECT_ID): string[] {
  const prefix = `projects/${projectId}/legal_obligations/`;
  const ids: string[] = [];
  const store = H.db?._store;
  if (store) {
    for (const key of store.keys()) {
      if (key.startsWith(prefix) && key.split('/').length === 4) {
        ids.push(key.slice(prefix.length));
      }
    }
  }
  return ids;
}

function auditRows(): Array<Record<string, unknown>> {
  const store = H.db?._store;
  const rows: Array<Record<string, unknown>> = [];
  if (store) {
    for (const [key, value] of store.entries()) {
      if (key.startsWith('audit_logs/')) rows.push(value as Record<string, unknown>);
    }
  }
  return rows;
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('POST /api/legal/:projectId/reconcile-obligations', () => {
  it('401 — no token', async () => {
    const res = await request(buildApp()).post(url());
    expect(res.status).toBe(401);
  });

  it('403 — caller not a project member', async () => {
    // project doc not seeded → assertProjectMember throws ProjectMembershipError
    const res = await request(buildApp()).post(url()).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 — materialises the CPHS obligations a 30-worker roster now requires', async () => {
    seedProject(); // workersCount 30 ≥ 25 → CPHS required, none seeded yet
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .set('x-test-email', 'sup@example.cl');

    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBeGreaterThan(0);
    const labels = (res.body.created as Array<{ label: string }>).map((c) => c.label).join(' | ');
    expect(labels).toMatch(/Comité Paritario/i);
    // Persisted into the SAME subcollection onboarding + the reminder cron use.
    expect(storedObligationIds().some((id) => /cphs/i.test(id))).toBe(true);
    // Audit invariant: one awaited row, actor identity from the token.
    const audits = auditRows();
    expect(audits.some((a) => a.action === 'legal.obligationsReconciled')).toBe(true);
    const reconAudit = audits.find((a) => a.action === 'legal.obligationsReconciled')!;
    expect(reconAudit.userId).toBe(CALLER_UID);
    // Compliance: no external-organism push surface in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/suseso|minsal|mutual|push/i);
  });

  it('200 — idempotent: a second reconcile creates nothing and writes no audit row', async () => {
    seedProject();
    await request(buildApp()).post(url()).set('x-test-uid', CALLER_UID); // first: creates
    const auditsAfterFirst = auditRows().length;

    const res = await request(buildApp()).post(url()).set('x-test-uid', CALLER_UID); // second: no-op
    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(0);
    expect(res.body.alreadyPresent).toBeGreaterThan(0);
    // No state change → no new audit row.
    expect(auditRows().length).toBe(auditsAfterFirst);
  });

  it('200 — non-CL project: dotación obligations are NOT materialised', async () => {
    seedProject({ country: 'AR', workersCount: 200 });
    const res = await request(buildApp()).post(url()).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(0);
    expect(storedObligationIds()).toEqual([]);
  });

  it('200 — sub-25 roster materialises the delegado-SST obligation, not a CPHS', async () => {
    seedProject({ workersCount: 10 });
    const res = await request(buildApp()).post(url()).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const labels = (res.body.created as Array<{ label: string }>).map((c) => c.label).join(' | ');
    expect(labels).toMatch(/delegado/i);
    expect(labels).not.toMatch(/Comité Paritario/i);
  });
});
