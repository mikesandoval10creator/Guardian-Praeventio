// Praeventio Guard — Risk Ranking client hook (4 POST mutators + 3 REAL pull
// hooks: useTopRisks, useWeakControls, useRiskTimeseries — all wired to
// /api/insights/* over Zettelkasten-canonical sources, ADR 0020).

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  RiskRecord,
  ControlRecord,
  ControlWeakness,
  ZoneStats,
  TaskRiskRecord,
} from '../services/riskRanking/riskRankingEngine';
import type { RankedRiskNode } from '../services/riskRanking/riskNodeRanking';

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

/**
 * GET endpoint hook with abort + refetch (mirrors `useControlComparator`).
 * `path === null` (e.g. no project selected) stays idle without fetching.
 */
function useEndpoint<T>(path: string | null): AsyncResult<T> {
  const [state, setState] = useState<Omit<AsyncResult<T>, 'refetch'>>({
    data: null,
    loading: Boolean(path),
    error: null,
  });
  const [refetchKey, setRefetchKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const ctl = new AbortController();
    controllerRef.current = ctl;
    (async () => {
      try {
        const res = await authedFetch(path, { signal: ctl.signal });
        const data = await json<T>(res);
        if (!ctl.signal.aborted) setState({ data, loading: false, error: null });
      } catch (err) {
        if (ctl.signal.aborted) return;
        setState({ data: null, loading: false, error: err as Error });
      }
    })();
    return () => ctl.abort();
  }, [path, refetchKey]);

  const refetch = useCallback(() => setRefetchKey((k) => k + 1), []);
  return { ...state, refetch };
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
// Dashboard pull-hooks (B2 🔵, Fase 5 — replacing the rescue-450 stubs)
// ──────────────────────────────────────────────────────────────────────
//
// All three are now REAL pull-hooks over the Zettelkasten-canonical sources
// (ADR 0020) and their dashboard widgets are mounted in `Risks.tsx`:
//   • useTopRisks       ← RISK nodes ranked by DS44 IPER
//   • useWeakControls   ← control_validations
//   • useRiskTimeseries ← FINDING nodes bucketed by day

interface AsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
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
 * REAL (B2 🔵, Fase 5): pulls the project's findings trend from
 * `GET /api/insights/{projectId}/risk-timeseries`, a daily total/critical
 * series over the trailing window (FINDING nodes; ADR 0020). Replaces the idle
 * stub that fed the orphan `RiskTimeseriesChart`.
 */
export function useRiskTimeseries(
  projectId: string | null,
  days: number = 30,
): AsyncResult<RiskTimeseriesData> {
  return useEndpoint<RiskTimeseriesData>(
    projectId
      ? `/api/insights/${encodeURIComponent(projectId)}/risk-timeseries?days=${days}`
      : null,
  );
}

export interface TopRisksData {
  /** Ranked RISK nodes (Zettelkasten) by DS44 IPER score. */
  topRisks: RankedRiskNode[];
  /** Total RISK nodes considered (before topN). */
  total: number;
  computedAt: string;
}
/**
 * REAL (B2 🔵, Fase 5): pulls the project's top RISK nodes ranked by their DS44
 * IPER score from `GET /api/insights/{projectId}/top-risks` (Zettelkasten
 * source — see ADR 0020). Replaces the previous idle stub that fed an orphan
 * dashboard from empty flat collections.
 */
export function useTopRisks(
  projectId: string | null,
  topN: number = 10,
): AsyncResult<TopRisksData> {
  return useEndpoint<TopRisksData>(
    projectId
      ? `/api/insights/${encodeURIComponent(projectId)}/top-risks?topN=${topN}`
      : null,
  );
}

export interface WeakControlsData {
  /** Controls ranked by weakness (failure rate / overdue / never verified). */
  weakControls: ControlWeakness[];
  /** Distinct controls considered (before topN). */
  total: number;
  computedAt: string;
}
/**
 * REAL (B2 🔵, Fase 5): pulls the project's weakest critical controls from
 * `GET /api/insights/{projectId}/weak-controls`, aggregated server-side from
 * the terreno validation log (`control_validations`). Replaces the previous
 * idle stub that read the empty flat `controls` collection. See ADR 0020.
 */
export function useWeakControls(
  projectId: string | null,
  topN: number = 10,
): AsyncResult<WeakControlsData> {
  return useEndpoint<WeakControlsData>(
    projectId
      ? `/api/insights/${encodeURIComponent(projectId)}/weak-controls?topN=${topN}`
      : null,
  );
}
