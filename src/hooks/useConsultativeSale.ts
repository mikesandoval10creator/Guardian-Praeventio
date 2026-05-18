// Praeventio Guard — Consultative Sale Playbook client hook
// (1 stateless mutator).

import { auth } from '../services/firebase';
import type {
  ProspectContext,
  SalePlaybook,
} from '../services/consultativeSale/consultativeSalePlaybook';

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
