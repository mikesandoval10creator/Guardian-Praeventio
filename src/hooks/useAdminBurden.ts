// Praeventio Guard — Admin Burden + Automation Suggester client hook.

import { auth } from '../services/firebase';
import type {
  AdminTaskTimeEntry,
  AdminBurdenReport,
} from '../services/adminBurden/adminBurdenTracker';
import type { AutomationSuggestion } from '../services/adminBurden/automationSuggester';

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
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. report ──────────────────────────────────────────────────────────

export interface BuildAdminBurdenReportInput {
  entries: AdminTaskTimeEntry[];
}
export interface BuildAdminBurdenReportResponse {
  report: AdminBurdenReport;
}

export async function buildAdminBurdenReportRemote(
  projectId: string,
  input: BuildAdminBurdenReportInput,
): Promise<BuildAdminBurdenReportResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/admin-burden/report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildAdminBurdenReportResponse>(res);
}

// ── 2. suggest-automations ─────────────────────────────────────────────

export interface SuggestAutomationsInput {
  report: AdminBurdenReport;
}
export interface SuggestAutomationsResponse {
  suggestions: AutomationSuggestion[];
  totalSavedMinutesPerWeek: number;
}

export async function suggestAdminAutomations(
  projectId: string,
  input: SuggestAutomationsInput,
): Promise<SuggestAutomationsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/admin-burden/suggest-automations`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SuggestAutomationsResponse>(res);
}
