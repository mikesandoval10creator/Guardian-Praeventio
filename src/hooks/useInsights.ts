// Praeventio Guard — Wire UI bridge hooks (PASO 2 cierre).
//
// Lightweight fetch-based hooks that drive the dashboard widgets.
// The project doesn't ship react-query; we follow the existing pattern
// (useState + useEffect + fetch) and let the widgets render the
// returned data. Each hook:
//   - reads the caller's Firebase ID token for Authorization
//   - returns { data, loading, error, refetch }
//   - aborts in-flight requests on unmount to prevent setState-after-unmount
//
// Endpoints contract:
//   GET /api/insights/:projectId/risk-ranking
//   GET /api/insights/:projectId/safety-talks
//   GET /api/insights/:projectId/role-view
//   GET /api/sitebook/:projectId/entries?year=YYYY

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type {
  RiskRecord,
  ControlRecord,
} from '../services/riskRanking/riskRankingEngine';
import type { SafetyTalkSuggestion } from '../services/safetyTalks/talkTopicSuggester';
import type { RoleViewState, RoleCard } from '../services/roleViews/roleViewBuilder';
import type { SiteBookEntry } from '../services/siteBook/siteBookService';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(path: string, signal: AbortSignal): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function useEndpoint<T>(path: string | null): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  });
  const [refetchKey, setRefetchKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const ctl = new AbortController();
    controllerRef.current = ctl;

    (async () => {
      try {
        const res = await authedFetch(path, ctl.signal);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `http_${res.status}`);
        }
        const json = (await res.json()) as T;
        if (!ctl.signal.aborted) {
          setState({ data: json, loading: false, error: null });
        }
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

// ────────────────────────────────────────────────────────────────────────
// Public hooks
// ────────────────────────────────────────────────────────────────────────

export interface RiskRankingResponse {
  topRisks: Array<RiskRecord & { score: number }>;
  weakControls: Array<{ controlId: string; label: string; failureRate: number; isStale: boolean; weaknessScore: number }>;
  computedAt: string;
}

export function useRiskRanking(projectId: string | null, topN = 5) {
  return useEndpoint<RiskRankingResponse>(
    projectId ? `/api/insights/${projectId}/risk-ranking?topN=${topN}` : null,
  );
}

export interface SafetyTalksResponse {
  suggestions: SafetyTalkSuggestion[];
  signalsSummary: { counts: { incidents: number; risks: number; tasks: number; findings: number } };
}

export function useSafetyTalks(projectId: string | null) {
  return useEndpoint<SafetyTalksResponse>(
    projectId ? `/api/insights/${projectId}/safety-talks` : null,
  );
}

export interface RoleViewResponse {
  state: RoleViewState;
  cards: RoleCard[];
  userEmail: string | null;
}

export function useRoleView(projectId: string | null) {
  return useEndpoint<RoleViewResponse>(
    projectId ? `/api/insights/${projectId}/role-view` : null,
  );
}

export interface SiteBookEntriesResponse {
  entries: SiteBookEntry[];
  year: number;
  count: number;
}

export function useSiteBookEntries(projectId: string | null, year?: number) {
  const yearPart = year ? `?year=${year}` : '';
  return useEndpoint<SiteBookEntriesResponse>(
    projectId ? `/api/sitebook/${projectId}/entries${yearPart}` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mutations (manual — no react-query Mutation primitive available)
// ────────────────────────────────────────────────────────────────────────

export interface CreateSiteBookEntryInput {
  kind: SiteBookEntry['kind'];
  occurredAt: string;
  description: string;
  location?: string;
  involvedWorkerUids?: string[];
}

export async function createSiteBookEntry(
  projectId: string,
  input: CreateSiteBookEntryInput,
): Promise<SiteBookEntry> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sitebook/${projectId}/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as SiteBookEntry;
}

export async function requestAuditExpressBundle(
  projectId: string,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/audit/express-bundle?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { downloadUrl: string; expiresAt: string };
}
