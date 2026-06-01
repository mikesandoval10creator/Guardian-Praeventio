// Praeventio Guard — Regulatory Framework client hook (5 lookups).
//
// Engine vive en `src/services/regulatory/registry.ts` con baseline ISO
// 45001 + 14 jurisdicciones (CL, US-OSHA, EU, MX, BR, UK, CA, AU, JP,
// KR, IN, CN, TW, RU). Cada control puede citar varias normas; el
// hook expone los 5 lookups esenciales para UIs de Normatives,
// Compliance dashboards y citation snippets.

import { apiAuthHeaders } from '../lib/apiAuth';
import type { TenantRegulatoryContext } from '../services/regulatory/registry';
import type {
  JurisdictionCode,
  ComplianceControl,
  RegulationRef,
} from '../services/regulatory/types';
import type { TierId } from '../services/pricing/tiers';

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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. active-jurisdictions ────────────────────────────────────────────

export async function getActiveJurisdictionsApi(
  projectId: string,
  input: { ctx: TenantRegulatoryContext; tier?: TierId },
): Promise<{ jurisdictions: JurisdictionCode[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/regulatory/active-jurisdictions`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ jurisdictions: JurisdictionCode[] }>(res);
}

// ── 2. cite ────────────────────────────────────────────────────────────

export async function citeRegulatoryApi(
  projectId: string,
  input: {
    controlId: string;
    jurisdictions: JurisdictionCode[];
    format?: 'short' | 'long';
  },
): Promise<{ citations: string[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/regulatory/cite`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ citations: string[] }>(res);
}

// ── 3. resolve-control ─────────────────────────────────────────────────

export async function resolveRegulatoryControlApi(
  projectId: string,
  input: { controlId: string; jurisdictions: JurisdictionCode[] },
): Promise<{ control: ComplianceControl | null }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/regulatory/resolve-control`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ control: ComplianceControl | null }>(res);
}

// ── 4. list-controls ───────────────────────────────────────────────────

export async function listRegulatoryControlsApi(
  projectId: string,
): Promise<{ controls: ComplianceControl[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/regulatory/list-controls`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<{ controls: ComplianceControl[] }>(res);
}

// ── 5. references ──────────────────────────────────────────────────────

export async function getRegulatoryReferencesApi(
  projectId: string,
  input: { controlId: string; jurisdictions: JurisdictionCode[] },
): Promise<{ references: RegulationRef[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/regulatory/references`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ references: RegulationRef[] }>(res);
}
