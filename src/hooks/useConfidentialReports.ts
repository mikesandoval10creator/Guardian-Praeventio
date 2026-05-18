// Praeventio Guard — §211-213 Reportes Confidenciales / Ley Karin hooks.
//
// Pareja cliente de `src/server/routes/confidentialReports.ts`. Migrado
// del monolito `useSprintK.ts` (2026-05-17) — Sprint K reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

// Codex P1 fix: enums alineados al server (Codex P1 sesión 2026-05-18).
// Antes eran labels en español (acoso_laboral, baja/media/...); el server
// usa los canónicos en inglés que el UI también espera.
export type ConfidentialReportKindApi =
  | 'harassment'
  | 'safety'
  | 'discrimination'
  | 'violence'
  | 'conflict_of_interest'
  | 'other';

export type ConfidentialReportSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type ConfidentialReportStatusApi =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'closed'
  | 'dismissed';

export interface ConfidentialReportApi {
  id: string;
  projectId: string;
  kind: ConfidentialReportKindApi;
  severity: ConfidentialReportSeverity;
  narrative: string;
  evidence?: string;
  allowsIdentity: boolean;
  reporterAnonHash: string;
  reporterUid?: string;
  status: ConfidentialReportStatusApi;
  submittedAt: string;
  firstResponseDueAt: string;
  resolveDueAt: string;
  respondedAt?: string;
  closedAt?: string;
  resolution?: string;
  outcome?: 'substantiated' | 'unsubstantiated' | 'transferred';
}

export interface RetaliationAlertApi {
  reportId: string;
  reporterAnonHash: string;
  reportSubmittedAt: string;
  actionAt: string;
  actionKind: 'termination' | 'salary_decrease' | 'shift_change' | 'role_change' | 'transfer';
  daysFromReport: number;
  severity: 'high' | 'critical';
}

export interface ConfidentialReportsListResponse {
  reports: ConfidentialReportApi[];
  /** Codex P1: server informa el rol del caller para que el UI decida
   *  si mostrar la vista handler (todos) o reporter (sólo míos). */
  role?: 'investigator' | 'reporter';
}

export interface RetaliationAlertsResponse {
  alerts: RetaliationAlertApi[];
  windowDays: number;
}

export function useConfidentialReports(projectId: string | null) {
  return useEndpoint<ConfidentialReportsListResponse>(
    projectId ? `/api/sprint-k/${projectId}/confidential-reports` : null,
  );
}

export function useRetaliationAlerts(projectId: string | null) {
  return useEndpoint<RetaliationAlertsResponse>(
    projectId ? `/api/sprint-k/${projectId}/confidential-reports/retaliation-alerts` : null,
  );
}

export interface SubmitConfidentialReportPayload {
  kind: ConfidentialReportKindApi;
  severity: ConfidentialReportSeverity;
  narrative: string;
  evidence?: string;
  allowsIdentity: boolean;
  /** Sólo cuando allowsIdentity=true. Si está omitido el server lo
   *  deriva del token. Cuando allowsIdentity=false NUNCA se envía
   *  (principio de mínima exposición). */
  reporterUid?: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function submitConfidentialReport(
  projectId: string,
  payload: SubmitConfidentialReportPayload,
): Promise<{ ok: true; report: ConfidentialReportApi; sla: Record<string, string> }> {
  return postJson(`/api/sprint-k/${projectId}/confidential-reports`, payload);
}

export async function respondToReport(
  projectId: string,
  reportId: string,
  message: string,
): Promise<void> {
  await postJson(
    `/api/sprint-k/${projectId}/confidential-reports/${reportId}/respond`,
    { message },
  );
}

export async function closeReport(
  projectId: string,
  reportId: string,
  resolution: string,
  outcome: 'substantiated' | 'unsubstantiated' | 'transferred' = 'substantiated',
): Promise<void> {
  await postJson(
    `/api/sprint-k/${projectId}/confidential-reports/${reportId}/close`,
    { resolution, outcome },
  );
}
