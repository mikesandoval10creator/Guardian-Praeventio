// Praeventio Guard — Multi-Project Comparator client hook
// (3 stateless mutators).

import type {
  BestPractice,
  ComparisonReport,
  ProjectSnapshot,
  RiskProjectAlert,
} from '../services/multiProject/projectComparator';
// The READ-side snapshots pipeline returns the *comparator* engine shape
// (`projectComparator/projectComparator`), which is the one ProjectsCompare +
// the /project-comparator/compare endpoint consume — distinct from the
// multiProject engine `ProjectSnapshot` (incidents nested counts) used by the
// 3 POST mutators above.
import type { ProjectSnapshot as ComparatorProjectSnapshot } from '../services/projectComparator/projectComparator';
import { apiAuthHeaders } from '../lib/apiAuth';

async function authedFetch(
  path: string,
  init: RequestInit = {},

): Promise<Response> {
  // §2.20 migration (2026-05-21) — usa apiAuthHeaders() unificado:
  // prefiere E2E header en MODE=test, fallback a Bearer productivo.
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

// ── 4. snapshots (READ-side pipeline, P1) ───────────────────────────────

export interface FetchProjectSnapshotsResponse {
  snapshots: ComparatorProjectSnapshot[];
}

/**
 * Fetch REAL per-project KPI snapshots for every project the caller belongs
 * to, aggregated server-side from incidents/findings/audits/risks/
 * corrective_actions. `projectId` is the auth "lens" (the caller must be a
 * member of it). Feeds ProjectsCompare so the comparator is reachable with
 * real data instead of an empty prop (DEEP-EX-34 H3 / #1049).
 */
export async function fetchProjectSnapshots(
  projectId: string,
): Promise<FetchProjectSnapshotsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/multi-project/snapshots`,
    { method: 'GET' },
  );
  return json<FetchProjectSnapshotsResponse>(res);
}
