// Praeventio Guard — Bloque 3.13 wire huérfanos: industryRules client hook.
//
// Wraps the HTTP surface at `src/server/routes/industryRules.ts`. Firebase
// ID-token auth, JSON-only. Mirrors `useLoneWorker.ts` shape so callers
// can compose `select` + `applicable-norms` + `required-epp` +
// `typical-hazards` in the wizard without re-implementing fetch glue.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  IndustryPreset,
  PresetApplication,
} from '../services/industryRules/industryRuleEngine';

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

async function jsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. list ────────────────────────────────────────────────────────────

export interface IndustryListResponse {
  presets: Array<{ prefix: string; label: string }>;
}

export async function listIndustryPresetsRemote(
  projectId: string,
): Promise<IndustryListResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/list`,
    { method: 'GET' },
  );
  return jsonResponse<IndustryListResponse>(res);
}

// ── 2. select ──────────────────────────────────────────────────────────

export interface SelectIndustryInput {
  industryPrefix: string;
}
export interface SelectIndustryResponse {
  application: PresetApplication;
  preset: IndustryPreset;
}

export async function selectIndustryRemote(
  projectId: string,
  input: SelectIndustryInput,
  idempotencyKey?: string,
): Promise<SelectIndustryResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/select`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return jsonResponse<SelectIndustryResponse>(res);
}

// ── 3. applicable-norms ────────────────────────────────────────────────

export interface ApplicableNormsResponse {
  industryPrefix: string;
  applicableRegulations: string[];
  minsalProtocols: string[];
}

export async function fetchApplicableNorms(
  projectId: string,
  industryPrefix: string,
): Promise<ApplicableNormsResponse> {
  const qs = new URLSearchParams({ industryPrefix }).toString();
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/applicable-norms?${qs}`,
    { method: 'GET' },
  );
  return jsonResponse<ApplicableNormsResponse>(res);
}

// ── 4. required-epp ────────────────────────────────────────────────────

export interface RequiredEppResponse {
  industryPrefix: string;
  baseEpp: string[];
}

export async function fetchRequiredEpp(
  projectId: string,
  industryPrefix: string,
): Promise<RequiredEppResponse> {
  const qs = new URLSearchParams({ industryPrefix }).toString();
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/required-epp?${qs}`,
    { method: 'GET' },
  );
  return jsonResponse<RequiredEppResponse>(res);
}

// ── 5. typical-hazards ─────────────────────────────────────────────────

export interface TypicalHazardsResponse {
  industryPrefix: string;
  label: string;
  typicalRisks: string[];
  mandatoryDocuments: string[];
  mandatoryTrainings: string[];
}

export async function fetchTypicalHazards(
  projectId: string,
  industryPrefix: string,
): Promise<TypicalHazardsResponse> {
  const qs = new URLSearchParams({ industryPrefix }).toString();
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/typical-hazards?${qs}`,
    { method: 'GET' },
  );
  return jsonResponse<TypicalHazardsResponse>(res);
}
