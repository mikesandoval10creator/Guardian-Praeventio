// Praeventio Guard — Medical Catalogs lookup client hook (6 lookups).
//
// Sprint 21 Bucket R + Fase 3.C — los 3 catálogos bundled
// (ICD-10/DS 109, WHO ATC/DrugBank, Wikipedia ES/DS 594) son accesibles
// vía HTTP para UIs que no quieran bundlear los 50+ entries.

import { auth } from '../services/firebase';
import type {
  DiagnosisEntry,
  DrugEntry,
  AnatomyEntry,
} from '../data/medical';

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

interface SearchResponse<T> {
  results: T[];
  total: number;
}

// ── diagnoses ────────────────────────────────────────────────────────

export async function searchDiagnosesApi(
  projectId: string,
  input: { query: string; occupationalOnly?: boolean; limit?: number },
): Promise<SearchResponse<DiagnosisEntry>> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/medical-catalogs/diagnoses/search`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SearchResponse<DiagnosisEntry>>(res);
}

export async function diagnosesByRiskAgentApi(
  projectId: string,
  input: { agent: string; limit?: number },
): Promise<SearchResponse<DiagnosisEntry>> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/medical-catalogs/diagnoses/by-risk-agent`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SearchResponse<DiagnosisEntry>>(res);
}

// ── drugs ───────────────────────────────────────────────────────────

export async function searchDrugsApi(
  projectId: string,
  input: { query: string; category?: string; limit?: number },
): Promise<SearchResponse<DrugEntry>> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/medical-catalogs/drugs/search`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SearchResponse<DrugEntry>>(res);
}

// ── anatomy ─────────────────────────────────────────────────────────

export async function searchAnatomyApi(
  projectId: string,
  input: { query: string; system?: string; limit?: number },
): Promise<SearchResponse<AnatomyEntry>> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/medical-catalogs/anatomy/search`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SearchResponse<AnatomyEntry>>(res);
}

export async function anatomyBySystemApi(
  projectId: string,
  input: { system: string; limit?: number },
): Promise<SearchResponse<AnatomyEntry>> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/medical-catalogs/anatomy/by-system`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SearchResponse<AnatomyEntry>>(res);
}

// ── meta ────────────────────────────────────────────────────────────

export interface CatalogMeta {
  meta: {
    name: string;
    version: string;
    license: string;
    source: string;
    scope: string;
    disclaimer: string;
    lastUpdated: string;
    todoExpand?: string;
  };
  count: number;
}

export interface MedicalCatalogsMeta {
  diagnoses: CatalogMeta;
  drugs: CatalogMeta;
  anatomy: CatalogMeta;
}

export async function listMedicalCatalogsMetaApi(
  projectId: string,
): Promise<MedicalCatalogsMeta> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/medical-catalogs/list-meta`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<MedicalCatalogsMeta>(res);
}
