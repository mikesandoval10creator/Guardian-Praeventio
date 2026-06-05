// Praeventio Guard — Risk Ranking client hook (4 POST mutators + useTopRisks
// real pull-hook + 2 remaining stubs: useRiskTimeseries, useWeakControls).

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
// `useTopRisks` is now REAL: it fetches the Zettelkasten-backed
// `GET /api/insights/{projectId}/top-risks` and `TopRisksDashboardCard` is
// mounted in `Risks.tsx`. `useRiskTimeseries` (← findings) and
// `useWeakControls` (← control_validations) remain idle stubs pending their
// own endpoints — next PRs. Tracked TODO §13 + `docs/stubs-inventory.md`.

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
  return idleResult<RiskTimeseriesData>();
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
  return idleResult<WeakControlsData>();
}
