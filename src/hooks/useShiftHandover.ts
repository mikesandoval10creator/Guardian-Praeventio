// Praeventio Guard — Shift Handover client hook.
//
// Wraps `src/server/routes/shiftHandover.ts`. Firebase ID-token auth,
// JSON-only. Mirrors the loneWorker / stoppage client patterns.
//
// 5 functions:
//   1. createShiftHandover         — turno saliente registra estado
//   2. acknowledgeShiftHandover    — turno entrante acusa recibo
//   3. addShiftHandoverDiscrepancy — entrante reporta discrepancia
//   4. fetchActiveShiftHandovers   — handovers pendientes de acuse
//   5. fetchShiftHandoverHistory   — listado histórico paginado por días

import { auth } from '../services/firebase';
import type {
  ShiftRecord,
  ShiftKind,
  ShiftHandoverNote,
  ShiftLogEntry,
  ShiftSummary,
} from '../services/shiftHandover/shiftHandoverService';
import type {
  HandoverQualityReport,
} from '../services/shiftHandover/shiftHandoverInsights';

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
      code?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. create ──────────────────────────────────────────────────────────

export interface CreateShiftHandoverInput {
  id: string;
  kind: ShiftKind;
  startedAt: string;
  supervisorUid: string;
  logEntries?: Array<Omit<ShiftLogEntry, 'at'> & { at?: string }>;
  handoverNotes?: ShiftHandoverNote[];
  endedAt?: string;
}

export interface CreateShiftHandoverResponse {
  shift: ShiftRecord;
  quality: HandoverQualityReport;
  summary: ShiftSummary;
}

export async function createShiftHandover(
  projectId: string,
  input: CreateShiftHandoverInput,
  idempotencyKey?: string,
): Promise<CreateShiftHandoverResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/create`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<CreateShiftHandoverResponse>(res);
}

// ── 2. acknowledge ─────────────────────────────────────────────────────

export interface AcknowledgeShiftHandoverInput {
  notes?: string;
  now?: string;
}

export interface AcknowledgeShiftHandoverResponse {
  shift: ShiftRecord;
}

export async function acknowledgeShiftHandover(
  projectId: string,
  hoId: string,
  input: AcknowledgeShiftHandoverInput = {},
  idempotencyKey?: string,
): Promise<AcknowledgeShiftHandoverResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/${encodeURIComponent(hoId)}/acknowledge`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<AcknowledgeShiftHandoverResponse>(res);
}

// ── 3. add-discrepancy ─────────────────────────────────────────────────

export interface AddShiftHandoverDiscrepancyInput {
  text: string;
  now?: string;
}

export interface AddShiftHandoverDiscrepancyResponse {
  shift: ShiftRecord;
}

export async function addShiftHandoverDiscrepancy(
  projectId: string,
  hoId: string,
  input: AddShiftHandoverDiscrepancyInput,
  idempotencyKey?: string,
): Promise<AddShiftHandoverDiscrepancyResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/${encodeURIComponent(hoId)}/add-discrepancy`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<AddShiftHandoverDiscrepancyResponse>(res);
}

// ── 4. active ──────────────────────────────────────────────────────────

export interface ShiftHandoverEntry {
  shift: ShiftRecord;
  quality: HandoverQualityReport;
  summary: ShiftSummary;
}

export interface ActiveShiftHandoversResponse {
  shifts: ShiftHandoverEntry[];
}

export async function fetchActiveShiftHandovers(
  projectId: string,
): Promise<ActiveShiftHandoversResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/active`,
    { method: 'GET' },
  );
  return json<ActiveShiftHandoversResponse>(res);
}

// ── 5. history ─────────────────────────────────────────────────────────

export interface ShiftHandoverHistoryQuery {
  days?: number;
}

export interface ShiftHandoverHistoryResponse {
  shifts: ShiftHandoverEntry[];
  days: number;
}

export async function fetchShiftHandoverHistory(
  projectId: string,
  q: ShiftHandoverHistoryQuery = {},
): Promise<ShiftHandoverHistoryResponse> {
  const qs =
    q.days !== undefined ? `?days=${encodeURIComponent(q.days)}` : '';
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/history${qs}`,
    { method: 'GET' },
  );
  return json<ShiftHandoverHistoryResponse>(res);
}
