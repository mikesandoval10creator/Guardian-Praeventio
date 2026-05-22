// Praeventio Guard — Consultative Sale Playbook client hook
// (1 stateless mutator).

import type {
  ProspectContext,
  SalePlaybook,
} from '../services/consultativeSale/consultativeSalePlaybook';
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

export interface BuildSalePlaybookResponse {
  playbook: SalePlaybook;
}

export async function buildSalePlaybookForProspect(
  projectId: string,
  ctx: ProspectContext,
): Promise<BuildSalePlaybookResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/sales/build-playbook`,
    { method: 'POST', body: JSON.stringify(ctx) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as BuildSalePlaybookResponse;
}
