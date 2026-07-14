// Praeventio Guard — Bloque 4.2: eppInventoryPurchaseFlow coverage.
//
// Cubre la cadena completa (epp-inspection -> ... -> purchase-order-pdf)
// y los caminos cortos (sin failed items, sin proveedor, etc.).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  onEppInspectionCompleted,
  createEppInspectionNode,
  createEppItemFailedNode,
  createInventoryAdjustedNode,
  createInventoryBelowThresholdNode,
  createPurchaseOrderSuggestedNode,
  createPurchaseOrderSignedNode,
  createPurchaseOrderPdfNode,
  persistSignedNode,
  persistPdfNode,
  __testOnly,
  type EppInspectionInput,
  type InspectedEppItem,
  type InventorySnapshot,
  type EppFlowDeps,
  type FlowRunResult,
} from './eppInventoryPurchaseFlow';
import type { RiskNodePayload } from '../types';
import type { ZkEdge, EdgeStore, EdgeType } from '../edges';
import type { WriteResult } from '../persistence/writeNode';
import type { PurchaseOrderDraft } from '../../financialAnalytics/purchaseOrderSuggester';

// ──────────────────────────────────────────────────────────────────────
// In-memory fakes
// ──────────────────────────────────────────────────────────────────────

function makeFakeWriteNodes() {
  const calls: Array<{ nodes: RiskNodePayload[]; projectId: string }> = [];
  let idCounter = 0;
  const fn = async (
    nodes: RiskNodePayload[],
    ctx: { projectId: string },
  ): Promise<WriteResult> => {
    const ids = nodes.map(() => {
      idCounter += 1;
      // 16-hex deterministic-ish id for the test harness.
      return idCounter.toString(16).padStart(16, '0');
    });
    calls.push({ nodes, projectId: ctx.projectId });
    return { ok: true, ids };
  };
  return { fn, calls, reset: () => { calls.length = 0; idCounter = 0; } };
}

function makeFakeEdgeStore(): EdgeStore & { _all: () => ZkEdge[] } {
  const byId = new Map<string, ZkEdge>();
  return {
    async saveEdge(edge) { byId.set(edge.id, edge); },
    async deleteEdgeById(id) { byId.delete(id); },
    async findOutgoing(nodeId, tenantId, type) {
      return Array.from(byId.values()).filter(
        (e) =>
          e.tenantId === tenantId &&
          e.fromNodeId === nodeId &&
          (!type || e.type === type),
      );
    },
    async findIncoming(nodeId, tenantId, type) {
      return Array.from(byId.values()).filter(
        (e) =>
          e.tenantId === tenantId &&
          e.toNodeId === nodeId &&
          (!type || e.type === type),
      );
    },
    async listByTenant(tenantId, limit) {
      const all = Array.from(byId.values()).filter((e) => e.tenantId === tenantId);
      return typeof limit === 'number' && limit > 0 ? all.slice(0, limit) : all;
    },
    _all: () => Array.from(byId.values()),
  };
}

function makeDeps(overrides: Partial<EppFlowDeps> = {}): {
  deps: EppFlowDeps;
  writeNodesCalls: Array<{ nodes: RiskNodePayload[]; projectId: string }>;
  edgeStore: ReturnType<typeof makeFakeEdgeStore>;
} {
  const w = makeFakeWriteNodes();
  const edgeStore = makeFakeEdgeStore();
  return {
    deps: {
      writeNodes: overrides.writeNodes ?? w.fn,
      edgeStore: overrides.edgeStore ?? edgeStore,
      tenantId: overrides.tenantId ?? 'tenant-A',
      createdBy: overrides.createdBy ?? 'worker-1',
      now: overrides.now ?? (() => '2026-05-20T10:00:00.000Z'),
    },
    writeNodesCalls: w.calls,
    edgeStore,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────

const baseInspection = (
  overrides: Partial<EppInspectionInput> = {},
): EppInspectionInput => ({
  inspectionId: 'insp-001',
  siteId: 'site-faena-A',
  workerUid: 'worker-7',
  items: [
    {
      itemId: 'epp-001',
      kind: 'helmet',
      status: 'failed',
      failureReason: 'damaged',
      reportedByUid: 'worker-7',
    },
    {
      itemId: 'epp-002',
      kind: 'gloves',
      status: 'failed',
      failureReason: 'expired',
      reportedByUid: 'worker-7',
    },
    {
      itemId: 'epp-003',
      kind: 'boots',
      status: 'ok',
      reportedByUid: 'worker-7',
    },
  ],
  inspectedAt: '2026-05-20T09:00:00.000Z',
  ...overrides,
});

const baseSnapshots = (): InventorySnapshot[] => [
  {
    kind: 'helmet',
    previousStock: 5,
    newStock: 4,
    reorderThreshold: 3, // not below
  },
  {
    kind: 'gloves',
    previousStock: 3,
    newStock: 2,
    reorderThreshold: 5, // below threshold!
  },
];

const baseDraft = (): PurchaseOrderDraft => ({
  lines: [
    {
      kind: 'gloves',
      quantity: 20,
      estimatedUnitCostClp: 5000,
      supplierId: 'sup-1',
      urgency: 'urgent',
    },
  ],
  totalClp: 100000,
  deliveryWeekHint: 2,
  notes: [],
});

// ──────────────────────────────────────────────────────────────────────
// NodeFactory unit coverage
// ──────────────────────────────────────────────────────────────────────

describe('node factory functions', () => {
  it('createEppInspectionNode reflects failed/warning counts in severity', () => {
    const n = createEppInspectionNode(baseInspection());
    expect(n.type).toBe(__testOnly.SAFETY_LEARNING_TYPE);
    expect(n.metadata.sourceType).toBe('epp-inspection-event');
    expect(n.metadata.failedCount).toBe(2);
    expect(n.metadata.itemCount).toBe(3);
    expect(n.severity).toBe('high');
    expect(n.connections).toContain('worker:worker-7');
    expect(n.connections).toContain('site:site-faena-A');
  });

  it('createEppInspectionNode severity=info when all ok', () => {
    const allOk = baseInspection({
      items: [
        { itemId: 'a', kind: 'helmet', status: 'ok', reportedByUid: 'w' },
      ],
    });
    const n = createEppInspectionNode(allOk);
    expect(n.severity).toBe('info');
    expect(n.metadata.failedCount).toBe(0);
  });

  it('createEppItemFailedNode includes reason + connections to item + worker', () => {
    const insp = baseInspection();
    const failedItem = insp.items[0]; // helmet damaged
    const n = createEppItemFailedNode(insp, failedItem);
    expect(n.metadata.sourceType).toBe('epp-item-failed');
    expect(n.metadata.reason).toBe('damaged');
    expect(n.metadata.itemId).toBe('epp-001');
    expect(n.connections).toContain('epp-item:epp-001');
    expect(n.connections).toContain('worker:worker-7');
    expect(n.severity).toBe('high'); // damaged => high
  });

  it('createInventoryAdjustedNode tracks delta + severity for stock 0', () => {
    const insp = baseInspection();
    const snap: InventorySnapshot = {
      kind: 'helmet',
      previousStock: 1,
      newStock: 0,
      reorderThreshold: 3,
    };
    const n = createInventoryAdjustedNode(
      insp,
      insp.items[0],
      snap,
      '2026-05-20T10:00:00.000Z',
    );
    expect(n.metadata.sourceType).toBe('inventory-adjusted');
    expect(n.metadata.previousStock).toBe(1);
    expect(n.metadata.newStock).toBe(0);
    expect(n.metadata.delta).toBe(1);
    expect(n.severity).toBe('high'); // newStock=0 -> high
  });

  it('createInventoryBelowThresholdNode marks critical when stock 0', () => {
    const insp = baseInspection();
    const snap: InventorySnapshot = {
      kind: 'gloves',
      previousStock: 1,
      newStock: 0,
      reorderThreshold: 5,
    };
    const n = createInventoryBelowThresholdNode(insp, snap, '2026-05-20T10:00:00.000Z');
    expect(n.metadata.sourceType).toBe('inventory-below-threshold');
    expect(n.metadata.deficit).toBe(5);
    expect(n.severity).toBe('critical');
  });

  it('createPurchaseOrderSuggestedNode reflects line count + hasEmergency', () => {
    const insp = baseInspection();
    const draft: PurchaseOrderDraft = {
      lines: [
        {
          kind: 'gloves',
          quantity: 10,
          estimatedUnitCostClp: 1000,
          supplierId: 's',
          urgency: 'emergency',
        },
      ],
      totalClp: 10000,
      deliveryWeekHint: 1,
      notes: [],
    };
    const n = createPurchaseOrderSuggestedNode(insp, 'oc-1', draft, '2026-05-20T10:00:00.000Z');
    expect(n.metadata.sourceType).toBe('purchase-order-suggested');
    expect(n.metadata.lineCount).toBe(1);
    expect(n.metadata.hasEmergency).toBe(true);
    expect(n.severity).toBe('critical');
    expect(n.metadata.status).toBe('pending_signature');
  });

  it('createPurchaseOrderSignedNode captures challengeId and signer', () => {
    const n = createPurchaseOrderSignedNode(
      {
        orderId: 'oc-1',
        signerUid: 'admin-1',
        signerRut: '11.111.111-1',
        signedAt: '2026-05-20T11:00:00.000Z',
        challengeId: 'chal-abc',
      },
      100000,
    );
    expect(n.metadata.sourceType).toBe('purchase-order-signed');
    expect(n.metadata.signerUid).toBe('admin-1');
    expect(n.metadata.challengeId).toBe('chal-abc');
    expect(n.metadata.status).toBe('signed');
    expect(n.references).toContain('Ley-19799');
  });

  it('createPurchaseOrderPdfNode always sets pushedToSupplier=false (directiva no-push)', () => {
    const n = createPurchaseOrderPdfNode({
      orderId: 'oc-1',
      pdfBytesLength: 1234,
      pdfSha256Hex: 'abcd1234efef5678abcd1234efef5678abcd1234efef5678abcd1234efef5678',
      generatedAt: '2026-05-20T12:00:00.000Z',
    });
    expect(n.metadata.sourceType).toBe('purchase-order-pdf-generated');
    expect(n.metadata.pushedToSupplier).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Orchestrator coverage — onEppInspectionCompleted
// ──────────────────────────────────────────────────────────────────────

describe('onEppInspectionCompleted (end-to-end chain)', () => {
  let depsBundle: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    depsBundle = makeDeps();
  });

  it('emits full chain when failed items + below-threshold inventory + supplier exists', async () => {
    const { deps, writeNodesCalls, edgeStore } = depsBundle;
    const insp = baseInspection();
    const result = await onEppInspectionCompleted(insp, deps, {
      resolveInventory: async () => baseSnapshots(),
      suggestOrder: async () => baseDraft(),
      projectId: 'proj-1',
    });
    expect(result.ok).toBe(true);
    // 1 inspection + 2 failed items + 2 adjusted + 1 below-threshold + 1 OC = 7 nodes
    expect(result.nodes).toHaveLength(7);
    expect(result.nodeIds).toHaveLength(7);
    expect(result.suggestedOrder).toBeDefined();
    expect(writeNodesCalls).toHaveLength(1);
    // Edges: 2 causes (insp -> failed1/failed2) + 2 expires_into (failed -> adjusted)
    // + 1 causes (adjusted gloves -> below) + 1 expires_into (below -> OC) = 6
    const edges = edgeStore._all();
    expect(edges.length).toBe(6);
    // Ensure node sourceTypes appear in chain order
    const sourceTypes = result.nodes.map((n) => n.metadata.sourceType);
    expect(sourceTypes[0]).toBe('epp-inspection-event');
    expect(sourceTypes).toContain('epp-item-failed');
    expect(sourceTypes).toContain('inventory-adjusted');
    expect(sourceTypes).toContain('inventory-below-threshold');
    expect(sourceTypes).toContain('purchase-order-suggested');
  });

  it('stops at inspection node when no failed items', async () => {
    const { deps } = depsBundle;
    const allOk = baseInspection({
      items: [
        { itemId: 'a', kind: 'helmet', status: 'ok', reportedByUid: 'w' },
        { itemId: 'b', kind: 'gloves', status: 'warning', reportedByUid: 'w' },
      ],
    });
    const result = await onEppInspectionCompleted(allOk, deps, {
      resolveInventory: async () => [],
      suggestOrder: async () => null,
      projectId: 'proj-1',
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].metadata.sourceType).toBe('epp-inspection-event');
    expect(result.suggestedOrder).toBeUndefined();
    expect(result.notes.some((n) => /no failed items/i.test(n))).toBe(true);
    expect(result.edges).toEqual([]);
  });

  it('skips OC suggestion when no kind is below threshold', async () => {
    const { deps } = depsBundle;
    const insp = baseInspection();
    const noneBelow: InventorySnapshot[] = [
      { kind: 'helmet', previousStock: 5, newStock: 4, reorderThreshold: 1 },
      { kind: 'gloves', previousStock: 5, newStock: 4, reorderThreshold: 1 },
    ];
    const result = await onEppInspectionCompleted(insp, deps, {
      resolveInventory: async () => noneBelow,
      suggestOrder: async () => baseDraft(),
      projectId: 'proj-1',
    });
    // 1 inspection + 2 failed + 2 adjusted = 5; no below + no OC
    expect(result.nodes).toHaveLength(5);
    expect(
      result.nodes.some(
        (n) => n.metadata.sourceType === 'inventory-below-threshold',
      ),
    ).toBe(false);
    expect(result.suggestedOrder).toBeUndefined();
  });

  it('records note when suggester returns no supplier match', async () => {
    const { deps } = depsBundle;
    const insp = baseInspection();
    const result = await onEppInspectionCompleted(insp, deps, {
      resolveInventory: async () => baseSnapshots(),
      suggestOrder: async () => null,
      projectId: 'proj-1',
    });
    expect(result.suggestedOrder).toBeUndefined();
    expect(result.notes.some((n) => /no supplier matched/i.test(n))).toBe(true);
    // inspection + 2 failed + 2 adjusted + 1 below = 6
    expect(result.nodes).toHaveLength(6);
  });

  it('does not chain edges when ids.length != nodes.length (offline queue case)', async () => {
    const offlineFn = async () => ({ ok: true, queued: true } as WriteResult);
    const { deps, edgeStore } = makeDeps({ writeNodes: offlineFn });
    const insp = baseInspection();
    const result = await onEppInspectionCompleted(insp, deps, {
      resolveInventory: async () => baseSnapshots(),
      suggestOrder: async () => baseDraft(),
      projectId: 'proj-1',
    });
    expect(result.ok).toBe(true);
    expect(result.nodeIds).toEqual([]);
    expect(edgeStore._all()).toEqual([]);
    expect(result.notes.some((n) => /edges skipped/i.test(n))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// persistSignedNode + persistPdfNode coverage
// ──────────────────────────────────────────────────────────────────────

describe('persistSignedNode / persistPdfNode', () => {
  it('persistSignedNode writes node + edge documented_by from suggested', async () => {
    const { deps, edgeStore } = makeDeps();
    const r = await persistSignedNode(
      {
        signature: {
          orderId: 'oc-1',
          signerUid: 'admin-1',
          signedAt: '2026-05-20T11:00:00.000Z',
          challengeId: 'chal-x',
        },
        draftTotalClp: 100000,
        suggestedNodeId: 'aaaaaaaaaaaaaaaa',
      },
      deps,
      { projectId: 'proj-1' },
    );
    expect(r.ok).toBe(true);
    expect(r.nodeId.length).toBeGreaterThan(0);
    expect(r.edge).not.toBeNull();
    expect(r.edge?.type).toBe<EdgeType>('documented_by');
    expect(edgeStore._all()).toHaveLength(1);
  });

  it('persistPdfNode writes pdf node + edge generated_by from signed', async () => {
    const { deps, edgeStore } = makeDeps();
    const r = await persistPdfNode(
      {
        meta: {
          orderId: 'oc-1',
          pdfBytesLength: 4096,
          pdfSha256Hex: 'a'.repeat(64),
          generatedAt: '2026-05-20T12:00:00.000Z',
        },
        signedNodeId: 'bbbbbbbbbbbbbbbb',
      },
      deps,
      { projectId: 'proj-1' },
    );
    expect(r.ok).toBe(true);
    expect(r.edge?.type).toBe<EdgeType>('generated_by');
    expect(edgeStore._all()).toHaveLength(1);
  });

  it('persistSignedNode skips edge when suggestedNodeId equals signed nodeId (defensive)', async () => {
    // Force writeNodes to return the same id as suggestedNodeId.
    const sameId = '1111111111111111';
    const fn = async () => ({ ok: true, ids: [sameId] } as WriteResult);
    const { deps, edgeStore } = makeDeps({ writeNodes: fn });
    const r = await persistSignedNode(
      {
        signature: {
          orderId: 'oc-2',
          signerUid: 'admin-2',
          signedAt: '2026-05-20T11:00:00.000Z',
          challengeId: 'chal-y',
        },
        draftTotalClp: 5000,
        suggestedNodeId: sameId,
      },
      deps,
      { projectId: 'proj-1' },
    );
    expect(r.edge).toBeNull();
    expect(edgeStore._all()).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// FlowRunResult shape sanity
// ──────────────────────────────────────────────────────────────────────

describe('FlowRunResult typing sanity', () => {
  it('keeps suggestedOrder in result for downstream PDF rendering', async () => {
    const { deps } = makeDeps();
    const insp = baseInspection();
    const result: FlowRunResult = await onEppInspectionCompleted(insp, deps, {
      resolveInventory: async () => baseSnapshots(),
      suggestOrder: async () => baseDraft(),
      projectId: 'proj-1',
      orderId: 'oc-custom',
    });
    expect(result.suggestedOrder?.lines[0].kind).toBe('gloves');
    // Verify the custom orderId is included in metadata of the OC node.
    const ocNode = result.nodes.find(
      (n) => n.metadata.sourceType === 'purchase-order-suggested',
    );
    expect(ocNode?.metadata.orderId).toBe('oc-custom');
  });
});
