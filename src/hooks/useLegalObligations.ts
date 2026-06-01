// Praeventio Guard — Bloque 3.14 wire huérfanos: Legal Obligations Calendar client hook.
//
// Wraps the HTTP surface at `src/server/routes/legalObligations.ts`
// (Sprint 39 Fase J.2). Firebase ID-token auth, JSON-only. Mirrors
// `useIndustryRules.ts` + `useShiftHandover.ts` shape.
//
// Endpoints (mount: /api/sprint-k):
//   GET  /:projectId/legal-calendar/upcoming?days=N  — próximas obligaciones
//   GET  /:projectId/legal-calendar/overdue          — obligaciones vencidas
//   POST /:projectId/legal-calendar/acknowledge      — firma/entrega supervisor (idempotent)
//   POST /:projectId/legal-calendar/snooze           — posponer obligación (idempotent)
//   GET  /:projectId/legal-calendar/history          — historial events
//
// Patrón founder: la rama `acknowledge` y `snooze` NO modifican facts en
// origen — solo agregan eventos de audit y mueven `nextDueAt` per
// `advanceObligation`. La firma real (biométrica + PIN) ocurre en el
// componente; este hook solo transporta la attestation booleana.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  LegalObligation,
  ObligationKind,
} from '../services/legalCalendar/legalObligationsCalendar';

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
      code?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. upcoming ─────────────────────────────────────────────────────────

export interface UpcomingObligationsResponse {
  obligations: LegalObligation[];
  count: number;
  windowDays: number;
}

/**
 * GET /:projectId/legal-calendar/upcoming?days=N
 *
 * Lista obligaciones legales con `nextDueAt` dentro de la ventana indicada
 * (default 30 días). Filtra `kind` (DS44/Ley16744/ISO45001/etc.) según el
 * project + jurisdicción.
 */
export async function fetchUpcomingObligations(
  projectId: string,
  options?: { windowDays?: number; signal?: AbortSignal },
): Promise<UpcomingObligationsResponse> {
  const days = options?.windowDays ?? 30;
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/legal-calendar/upcoming?days=${days}`,
    { method: 'GET', signal: options?.signal },
  );
  return json<UpcomingObligationsResponse>(res);
}

// ── 2. overdue ──────────────────────────────────────────────────────────

export interface OverdueObligationsResponse {
  obligations: LegalObligation[];
  count: number;
}

/**
 * GET /:projectId/legal-calendar/overdue
 *
 * Lista obligaciones que pasaron su `nextDueAt` sin acknowledge ni snooze.
 * Estas SON el material de la alerta P0 al supervisor.
 */
export async function fetchOverdueObligations(
  projectId: string,
  options?: { signal?: AbortSignal },
): Promise<OverdueObligationsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/legal-calendar/overdue`,
    { method: 'GET', signal: options?.signal },
  );
  return json<OverdueObligationsResponse>(res);
}

// ── 3. acknowledge ──────────────────────────────────────────────────────

export interface AcknowledgeObligationInput {
  obligation: LegalObligation;
  notes?: string;
}

export interface AcknowledgeObligationResponse {
  obligation: LegalObligation;
  nextDueAt: string;
  ackId: string;
}

/**
 * POST /:projectId/legal-calendar/acknowledge
 *
 * Supervisor declara haber cumplido la obligación (firma/entrega del
 * documento). El servidor:
 *   1. Aplica `advanceObligation()` → nuevo `nextDueAt` cíclico.
 *   2. Persiste evento audit `legal_obligation_ack` (tamper-proof chain).
 *   3. Idempotente por `Idempotency-Key` header (cliente debe enviarlo).
 *
 * La rama NO ejecuta autohaving — el `notes` es opcional y NO entra a
 * APIs estatales (SUSESO/SII/etc.) según directiva founder.
 */
export async function acknowledgeObligation(
  projectId: string,
  input: AcknowledgeObligationInput,
  options?: { idempotencyKey?: string; signal?: AbortSignal },
): Promise<AcknowledgeObligationResponse> {
  const headers: Record<string, string> = {};
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/legal-calendar/acknowledge`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: options?.signal,
    },
  );
  return json<AcknowledgeObligationResponse>(res);
}

// ── 4. snooze ──────────────────────────────────────────────────────────

export interface SnoozeObligationInput {
  obligation: LegalObligation;
  /** ISO 8601 timestamp para postergar `nextDueAt`. Max 30 días desde now. */
  snoozeUntil: string;
  reason: string;
}

export interface SnoozeObligationResponse {
  obligation: LegalObligation;
  snoozedUntil: string;
  snoozeId: string;
}

/**
 * POST /:projectId/legal-calendar/snooze
 *
 * Supervisor posterga una obligación con justificación (auditable). El
 * `reason` queda en el evento audit. Idempotente por `Idempotency-Key`.
 *
 * Restricción founder: NO snoozear obligaciones P0 (vida) — la API
 * server-side rechaza con 422 si el `kind` cae en blacklist.
 */
export async function snoozeObligation(
  projectId: string,
  input: SnoozeObligationInput,
  options?: { idempotencyKey?: string; signal?: AbortSignal },
): Promise<SnoozeObligationResponse> {
  const headers: Record<string, string> = {};
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/legal-calendar/snooze`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: options?.signal,
    },
  );
  return json<SnoozeObligationResponse>(res);
}

// ── 5. history ─────────────────────────────────────────────────────────

export interface ObligationHistoryEntry {
  at: string;
  uid: string;
  kind: 'acknowledge' | 'snooze' | 'create' | 'overdue_emitted';
  obligationKind: ObligationKind;
  notes?: string;
  reason?: string;
}

export interface ObligationHistoryResponse {
  entries: ObligationHistoryEntry[];
  count: number;
}

/**
 * GET /:projectId/legal-calendar/history?limit=N
 *
 * Historial completo del proyecto. Tenant-scoped + role-gated (auditor +
 * admin tienen visibilidad full; supervisor solo eventos propios).
 */
export async function fetchObligationHistory(
  projectId: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<ObligationHistoryResponse> {
  const limit = options?.limit ?? 100;
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/legal-calendar/history?limit=${limit}`,
    { method: 'GET', signal: options?.signal },
  );
  return json<ObligationHistoryResponse>(res);
}

// ── Bundle export ──────────────────────────────────────────────────────

/**
 * Bundle accessor — useful for callers that prefer object dispatch.
 * (Mirrors the pattern in `useIndustryRules`/`useShiftHandover`.)
 */
export const useLegalObligations = {
  fetchUpcoming: fetchUpcomingObligations,
  fetchOverdue: fetchOverdueObligations,
  acknowledge: acknowledgeObligation,
  snooze: snoozeObligation,
  fetchHistory: fetchObligationHistory,
};
