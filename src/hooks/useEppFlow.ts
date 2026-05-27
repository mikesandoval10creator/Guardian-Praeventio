// Praeventio Guard — Bloque 4.2: useEppFlow client hook.
//
// Cliente del router `src/server/routes/eppFlow.ts`. Cuatro mutators
// minimales: submitInspection, listPendingOrders, signOrder, downloadPdf.
//
// Patron alineado con `useReadReceipts.ts`: token Bearer via
// `auth.currentUser.getIdToken()`, errores con `http_${status}`,
// idempotency-key-ready.

import { auth } from '../services/firebase';
import type {
  EppInspectionInput,
  EppFlowSourceType,
} from '../services/zettelkasten/flows/eppInventoryPurchaseFlow';
import type {
  InventoryItem,
  SupplierCatalogEntry,
  PurchaseOrderDraft,
} from '../services/financialAnalytics/purchaseOrderSuggester';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ────────────────────────────────────────────────────────────────────────
// 1. submitInspection
// ────────────────────────────────────────────────────────────────────────

export interface SubmitInspectionInput {
  inspection: EppInspectionInput;
  inventoryByKind: Record<string, InventoryItem>;
  supplierCatalog: SupplierCatalogEntry[];
  leadTimeDaysBySupplier: Record<string, number>;
  tenantId: string;
  orderId?: string;
}

export interface SubmitInspectionResponse {
  ok: boolean;
  nodeCount: number;
  edgeCount: number;
  suggestedOrder: PurchaseOrderDraft | null;
  notes: string[];
}

export async function submitEppInspection(
  projectId: string,
  input: SubmitInspectionInput,
): Promise<SubmitInspectionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/epp-flow/inspection`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SubmitInspectionResponse>(res);
}

// ────────────────────────────────────────────────────────────────────────
// 2. listPendingOrders
// ────────────────────────────────────────────────────────────────────────

export interface PendingOrder {
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

export interface ListPendingOrdersResponse {
  orders: PendingOrder[];
}

export async function listPendingEppOrders(
  projectId: string,
): Promise<ListPendingOrdersResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/epp-flow/pending-orders`,
    { method: 'GET' },
  );
  return json<ListPendingOrdersResponse>(res);
}

// ────────────────────────────────────────────────────────────────────────
// 3. signOrder — admin firma OC. La firma WebAuthn 'claim-signing' DEBE
//    ejecutarse antes (en el modal) y el resultado se valida con
//    /api/auth/webauthn/verify. El `challengeId` aqui es el mismo que
//    el cliente acaba de consumir.
// ────────────────────────────────────────────────────────────────────────

export interface SignOrderInput {
  challengeId: string;
  signerUid: string;
  signerRut?: string;
  signerName?: string;
  signedAt: string;
  suggestedNodeId: string;
  draftTotalClp: number;
  tenantId: string;
}

export interface SignOrderResponse {
  ok: boolean;
  signedNodeId: string;
  edgeId: string | null;
  order: PendingOrder;
}

export async function signEppOrder(
  projectId: string,
  orderId: string,
  input: SignOrderInput,
): Promise<SignOrderResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/epp-flow/sign-order/${encodeURIComponent(orderId)}`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SignOrderResponse>(res);
}

// ────────────────────────────────────────────────────────────────────────
// 4. downloadPdf — bytes binarios, devolvemos Blob para que el caller
//    haga URL.createObjectURL + anchor download.
//    NO empuja al proveedor (header X-Praeventio-Pushed-To-Supplier: false).
// ────────────────────────────────────────────────────────────────────────

export async function downloadEppOrderPdf(
  projectId: string,
  orderId: string,
  tenantId: string,
): Promise<Blob> {
  const url =
    `/api/sprint-k/${projectId}/epp-flow/order-pdf/${encodeURIComponent(orderId)}` +
    `?tenantId=${encodeURIComponent(tenantId)}`;
  const res = await authedFetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`http_${res.status}`);
  }
  return res.blob();
}

// ────────────────────────────────────────────────────────────────────────
// Convenience export — sourceType list para UI mostrando la cadena.
// ────────────────────────────────────────────────────────────────────────

export const EPP_FLOW_CHAIN: ReadonlyArray<EppFlowSourceType> = [
  'epp-inspection-event',
  'epp-item-failed',
  'inventory-adjusted',
  'inventory-below-threshold',
  'purchase-order-suggested',
  'purchase-order-signed',
  'purchase-order-pdf-generated',
];

/**
 * useEppFlow — hook agregador para los 4 mutators. No mantiene estado
 * propio (eso vive en los componentes con `useState`). Patron alineado
 * con `useStoppage` / `useReadReceipts`.
 */
export function useEppFlow() {
  return {
    submitEppInspection,
    listPendingEppOrders,
    signEppOrder,
    downloadEppOrderPdf,
    EPP_FLOW_CHAIN,
  };
}
