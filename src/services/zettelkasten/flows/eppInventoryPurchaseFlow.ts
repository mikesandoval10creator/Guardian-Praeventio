// Praeventio Guard — Bloque 4.2: Inspeccion EPP -> Inventario -> Orden de Compra.
//
// Cierra: "Plan Bloque 4.2 — segunda demostracion del poder ZK" (founder).
//
// Cuando un trabajador completa una inspeccion EPP en faena (mobile-first
// item-by-item: ok / warning / failed), este orquestador detecta los items
// failed (vencidos o danados), ajusta el inventario y -si el stock cae bajo
// el umbral de reorden- emite una sugerencia de orden de compra. El admin
// debe firmar la OC con WebAuthn (purpose: 'claim-signing') y el resultado
// se exporta como PDF descargable. NO auto-enviamos al proveedor — cumple
// la directiva 4-directivas: "Praeventio NUNCA hace push a APIs externas;
// genera el documento, la empresa lo firma + entrega".
//
// Cadena ZK (7 nodos):
//   epp-inspection-event
//     -> epp-item-failed (1..N por inspeccion)
//        -> inventory-adjusted (1 por failed item, descuenta stock)
//           -> inventory-below-threshold (opcional, si cruza umbral)
//              -> purchase-order-suggested (1 por trigger, agrupa items)
//                 -> purchase-order-signed (cuando admin firma)
//                    -> purchase-order-pdf-generated (export final)
//
// Cada paso es deterministico dado el input. La firma biometrica del admin
// es un side-effect externo (route layer): cuando la route llama
// `createPurchaseOrderSignedNode` ya se asume que el WebAuthn /verify
// devolvio { verified: true }.
//
// Diseno:
//   - Las NodeFactory functions son puras: input -> RiskNodePayload, sin IO.
//     Mismos inputs -> mismo nodeIdFor() -> mismo id Firestore (idempotente).
//   - El orquestador `onEppInspectionCompleted(...)` toma una inspeccion
//     completa, produce la lista de payloads + edges, y los persiste via
//     writeNodes + createEdge inyectados como deps. Tests inyectan fakes.
//   - El `type` discriminator de RiskNodePayload usa 'safety-learning' (es
//     el unico no-Bernoulli admitido por VALID_TYPES del route
//     /api/zettelkasten/nodes). El sub-tipo de la cadena vive en
//     `metadata.sourceType` (ej: 'epp-inspection-event'). Mismo patron que
//     usa `objectLifecycleOrchestrator` y el flujo Bloque 4.1 horometro.
//   - El sourceType.size es 7 — el mismo orden que la cadena.
//
// ADR 0019: Google ecosystem. No introducimos backend externo; Firestore via
// writeNodes (que usa Auth + admin SDK del lado servidor).

import type { RiskNodePayload } from '../types.js';
import type {
  WriteContext,
  WriteResult,
} from '../persistence/writeNode.js';
import type { EdgeStore, EdgeType, ZkEdge } from '../edges.js';
import { buildEdge } from '../edges.js';
import type {
  PurchaseOrderDraft,
  PurchaseOrderLine,
} from '../../financialAnalytics/purchaseOrderSuggester.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Sub-tipos de la cadena. Viven en `metadata.sourceType` porque el campo
 * `type: RiskNodeType` esta acotado a BernoulliNodeType | 'safety-learning'.
 */
export type EppFlowSourceType =
  | 'epp-inspection-event'
  | 'epp-item-failed'
  | 'inventory-adjusted'
  | 'inventory-below-threshold'
  | 'purchase-order-suggested'
  | 'purchase-order-signed'
  | 'purchase-order-pdf-generated';

/** Estado puntual de un EPP en una inspeccion. */
export type EppItemStatus = 'ok' | 'warning' | 'failed';

/** Razon principal del fallo (acota la descripcion del nodo). */
export type EppItemFailureReason =
  | 'expired' // vencido por vida util
  | 'damaged' // dano fisico observable
  | 'missing' // no se encuentra
  | 'contaminated' // contaminacion irrecuperable
  | 'other';

export interface InspectedEppItem {
  /** Identificador estable del item EPP (matches catalogo eppBackend). */
  itemId: string;
  /** Tipo de EPP (mapea a kind de InventoryItem). */
  kind: string;
  /** Estado evaluado por el trabajador. */
  status: EppItemStatus;
  /** Razon obligatoria si status === 'failed'. */
  failureReason?: EppItemFailureReason;
  /** Worker UID que reporta. */
  reportedByUid: string;
  /** Notas libres opcionales. */
  notes?: string;
}

export interface EppInspectionInput {
  /** ID de la inspeccion (matches doc id Firestore). */
  inspectionId: string;
  /** Site/faena/zona donde se hace la inspeccion. */
  siteId?: string;
  /** Trabajador inspeccionado (no necesariamente == reportedByUid). */
  workerUid: string;
  /** Items inspeccionados. */
  items: InspectedEppItem[];
  /** ISO timestamp. */
  inspectedAt: string;
}

/**
 * Snapshot del estado de inventario para un kind antes/despues del ajuste.
 * Lo provee el caller (no lo calculamos aqui — separamos el dominio).
 */
export interface InventorySnapshot {
  kind: string;
  /** Stock previo al ajuste. */
  previousStock: number;
  /** Stock luego del descuento por items failed. */
  newStock: number;
  /** Umbral de reorden configurado. */
  reorderThreshold: number;
}

export interface EppFlowDeps {
  /**
   * Persiste un batch de nodos. En produccion = `writeNodes` del modulo
   * persistence. En tests = fake que captura el array.
   */
  writeNodes: (
    nodes: RiskNodePayload[],
    ctx: WriteContext,
  ) => Promise<WriteResult>;
  /**
   * Store de edges (DI from edges.ts). En produccion = adapter Firestore.
   * En tests = in-memory map.
   */
  edgeStore: EdgeStore;
  /** Tenant scope para los edges (== Firebase Auth claim). */
  tenantId: string;
  /** UID del actor que dispara el flow (worker que inspecciona). */
  createdBy: string;
  /**
   * Reloj inyectable para tests deterministas. Devuelve ISO-8601.
   * Default: `new Date().toISOString()`.
   */
  now?: () => string;
}

/** Resultado completo de un run del orquestador. */
export interface FlowRunResult {
  /** Nodos generados y enviados a writeNodes (en orden de la cadena). */
  nodes: RiskNodePayload[];
  /** IDs deterministicos calculados por writeNodes (alineado con nodes). */
  nodeIds: string[];
  /** Edges creados en el grafo (cadena temporal). */
  edges: ZkEdge[];
  /** Si se sugirio una OC, su draft (para que el caller la persista). */
  suggestedOrder?: PurchaseOrderDraft;
  /** Notas de diagnostico (kind sin proveedor, inspeccion sin failed, etc.). */
  notes: string[];
  /** True cuando el writeNodes fue OK (o queued offline). */
  ok: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Internal — id local determinista para usar como connection antes de que
// writeNodes nos devuelva los nodeIds reales. Evita romper el contrato puro
// de las factory functions (que NO deben tocar globalThis.crypto.subtle).
// ────────────────────────────────────────────────────────────────────────

const SAFETY_LEARNING_TYPE: RiskNodePayload['type'] = 'safety-learning';

function localRef(sourceType: EppFlowSourceType, key: string): string {
  // Solo se usa en `connections[]` para enlazar dentro del batch. El edge
  // real se crea con los nodeIds que devuelve writeNodes (mas abajo).
  return `${sourceType}:${key}`;
}

function nowIso(deps: EppFlowDeps): string {
  return (deps.now ?? (() => new Date().toISOString()))();
}

// ────────────────────────────────────────────────────────────────────────
// NodeFactory functions — puras, sin IO.
// ────────────────────────────────────────────────────────────────────────

export function createEppInspectionNode(
  inspection: EppInspectionInput,
): RiskNodePayload {
  const failedCount = inspection.items.filter((i) => i.status === 'failed').length;
  const warningCount = inspection.items.filter((i) => i.status === 'warning').length;
  const total = inspection.items.length;
  const severity: RiskNodePayload['severity'] = failedCount > 0
    ? 'high'
    : warningCount > 0
      ? 'medium'
      : 'info';
  return {
    title: `Inspeccion EPP ${inspection.inspectionId}`,
    description:
      `Inspeccion EPP completada para trabajador ${inspection.workerUid}. ` +
      `${total} items revisados — ${failedCount} failed, ${warningCount} warning. ` +
      `Si hay items failed, se gatilla ajuste de inventario + posible OC.`,
    type: SAFETY_LEARNING_TYPE,
    severity,
    metadata: {
      sourceType: 'epp-inspection-event',
      inspectionId: inspection.inspectionId,
      workerUid: inspection.workerUid,
      siteId: inspection.siteId ?? '',
      itemCount: total,
      failedCount,
      warningCount,
      inspectedAt: inspection.inspectedAt,
    },
    connections: [
      `worker:${inspection.workerUid}`,
      ...(inspection.siteId ? [`site:${inspection.siteId}`] : []),
    ],
    references: ['DS-594', 'NIOSH-42-CFR-84'],
  };
}

export function createEppItemFailedNode(
  inspection: EppInspectionInput,
  failedItem: InspectedEppItem,
): RiskNodePayload {
  const reason = failedItem.failureReason ?? 'other';
  const severity: RiskNodePayload['severity'] = reason === 'damaged' || reason === 'contaminated'
    ? 'high'
    : reason === 'expired'
      ? 'medium'
      : 'medium';
  return {
    title: `EPP fallido: ${failedItem.kind} (${failedItem.itemId})`,
    description:
      `Item EPP ${failedItem.itemId} (${failedItem.kind}) reportado como ` +
      `failed en inspeccion ${inspection.inspectionId}. Razon: ${reason}. ` +
      (failedItem.notes ? `Notas: ${failedItem.notes}. ` : '') +
      `Trabajador ${inspection.workerUid} debe ser reasignado con repuesto.`,
    type: SAFETY_LEARNING_TYPE,
    severity,
    metadata: {
      sourceType: 'epp-item-failed',
      inspectionId: inspection.inspectionId,
      itemId: failedItem.itemId,
      kind: failedItem.kind,
      reason,
      workerUid: inspection.workerUid,
      reportedByUid: failedItem.reportedByUid,
      reportedAt: inspection.inspectedAt,
    },
    connections: [
      localRef('epp-inspection-event', inspection.inspectionId),
      `epp-item:${failedItem.itemId}`,
      `worker:${inspection.workerUid}`,
    ],
    references: ['NIOSH-42-CFR-84', 'DS-594'],
  };
}

export function createInventoryAdjustedNode(
  inspection: EppInspectionInput,
  failedItem: InspectedEppItem,
  snapshot: InventorySnapshot,
  generatedAt: string,
): RiskNodePayload {
  const delta = snapshot.previousStock - snapshot.newStock;
  return {
    title: `Ajuste inventario: ${snapshot.kind} (-${delta})`,
    description:
      `Inventario de "${snapshot.kind}" ajustado por baja de item failed. ` +
      `Stock previo ${snapshot.previousStock} -> nuevo ${snapshot.newStock}. ` +
      `Inspeccion origen: ${inspection.inspectionId}. ` +
      `Umbral reorden: ${snapshot.reorderThreshold}.`,
    type: SAFETY_LEARNING_TYPE,
    severity: snapshot.newStock <= 0 ? 'high' : 'low',
    metadata: {
      sourceType: 'inventory-adjusted',
      inspectionId: inspection.inspectionId,
      itemId: failedItem.itemId,
      kind: snapshot.kind,
      previousStock: snapshot.previousStock,
      newStock: snapshot.newStock,
      delta,
      reorderThreshold: snapshot.reorderThreshold,
      adjustedAt: generatedAt,
    },
    connections: [
      localRef('epp-item-failed', `${inspection.inspectionId}:${failedItem.itemId}`),
      `inventory:${snapshot.kind}`,
    ],
    references: ['internal'],
  };
}

export function createInventoryBelowThresholdNode(
  inspection: EppInspectionInput,
  snapshot: InventorySnapshot,
  generatedAt: string,
): RiskNodePayload {
  const deficit = Math.max(0, snapshot.reorderThreshold - snapshot.newStock);
  return {
    title: `Stock bajo umbral: ${snapshot.kind}`,
    description:
      `Stock de "${snapshot.kind}" (${snapshot.newStock}) cayo por debajo ` +
      `del umbral de reorden (${snapshot.reorderThreshold}). ` +
      `Deficit: ${deficit}. Se sugiere generar orden de compra. ` +
      `Inspeccion origen: ${inspection.inspectionId}.`,
    type: SAFETY_LEARNING_TYPE,
    severity: snapshot.newStock <= 0 ? 'critical' : 'high',
    metadata: {
      sourceType: 'inventory-below-threshold',
      inspectionId: inspection.inspectionId,
      kind: snapshot.kind,
      currentStock: snapshot.newStock,
      reorderThreshold: snapshot.reorderThreshold,
      deficit,
      crossedAt: generatedAt,
    },
    connections: [
      localRef('inventory-adjusted', `${inspection.inspectionId}:${snapshot.kind}`),
      `inventory:${snapshot.kind}`,
    ],
    references: ['internal'],
  };
}

export function createPurchaseOrderSuggestedNode(
  inspection: EppInspectionInput,
  orderId: string,
  draft: PurchaseOrderDraft,
  generatedAt: string,
): RiskNodePayload {
  const lineCount = draft.lines.length;
  const hasEmergency = draft.lines.some((l) => l.urgency === 'emergency');
  return {
    title: `OC sugerida ${orderId} (${lineCount} items)`,
    description:
      `Orden de compra sugerida automaticamente por trigger Bloque 4.2. ` +
      `${lineCount} lineas, total CLP ${draft.totalClp}, ` +
      `entrega estimada semana ${draft.deliveryWeekHint}. ` +
      `Pendiente de firma del admin (WebAuthn 'claim-signing'). ` +
      `Inspeccion origen: ${inspection.inspectionId}.`,
    type: SAFETY_LEARNING_TYPE,
    severity: hasEmergency ? 'critical' : 'medium',
    metadata: {
      sourceType: 'purchase-order-suggested',
      orderId,
      inspectionId: inspection.inspectionId,
      lineCount,
      totalClp: draft.totalClp,
      deliveryWeekHint: draft.deliveryWeekHint,
      hasEmergency,
      suggestedAt: generatedAt,
      status: 'pending_signature',
    },
    connections: [
      localRef('inventory-below-threshold', inspection.inspectionId),
      `purchase-order:${orderId}`,
    ],
    references: ['internal'],
  };
}

export interface PurchaseOrderSignatureInput {
  orderId: string;
  /** UID del admin que firmo. */
  signerUid: string;
  /** RUT (opcional, telemetria + PDF). */
  signerRut?: string;
  /** ISO de la firma. */
  signedAt: string;
  /**
   * `challengeId` consumido en /api/auth/webauthn/verify. NO la firma
   * cruda — basta con el id para auditoria sin guardar bytes sensibles.
   */
  challengeId: string;
}

export function createPurchaseOrderSignedNode(
  signature: PurchaseOrderSignatureInput,
  draftTotalClp: number,
): RiskNodePayload {
  return {
    title: `OC firmada ${signature.orderId}`,
    description:
      `Orden de compra ${signature.orderId} firmada por admin ` +
      `${signature.signerUid} via WebAuthn (claim-signing). ` +
      `ChallengeId consumido: ${signature.challengeId}. ` +
      `La empresa puede ahora descargar el PDF y enviarlo manualmente ` +
      `al proveedor — Praeventio NO empuja al proveedor automaticamente.`,
    type: SAFETY_LEARNING_TYPE,
    severity: 'info',
    metadata: {
      sourceType: 'purchase-order-signed',
      orderId: signature.orderId,
      signerUid: signature.signerUid,
      signerRut: signature.signerRut ?? '',
      signedAt: signature.signedAt,
      challengeId: signature.challengeId,
      totalClp: draftTotalClp,
      status: 'signed',
    },
    connections: [
      `purchase-order:${signature.orderId}`,
      localRef('purchase-order-suggested', signature.orderId),
    ],
    references: ['Ley-19799'],
  };
}

export interface PurchaseOrderPdfMeta {
  orderId: string;
  /** Bytes del PDF renderizado (length, no contenido). */
  pdfBytesLength: number;
  /** SHA-256 hex del PDF (provee el caller). */
  pdfSha256Hex: string;
  /** ISO timestamp de generacion. */
  generatedAt: string;
}

export function createPurchaseOrderPdfNode(
  meta: PurchaseOrderPdfMeta,
): RiskNodePayload {
  return {
    title: `PDF OC ${meta.orderId}`,
    description:
      `PDF de la orden de compra ${meta.orderId} generado para descarga. ` +
      `Tamano: ${meta.pdfBytesLength} bytes. SHA-256: ${meta.pdfSha256Hex.slice(0, 16)}... ` +
      `Este documento NO fue enviado automaticamente al proveedor — ` +
      `la empresa debe descargar, revisar y enviar manualmente.`,
    type: SAFETY_LEARNING_TYPE,
    severity: 'info',
    metadata: {
      sourceType: 'purchase-order-pdf-generated',
      orderId: meta.orderId,
      pdfBytesLength: meta.pdfBytesLength,
      pdfSha256Hex: meta.pdfSha256Hex,
      generatedAt: meta.generatedAt,
      pushedToSupplier: false, // <<< nunca true: directiva no-push.
    },
    connections: [
      `purchase-order:${meta.orderId}`,
      localRef('purchase-order-signed', meta.orderId),
    ],
    references: ['internal'],
  };
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator — onEppInspectionCompleted
// ────────────────────────────────────────────────────────────────────────

/**
 * Resuelve el snapshot de inventario para los kinds afectados. El caller
 * (route layer) inyecta esta funcion porque Firestore vive afuera del
 * orquestador puro.
 *
 * El contrato: dado el set de items failed agrupados por kind, devolver
 * un snapshot por cada kind (estado previo, estado nuevo, umbral).
 */
export type ResolveInventoryFn = (input: {
  inspection: EppInspectionInput;
  failedByKind: Map<string, InspectedEppItem[]>;
}) => Promise<InventorySnapshot[]>;

/**
 * Suggester injectable — toma snapshots que cayeron bajo el umbral y
 * devuelve el draft de OC. Default = caller usa `suggestPurchaseOrder` del
 * modulo `services/financialAnalytics/purchaseOrderSuggester.ts`.
 */
export type SuggestPurchaseOrderFn = (input: {
  snapshots: InventorySnapshot[];
  inspection: EppInspectionInput;
}) => Promise<PurchaseOrderDraft | null>;

export interface InspectionCompletedOptions {
  resolveInventory: ResolveInventoryFn;
  suggestOrder: SuggestPurchaseOrderFn;
  /** projectId para WriteContext + edges. */
  projectId: string;
  /**
   * Override del ID de la OC sugerida (idempotencia desde la route).
   * Si se omite, usamos `oc-{inspectionId}` para que reintentos colapsen.
   */
  orderId?: string;
}

export async function onEppInspectionCompleted(
  inspection: EppInspectionInput,
  deps: EppFlowDeps,
  opts: InspectionCompletedOptions,
): Promise<FlowRunResult> {
  const notes: string[] = [];
  const nodes: RiskNodePayload[] = [];
  // edge specs en el orden temporal (fromIdx, toIdx) — resolvemos a edges
  // reales cuando tengamos los nodeIds que devuelve writeNodes.
  const edgeSpecs: Array<{ from: number; to: number; type: EdgeType }> = [];

  // 1) Inspeccion root.
  const inspectionNode = createEppInspectionNode(inspection);
  nodes.push(inspectionNode);
  const inspectionIdx = 0;

  // 2) Por cada failed item, emitimos epp-item-failed.
  const failedItems = inspection.items.filter((i) => i.status === 'failed');
  if (failedItems.length === 0) {
    notes.push('No failed items in inspection — chain stops at inspection root.');
    const written = await deps.writeNodes(nodes, { projectId: opts.projectId });
    return {
      nodes,
      nodeIds: written.ids ?? [],
      edges: [],
      notes,
      ok: written.ok,
    };
  }

  const failedIdxByItemId = new Map<string, number>();
  for (const item of failedItems) {
    const failedNode = createEppItemFailedNode(inspection, item);
    const idx = nodes.length;
    nodes.push(failedNode);
    failedIdxByItemId.set(item.itemId, idx);
    edgeSpecs.push({ from: inspectionIdx, to: idx, type: 'causes' });
  }

  // 3) Snapshot de inventario por kind (callback Firestore).
  const failedByKind = new Map<string, InspectedEppItem[]>();
  for (const item of failedItems) {
    const list = failedByKind.get(item.kind) ?? [];
    list.push(item);
    failedByKind.set(item.kind, list);
  }
  const snapshots = await opts.resolveInventory({ inspection, failedByKind });

  const generatedAt = nowIso(deps);
  const belowThresholdSnapshots: InventorySnapshot[] = [];
  const adjustedIdxByKind = new Map<string, number>();
  const belowIdxByKind = new Map<string, number>();

  // 4) Para cada snapshot creamos inventory-adjusted, y si esta bajo umbral
  //    tambien inventory-below-threshold.
  for (const snap of snapshots) {
    const adjustedNode = createInventoryAdjustedNode(
      inspection,
      // Pickeamos uno representativo del kind para mantener el link.
      (failedByKind.get(snap.kind) ?? failedItems)[0],
      snap,
      generatedAt,
    );
    const adjIdx = nodes.length;
    nodes.push(adjustedNode);
    adjustedIdxByKind.set(snap.kind, adjIdx);

    // Edges: cada failed item de este kind apunta a adjusted via 'expires_into'.
    for (const item of failedByKind.get(snap.kind) ?? []) {
      const fromIdx = failedIdxByItemId.get(item.itemId);
      if (fromIdx !== undefined) {
        edgeSpecs.push({ from: fromIdx, to: adjIdx, type: 'expires_into' });
      }
    }

    if (snap.newStock <= snap.reorderThreshold) {
      const belowNode = createInventoryBelowThresholdNode(
        inspection,
        snap,
        generatedAt,
      );
      const belowIdx = nodes.length;
      nodes.push(belowNode);
      belowIdxByKind.set(snap.kind, belowIdx);
      belowThresholdSnapshots.push(snap);
      edgeSpecs.push({ from: adjIdx, to: belowIdx, type: 'causes' });
    }
  }

  // 5) Si hay snapshots bajo umbral, sugerimos una OC unica que las agrupa.
  let suggestedOrder: PurchaseOrderDraft | undefined;
  if (belowThresholdSnapshots.length > 0) {
    const draft = await opts.suggestOrder({
      snapshots: belowThresholdSnapshots,
      inspection,
    });
    if (draft && draft.lines.length > 0) {
      suggestedOrder = draft;
      const orderId = opts.orderId ?? `oc-${inspection.inspectionId}`;
      const ocNode = createPurchaseOrderSuggestedNode(
        inspection,
        orderId,
        draft,
        generatedAt,
      );
      const ocIdx = nodes.length;
      nodes.push(ocNode);
      // Cada below-threshold del kind incluido en alguna linea apunta a la OC.
      const kindsInLines = new Set(draft.lines.map((l) => l.kind));
      for (const [kind, idx] of belowIdxByKind.entries()) {
        if (kindsInLines.has(kind)) {
          edgeSpecs.push({ from: idx, to: ocIdx, type: 'expires_into' });
        }
      }
    } else {
      notes.push('No supplier matched for below-threshold kinds — manual review needed.');
    }
  }

  // 6) Persistencia batch + edges.
  const written = await deps.writeNodes(nodes, { projectId: opts.projectId });
  const ids = written.ids ?? [];
  const edges: ZkEdge[] = [];
  if (ids.length === nodes.length) {
    for (const spec of edgeSpecs) {
      const fromId = ids[spec.from];
      const toId = ids[spec.to];
      if (!fromId || !toId || fromId === toId) continue;
      const edge = buildEdge({
        fromNodeId: fromId,
        toNodeId: toId,
        type: spec.type,
        tenantId: deps.tenantId,
        createdBy: deps.createdBy,
        projectId: opts.projectId,
        createdAt: generatedAt,
      });
      await deps.edgeStore.saveEdge(edge);
      edges.push(edge);
    }
  } else if (written.ok) {
    notes.push(
      `writeNodes ok=${written.ok} but ids.length=${ids.length} != nodes.length=${nodes.length}; ` +
        `edges skipped (offline queue?).`,
    );
  }

  return {
    nodes,
    nodeIds: ids,
    edges,
    suggestedOrder,
    notes,
    ok: written.ok,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Sign + PDF — invocados por la route cuando admin firma o descarga PDF.
// Estos son helpers livianos: producen el RiskNodePayload + persistencia.
// ────────────────────────────────────────────────────────────────────────

export interface SignOrderInput {
  signature: PurchaseOrderSignatureInput;
  draftTotalClp: number;
  /**
   * nodeId del 'purchase-order-suggested' (para crear edge 'documented_by').
   * La route lo conoce porque lo guardamos al sugerir.
   */
  suggestedNodeId: string;
}

export async function persistSignedNode(
  input: SignOrderInput,
  deps: EppFlowDeps,
  opts: { projectId: string },
): Promise<{ nodeId: string; edge: ZkEdge | null; ok: boolean }> {
  const node = createPurchaseOrderSignedNode(input.signature, input.draftTotalClp);
  const written = await deps.writeNodes([node], { projectId: opts.projectId });
  const nodeId = written.ids?.[0] ?? '';
  let edge: ZkEdge | null = null;
  if (nodeId && nodeId !== input.suggestedNodeId) {
    const built = buildEdge({
      fromNodeId: input.suggestedNodeId,
      toNodeId: nodeId,
      type: 'documented_by',
      tenantId: deps.tenantId,
      createdBy: deps.createdBy,
      projectId: opts.projectId,
      createdAt: input.signature.signedAt,
    });
    await deps.edgeStore.saveEdge(built);
    edge = built;
  }
  return { nodeId, edge, ok: written.ok };
}

export interface GeneratePdfInput {
  meta: PurchaseOrderPdfMeta;
  /** nodeId del 'purchase-order-signed' (link al PDF). */
  signedNodeId: string;
}

export async function persistPdfNode(
  input: GeneratePdfInput,
  deps: EppFlowDeps,
  opts: { projectId: string },
): Promise<{ nodeId: string; edge: ZkEdge | null; ok: boolean }> {
  const node = createPurchaseOrderPdfNode(input.meta);
  const written = await deps.writeNodes([node], { projectId: opts.projectId });
  const nodeId = written.ids?.[0] ?? '';
  let edge: ZkEdge | null = null;
  if (nodeId && nodeId !== input.signedNodeId) {
    const built = buildEdge({
      fromNodeId: input.signedNodeId,
      toNodeId: nodeId,
      type: 'generated_by',
      tenantId: deps.tenantId,
      createdBy: deps.createdBy,
      projectId: opts.projectId,
      createdAt: input.meta.generatedAt,
    });
    await deps.edgeStore.saveEdge(built);
    edge = built;
  }
  return { nodeId, edge, ok: written.ok };
}

// ────────────────────────────────────────────────────────────────────────
// PDF renderer — usa pdfkit como en diatPdfRenderer.ts. Buffer in/out.
// ────────────────────────────────────────────────────────────────────────

export interface PurchaseOrderPdfInput {
  orderId: string;
  companyName: string;
  companyRut?: string;
  signerName?: string;
  signerRut?: string;
  signerUid?: string;
  signedAt?: string;
  lines: PurchaseOrderLine[];
  totalClp: number;
  deliveryWeekHint: number;
  notes?: string[];
  /** Project (faena) name para el header. */
  projectName?: string;
  /** Verify URL opcional. */
  verifyUrl?: string;
}

/**
 * Renderiza el PDF de la orden de compra. Reusa el patron de
 * `services/suseso/diatPdfRenderer.ts` (pdfkit Buffer in/out, no IO).
 *
 * Important: el footer del PDF lleva el disclaimer
 * "Praeventio NO envia al proveedor" — refuerza la directiva no-push.
 */
export async function renderPurchaseOrderPdf(
  input: PurchaseOrderPdfInput,
): Promise<Buffer> {
  // Lazy import — pdfkit es pesado, solo lo cargamos cuando hay
  // generacion real (test puede mockear esta funcion sin pagar el costo).
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(16).text('ORDEN DE COMPRA — EPP', { align: 'center' });
      doc.moveDown(0.2);
      doc
        .fontSize(9)
        .text('Praeventio Guard — Bloque 4.2 (auto-sugerencia + firma admin)', {
          align: 'center',
        });
      doc.moveDown(0.3);
      doc.fontSize(11).text(`OC: ${input.orderId}`, { align: 'center' });
      if (input.projectName) {
        doc.fontSize(9).text(`Faena: ${input.projectName}`, { align: 'center' });
      }
      doc.moveDown(0.8);

      // Empresa
      doc.fontSize(11).fillColor('#003366').text('1. EMPRESA', { underline: true });
      doc.fillColor('black').fontSize(9);
      doc.text(`Razon social: ${input.companyName}`, { indent: 10 });
      if (input.companyRut) doc.text(`RUT: ${input.companyRut}`, { indent: 10 });
      doc.moveDown(0.4);

      // Lineas
      doc.fontSize(11).fillColor('#003366').text('2. LINEAS DE COMPRA', { underline: true });
      doc.fillColor('black').fontSize(9);
      input.lines.forEach((line, i) => {
        const subtotal = line.quantity * line.estimatedUnitCostClp;
        doc.text(
          `${i + 1}. ${line.kind} — Qty ${line.quantity} x CLP ` +
            `${line.estimatedUnitCostClp} = CLP ${subtotal} ` +
            `[urgencia: ${line.urgency}, proveedor: ${line.supplierId}]`,
          { indent: 10 },
        );
      });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`TOTAL: CLP ${input.totalClp}`, { indent: 10, underline: true });
      doc.fontSize(9).text(
        `Entrega estimada: semana ${input.deliveryWeekHint}.`,
        { indent: 10 },
      );
      doc.moveDown(0.4);

      // Notas
      if (input.notes && input.notes.length > 0) {
        doc.fontSize(11).fillColor('#003366').text('3. NOTAS', { underline: true });
        doc.fillColor('black').fontSize(9);
        input.notes.forEach((n) => doc.text(`- ${n}`, { indent: 10 }));
        doc.moveDown(0.4);
      }

      // Firma
      doc.fontSize(11).fillColor('#003366').text('4. FIRMA ADMIN', { underline: true });
      doc.fillColor('black').fontSize(9);
      if (input.signerUid) {
        doc.text(`Firmante UID: ${input.signerUid}`, { indent: 10 });
        if (input.signerName) doc.text(`Nombre: ${input.signerName}`, { indent: 10 });
        if (input.signerRut) doc.text(`RUT: ${input.signerRut}`, { indent: 10 });
        if (input.signedAt) doc.text(`Fecha firma: ${input.signedAt}`, { indent: 10 });
        doc.text('Mecanismo: WebAuthn claim-signing (Ley 19.799 art. 3).', {
          indent: 10,
        });
      } else {
        doc
          .fillColor('#aa0000')
          .text('PENDIENTE DE FIRMA — este documento no es valido aun.', {
            indent: 10,
          })
          .fillColor('black');
      }
      doc.moveDown(0.6);

      // Verify URL
      if (input.verifyUrl) {
        doc.fontSize(8).text(`Verificacion publica: ${input.verifyUrl}`, {
          align: 'center',
        });
      }

      // Disclaimer (directiva no-push)
      doc.moveDown(0.4);
      doc
        .fontSize(7)
        .fillColor('#555555')
        .text(
          'Documento generado por Praeventio Guard. Praeventio NO envia esta ' +
            'orden de compra al proveedor automaticamente — la empresa debe ' +
            'descargar, revisar y enviar el documento por su canal habitual ' +
            '(email, portal del proveedor, etc.). El PDF es prueba de ' +
            'autorizacion firmada por el admin responsable.',
          { align: 'center' },
        )
        .fillColor('black');

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ────────────────────────────────────────────────────────────────────────
// Test helpers — re-exportamos los factory + el orquestador. Asi los
// tests pueden ejercer cada paso aisladamente o end-to-end.
// ────────────────────────────────────────────────────────────────────────

export const __testOnly = {
  localRef,
  SAFETY_LEARNING_TYPE,
};
