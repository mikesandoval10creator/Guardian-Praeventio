// Praeventio Guard — hazmat inventory client hook. Mirrors useReadReceipts:
// each route gets a typed wrapper; the server owns compute, the client owns
// persistence (Firestore/IDB).
//
// Endpoint base: `/api/sprint-k/:projectId/hazmat/...` mirrors the existing
// /api/sprint-k mount used by readReceipts + loneWorker.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  HazmatItem,
  CompatibilityIssue,
  SpillResponsePlan,
} from '../services/hazmat/hazmatInventory';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
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

function base(projectId: string): string {
  return `/api/sprint-k/${projectId}/hazmat`;
}

// ── 1. add substance ───────────────────────────────────────────────────

export interface AddSubstanceInput {
  item: HazmatItem;
  inventory?: HazmatItem[];
  idempotencyKey?: string;
}
export interface AddSubstanceResponse {
  item: HazmatItem;
  inventory: HazmatItem[];
  issues: CompatibilityIssue[];
}

export async function addHazmatSubstance(
  projectId: string,
  input: AddSubstanceInput,
): Promise<AddSubstanceResponse> {
  const { idempotencyKey, ...payload } = input;
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(`${base(projectId)}/substance`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return json<AddSubstanceResponse>(res);
}

// ── 2. get substance by id (from an in-memory inventory) ───────────────

export interface GetSubstanceInput {
  itemId: string;
  inventory: HazmatItem[];
}
export interface GetSubstanceResponse {
  item: HazmatItem;
}

export async function getHazmatSubstance(
  projectId: string,
  input: GetSubstanceInput,
): Promise<GetSubstanceResponse> {
  const res = await authedFetch(`${base(projectId)}/substance/get`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return json<GetSubstanceResponse>(res);
}

// ── 3. list inventory with filters ─────────────────────────────────────

export interface ListInventoryInput {
  inventory: HazmatItem[];
  filters?: {
    locationId?: string;
    hazardClass?: HazmatItem['hazardClasses'][number];
    search?: string;
    expiringWithinDays?: number;
  };
  now?: string;
}
export interface ListInventoryResponse {
  items: HazmatItem[];
  total: number;
}

export async function listHazmatInventory(
  projectId: string,
  input: ListInventoryInput,
): Promise<ListInventoryResponse> {
  const res = await authedFetch(`${base(projectId)}/inventory`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return json<ListInventoryResponse>(res);
}

// ── 4. update substance ────────────────────────────────────────────────

export interface UpdateSubstanceInput {
  item: HazmatItem;
  inventory: HazmatItem[];
  idempotencyKey?: string;
}
export interface UpdateSubstanceResponse {
  item: HazmatItem;
  inventory: HazmatItem[];
  issues: CompatibilityIssue[];
}

export async function updateHazmatSubstance(
  projectId: string,
  input: UpdateSubstanceInput,
): Promise<UpdateSubstanceResponse> {
  const { idempotencyKey, ...payload } = input;
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(`${base(projectId)}/substance/update`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return json<UpdateSubstanceResponse>(res);
}

// ── 5. delete substance ────────────────────────────────────────────────

export interface DeleteSubstanceInput {
  itemId: string;
  inventory: HazmatItem[];
  idempotencyKey?: string;
}
export interface DeleteSubstanceResponse {
  itemId: string;
  inventory: HazmatItem[];
}

export async function deleteHazmatSubstance(
  projectId: string,
  input: DeleteSubstanceInput,
): Promise<DeleteSubstanceResponse> {
  const { idempotencyKey, ...payload } = input;
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(`${base(projectId)}/substance/delete`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return json<DeleteSubstanceResponse>(res);
}

// ── 6. compatibility check ─────────────────────────────────────────────

export interface CompatibilityCheckInput {
  inventory: HazmatItem[];
}
export interface CompatibilityCheckResponse {
  issues: CompatibilityIssue[];
  summary: { total: number; incompatible: number; caution: number };
}

export async function checkHazmatCompatibility(
  projectId: string,
  input: CompatibilityCheckInput,
): Promise<CompatibilityCheckResponse> {
  const res = await authedFetch(`${base(projectId)}/compatibility-check`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return json<CompatibilityCheckResponse>(res);
}

// ── 7. spill plan ──────────────────────────────────────────────────────

export interface SpillPlanInput {
  item: HazmatItem;
}
export interface SpillPlanResponse {
  plan: SpillResponsePlan;
}

export async function buildHazmatSpillPlan(
  projectId: string,
  input: SpillPlanInput,
): Promise<SpillPlanResponse> {
  const res = await authedFetch(`${base(projectId)}/spill-plan`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return json<SpillPlanResponse>(res);
}
