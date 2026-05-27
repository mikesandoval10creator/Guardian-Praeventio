// Praeventio Guard — Reports Automation client hook (3 mutators).

import { auth } from '../services/firebase';
import type {
  ReportTemplate,
  ReportData,
  RenderInputs,
  PublishedReport,
  DueReportInput,
  DueReportDecision,
} from '../services/reportsAutomation/reportsAutomation';

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
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. validate ────────────────────────────────────────────────────────

export interface ValidateReportInput {
  template: ReportTemplate;
  data: ReportData;
}
export interface ValidateReportResponse {
  validation: { templateId: string; isValid: boolean; missingSections: string[] };
}

export async function validateReportApi(
  projectId: string,
  input: ValidateReportInput,
): Promise<ValidateReportResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/reports-automation/validate`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateReportResponse>(res);
}

// ── 2. render ──────────────────────────────────────────────────────────

export interface RenderReportResponse {
  report: PublishedReport;
}

export async function renderReportApi(
  projectId: string,
  input: RenderInputs,
): Promise<RenderReportResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/reports-automation/render`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RenderReportResponse>(res);
}

// ── 3. check-due ───────────────────────────────────────────────────────

export interface CheckReportDueResponse {
  decision: DueReportDecision;
}

export async function checkReportDueApi(
  projectId: string,
  input: DueReportInput,
): Promise<CheckReportDueResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/reports-automation/check-due`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CheckReportDueResponse>(res);
}
