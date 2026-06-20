// Praeventio Guard — Real-router supertest coverage for eppFlow route.
//
// Plan v3 Fase 1: raises line coverage toward 90% without touching production
// code. Mounts the ACTUAL router and exercises HTTP contracts, auth gates,
// validation 400s, project-membership 403s, in-memory pending-order lifecycle,
// and the core business branches (inspection with/without failed items,
// sign-order identity check, order-pdf 400/404/409/200).
//
// The `writeNodes` service is mocked so the test stays fast (no crypto.subtle
// usage and no network). `onEppInspectionCompleted`, `persistSignedNode`, and
// `renderPurchaseOrderPdf` are also mocked — each mock returns a realistic
// shape that exercises all in-route branching.
//
// Mount prefix: /api/sprint-k (from src/hooks/useEppFlow.ts line 74).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ────────────────────────────────────────────────────────────────────────
// Hoisted holder — reassigned in beforeEach so the db is fresh every test.
// ────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import('../helpers/fakeFirestore').createFakeFirestore
  > | null,
}));

// ────────────────────────────────────────────────────────────────────────
// firebase-admin mock (no auth.getUser needed — route uses assertProjectMember
// which only reads Firestore, not custom claims via admin.auth()).
// ────────────────────────────────────────────────────────────────────────

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ────────────────────────────────────────────────────────────────────────
// verifyAuth — read x-test-uid header; 401 if absent.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Token tenant defaults to 'tenant-a' (== TENANT_ID) so existing happy-path
    // tests stay green after the cross-tenant guard landed; the sentinel 'none'
    // simulates a token WITHOUT a tenant claim (→ callerTenantOr403 403s).
    const rawTenant = req.header('x-test-tenant');
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      tenantId: rawTenant === 'none' ? undefined : (rawTenant ?? 'tenant-a'),
    };
    next();
  },
}));

// ────────────────────────────────────────────────────────────────────────
// validate middleware — use the REAL module (inline Zod safeParse in route
// — the validate() factory is a thin middleware; exercising it gives real 400s).
// ────────────────────────────────────────────────────────────────────────

// No mock for validate.js — we let the real middleware run.

// ────────────────────────────────────────────────────────────────────────
// logger + captureRouteError + observability
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ────────────────────────────────────────────────────────────────────────
// writeNodes — the route imports this directly; mock at its specifier.
// Returns a realistic WriteResult with stable ids so the route stores the
// suggestedNodeId in pendingOrders correctly.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../services/zettelkasten/persistence/writeNode.js', () => ({
  writeNodes: vi.fn(async (nodes: unknown[]) => {
    // Return one stable id per node so the route can index nodeIds[ocNodeIdx].
    const ids = nodes.map((_, i) => `fake-node-id-${i}`);
    return { ok: true, ids };
  }),
}));

// ────────────────────────────────────────────────────────────────────────
// eppInventoryPurchaseFlow service — mock the three exported functions the
// route calls: onEppInspectionCompleted, persistSignedNode, renderPurchaseOrderPdf.
// persistPdfNode is also imported but only called when signedNodeId is set;
// we mock it too for safety.
// ────────────────────────────────────────────────────────────────────────

// Swappable results so individual tests can override.
const flowMock = {
  inspectionResult: null as null | {
    ok: boolean;
    nodes: Array<{ metadata: Record<string, unknown> }>;
    nodeIds: string[];
    edges: unknown[];
    suggestedOrder: null | {
      lines: Array<{ kind: string; quantity: number; estimatedUnitCostClp: number; supplierId: string; urgency: string }>;
      totalClp: number;
      deliveryWeekHint: number;
      notes: string[];
    };
    notes: string[];
  },
  signedResult: null as null | { ok: boolean; nodeId: string; edge: null | { id: string } },
};

vi.mock('../../services/zettelkasten/flows/eppInventoryPurchaseFlow.js', () => ({
  onEppInspectionCompleted: vi.fn(async () => flowMock.inspectionResult),
  persistSignedNode: vi.fn(async () => flowMock.signedResult),
  persistPdfNode: vi.fn(async () => ({ ok: true, nodeId: 'pdf-node-1', edge: null })),
  renderPurchaseOrderPdf: vi.fn(async () => Buffer.from('%PDF-1.4 fake')),
}));

// ────────────────────────────────────────────────────────────────────────
// purchaseOrderSuggester — imported and called inside the resolveInventory /
// suggestOrder callbacks the route passes to onEppInspectionCompleted.
// Since onEppInspectionCompleted itself is mocked, this import is never
// actually called by the route. Mock it for completeness and to prevent any
// module-resolution failure.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../services/financialAnalytics/purchaseOrderSuggester.js', () => ({
  suggestPurchaseOrder: vi.fn(() => ({ lines: [], totalClp: 0, deliveryWeekHint: 1, notes: [] })),
}));

// ────────────────────────────────────────────────────────────────────────
// assertProjectMember — via the projectMembership module. We keep the REAL
// module but seed `projects/{projectId}` in fakeFirestore so the route's
// guard() call reads from our in-memory store. That way we exercise the
// real guard() code path (including the instanceof check).
// The real assertProjectMember calls admin.firestore() which returns H.db.
// ────────────────────────────────────────────────────────────────────────

// No mock for projectMembership — the real code runs against the fake db.

// ────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────────────────────────────────

import eppFlowRouter, {
  __resetPendingOrdersForTests,
} from '../../server/routes/eppFlow.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ────────────────────────────────────────────────────────────────────────
// App factory
// ────────────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', eppFlowRouter);
  return app;
}

// ────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-epp-1';
const MEMBER_UID = 'uid-member-1';
const OTHER_UID = 'uid-outsider-9';
const TENANT_ID = 'tenant-a';

/** Minimal valid inspection POST body. */
const baseInspectionBody = {
  inspection: {
    inspectionId: 'insp-001',
    workerUid: 'w-001',
    items: [
      {
        itemId: 'item-a',
        kind: 'casco',
        status: 'ok',
        reportedByUid: MEMBER_UID,
      },
    ],
    inspectedAt: '2026-05-30T10:00:00.000Z',
  },
  inventoryByKind: {},
  supplierCatalog: [],
  leadTimeDaysBySupplier: {},
  tenantId: TENANT_ID,
};

/** Minimal valid sign-order POST body. */
function signOrderBody(signerUid: string, suggestedNodeId = 'fake-node-0') {
  return {
    challengeId: 'chal-abc123',
    signerUid,
    signedAt: '2026-05-30T11:00:00.000Z',
    suggestedNodeId,
    draftTotalClp: 150000,
    tenantId: TENANT_ID,
  };
}

// ────────────────────────────────────────────────────────────────────────
// beforeEach — fresh db + clear in-memory pending orders map.
// ────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  // Seed the project so assertProjectMember passes for MEMBER_UID.
  H.db._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
  // Reset pending-orders in-memory cache between tests.
  __resetPendingOrdersForTests();
  // Default flow mock results.
  flowMock.inspectionResult = {
    ok: true,
    nodes: [{ metadata: { sourceType: 'epp-inspection-event' } }],
    nodeIds: ['fake-node-0'],
    edges: [],
    suggestedOrder: null,
    notes: [],
  };
  flowMock.signedResult = {
    ok: true,
    nodeId: 'signed-node-1',
    edge: { id: 'edge-sign-1' },
  };
});

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/epp-flow/inspection
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/epp-flow/inspection', () => {
  const URL = `/api/sprint-k/${PROJECT_ID}/epp-flow/inspection`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(baseInspectionBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', OTHER_UID)
      .send(baseInspectionBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when body is missing required fields (no inspection)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ tenantId: TENANT_ID }); // missing inspection, inventoryByKind, etc.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when items array is empty (min:1 violation)', async () => {
    const body = {
      ...baseInspectionBody,
      inspection: { ...baseInspectionBody.inspection, items: [] },
    };
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 happy path — no failed items, no suggested order', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send(baseInspectionBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.suggestedOrder).toBeNull();
    expect(typeof res.body.nodeCount).toBe('number');
    expect(typeof res.body.edgeCount).toBe('number');
  });

  it('200 + populates pendingOrders when inspectionResult includes a suggestedOrder + purchase-order-suggested node', async () => {
    // Override flow mock to return a result with a suggested order.
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId: 'oc-insp-001',
            suggestedAt: '2026-05-30T10:00:00.000Z',
          },
        },
      ],
      nodeIds: ['fake-node-0', 'fake-node-1'],
      edges: [],
      suggestedOrder: {
        lines: [
          {
            kind: 'casco',
            quantity: 5,
            estimatedUnitCostClp: 15000,
            supplierId: 'sup-1',
            urgency: 'routine',
          },
        ],
        totalClp: 75000,
        deliveryWeekHint: 3,
        notes: [],
      },
      notes: [],
    };

    const bodyWithFailed = {
      ...baseInspectionBody,
      inspection: {
        ...baseInspectionBody.inspection,
        items: [
          {
            itemId: 'item-a',
            kind: 'casco',
            status: 'failed',
            failureReason: 'damaged',
            reportedByUid: MEMBER_UID,
          },
        ],
      },
      inventoryByKind: {
        casco: {
          kind: 'casco',
          currentStock: 1,
          reorderThreshold: 5,
          expectedConsumptionPerMonth: 3,
          preferredSupplierId: 'sup-1',
        },
      },
      supplierCatalog: [{ supplierId: 'sup-1', kind: 'casco', unitCostClp: 15000 }],
      leadTimeDaysBySupplier: { 'sup-1': 7 },
    };

    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send(bodyWithFailed);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.suggestedOrder).not.toBeNull();
    expect(res.body.suggestedOrder.lines).toHaveLength(1);
    expect(res.body.suggestedOrder.totalClp).toBe(75000);

    // Verify the pending order was registered (GET pending-orders should return it).
    const pending = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/epp-flow/pending-orders`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');
    expect(pending.status).toBe(200);
    expect(pending.body.orders).toHaveLength(1);
    expect(pending.body.orders[0].orderId).toBe('oc-insp-001');
    expect(pending.body.orders[0].status).toBe('pending_signature');
  });

  it('200 when inspectionResult.ok is true and orderId override is used', async () => {
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId: 'my-override-oc',
            suggestedAt: '2026-05-30T10:00:00.000Z',
          },
        },
      ],
      nodeIds: ['node-0', 'node-1'],
      edges: [],
      suggestedOrder: {
        lines: [{ kind: 'guante', quantity: 2, estimatedUnitCostClp: 5000, supplierId: 's1', urgency: 'urgent' }],
        totalClp: 10000,
        deliveryWeekHint: 2,
        notes: [],
      },
      notes: [],
    };

    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...baseInspectionBody, orderId: 'my-override-oc' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 1b. Cross-tenant IDOR guard (#700/#707/#708) — tenant from the verified
//     token, never from the request body. A member of tenant A echoing a
//     foreign tenantId, or a token with no tenant binding, is rejected.
// ────────────────────────────────────────────────────────────────────────

describe('cross-tenant guard — eppFlow tenant is token-authoritative', () => {
  const INSPECT_URL = `/api/sprint-k/${PROJECT_ID}/epp-flow/inspection`;

  it('403 tenant_mismatch on inspection when body.tenantId forges a foreign tenant', async () => {
    const res = await request(buildApp())
      .post(INSPECT_URL)
      .set('x-test-uid', MEMBER_UID) // token tenant defaults to 'tenant-a'
      .send({ ...baseInspectionBody, tenantId: 'tenant-evil' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tenant_mismatch');
  });

  it('403 no_tenant_binding on inspection when the token carries no tenant claim', async () => {
    const res = await request(buildApp())
      .post(INSPECT_URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-tenant', 'none') // simulate a token without a tenant claim
      .send(baseInspectionBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_tenant_binding');
  });

  it('403 tenant_mismatch on sign-order when body.tenantId forges a foreign tenant', async () => {
    // Seed a pending order whose suggestedNodeId is 'fake-node-0'.
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        { metadata: { sourceType: 'purchase-order-suggested', orderId: 'oc-xt', suggestedAt: '2026-05-30T10:00:00.000Z' } },
      ],
      nodeIds: ['n0', 'fake-node-0'],
      edges: [],
      suggestedOrder: { lines: [{ kind: 'casco', quantity: 1, estimatedUnitCostClp: 1, supplierId: 's1', urgency: 'routine' }], totalClp: 1, deliveryWeekHint: 1, notes: [] },
      notes: [],
    };
    await request(buildApp())
      .post(INSPECT_URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...baseInspectionBody, orderId: 'oc-xt' });

    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/epp-flow/sign-order/oc-xt`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send({ ...signOrderBody(MEMBER_UID, 'fake-node-0'), tenantId: 'tenant-evil' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tenant_mismatch');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. GET /:projectId/epp-flow/pending-orders
// ────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/epp-flow/pending-orders', () => {
  const URL = `/api/sprint-k/${PROJECT_ID}/epp-flow/pending-orders`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', OTHER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 forbidden_role when caller is a member but lacks an elevated role', async () => {
    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', MEMBER_UID); // member, but no x-test-role
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('200 returns empty orders list when there are none', async () => {
    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
  });

  it('200 returns only pending_signature orders (not signed ones)', async () => {
    // Post an inspection to register a pending order.
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId: 'oc-get-test',
            suggestedAt: '2026-05-30T09:00:00.000Z',
          },
        },
      ],
      nodeIds: ['n0', 'n1'],
      edges: [],
      suggestedOrder: {
        lines: [{ kind: 'bota', quantity: 3, estimatedUnitCostClp: 20000, supplierId: 'sup-2', urgency: 'routine' }],
        totalClp: 60000,
        deliveryWeekHint: 2,
        notes: [],
      },
      notes: [],
    };

    await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/epp-flow/inspection`)
      .set('x-test-uid', MEMBER_UID)
      .send(baseInspectionBody);

    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].status).toBe('pending_signature');
  });

  // ── Cross-process source of truth: persisted ZK nodes (not just the Map). ──
  // The in-memory cache is empty on a fresh worker, so an admin on instance B
  // must still see an OC suggested by a worker's inspection on instance A. We
  // simulate that by seeding the persisted `purchase-order-suggested` node
  // directly (NO inspection POST in this process → Map is empty).

  /** Seed a persisted suggested-OC node the way the inspection handler does. */
  function seedSuggestedNode(
    nodeId: string,
    orderId: string,
    extra: Record<string, unknown> = {},
  ) {
    H.db!._seed(`zettelkasten_nodes/${nodeId}`, {
      projectId: PROJECT_ID,
      metadata: {
        sourceType: 'purchase-order-suggested',
        orderId,
        tenantId: TENANT_ID,
        inspectionId: 'insp-cross',
        suggestedAt: '2026-06-20T08:00:00.000Z',
        status: 'pending_signature',
        draft: {
          lines: [
            { kind: 'casco', quantity: 4, estimatedUnitCostClp: 12000, supplierId: 'sup-1', urgency: 'routine' },
          ],
          totalClp: 48000,
          deliveryWeekHint: 2,
          notes: [],
        },
        ...extra,
      },
    });
  }

  it('200 returns a persisted OC suggested in another process (Map empty)', async () => {
    seedSuggestedNode('zk-cross-1', 'oc-cross-1');

    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    const order = res.body.orders[0];
    expect(order.orderId).toBe('oc-cross-1');
    expect(order.suggestedNodeId).toBe('zk-cross-1');
    expect(order.status).toBe('pending_signature');
    // The FULL draft round-trips from Firestore (real lines, not fabricated).
    expect(order.draft.lines).toHaveLength(1);
    expect(order.draft.lines[0].kind).toBe('casco');
    expect(order.draft.totalClp).toBe(48000);
  });

  it('200 excludes a persisted OC that already has a purchase-order-signed node', async () => {
    seedSuggestedNode('zk-signed-suggested', 'oc-already-signed');
    // A signed node for the SAME orderId → no longer pending.
    H.db!._seed('zettelkasten_nodes/zk-signed', {
      projectId: PROJECT_ID,
      metadata: {
        sourceType: 'purchase-order-signed',
        orderId: 'oc-already-signed',
      },
    });

    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');

    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
  });

  it('200 skips a persisted suggested node missing its draft (no fabrication)', async () => {
    // Legacy node without metadata.draft → cannot rebuild faithfully → skipped.
    H.db!._seed('zettelkasten_nodes/zk-legacy', {
      projectId: PROJECT_ID,
      metadata: {
        sourceType: 'purchase-order-suggested',
        orderId: 'oc-legacy',
        suggestedAt: '2026-06-20T08:00:00.000Z',
      },
    });

    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');

    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
  });

  it('de-duplicates by orderId when an order is both persisted and in the Map', async () => {
    // Persist a suggested node, AND register the same orderId via an inspection
    // in THIS process. The GET must return exactly ONE entry for that orderId.
    seedSuggestedNode('zk-dup', 'oc-dup');
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId: 'oc-dup',
            suggestedAt: '2026-06-20T09:00:00.000Z',
          },
        },
      ],
      nodeIds: ['n0', 'zk-dup'],
      edges: [],
      suggestedOrder: {
        lines: [{ kind: 'bota', quantity: 2, estimatedUnitCostClp: 20000, supplierId: 'sup-9', urgency: 'routine' }],
        totalClp: 40000,
        deliveryWeekHint: 2,
        notes: [],
      },
      notes: [],
    };
    await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/epp-flow/inspection`)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...baseInspectionBody, orderId: 'oc-dup' });

    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');

    expect(res.status).toBe(200);
    const dup = res.body.orders.filter(
      (o: { orderId: string }) => o.orderId === 'oc-dup',
    );
    expect(dup).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/epp-flow/sign-order/:orderId
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/epp-flow/sign-order/:orderId', () => {
  const ORDER_ID = 'oc-sign-test';
  const SIGN_URL = `/api/sprint-k/${PROJECT_ID}/epp-flow/sign-order/${ORDER_ID}`;

  /** Seed a pending order so sign-order can find it. */
  async function seedPendingOrder(orderId = ORDER_ID) {
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId,
            suggestedAt: '2026-05-30T10:00:00.000Z',
          },
        },
      ],
      nodeIds: ['n0', 'fake-node-0'],
      edges: [],
      suggestedOrder: {
        lines: [{ kind: 'casco', quantity: 4, estimatedUnitCostClp: 12000, supplierId: 's1', urgency: 'routine' }],
        totalClp: 48000,
        deliveryWeekHint: 2,
        notes: [],
      },
      notes: [],
    };

    await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/epp-flow/inspection`)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...baseInspectionBody, orderId });
  }

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(SIGN_URL)
      .send(signOrderBody(MEMBER_UID));
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(SIGN_URL)
      .set('x-test-uid', OTHER_UID)
      .send(signOrderBody(OTHER_UID));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when body is missing required fields', async () => {
    const res = await request(buildApp())
      .post(SIGN_URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ tenantId: TENANT_ID }); // missing challengeId, signerUid, etc.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 forbidden_role when caller is a member but lacks an elevated role', async () => {
    await seedPendingOrder();
    // signerUid matches the caller, order exists & node matches — the ONLY
    // reason this is rejected is the missing elevated role. Proves the role
    // gate fires before the signerUid/order checks.
    const res = await request(buildApp())
      .post(SIGN_URL)
      .set('x-test-uid', MEMBER_UID) // member, but no x-test-role
      .send(signOrderBody(MEMBER_UID, 'fake-node-0'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('403 when signerUid does not match the authenticated caller', async () => {
    await seedPendingOrder();
    const res = await request(buildApp())
      .post(SIGN_URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(signOrderBody('uid-impersonator')); // signerUid != MEMBER_UID
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(res.body.message).toMatch(/signerUid/);
  });

  it('404 when the order is not found in pendingOrders', async () => {
    const res = await request(buildApp())
      .post(SIGN_URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(signOrderBody(MEMBER_UID));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('order_not_found');
  });

  it('400 when suggestedNodeId in body does not match what was stored', async () => {
    await seedPendingOrder();
    const body = signOrderBody(MEMBER_UID, 'WRONG-NODE-ID');
    const res = await request(buildApp())
      .post(SIGN_URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('suggestedNodeId_mismatch');
  });

  it('200 happy path — order signed, status updated to signed', async () => {
    await seedPendingOrder();
    // The stored suggestedNodeId is 'fake-node-0' (second node, index 1 of nodeIds).
    const body = signOrderBody(MEMBER_UID, 'fake-node-0');
    const res = await request(buildApp())
      .post(SIGN_URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.signedNodeId).toBe('signed-node-1');
    expect(res.body.edgeId).toBe('edge-sign-1');
    expect(res.body.order.status).toBe('signed');
    expect(res.body.order.signerUid).toBe(MEMBER_UID);

    // After signing, GET pending-orders should not return this order (it's signed).
    const pending = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/epp-flow/pending-orders`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');
    expect(pending.status).toBe(200);
    expect(pending.body.orders).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. GET /:projectId/epp-flow/order-pdf/:orderId
// ────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/epp-flow/order-pdf/:orderId', () => {
  const ORDER_ID = 'oc-pdf-test';
  const PDF_URL = `/api/sprint-k/${PROJECT_ID}/epp-flow/order-pdf/${ORDER_ID}`;

  /** Seed a signed order so the PDF endpoint can find it. */
  async function seedSignedOrder() {
    // 1) Seed inspection → pending order.
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId: ORDER_ID,
            suggestedAt: '2026-05-30T10:00:00.000Z',
          },
        },
      ],
      nodeIds: ['n0', 'fake-node-0'],
      edges: [],
      suggestedOrder: {
        lines: [{ kind: 'chaleco', quantity: 2, estimatedUnitCostClp: 35000, supplierId: 's3', urgency: 'urgent' }],
        totalClp: 70000,
        deliveryWeekHint: 1,
        notes: [],
      },
      notes: [],
    };
    await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/epp-flow/inspection`)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...baseInspectionBody, orderId: ORDER_ID });

    // 2) Sign the order.
    flowMock.signedResult = { ok: true, nodeId: 'signed-pdf-node', edge: null };
    await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/epp-flow/sign-order/${ORDER_ID}`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(signOrderBody(MEMBER_UID, 'fake-node-0'));
  }

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${PDF_URL}?tenantId=${TENANT_ID}`);
    expect(res.status).toBe(401);
  });

  it('no longer 400 when the tenantId query is absent — the token is authoritative (404 here, order not seeded)', async () => {
    const res = await request(buildApp())
      .get(PDF_URL) // no ?tenantId — resolved from the verified token
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('order_not_found');
  });

  it('403 tenant_mismatch when ?tenantId forges a tenant different from the token', async () => {
    const res = await request(buildApp())
      .get(`${PDF_URL}?tenantId=tenant-evil`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor'); // token tenant defaults to 'tenant-a'
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tenant_mismatch');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`${PDF_URL}?tenantId=${TENANT_ID}`)
      .set('x-test-uid', OTHER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 forbidden_role when caller is a member but lacks an elevated role', async () => {
    const res = await request(buildApp())
      .get(`${PDF_URL}?tenantId=${TENANT_ID}`)
      .set('x-test-uid', MEMBER_UID); // member, but no x-test-role
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('404 when the order is not found', async () => {
    const res = await request(buildApp())
      .get(`${PDF_URL}?tenantId=${TENANT_ID}`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('order_not_found');
  });

  it('409 when the order exists but is not yet signed', async () => {
    // Seed a pending (unsigned) order.
    flowMock.inspectionResult = {
      ok: true,
      nodes: [
        { metadata: { sourceType: 'epp-inspection-event' } },
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId: ORDER_ID,
            suggestedAt: '2026-05-30T10:00:00.000Z',
          },
        },
      ],
      nodeIds: ['n0', 'n1'],
      edges: [],
      suggestedOrder: {
        lines: [{ kind: 'casco', quantity: 1, estimatedUnitCostClp: 10000, supplierId: 's1', urgency: 'routine' }],
        totalClp: 10000,
        deliveryWeekHint: 1,
        notes: [],
      },
      notes: [],
    };
    await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/epp-flow/inspection`)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...baseInspectionBody, orderId: ORDER_ID });

    const res = await request(buildApp())
      .get(`${PDF_URL}?tenantId=${TENANT_ID}`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('order_not_signed');
  });

  it('200 returns a PDF binary with correct headers for a signed order', async () => {
    await seedSignedOrder();

    const res = await request(buildApp())
      .get(`${PDF_URL}?tenantId=${TENANT_ID}`)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(ORDER_ID);
    // Directiva no-push: header must be false.
    expect(res.headers['x-praeventio-pushed-to-supplier']).toBe('false');
    // Body should be the mocked PDF buffer.
    expect(Buffer.isBuffer(res.body) || res.body instanceof Buffer).toBe(true);
  });
});
