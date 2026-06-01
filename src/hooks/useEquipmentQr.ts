// Praeventio Guard — Bloque 3 wire huérfanos (3.11) client hook.
//
// Wraps the five endpoints of `src/server/routes/equipmentQr.ts`:
//   • registerEquipmentQr             — POST   /api/sprint-k/:projectId/equipment-qr/register
//   • lookupEquipmentByQr             — GET    /api/sprint-k/:projectId/equipment-qr/:qrId
//   • submitPreUseChecklist           — POST   /api/sprint-k/:projectId/equipment-qr/:qrId/preuse
//   • fetchEquipmentPreUseHistory     — GET    /api/sprint-k/:projectId/equipment-qr/:qrId/history
//   • listEquipmentBySite             — GET    /api/sprint-k/:projectId/equipment-qr/list-by-site
//
// Founder directive — NUNCA bloquear maquinaria:
//   `submitPreUseChecklist` returns a `recommendation` object that the UI
//   must surface to the worker. A `recommend_not_operate` action means the
//   UI shows a "RECOMENDAMOS no operar — reporta al supervisor" banner.
//   It does NOT mean the hook (or the route) refused to record the event.
//   The validation is ALWAYS persisted; the recommendation is digital
//   guidance, not a physical lock.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  Equipment,
  EquipmentStatus,
  EquipmentCriticality,
  PreUseChecklistItem,
  PreUseResponse,
  PreUseValidation,
} from '../services/equipment/equipmentQrService';

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

// ── 1. register ────────────────────────────────────────────────────────

export interface RegisterEquipmentInput {
  code: string;
  type: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  criticality: EquipmentCriticality;
  riskCategories?: string[];
  requiresPreUseChecklist?: boolean;
  nextMaintenanceAt?: string;
}

export interface RegisterEquipmentResponse {
  equipment: Equipment;
  /** Cadena lista para alimentar a `qrcode.react` — formato `equipment:{id}`. */
  qrPayload: string;
}

export async function registerEquipmentQr(
  projectId: string,
  input: RegisterEquipmentInput,
  idempotencyKey?: string,
): Promise<RegisterEquipmentResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/equipment-qr/register`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    },
  );
  return json<RegisterEquipmentResponse>(res);
}

// ── 2. lookup ──────────────────────────────────────────────────────────

export interface LookupEquipmentResponse {
  equipment: Equipment;
  /** Canonical checklist for `equipment.type` — pre-filtered server side. */
  checklist: PreUseChecklistItem[];
}

export async function lookupEquipmentByQr(
  projectId: string,
  qrId: string,
): Promise<LookupEquipmentResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/equipment-qr/${encodeURIComponent(qrId)}`,
    { method: 'GET' },
  );
  return json<LookupEquipmentResponse>(res);
}

// Helper: the scanner returns raw QR text (e.g. `equipment:{uuid}`).
// Extract the qrId for the lookup call.
export function parseEquipmentQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return null;
  if (trimmed.toLowerCase().startsWith('equipment:')) {
    const rest = trimmed.slice('equipment:'.length).trim();
    return rest.length > 0 ? rest : null;
  }
  // Accept plain id as a fallback (admin pasted the bare uuid).
  if (/^[A-Za-z0-9_-]{6,128}$/.test(trimmed)) return trimmed;
  return null;
}

// ── 3. preuse ──────────────────────────────────────────────────────────

export interface SubmitPreUseInput {
  responses: PreUseResponse[];
  signatureHashHex?: string;
}

export interface PreUseRecommendation {
  action: 'proceed' | 'recommend_not_operate' | 'recommend_report_supervisor';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface SubmitPreUseResponse {
  validation: PreUseValidation;
  recommendation: PreUseRecommendation;
  appliedStatus: EquipmentStatus;
  auditHash: string;
}

export async function submitPreUseChecklist(
  projectId: string,
  qrId: string,
  input: SubmitPreUseInput,
  idempotencyKey?: string,
): Promise<SubmitPreUseResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/equipment-qr/${encodeURIComponent(qrId)}/preuse`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    },
  );
  return json<SubmitPreUseResponse>(res);
}

// ── 4. history ─────────────────────────────────────────────────────────

export interface EquipmentPreUseHistoryResponse {
  history: PreUseValidation[];
}

export async function fetchEquipmentPreUseHistory(
  projectId: string,
  qrId: string,
  opts: { limit?: number } = {},
): Promise<EquipmentPreUseHistoryResponse> {
  const qs = new URLSearchParams();
  if (typeof opts.limit === 'number') qs.set('limit', String(opts.limit));
  const query = qs.toString();
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/equipment-qr/${encodeURIComponent(qrId)}/history${query ? `?${query}` : ''}`,
    { method: 'GET' },
  );
  return json<EquipmentPreUseHistoryResponse>(res);
}

// ── 5. list by site ────────────────────────────────────────────────────

export interface ListEquipmentBySiteResponse {
  equipment: Equipment[];
}

export async function listEquipmentBySite(
  projectId: string,
  opts: { status?: EquipmentStatus } = {},
): Promise<ListEquipmentBySiteResponse> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set('status', opts.status);
  const query = qs.toString();
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/equipment-qr/list-by-site${query ? `?${query}` : ''}`,
    { method: 'GET' },
  );
  return json<ListEquipmentBySiteResponse>(res);
}
