// Praeventio Guard — CEAL-SM/SUSESO client (campaigns + anonymous response
// + k-gated results). All writes go through /api/sprint-k/:projectId/ceal-sm/*
// where identity is stamped from the verified token and answers are stored
// anonymously (responder hash, never a uid) — see src/server/routes/cealSm.ts.

import type {
  CealAnswers,
  CealSmCenterResult,
} from '../services/protocols/cealSm';
import { apiAuthHeaders } from '../lib/apiAuth';

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.error ?? body.message ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── Types mirroring the server contracts ────────────────────────────────

export interface CealCampaignSummary {
  id: string;
  title: string;
  status: 'open' | 'closed';
  openAt: string;
  closeAt: string;
  totalWorkers: number;
  createdAt: string;
  responseCount: number;
  participationRate: number | null;
  hasResponded: boolean;
}

export interface CreateCealCampaignInput {
  title: string;
  openAt: string;
  closeAt: string;
  totalWorkers: number;
}

export interface CealResultsResponse {
  campaignId: string;
  title: string;
  status: 'open' | 'closed';
  openAt: string;
  closeAt: string;
  totalWorkers: number;
  totalResponses: number;
  participationRate: number | null;
  insufficientResponses: boolean;
  threshold?: number;
  result: CealSmCenterResult | null;
}

// ── Calls ────────────────────────────────────────────────────────────────

export async function createCealCampaign(
  projectId: string,
  input: CreateCealCampaignInput,
): Promise<{ id: string }> {
  const res = await authedFetch(`/api/sprint-k/${projectId}/ceal-sm/campaigns`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return json<{ id: string }>(res);
}

export async function listCealCampaigns(
  projectId: string,
): Promise<{ campaigns: CealCampaignSummary[] }> {
  const res = await authedFetch(`/api/sprint-k/${projectId}/ceal-sm/campaigns`, {
    method: 'GET',
  });
  return json<{ campaigns: CealCampaignSummary[] }>(res);
}

export async function submitCealResponse(
  projectId: string,
  campaignId: string,
  answers: CealAnswers,
): Promise<{ ok: boolean }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ceal-sm/campaigns/${campaignId}/respond`,
    { method: 'POST', body: JSON.stringify({ answers }) },
  );
  return json<{ ok: boolean }>(res);
}

export async function getCealResults(
  projectId: string,
  campaignId: string,
): Promise<CealResultsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ceal-sm/campaigns/${campaignId}/results`,
    { method: 'GET' },
  );
  return json<CealResultsResponse>(res);
}
