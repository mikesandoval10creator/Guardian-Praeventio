// Praeventio Guard — Contractors KPI client hook (3 mutators).

import type {
  ContractorPerformance,
  ContractorKpi,
  ContractorRankEntry,
  AcreditationRecord,
  AcreditationGapReport,
} from '../services/contractors/contractorKpiService';
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

// ── 1. compute-kpi ─────────────────────────────────────────────────────

export interface ComputeContractorKpiInput {
  perf: ContractorPerformance;
}
export interface ComputeContractorKpiResponse {
  kpi: ContractorKpi;
}

export async function computeContractorKpiRemote(
  projectId: string,
  input: ComputeContractorKpiInput,
): Promise<ComputeContractorKpiResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contractors/compute-kpi`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeContractorKpiResponse>(res);
}

// ── 2. rank-by-risk ────────────────────────────────────────────────────

export interface RankContractorsInput {
  perfs: ContractorPerformance[];
}
export interface RankContractorsResponse {
  ranking: ContractorRankEntry[];
}

export async function rankContractorsByRiskRemote(
  projectId: string,
  input: RankContractorsInput,
): Promise<RankContractorsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contractors/rank-by-risk`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RankContractorsResponse>(res);
}

// ── 3. acreditation-gap-report ─────────────────────────────────────────

export interface AcreditationGapInput {
  record: AcreditationRecord;
  nowIso?: string;
}
export interface AcreditationGapResponse {
  report: AcreditationGapReport;
}

export async function buildAcreditationGapReportRemote(
  projectId: string,
  input: AcreditationGapInput,
): Promise<AcreditationGapResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contractors/acreditation-gap-report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AcreditationGapResponse>(res);
}
