// Praeventio Guard — Multi-Project Comparator client hook
// (3 stateless mutators).

import { auth } from '../services/firebase';
import type {
  BestPractice,
  ComparisonReport,
  ProjectSnapshot,
  RiskProjectAlert,
} from '../services/multiProject/projectComparator';

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

// ── 1. compare ─────────────────────────────────────────────────────────

export interface CompareProjectsInput {
  snapshots: ProjectSnapshot[];
}
export interface CompareProjectsResponse {
  report: ComparisonReport;
}

export async function compareProjectsAcrossTenant(
  projectId: string,
  input: CompareProjectsInput,
): Promise<CompareProjectsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/multi-project/compare`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CompareProjectsResponse>(res);
}

// ── 2. best-practices ──────────────────────────────────────────────────

export interface BestPracticesInput {
  report: ComparisonReport;
}
export interface BestPracticesResponse {
  practices: BestPractice[];
}

export async function extractBestPracticesFromReport(
  projectId: string,
  input: BestPracticesInput,
): Promise<BestPracticesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/multi-project/best-practices`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BestPracticesResponse>(res);
}

// ── 3. risk-projects ───────────────────────────────────────────────────

export interface RiskProjectsInput {
  report: ComparisonReport;
}
export interface RiskProjectsResponse {
  alerts: RiskProjectAlert[];
}

export async function flagRiskyProjects(
  projectId: string,
  input: RiskProjectsInput,
): Promise<RiskProjectsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/multi-project/risk-projects`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RiskProjectsResponse>(res);
}
