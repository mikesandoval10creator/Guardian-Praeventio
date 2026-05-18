// Praeventio Guard — §211-213 Reportes Confidenciales / Ley Karin hooks.
//
// Pareja cliente de `src/server/routes/confidentialReports.ts`. Migrado
// del monolito `useSprintK.ts` (2026-05-17) — Sprint K reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

export type ConfidentialReportKindApi =
  | 'acoso_laboral'
  | 'acoso_sexual'
  | 'violencia'
  | 'discriminacion'
  | 'falta_etica'
  | 'incumplimiento_seguridad'
  | 'otro';

export type ConfidentialReportSeverity = 'baja' | 'media' | 'alta' | 'critica';

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

export function useConfidentialReports(projectId: string | null) {
  return useEndpoint<{ reports: ConfidentialReportApi[] }>(
    projectId ? `/api/sprint-k/${projectId}/confidential-reports` : null,
  );
}

export function useRetaliationAlerts(projectId: string | null) {
  return useEndpoint<{ alerts: RetaliationAlertApi[]; windowDays: number }>(
    projectId ? `/api/sprint-k/${projectId}/confidential-reports/retaliation-alerts` : null,
  );
}

export interface SubmitConfidentialReportPayload {
  kind: ConfidentialReportKindApi;
  severity: ConfidentialReportSeverity;
  narrative: string;
  evidence?: string;
  allowsIdentity: boolean;
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
