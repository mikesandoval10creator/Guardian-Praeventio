// Praeventio Guard — Risk Ranking client hook (4 mutators).

import { auth } from '../services/firebase';
import type {
  RiskRecord,
  ControlRecord,
  ControlWeakness,
  ZoneStats,
  TaskRiskRecord,
} from '../services/riskRanking/riskRankingEngine';

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

// ── 1. risks ──────────────────────────────────────────────────────────

export interface RankRisksResponse {
  ranking: Array<RiskRecord & { score: number }>;
}
export async function rankRisksApi(
  projectId: string,
  input: { records: RiskRecord[]; topN?: number },
): Promise<RankRisksResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/risk-ranking/risks`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RankRisksResponse>(res);
}

// ── 2. weak-controls ──────────────────────────────────────────────────

export interface RankWeakControlsResponse {
  ranking: ControlWeakness[];
}
export async function rankWeakControlsApi(
  projectId: string,
  input: { records: ControlRecord[]; topN?: number },
): Promise<RankWeakControlsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/risk-ranking/weak-controls`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RankWeakControlsResponse>(res);
}

// ── 3. zones ──────────────────────────────────────────────────────────

export interface RankZonesResponse {
  ranking: Array<ZoneStats & { score: number }>;
}
export async function rankZonesApi(
  projectId: string,
  input: { zones: ZoneStats[]; topN?: number },
): Promise<RankZonesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/risk-ranking/zones`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RankZonesResponse>(res);
}

// ── 4. tasks ──────────────────────────────────────────────────────────

export interface RankTasksResponse {
  ranking: Array<TaskRiskRecord & { score: number }>;
}
export async function rankTasksByRiskApi(
  projectId: string,
  input: { tasks: TaskRiskRecord[]; topN?: number },
): Promise<RankTasksResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/risk-ranking/tasks`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RankTasksResponse>(res);
}
