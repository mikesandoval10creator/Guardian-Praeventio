// Praeventio Guard — Risk Ranking client hook (4 mutators + 3 React hook stubs).

import { useState, useEffect, useCallback } from 'react';
import { apiAuthHeaders } from '../lib/apiAuth';
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

// ──────────────────────────────────────────────────────────────────────
// React hook stubs expected by orphan dashboard components (rescue-450)
// ──────────────────────────────────────────────────────────────────────
//
// `src/components/riskRanking/{RiskTimeseriesChart, TopRisksDashboardCard,
// WeakControlsDashboardCard}.tsx` were wired in rescue-450 PR #505 to
// these hook names, but none of them are mounted in any route. The hooks
// below return idle results (no fetch) so typecheck passes and the
// components render their "empty/loading" state if accidentally mounted.
//
// Real implementation requires new GET endpoints that don't yet exist —
// the existing rank*Api functions are push-based (client provides records),
// which doesn't fit the dashboard pull pattern. Tracked TODO §13 +
// `docs/stubs-inventory.md`.

interface AsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const NOOP = () => undefined;
function idleResult<T>(): AsyncResult<T> {
  return { data: null, loading: false, error: null, refetch: NOOP };
}

export interface RiskTimeseriesPoint {
  date: string;
  totalFindings: number;
  criticalFindings: number;
}
export interface RiskTimeseriesData {
  series: RiskTimeseriesPoint[];
}
/**
 * Stub — needs new `GET /api/sprint-k/{projectId}/risk-ranking/timeseries`
 * endpoint + server-side computation from `findings` collection. Tracked
 * TODO §13. Currently returns idle (data:null, loading:false) so the
 * orphan `RiskTimeseriesChart.tsx` renders its empty-window message.
 */
export function useRiskTimeseries(
  _projectId: string | null,
  _days: number = 30,
): AsyncResult<RiskTimeseriesData> {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return idleResult<RiskTimeseriesData>();
}

export interface TopRisksData {
  topRisks: Array<RiskRecord & { score: number }>;
}
/**
 * Stub — needs new `GET /api/sprint-k/{projectId}/risk-ranking/top-risks`
 * endpoint (pull-based, server fetches records then ranks). The existing
 * `rankRisksApi` is push-based and doesn't fit dashboard consumers.
 * Tracked TODO §13.
 */
export function useTopRisks(
  _projectId: string | null,
  _topN: number = 10,
): AsyncResult<TopRisksData> {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return idleResult<TopRisksData>();
}

export interface WeakControlsData {
  weakControls: ControlWeakness[];
}
/**
 * Stub — needs new `GET /api/sprint-k/{projectId}/risk-ranking/weak-controls`
 * endpoint (pull-based). The orphan `WeakControlsDashboardCard.tsx`
 * passes a `topN` arg so we accept it here for compile-time parity even
 * though the stub ignores it. Tracked TODO §13.
 */
export function useWeakControls(
  _projectId: string | null,
  _topN: number = 10,
): AsyncResult<WeakControlsData> {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return idleResult<WeakControlsData>();
}
