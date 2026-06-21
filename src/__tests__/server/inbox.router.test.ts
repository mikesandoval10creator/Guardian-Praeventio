// Real-router supertest for the Inbox del Prevencionista endpoint
// (Fase F.8 — src/server/routes/inbox.ts). Mounts the REAL router so v8
// coverage counts the route code, and runs the REAL inbox aggregator engine
// (dynamically imported inside the handler, left UNMOCKED) + the REAL
// CorrectiveActionsAdapter / SIFAdapter + the REAL assertProjectMember guard.
//
// This endpoint is read-only (no state change → no audit_logs), so the
// assertions target the engine's output shape: aggregation, urgency ordering,
// the per-caller responsibleUid filter, and the honest-empty contract. It also
// pins the auth (401) / membership (403) / tenant (404) guards and the
// graceful read-degradation path (per-feed `.catch(() => [])`).

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

import inboxRouter from '../../server/routes/inbox.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', inboxRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const TENANT_ID = 'tenant-abc';
const PROJECT_ID = 'proj-alpha';
const MEMBER_UID = 'prevencionista1';
const OUTSIDER_UID = 'intruder9';

const CA_PATH = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/corrective_actions`;
const SIF_PATH = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/sif_precursors`;

/** Seed the project doc so assertProjectMember + resolveTenantId both pass. */
function seedProject(
  db: ReturnType<typeof createFakeFirestore>,
  extra: Record<string, unknown> = {},
) {
  db._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
    ...extra,
  });
}

type InboxItem = {
  id: string;
  kind: string;
  urgency: string;
  assignedToUid: string;
  priorityScore: number;
  sourceRef: { collection: string; docId: string };
};
type InboxResponse = {
  items: InboxItem[];
  summary: {
    total: number;
    byUrgency: Record<string, number>;
    byKind: Record<string, number>;
    overdueCount: number;
  };
};

beforeEach(() => {
  H.db = createFakeFirestore();
});

// =============================================================================
// GET /:projectId/inbox — guards
// =============================================================================

describe('GET /api/sprint-k/:projectId/inbox — guards', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(`/api/sprint-k/${PROJECT_ID}/inbox`);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    seedProject(H.db!); // members = [MEMBER_UID]
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/inbox`)
      .set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('403 when the project does not exist (membership cannot be proven)', async () => {
    // No project doc seeded at all → assertProjectMember throws 403 (IDOR guard).
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/inbox`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(403);
  });

  it('404 when the project exists but has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID] }); // no tenantId
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/inbox`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_not_found');
  });
});

// =============================================================================
// GET /:projectId/inbox — happy path (real engine output)
// =============================================================================

describe('GET /api/sprint-k/:projectId/inbox — aggregation', () => {
  it('200 with honest-empty inbox when nothing is pending', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/inbox`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as InboxResponse;
    expect(body.items).toEqual([]);
    expect(body.summary.total).toBe(0);
    expect(body.summary.overdueCount).toBe(0);
    expect(body.summary.byUrgency).toEqual({ urgent: 0, high: 0, medium: 0, low: 0 });
  });

  it('200 aggregates unresolved corrective actions (open/in_progress/reopened) + SIF precursors, SIF urgent-first', async () => {
    seedProject(H.db!);
    // Corrective actions in each unresolved status the route fetches.
    H.db!._seed(`${CA_PATH}/ca-open`, {
      id: 'ca-open',
      description: 'Instalar baranda nivel 3',
      status: 'open',
      isSystemic: false,
    });
    H.db!._seed(`${CA_PATH}/ca-prog`, {
      id: 'ca-prog',
      description: 'Capacitar cuadrilla en bloqueo',
      status: 'in_progress',
      isSystemic: false,
    });
    H.db!._seed(`${CA_PATH}/ca-reop`, {
      id: 'ca-reop',
      description: 'Revisar arnés defectuoso reabierto',
      status: 'reopened',
      isSystemic: false,
    });
    // A closed action must NOT appear (route never fetches 'closed'/'verified').
    H.db!._seed(`${CA_PATH}/ca-closed`, {
      id: 'ca-closed',
      description: 'Acción ya cerrada',
      status: 'closed',
      isSystemic: false,
    });
    // SIF precursor pending executive review (executiveReviewRequired + no reviewedAt).
    H.db!._seed(`${SIF_PATH}/sif-1`, {
      id: 'sif-1',
      kind: 'altura_sin_lesion',
      rationale: ['Caída evitada desde 4m (umbral SIF 1.8m)'],
      executiveReviewRequired: true,
      occurredAt: '2026-06-01T10:00:00.000Z',
    });

    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/inbox`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as InboxResponse;

    // 3 unresolved corrective actions + 1 SIF; closed excluded.
    expect(body.items).toHaveLength(4);
    const ids = body.items.map((i) => i.id).sort();
    expect(ids).toEqual(['ca_ca-open', 'ca_ca-prog', 'ca_ca-reop', 'sif_sif-1']);

    // Real engine: SIF precursor is 'urgent' and sorts first.
    expect(body.items[0].id).toBe('sif_sif-1');
    expect(body.items[0].kind).toBe('sif_precursor_pending');
    expect(body.items[0].urgency).toBe('urgent');
    expect(body.items[0].priorityScore).toBe(100);
    expect(body.items[0].sourceRef).toEqual({
      collection: 'sif_precursors',
      docId: 'sif-1',
    });

    // Corrective actions are assigned to the calling prevencionista.
    const ca = body.items.find((i) => i.id === 'ca_ca-open')!;
    expect(ca.kind).toBe('corrective_action_open');
    expect(ca.assignedToUid).toBe(MEMBER_UID);

    // Summary reflects the real engine output.
    expect(body.summary.total).toBe(4);
    expect(body.summary.byUrgency.urgent).toBe(1); // the SIF
    expect(body.summary.byKind.corrective_action_open).toBe(3);
    expect(body.summary.byKind.sif_precursor_pending).toBe(1);
  });

  it('200 filters corrective actions by responsibleUid (own queue), keeping legacy un-owned records', async () => {
    seedProject(H.db!);
    // Owned by the caller → kept.
    H.db!._seed(`${CA_PATH}/ca-mine`, {
      id: 'ca-mine',
      description: 'Mi acción asignada',
      status: 'open',
      isSystemic: false,
      responsibleUid: MEMBER_UID,
    });
    // Owned by someone else → filtered out.
    H.db!._seed(`${CA_PATH}/ca-theirs`, {
      id: 'ca-theirs',
      description: 'Acción de otro prevencionista',
      status: 'open',
      isSystemic: false,
      responsibleUid: 'other-prev',
    });
    // Legacy record with no responsibleUid → included (fallback include-all).
    H.db!._seed(`${CA_PATH}/ca-legacy`, {
      id: 'ca-legacy',
      description: 'Acción legacy sin dueño',
      status: 'open',
      isSystemic: false,
    });

    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/inbox`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as InboxResponse;
    const ids = body.items.map((i) => i.id).sort();
    expect(ids).toEqual(['ca_ca-legacy', 'ca_ca-mine']);
    expect(ids).not.toContain('ca_ca-theirs');
  });

  it('200 degrades gracefully (empty inbox) when the corrective/SIF reads fail', async () => {
    seedProject(H.db!);
    H.db!._seed(`${CA_PATH}/ca-open`, {
      id: 'ca-open',
      description: 'no debería aparecer si la lectura falla',
      status: 'open',
      isSystemic: false,
    });
    // Force every subcollection read under the tenant to reject. The project
    // doc read for the guard already happened; per-feed `.catch(() => [])`
    // should turn the failures into an honest-empty inbox, not a 500.
    H.db!._failReads(`tenants/${TENANT_ID}`);

    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/inbox`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as InboxResponse;
    expect(body.items).toEqual([]);
    expect(body.summary.total).toBe(0);
  });
});
