// Praeventio Guard — Legal calendar client hook (5 GET/POST queries).
//
// Plan Bloque 3.14 — Wraps the HTTP surface at
// `src/server/routes/legalObligations.ts`. Firebase ID-token auth, JSON-only.
//
// Directiva proyecto: este hook MUESTRA obligaciones legales y registra
// firma/entrega manual. NUNCA ejecuta push a APIs estatales (SUSESO / SII /
// MINSAL / OSHA). Las funciones `acknowledge` y `snooze` solo actualizan el
// ciclo interno del calendario; la entrega real al organismo la hace la
// empresa, manualmente, con su firma.
//
// Endpoints wrapped (mount: /api/sprint-k):
//   GET  /:projectId/legal-calendar/upcoming?days=30   → fetchLegalCalendarUpcoming
//   GET  /:projectId/legal-calendar/overdue            → fetchLegalCalendarOverdue
//   POST /:projectId/legal-calendar/acknowledge        → acknowledgeLegalObligation
//   POST /:projectId/legal-calendar/snooze             → snoozeLegalObligation
//   GET  /:projectId/legal-calendar/history            → fetchLegalCalendarHistory

import { auth } from '../services/firebase';
import type {
  CalendarEntry,
  CalendarSummary,
  LegalObligation,
  ObligationKind,
} from '../services/legalCalendar/legalObligationsCalendar';

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

// ── 1. upcoming ────────────────────────────────────────────────────────

export interface UpcomingResponse {
  entries: CalendarEntry[];
  summary: CalendarSummary;
  windowDays: number;
}

export async function fetchLegalCalendarUpcoming(
  projectId: string,
  days: number = 30,
): Promise<UpcomingResponse> {
  const url = `/api/sprint-k/${projectId}/legal-calendar/upcoming?days=${encodeURIComponent(
    String(days),
  )}`;
  const res = await authedFetch(url, { method: 'GET' });
  return json<UpcomingResponse>(res);
}

// ── 2. overdue ─────────────────────────────────────────────────────────

export interface OverdueResponse {
  entries: CalendarEntry[];
  count: number;
}

export async function fetchLegalCalendarOverdue(
  projectId: string,
): Promise<OverdueResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/legal-calendar/overdue`,
    { method: 'GET' },
  );
  return json<OverdueResponse>(res);
}

// ── 3. acknowledge ─────────────────────────────────────────────────────

export interface AcknowledgeInput {
  obligation: LegalObligation;
  notes?: string;
}
export interface AcknowledgeResponse {
  obligation: LegalObligation;
}

export async function acknowledgeLegalObligation(
  projectId: string,
  input: AcknowledgeInput,
  idempotencyKey?: string,
): Promise<AcknowledgeResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/legal-calendar/acknowledge`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<AcknowledgeResponse>(res);
}

// ── 4. snooze ──────────────────────────────────────────────────────────

export interface SnoozeInput {
  obligation: LegalObligation;
  days: number;
  reason: string;
}
export interface SnoozeResponse {
  obligation: LegalObligation;
}

export async function snoozeLegalObligation(
  projectId: string,
  input: SnoozeInput,
  idempotencyKey?: string,
): Promise<SnoozeResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/legal-calendar/snooze`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<SnoozeResponse>(res);
}

// ── 5. history ─────────────────────────────────────────────────────────

export interface LegalCalendarHistoryEntry {
  obligationId: string;
  kind: ObligationKind;
  label: string;
  legalCitation: string;
  nextDueAt: string;
  reminders: Array<{
    sentAtIso: string;
    daysUntilWhenSent: number;
  }>;
  lastAcknowledgedAt?: string;
  lastAcknowledgedByUid?: string;
  lastSnoozedAt?: string;
  lastSnoozedByUid?: string;
  lastSnoozeReason?: string;
}
export interface HistoryResponse {
  entries: LegalCalendarHistoryEntry[];
  count: number;
}

export async function fetchLegalCalendarHistory(
  projectId: string,
): Promise<HistoryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/legal-calendar/history`,
    { method: 'GET' },
  );
  return json<HistoryResponse>(res);
}
