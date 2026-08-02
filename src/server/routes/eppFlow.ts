// Praeventio Guard — Bloque 4.2: EPP Inventory Purchase Flow HTTP surface.
//
// 5 endpoints sobre el orquestador
// `src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts`:
//
//   POST /:projectId/epp-flow/inspection        (worker reporta inspeccion)
//   GET  /:projectId/epp-flow/pending-orders    (admin lista OC sugeridas)
//   GET  /:projectId/epp-flow/sign-challenge/:orderId
//                                               (challenge ligado a la OC)
//   POST /:projectId/epp-flow/sign-order/:orderId
//                                               (admin firma OC con WebAuthn)
//   GET  /:projectId/epp-flow/order-pdf/:orderId
//                                               (admin descarga PDF — no envia)
//
// Directiva no-push: NUNCA empujamos al proveedor. El PDF se descarga, la
// empresa lo envia por sus canales habituales. El campo `pushedToSupplier`
// en el nodo PDF queda en `false` siempre.
//
// Directiva firma biometrica: la firma de OC usa una assertion WebAuthn con
// purpose `epp_order_signing`. El endpoint sign-order verifica directamente
// credencial, usuario, challenge single-use, RP ID, origen y metadata ligada
// a tenant/proyecto/orden antes de persistir cualquier evidencia legal.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { getWebauthnExpectedOrigin, getWebauthnRpId } from '../auth/rpId.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { callerTenantOr403 } from '../auth/callerTenant.js';
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
import type { EdgeStore, ZkEdge } from '../../services/zettelkasten/edges.js';
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
    // ZK-5 — required by the EdgeStore contract. NOTE: this whole object is a
    // duplicate of `buildEdgeStore` (services/zettelkasten/edgeStoreFirestore),
    // which exists precisely so routes share ONE materialization. Collapsing
    // this copy into it is a separate cleanup.
    async listByTenant(tenantId, limit) {
      let q: FirebaseFirestore.Query = col(tenantId);
      if (typeof limit === 'number' && limit > 0) q = q.limit(limit);
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

const webAuthnAssertionSchema = z.object({
  challengeId: z.string().min(1).max(256),
  id: z.string().min(1).max(512),
  rawId: z.string().min(1).max(512),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  clientDataJSON: z.string().min(1).max(16_384),
  authenticatorData: z.string().min(1).max(16_384),
  signature: z.string().min(1).max(16_384),
});

const signOrderSchema = z.object({
  /** Assertion WebAuthn completa; un challengeId aislado nunca es una firma. */
  assertion: webAuthnAssertionSchema,
});

interface EppOrderSigningChallengeMetadata {
  purpose: 'epp_order_signing';
  tenantId: string;
  projectId: string;
  orderId: string;
  suggestedNodeId: string;
  draftTotalClp: number;
}

function matchesEppOrderSigningChallenge(
  metadata: unknown,
  expected: EppOrderSigningChallengeMetadata,
): metadata is EppOrderSigningChallengeMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const candidate = metadata as Record<string, unknown>;
  return (
    candidate.purpose === expected.purpose &&
    candidate.tenantId === expected.tenantId &&
    candidate.projectId === expected.projectId &&
    candidate.orderId === expected.orderId &&
    candidate.suggestedNodeId === expected.suggestedNodeId &&
    candidate.draftTotalClp === expected.draftTotalClp &&
    Object.keys(candidate).length === 6
  );
}

// ────────────────────────────────────────────────────────────────────────
// Cache por proceso de OC pendientes. La fuente de verdad son los nodos ZK
// persistidos en Firestore; todos los límites legales pueden reconstruirla.
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
  signerRut?: string;
  signerName?: string;
  signedNodeId?: string;
}

const pendingOrders = new Map<string, PendingOrderRecord>();
const signingOrders = new Set<string>();
const EPP_SIGNING_LEASE_MS = 5 * 60 * 1000;

function pendingKey(projectId: string, orderId: string): string {
  return `${projectId}:${orderId}`;
}

// ────────────────────────────────────────────────────────────────────────
// Firestore-backed read of pending OC. The in-memory `pendingOrders` Map is a
// per-process MVP cache that is empty on a fresh worker and invisible across
// the multi-instance Cloud Run deployment — an admin on instance B never sees
// an OC suggested by a worker's inspection that landed on instance A. The real
// source of truth is the persisted ZK node `purchase-order-suggested` (legacy
// `zettelkasten_nodes/{id}`, written by `serverWriteNodes`). We read THAT,
// reconstruct the `PendingOrderRecord`, and exclude any order that already has
// a `purchase-order-signed` node (signed → no longer pending). The full draft
// is recoverable because the inspection handler merge-stamps `metadata.draft`
// onto the suggested node at write time (see `persistSuggestedOrderDraft`).
// ────────────────────────────────────────────────────────────────────────

/**
 * Merge-stamp the full draft + the resolved tenant onto the persisted
 * `purchase-order-suggested` node so a later cross-process GET can rebuild a
 * faithful `PendingOrderRecord` (the pure flow node only carries lineCount /
 * totalClp / deliveryWeekHint, not the line array nor the tenant). Best-effort:
 * the in-memory cache already holds the authoritative copy for this process, so
 * a write failure must NOT break the inspection response.
 */
async function persistSuggestedOrderDraft(
  suggestedNodeId: string,
  rec: Pick<PendingOrderRecord, 'orderId' | 'tenantId' | 'inspectionId' | 'draft' | 'suggestedAt'>,
): Promise<void> {
  try {
    await admin
      .firestore()
      .collection('zettelkasten_nodes')
      .doc(suggestedNodeId)
      .set(
        {
          metadata: {
            sourceType: 'purchase-order-suggested',
            orderId: rec.orderId,
            tenantId: rec.tenantId,
            inspectionId: rec.inspectionId,
            suggestedAt: rec.suggestedAt,
            draft: rec.draft,
            status: 'pending_signature',
          },
        },
        { merge: true },
      );
  } catch (err) {
    logger.warn?.('eppFlow.persistSuggestedOrderDraft.failed', {
      suggestedNodeId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

interface SuggestedNodeDoc {
  projectId?: string;
  metadata?: {
    sourceType?: string;
    orderId?: string;
    tenantId?: string;
    inspectionId?: string;
    suggestedAt?: string;
    draft?: PurchaseOrderDraft;
    signerUid?: string;
    signerRut?: string;
    signedAt?: string;
    status?: string;
  };
}

/**
 * Read pending purchase orders for a project from the persisted ZK nodes
 * (cross-process source of truth). Returns ONLY orders that are suggested and
 * NOT yet signed, each rebuilt as a `PendingOrderRecord`. Orders missing the
 * stamped `metadata.draft` (e.g. legacy nodes written before this field) are
 * skipped rather than fabricated — honest empty over invented lines.
 */
async function readPersistedPendingOrders(
  projectId: string,
): Promise<PendingOrderRecord[]> {
  const db = admin.firestore();
  const col = db.collection('zettelkasten_nodes');

  const [suggestedSnap, signedSnap] = await Promise.all([
    col
      .where('projectId', '==', projectId)
      .where('metadata.sourceType', '==', 'purchase-order-suggested')
      .get(),
    col
      .where('projectId', '==', projectId)
      .where('metadata.sourceType', '==', 'purchase-order-signed')
      .get(),
  ]);

  const signedOrderIds = new Set<string>();
  for (const d of signedSnap.docs) {
    const oid = (d.data() as SuggestedNodeDoc).metadata?.orderId;
    if (typeof oid === 'string' && oid.length > 0) signedOrderIds.add(oid);
  }

  const out: PendingOrderRecord[] = [];
  for (const d of suggestedSnap.docs) {
    const data = d.data() as SuggestedNodeDoc;
    const meta = data.metadata;
    const orderId = meta?.orderId;
    const draft = meta?.draft;
    // Skip nodes we can't faithfully rebuild (no orderId / no full draft) and
    // any order already signed — never fabricate a line array.
    if (!orderId || signedOrderIds.has(orderId)) continue;
    if (!draft || !Array.isArray(draft.lines)) continue;
    out.push({
      orderId,
      projectId,
      tenantId: meta?.tenantId ?? '',
      inspectionId: meta?.inspectionId ?? '',
      suggestedNodeId: d.id,
      draft,
      suggestedAt: meta?.suggestedAt ?? '',
      status: 'pending_signature',
    });
  }
  return out;
}

async function resolvePendingOrder(
  projectId: string,
  orderId: string,
): Promise<PendingOrderRecord | undefined> {
  const key = pendingKey(projectId, orderId);
  const cached = pendingOrders.get(key);
  if (cached?.status === 'pending_signature') return cached;

  const persisted = (await readPersistedPendingOrders(projectId)).find(
    (order) => order.orderId === orderId,
  );
  if (persisted) pendingOrders.set(key, persisted);
  return persisted;
}

async function readPersistedSignedOrder(
  projectId: string,
  orderId: string,
): Promise<PendingOrderRecord | undefined> {
  const col = admin.firestore().collection('zettelkasten_nodes');
  const [suggestedSnap, signedSnap] = await Promise.all([
    col
      .where('projectId', '==', projectId)
      .where('metadata.sourceType', '==', 'purchase-order-suggested')
      .get(),
    col
      .where('projectId', '==', projectId)
      .where('metadata.sourceType', '==', 'purchase-order-signed')
      .get(),
  ]);
  const suggestedDoc = suggestedSnap.docs.find(
    (doc) => (doc.data() as SuggestedNodeDoc).metadata?.orderId === orderId,
  );
  const signedDoc = signedSnap.docs.find(
    (doc) => (doc.data() as SuggestedNodeDoc).metadata?.orderId === orderId,
  );
  if (!suggestedDoc || !signedDoc) return undefined;

  const suggested = suggestedDoc.data() as SuggestedNodeDoc;
  const signed = signedDoc.data() as SuggestedNodeDoc;
  const suggestedMeta = suggested.metadata;
  const signedMeta = signed.metadata;
  if (!suggestedMeta?.draft || !Array.isArray(suggestedMeta.draft.lines)) {
    return undefined;
  }
  if (!signedMeta?.signerUid || !signedMeta.signedAt) return undefined;
  const signerIdentity = await readSignerIdentity(signedMeta.signerUid);
  return {
    orderId,
    projectId,
    tenantId: suggestedMeta.tenantId ?? '',
    inspectionId: suggestedMeta.inspectionId ?? '',
    suggestedNodeId: suggestedDoc.id,
    draft: suggestedMeta.draft,
    suggestedAt: suggestedMeta.suggestedAt ?? '',
    status: 'signed',
    signedAt: signedMeta.signedAt,
    signerUid: signedMeta.signerUid,
    signerRut: signedMeta.signerRut || signerIdentity.signerRut,
    signerName: signerIdentity.signerName,
    signedNodeId: signedDoc.id,
  };
}

async function readSignerIdentity(
  uid: string,
): Promise<{ signerRut?: string; signerName?: string }> {
  try {
    const snap = await admin.firestore().collection('users').doc(uid).get();
    if (!snap.exists) return {};
    const data = snap.data() as Record<string, unknown> | undefined;
    const rut = typeof data?.rut === 'string' ? data.rut.trim() : '';
    const displayName =
      typeof data?.displayName === 'string' ? data.displayName.trim() : '';
    return {
      ...(rut ? { signerRut: rut } : {}),
      ...(displayName ? { signerName: displayName } : {}),
    };
  } catch (err) {
    logger.warn?.('eppFlow.signer_identity_read_failed', {
      uid,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

async function auditEppEventNonBlocking(
  req: import('express').Request,
  action: string,
  details: Record<string, unknown>,
  projectId: string,
  captureContext: string,
): Promise<void> {
  try {
    await auditServerEvent(req, action, 'eppFlow', details, { projectId });
  } catch (err) {
    logger.error?.('eppFlow.audit_failed', {
      action,
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    captureRouteError(err, captureContext);
  }
}

type EppSigningClaimResult = 'claimed' | 'already_signed' | 'in_progress' | 'missing';

interface EppSigningClaim {
  challengeId: string;
  signerUid: string;
  expiresAtMs: number;
}

function readEppSigningClaim(metadata: Record<string, unknown>): EppSigningClaim | undefined {
  const raw = metadata.eppSigningClaim;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const claim = raw as Record<string, unknown>;
  if (
    typeof claim.challengeId !== 'string' ||
    typeof claim.signerUid !== 'string' ||
    typeof claim.expiresAtMs !== 'number'
  ) {
    return undefined;
  }
  return {
    challengeId: claim.challengeId,
    signerUid: claim.signerUid,
    expiresAtMs: claim.expiresAtMs,
  };
}

async function claimEppOrderForSigning(
  suggestedNodeId: string,
  challengeId: string,
  signerUid: string,
): Promise<EppSigningClaimResult> {
  const db = admin.firestore();
  const ref = db.collection('zettelkasten_nodes').doc(suggestedNodeId);
  const nowMs = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'missing';
    const data = snap.data() as { metadata?: Record<string, unknown> } | undefined;
    const metadata = data?.metadata ?? {};
    if (typeof metadata.eppSignedNodeId === 'string' && metadata.eppSignedNodeId) {
      return 'already_signed';
    }
    const activeClaim = readEppSigningClaim(metadata);
    if (activeClaim && activeClaim.expiresAtMs > nowMs) return 'in_progress';
    tx.update(ref, {
      'metadata.eppSigningClaim': {
        challengeId,
        signerUid,
        expiresAtMs: nowMs + EPP_SIGNING_LEASE_MS,
      },
    });
    return 'claimed';
  });
}

async function releaseEppSigningClaim(
  suggestedNodeId: string,
  challengeId: string,
): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection('zettelkasten_nodes').doc(suggestedNodeId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as { metadata?: Record<string, unknown> } | undefined;
    const activeClaim = readEppSigningClaim(data?.metadata ?? {});
    if (activeClaim?.challengeId !== challengeId) return;
    tx.update(ref, {
      'metadata.eppSigningClaim': admin.firestore.FieldValue.delete(),
    });
  });
}

async function markEppOrderSigned(
  suggestedNodeId: string,
  challengeId: string,
  signedNodeId: string,
  signedAt: string,
  signerUid: string,
): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection('zettelkasten_nodes').doc(suggestedNodeId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as { metadata?: Record<string, unknown> } | undefined;
    const activeClaim = readEppSigningClaim(data?.metadata ?? {});
    if (activeClaim?.challengeId !== challengeId) {
      throw new Error('epp_signing_claim_lost');
    }
    tx.update(ref, {
      'metadata.eppSignedNodeId': signedNodeId,
      'metadata.eppSignedAt': signedAt,
      'metadata.eppSignerUid': signerUid,
      'metadata.eppSigningClaim': admin.firestore.FieldValue.delete(),
    });
  });
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
    // Cross-tenant guard (#700/#707/#708): the authoritative tenant is the
    // verified token claim, NOT the client-supplied body.tenantId. A member of
    // tenant A echoing `tenantId: B` is rejected with 403.
    const tenantId = callerTenantOr403(req, res, body.tenantId);
    if (tenantId === null) return undefined;

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
        tenantId,
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
          const suggestedNodeId = result.nodeIds[ocNodeIdx];
          const suggestedAt = result.nodes[ocNodeIdx].metadata.suggestedAt as string;
          pendingOrders.set(pendingKey(projectId, orderId), {
            orderId,
            projectId,
            tenantId,
            inspectionId: body.inspection.inspectionId,
            suggestedNodeId,
            draft: result.suggestedOrder,
            suggestedAt,
            status: 'pending_signature',
          });
          // Persist the full draft + tenant onto the suggested ZK node so a
          // cross-process GET (admin on another instance) can rebuild the order
          // from Firestore, not just from this worker's in-memory cache.
          await persistSuggestedOrderDraft(suggestedNodeId, {
            orderId,
            tenantId,
            inspectionId: body.inspection.inspectionId,
            draft: result.suggestedOrder,
            suggestedAt,
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
      // Cross-process source of truth: the persisted ZK nodes. The in-memory
      // cache is overlaid on top so an order suggested earlier in THIS process
      // (whose Firestore write may still be settling, or whose status flipped
      // to `signed` locally) reflects the freshest state. Keyed by orderId.
      const byOrderId = new Map<string, PendingOrderRecord>();
      const persisted = await readPersistedPendingOrders(projectId);
      for (const o of persisted) byOrderId.set(o.orderId, o);
      for (const o of pendingOrders.values()) {
        if (o.projectId !== projectId) continue;
        if (o.status !== 'pending_signature') {
          // Locally-signed order supersedes a stale persisted "pending" copy.
          byOrderId.delete(o.orderId);
          continue;
        }
        byOrderId.set(o.orderId, o);
      }
      const orders = Array.from(byOrderId.values());
      return res.json({ orders });
    } catch (err) {
      logger.error?.('eppFlow.pendingOrders.error', err);
      captureRouteError(err, 'eppFlow.pendingOrders');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. GET /:projectId/epp-flow/sign-challenge/:orderId
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/epp-flow/sign-challenge/:orderId',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, orderId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (!callerCanSignEpp(req)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }
    const tenantId = callerTenantOr403(req, res, undefined);
    if (tenantId === null) return undefined;

    try {
      const pending = await resolvePendingOrder(projectId, orderId);
      if (!pending) return res.status(404).json({ error: 'order_not_found' });
      if (!pending.tenantId || pending.tenantId !== tenantId) {
        return res.status(403).json({ error: 'tenant_mismatch' });
      }

      const metadata: EppOrderSigningChallengeMetadata = {
        purpose: 'epp_order_signing',
        tenantId,
        projectId,
        orderId,
        suggestedNodeId: pending.suggestedNodeId,
        draftTotalClp: pending.draft.totalClp,
      };
      const { generateWebAuthnChallenge, storeWebAuthnChallenge } = await import(
        '../../services/auth/webauthnChallenge.js'
      );
      const { buildWebAuthnDb } = await import('./curriculum.js');
      const { challengeId, challenge } = generateWebAuthnChallenge();
      await storeWebAuthnChallenge(callerUid, challengeId, challenge, buildWebAuthnDb(), {
        metadata,
      });
      return res.json({
        challengeId,
        challenge: Buffer.from(challenge).toString('base64'),
        rpId: getWebauthnRpId(),
      });
    } catch (err) {
      logger.error?.('eppFlow.signChallenge.error', err);
      captureRouteError(err, 'eppFlow.signChallenge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/epp-flow/sign-order/:orderId
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

    // Actor and tenant come exclusively from the verified token. Legacy body
    // fields are stripped by Zod and cannot influence the legal signature.
    const tenantId = callerTenantOr403(req, res, undefined);
    if (tenantId === null) return undefined;

    try {
      const key = pendingKey(projectId, orderId);
      const pending = await resolvePendingOrder(projectId, orderId);
      if (!pending) {
        return res.status(404).json({ error: 'order_not_found' });
      }
      if (!pending.tenantId || pending.tenantId !== tenantId) {
        return res.status(403).json({ error: 'tenant_mismatch' });
      }

      const expectedChallengeMetadata: EppOrderSigningChallengeMetadata = {
        purpose: 'epp_order_signing',
        tenantId,
        projectId,
        orderId,
        suggestedNodeId: pending.suggestedNodeId,
        draftTotalClp: pending.draft.totalClp,
      };
      const assertion = body.assertion;
      const { verifyWebAuthnAssertion } = await import('../auth/webauthnAssertion.js');
      const { buildWebAuthnDb, buildWebAuthnCredentialsDb } = await import('./curriculum.js');
      const verdict = await verifyWebAuthnAssertion({
        uid: callerUid,
        credentialId: assertion.id,
        rawId: assertion.rawId,
        clientDataJSON: assertion.clientDataJSON,
        authenticatorData: assertion.authenticatorData,
        signature: assertion.signature,
        clientExtensionResults: assertion.clientExtensionResults,
        type: assertion.type,
        challengeId: assertion.challengeId,
        expectedOrigin: getWebauthnExpectedOrigin(),
        expectedRpId: getWebauthnRpId(),
        challengesDb: buildWebAuthnDb(),
        credentialsDb: buildWebAuthnCredentialsDb(),
        challengeMetadataValidator: (metadata) =>
          matchesEppOrderSigningChallenge(metadata, expectedChallengeMetadata),
      });
      if (!verdict.verified) {
        await auditEppEventNonBlocking(
          req,
          'eppFlow.sign-order-failed',
          {
            projectId,
            orderId,
            credentialId: assertion.id,
            reason: verdict.reason ?? 'verification_failed',
          },
          projectId,
          'eppFlow.signOrder.audit-rejection',
        );
        return res.status(401).json({
          error: 'webauthn_verification_failed',
          reason: verdict.reason ?? 'verification_failed',
        });
      }

      if (signingOrders.has(key)) {
        return res.status(409).json({ error: 'order_already_signed' });
      }
      signingOrders.add(key);
      try {
        const claimResult = await claimEppOrderForSigning(
          pending.suggestedNodeId,
          assertion.challengeId,
          callerUid,
        );
        if (claimResult !== 'claimed') {
          await auditEppEventNonBlocking(
            req,
            'eppFlow.sign-order-conflict',
            { projectId, orderId, claimResult },
            projectId,
            'eppFlow.signOrder.audit-conflict',
          );
          return res.status(409).json({ error: 'order_already_signed' });
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
          tenantId,
          createdBy: callerUid,
        };
        const signedAt = new Date().toISOString();
        const signerIdentity = await readSignerIdentity(callerUid);

        let signed: Awaited<ReturnType<typeof persistSignedNode>>;
        try {
          signed = await persistSignedNode(
            {
              signature: {
                orderId,
                signerUid: callerUid,
                signerRut: signerIdentity.signerRut,
                signedAt,
                challengeId: assertion.challengeId,
              },
              draftTotalClp: pending.draft.totalClp,
              suggestedNodeId: pending.suggestedNodeId,
            },
            deps,
            { projectId },
          );
        } catch (err) {
          try {
            await releaseEppSigningClaim(pending.suggestedNodeId, assertion.challengeId);
          } catch (releaseErr) {
            logger.error?.('eppFlow.signing_claim_release_failed', releaseErr);
            captureRouteError(releaseErr, 'eppFlow.signOrder.releaseClaim');
          }
          throw err;
        }

        pending.status = 'signed';
        pending.signedAt = signedAt;
        pending.signerUid = callerUid;
        pending.signerRut = signerIdentity.signerRut;
        pending.signerName = signerIdentity.signerName;
        pending.signedNodeId = signed.nodeId;
        pendingOrders.set(key, pending);

        try {
          await markEppOrderSigned(
            pending.suggestedNodeId,
            assertion.challengeId,
            signed.nodeId,
            signedAt,
            callerUid,
          );
        } catch (markErr) {
          // The signed node is already authoritative. Keep the user-facing
          // success and surface the marker repair failure operationally.
          logger.error?.('eppFlow.signed_marker_failed', markErr);
          captureRouteError(markErr, 'eppFlow.signOrder.markSigned');
        }

        await auditEppEventNonBlocking(
          req,
          'eppFlow.sign-order',
          { projectId, orderId },
          projectId,
          'eppFlow.signOrder.audit',
        );
        return res.json({
          ok: signed.ok,
          signedNodeId: signed.nodeId,
          edgeId: signed.edge?.id ?? null,
          order: pending,
        });
      } finally {
        signingOrders.delete(key);
      }
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
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (!callerCanSignEpp(req)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }
    // Cross-tenant guard (#700/#707/#708): the authoritative tenant is the verified
    // token claim. A missing claim → 403 (no_tenant_binding); a forged query
    // ?tenantId=other → 403 (tenant_mismatch). Replaces the old trust-the-query path.
    const tenantId = callerTenantOr403(req, res, req.query.tenantId);
    if (tenantId === null) return undefined;

    try {
      const key = pendingKey(projectId, orderId);
      const cached = pendingOrders.get(key);
      const persistedSigned =
        cached?.status === 'signed'
          ? undefined
          : await readPersistedSignedOrder(projectId, orderId);
      const order = cached?.status === 'signed' ? cached : (persistedSigned ?? cached);
      if (!order) {
        return res.status(404).json({ error: 'order_not_found' });
      }
      if (!order.tenantId || order.tenantId !== tenantId) {
        return res.status(403).json({ error: 'tenant_mismatch' });
      }
      if (order.status !== 'signed') {
        return res.status(409).json({ error: 'order_not_signed' });
      }

      // Renderizamos PDF.
      const pdf = await renderPurchaseOrderPdf({
        orderId,
        companyName: 'Empresa', // MVP: idealmente lookup en projects/{projectId}
        signerUid: order.signerUid,
        signerRut: order.signerRut,
        signerName: order.signerName,
        signedAt: order.signedAt,
        lines: order.draft.lines,
        totalClp: order.draft.totalClp,
        deliveryWeekHint: order.draft.deliveryWeekHint,
        notes: order.draft.notes,
      });
      const pdfSha256Hex = createHash('sha256').update(pdf).digest('hex');

      // Persistimos el nodo PDF enlazado al nodo firmado autoritativo.
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
      const signedNodeId = order.signedNodeId ?? '';
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
  signingOrders.clear();
}

export default router;
