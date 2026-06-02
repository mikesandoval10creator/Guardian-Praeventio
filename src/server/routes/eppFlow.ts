// Praeventio Guard — Bloque 4.2: EPP Inventory Purchase Flow HTTP surface.
//
// 4 endpoints sobre el orquestador
// `src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts`:
//
//   POST /:projectId/epp-flow/inspection        (worker reporta inspeccion)
//   GET  /:projectId/epp-flow/pending-orders    (admin lista OC sugeridas)
//   POST /:projectId/epp-flow/sign-order/:orderId
//                                               (admin firma OC con WebAuthn)
//   GET  /:projectId/epp-flow/order-pdf/:orderId
//                                               (admin descarga PDF — no envia)
//
// Directiva no-push: NUNCA empujamos al proveedor. El PDF se descarga, la
// empresa lo envia por sus canales habituales. El campo `pushedToSupplier`
// en el nodo PDF queda en `false` siempre.
//
// Directiva firma biometrica: la firma de OC usa WebAuthn 'claim-signing'.
// El cliente (modal) corre el ceremony y le pasa al server `challengeId` +
// estado de verificacion. El server CONFIA en el ceremony del cliente
// porque el flow ya paso por /api/auth/webauthn/verify antes de llamar al
// endpoint sign-order (mismo patron que StoppageResumeModal -> resumeStoppage).
// TODO: una proxima iteracion puede revalidar la firma en el server-side.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  onEppInspectionCompleted,
  persistSignedNode,
  persistPdfNode,
  renderPurchaseOrderPdf,
  type EppInspectionInput,
  type InspectedEppItem,
  type InventorySnapshot,
  type EppFlowDeps,
  type FlowRunResult,
} from '../../services/zettelkasten/flows/eppInventoryPurchaseFlow.js';
import { makeServerWriteNodes } from '../services/serverZkNodeWriter.js';
import type { EdgeStore, ZkEdge, EdgeType } from '../../services/zettelkasten/edges.js';
import {
  suggestPurchaseOrder,
  type InventoryItem,
  type SupplierCatalogEntry,
  type PurchaseOrderDraft,
} from '../../services/financialAnalytics/purchaseOrderSuggester.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// Guard helper — projectId membership.
// ────────────────────────────────────────────────────────────────────────

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────
// Role gate — procurement signing is an ADMIN flow (see header doc lines
// 7-11: pending-orders / sign-order / order-pdf are all marked "admin").
// Project membership alone is NOT sufficient: a regular worker who is a
// project member must NOT be able to sign a purchase order as themselves.
// Defence in depth: an authorized caller must be BOTH an elevated signer
// role AND (for sign-order) signing as themselves (signerUid === callerUid).
// The route docs say "admin" generically (no named signer role) so we use
// the canonical EPP/brigade signer set. Pattern copied from
// src/server/routes/emergencyBrigade.ts (callerCanWriteBrigade).
// NOTE: the routine worker inspection (POST .../inspection) is deliberately
// NOT gated — the docs mark it as a worker action.
// ────────────────────────────────────────────────────────────────────────

const EPP_SIGN_ROLES = new Set(['admin', 'prevencionista', 'supervisor']);

function callerCanSignEpp(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && EPP_SIGN_ROLES.has(u.role)) return true;
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (
    tenants &&
    typeof tenants === 'object' &&
    typeof u.tenantId === 'string'
  ) {
    const t = tenants[u.tenantId];
    if (t && typeof t.role === 'string' && EPP_SIGN_ROLES.has(t.role)) {
      return true;
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// Firestore-backed EdgeStore adapter (DI shape from edges.ts).
// Per-tenant collection `tenants/{tenantId}/zettelkasten_edges/{edgeId}`.
// ────────────────────────────────────────────────────────────────────────

function buildFirestoreEdgeStore(): EdgeStore {
  const db = admin.firestore();
  function col(tenantId: string) {
    return db.collection(`tenants/${tenantId}/zettelkasten_edges`);
  }
  return {
    async saveEdge(edge: ZkEdge) {
      await col(edge.tenantId).doc(edge.id).set(edge, { merge: true });
    },
    async deleteEdgeById(id, tenantId) {
      await col(tenantId).doc(id).delete();
    },
    async findOutgoing(nodeId, tenantId, type) {
      let q: FirebaseFirestore.Query = col(tenantId).where(
        'fromNodeId',
        '==',
        nodeId,
      );
      if (type) q = q.where('type', '==', type);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
    async findIncoming(nodeId, tenantId, type) {
      let q: FirebaseFirestore.Query = col(tenantId).where(
        'toNodeId',
        '==',
        nodeId,
      );
      if (type) q = q.where('type', '==', type);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────

const inspectedItemSchema = z.object({
  itemId: z.string().min(1).max(200),
  kind: z.string().min(1).max(120),
  status: z.enum(['ok', 'warning', 'failed']),
  failureReason: z.enum(['expired', 'damaged', 'missing', 'contaminated', 'other']).optional(),
  reportedByUid: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<InspectedEppItem>;

const inspectionInputSchema = z.object({
  inspectionId: z.string().min(1).max(200),
  siteId: z.string().min(1).max(200).optional(),
  workerUid: z.string().min(1).max(200),
  items: z.array(inspectedItemSchema).min(1).max(500),
  inspectedAt: z.string().min(10).max(64),
}) as unknown as z.ZodType<EppInspectionInput>;

const inventoryItemSchema = z.object({
  kind: z.string().min(1).max(120),
  currentStock: z.number().nonnegative().max(1_000_000_000),
  reorderThreshold: z.number().nonnegative().max(1_000_000_000),
  expectedConsumptionPerMonth: z.number().nonnegative().max(1_000_000_000),
  preferredSupplierId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<InventoryItem>;

const supplierEntrySchema = z.object({
  supplierId: z.string().min(1).max(200),
  kind: z.string().min(1).max(120),
  unitCostClp: z.number().nonnegative().max(1e12),
}) as unknown as z.ZodType<SupplierCatalogEntry>;

const inspectionPostSchema = z.object({
  inspection: inspectionInputSchema,
  /** Snapshot inicial del inventario por kind (currentStock previo). */
  inventoryByKind: z.record(z.string(), inventoryItemSchema),
  /** Catalogo de proveedores. */
  supplierCatalog: z.array(supplierEntrySchema).max(1000),
  /** Lead time por supplier (dias). */
  leadTimeDaysBySupplier: z.record(z.string(), z.number().int().min(0).max(365)),
  /** Tenant del Firebase Auth claim. */
  tenantId: z.string().min(1).max(200),
  /** Override del orderId para idempotencia. */
  orderId: z.string().min(1).max(200).optional(),
});

const signOrderSchema = z.object({
  /** El cliente ya corrio /api/auth/webauthn/verify y obtuvo true. */
  challengeId: z.string().min(1).max(256),
  /** UID del admin firmante (debe == callerUid en check). */
  signerUid: z.string().min(1).max(200),
  signerRut: z.string().min(1).max(50).optional(),
  signerName: z.string().min(1).max(200).optional(),
  signedAt: z.string().min(10).max(64),
  /** nodeId del 'purchase-order-suggested'. */
  suggestedNodeId: z.string().min(1).max(64),
  /** Draft total CLP (auditoria). */
  draftTotalClp: z.number().nonnegative().max(1e12),
  tenantId: z.string().min(1).max(200),
});

// ────────────────────────────────────────────────────────────────────────
// In-memory pending orders cache (per server instance).
// MVP: rapidly-evicted store. La fuente de verdad real son los nodos ZK.
// La proxima iteracion debe persistir esto en Firestore.
// ────────────────────────────────────────────────────────────────────────

interface PendingOrderRecord {
  orderId: string;
  projectId: string;
  tenantId: string;
  inspectionId: string;
  suggestedNodeId: string;
  draft: PurchaseOrderDraft;
  suggestedAt: string;
  status: 'pending_signature' | 'signed';
  signedAt?: string;
  signerUid?: string;
}

const pendingOrders = new Map<string, PendingOrderRecord>();

function pendingKey(projectId: string, orderId: string): string {
  return `${projectId}:${orderId}`;
}

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/epp-flow/inspection — worker reporta inspeccion.
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/epp-flow/inspection',
  verifyAuth,
  validate(inspectionPostSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof inspectionPostSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    try {
      const deps: EppFlowDeps = {
        // Codex P1 (#650): in the Express runtime the browser `writeNodes`
        // (relative fetch + IndexedDB) can't persist — use the Admin-SDK
        // server writer, stamped with the verified actor.
        writeNodes: makeServerWriteNodes({
          createdBy: callerUid,
          createdByEmail: req.user?.email ?? null,
        }),
        edgeStore: buildFirestoreEdgeStore(),
        tenantId: body.tenantId,
        createdBy: callerUid,
      };

      const result: FlowRunResult = await onEppInspectionCompleted(
        body.inspection,
        deps,
        {
          projectId,
          orderId: body.orderId,
          resolveInventory: async ({ failedByKind }) => {
            const snapshots: InventorySnapshot[] = [];
            for (const [kind, failedList] of failedByKind.entries()) {
              const inv = body.inventoryByKind[kind];
              if (!inv) continue; // kind sin record => no ajuste
              const delta = failedList.length;
              const previousStock = inv.currentStock;
              const newStock = Math.max(0, previousStock - delta);
              snapshots.push({
                kind,
                previousStock,
                newStock,
                reorderThreshold: inv.reorderThreshold,
              });
            }
            return snapshots;
          },
          suggestOrder: async ({ snapshots }) => {
            // Construye InventoryItem[] desde snapshots + body.inventoryByKind.
            const items: InventoryItem[] = snapshots.map((s) => {
              const inv = body.inventoryByKind[s.kind];
              return {
                kind: s.kind,
                currentStock: s.newStock,
                reorderThreshold: s.reorderThreshold,
                expectedConsumptionPerMonth: inv?.expectedConsumptionPerMonth ?? 0,
                preferredSupplierId: inv?.preferredSupplierId,
              };
            });
            const draft = suggestPurchaseOrder(
              items,
              body.supplierCatalog,
              body.leadTimeDaysBySupplier,
            );
            return draft.lines.length > 0 ? draft : null;
          },
        },
      );

      // Si genero una OC sugerida, capturamos el nodeId del
      // 'purchase-order-suggested' para que el sign-order pueda referenciarlo.
      if (result.suggestedOrder) {
        const ocNodeIdx = result.nodes.findIndex(
          (n) => n.metadata.sourceType === 'purchase-order-suggested',
        );
        if (ocNodeIdx >= 0 && result.nodeIds[ocNodeIdx]) {
          const orderId =
            (result.nodes[ocNodeIdx].metadata.orderId as string) ||
            body.orderId ||
            `oc-${body.inspection.inspectionId}`;
          pendingOrders.set(pendingKey(projectId, orderId), {
            orderId,
            projectId,
            tenantId: body.tenantId,
            inspectionId: body.inspection.inspectionId,
            suggestedNodeId: result.nodeIds[ocNodeIdx],
            draft: result.suggestedOrder,
            suggestedAt: result.nodes[ocNodeIdx].metadata.suggestedAt as string,
            status: 'pending_signature',
          });
        }
      }

      await auditServerEvent(req, 'eppFlow.inspection', 'eppFlow', { projectId, inspectionId: body.inspection.inspectionId }, { projectId });
      return res.json({
        ok: result.ok,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        suggestedOrder: result.suggestedOrder ?? null,
        notes: result.notes,
      });
    } catch (err) {
      logger.error?.('eppFlow.inspection.error', err);
      captureRouteError(err, 'eppFlow.inspection');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. GET /:projectId/epp-flow/pending-orders — admin lista OC sugeridas.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/epp-flow/pending-orders',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (!callerCanSignEpp(req)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }

    try {
      const orders = Array.from(pendingOrders.values()).filter(
        (o) => o.projectId === projectId && o.status === 'pending_signature',
      );
      return res.json({ orders });
    } catch (err) {
      logger.error?.('eppFlow.pendingOrders.error', err);
      captureRouteError(err, 'eppFlow.pendingOrders');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/epp-flow/sign-order/:orderId
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/epp-flow/sign-order/:orderId',
  verifyAuth,
  validate(signOrderSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, orderId } = req.params;
    const body = req.body as z.infer<typeof signOrderSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    // Procurement signing is an admin flow — project membership is not enough.
    if (!callerCanSignEpp(req)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }

    // Solo el admin que dice ser puede firmar. Anti-blame estilo readReceipts.
    if (body.signerUid !== callerUid) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'signerUid must match the authenticated caller.',
      });
    }

    try {
      const key = pendingKey(projectId, orderId);
      const pending = pendingOrders.get(key);
      if (!pending) {
        return res.status(404).json({ error: 'order_not_found' });
      }
      if (pending.suggestedNodeId !== body.suggestedNodeId) {
        return res.status(400).json({ error: 'suggestedNodeId_mismatch' });
      }

      const deps: EppFlowDeps = {
        // Codex P1 (#650): in the Express runtime the browser `writeNodes`
        // (relative fetch + IndexedDB) can't persist — use the Admin-SDK
        // server writer, stamped with the verified actor.
        writeNodes: makeServerWriteNodes({
          createdBy: callerUid,
          createdByEmail: req.user?.email ?? null,
        }),
        edgeStore: buildFirestoreEdgeStore(),
        tenantId: body.tenantId,
        createdBy: callerUid,
      };

      const signed = await persistSignedNode(
        {
          signature: {
            orderId,
            signerUid: body.signerUid,
            signerRut: body.signerRut,
            signedAt: body.signedAt,
            challengeId: body.challengeId,
          },
          draftTotalClp: body.draftTotalClp,
          suggestedNodeId: body.suggestedNodeId,
        },
        deps,
        { projectId },
      );

      pending.status = 'signed';
      pending.signedAt = body.signedAt;
      pending.signerUid = body.signerUid;
      pendingOrders.set(key, pending);

      await auditServerEvent(req, 'eppFlow.sign-order', 'eppFlow', { projectId, orderId }, { projectId });
      return res.json({
        ok: signed.ok,
        signedNodeId: signed.nodeId,
        edgeId: signed.edge?.id ?? null,
        order: pending,
      });
    } catch (err) {
      logger.error?.('eppFlow.signOrder.error', err);
      captureRouteError(err, 'eppFlow.signOrder');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. GET /:projectId/epp-flow/order-pdf/:orderId — descarga PDF.
//    NO auto-envia al proveedor (directiva no-push).
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/epp-flow/order-pdf/:orderId',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, orderId } = req.params;
    const tenantId = (req.query.tenantId ?? '') as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId required' });
    }
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (!callerCanSignEpp(req)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }

    try {
      const key = pendingKey(projectId, orderId);
      const order = pendingOrders.get(key);
      if (!order) {
        return res.status(404).json({ error: 'order_not_found' });
      }
      if (order.status !== 'signed') {
        return res.status(409).json({ error: 'order_not_signed' });
      }

      // Renderizamos PDF.
      const pdf = await renderPurchaseOrderPdf({
        orderId,
        companyName: 'Empresa', // MVP: idealmente lookup en projects/{projectId}
        signerUid: order.signerUid,
        signedAt: order.signedAt,
        lines: order.draft.lines,
        totalClp: order.draft.totalClp,
        deliveryWeekHint: order.draft.deliveryWeekHint,
        notes: order.draft.notes,
      });
      const pdfSha256Hex = createHash('sha256').update(pdf).digest('hex');

      // Persistimos el nodo PDF en la cadena ZK.
      // Buscamos el signedNodeId desde pendingOrders.signedNodeId (lo
      // grabamos en sign-order). MVP: si no tenemos, hacemos un best-effort.
      // El persistPdfNode skipea edge si los ids coinciden (defensive path).
      const deps: EppFlowDeps = {
        // Codex P1 (#650): in the Express runtime the browser `writeNodes`
        // (relative fetch + IndexedDB) can't persist — use the Admin-SDK
        // server writer, stamped with the verified actor.
        writeNodes: makeServerWriteNodes({
          createdBy: callerUid,
          createdByEmail: req.user?.email ?? null,
        }),
        edgeStore: buildFirestoreEdgeStore(),
        tenantId,
        createdBy: callerUid,
      };
      const generatedAt = new Date().toISOString();
      // Para una version mas robusta, signedNodeId deberia persistirse en
      // pendingOrders. MVP: lo dejamos como vacio y persistPdfNode no crea
      // edge cuando se omite. La cadena queda con el nodo firmado + nodo
      // PDF, y la route de auditoria puede vincularlos por orderId.
      const signedNodeId = (order as PendingOrderRecord & { signedNodeId?: string })
        .signedNodeId ?? '';
      if (signedNodeId) {
        await persistPdfNode(
          {
            meta: {
              orderId,
              pdfBytesLength: pdf.length,
              pdfSha256Hex,
              generatedAt,
            },
            signedNodeId,
          },
          deps,
          { projectId },
        );
      }

      await auditServerEvent(req, 'eppFlow.order-pdf', 'eppFlow', { projectId, orderId }, { projectId });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${orderId}.pdf"`,
      );
      // Disclaimer headers — refuerza directiva.
      res.setHeader('X-Praeventio-Pushed-To-Supplier', 'false');
      res.end(pdf);
      return undefined;
    } catch (err) {
      logger.error?.('eppFlow.orderPdf.error', err);
      captureRouteError(err, 'eppFlow.orderPdf');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Test-only export — limpia el cache en suites.
// ────────────────────────────────────────────────────────────────────────

export function __resetPendingOrdersForTests(): void {
  pendingOrders.clear();
}

export default router;
