// Praeventio Guard — 5S Audit client hook (3 mutators).

import type {
  FiveSAuditChecklistItem,
  FiveSAuditResponse,
  FiveSAuditReport,
  ZoneScoreEntry,
} from '../services/fiveS/fiveSAudit';
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

// ── 1. checklist ───────────────────────────────────────────────────────

export interface FiveSChecklistResponse {
  items: FiveSAuditChecklistItem[];
}

export async function fetchFiveSChecklist(
  projectId: string,
): Promise<FiveSChecklistResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/five-s/checklist`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<FiveSChecklistResponse>(res);
}

// ── 2. build-report ────────────────────────────────────────────────────

export interface BuildFiveSReportInput {
  zoneId: string;
  responses: FiveSAuditResponse[];
}
export interface BuildFiveSReportResponse {
  report: FiveSAuditReport;
}

export async function buildFiveSReport(
  projectId: string,
  input: BuildFiveSReportInput,
): Promise<BuildFiveSReportResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/five-s/build-report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildFiveSReportResponse>(res);
}

// ── 3. rank-zones ──────────────────────────────────────────────────────

export interface RankFiveSZonesInput {
  reports: FiveSAuditReport[];
}
export interface RankFiveSZonesResponse {
  ranking: ZoneScoreEntry[];
}

export async function rankFiveSZones(
  projectId: string,
  input: RankFiveSZonesInput,
): Promise<RankFiveSZonesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/five-s/rank-zones`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RankFiveSZonesResponse>(res);
}
