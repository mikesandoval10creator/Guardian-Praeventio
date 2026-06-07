// Praeventio Guard — LOTO Digital hook.
//
// Hook fetch-based para `/api/sprint-k/:projectId/loto`.
// Migrado del monolito `useSprintK.ts` (2026-05-18).

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type { LotoApplication } from '../services/loto/lotoDigitalLight';
import type { EnergyType } from '../services/criticalControls/controlRobustness';
import { apiAuthHeader, apiAuthHeaders } from '../lib/apiAuth';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(
  path: string,
  signal: AbortSignal,
): Promise<Response> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  return fetch(path, {
    signal,
    headers: authHeader ? { Authorization: authHeader } : undefined,
  });
}

function useEndpoint<T>(
  path: string | null,
): FetchState<T> & { refetch: () => void } {
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
      return undefined;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const ctl = new AbortController();
    controllerRef.current = ctl;

    (async () => {
      try {
        const res = await authedFetch(path, ctl.signal);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
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

export interface LotoResponse {
  applications: LotoApplication[];
}

export function useLoto(
  projectId: string | null,
  opts: { equipmentId?: string } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.equipmentId) qs.set('equipmentId', opts.equipmentId);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/loto${query ? `?${query}` : ''}`;
  }
  return useEndpoint<LotoResponse>(path);
}

// ─── Write-path client (B8, Fase 5) ────────────────────────────────────────
// Thin POST helpers for the LOTO write endpoints. The server stamps the actor
// identity from the verified token and gates release by leader/authorized
// worker; these just carry the form fields + Authorization header.

async function lotoPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await apiAuthHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export interface CreateLotoInput {
  equipmentId: string;
  workDescription: string;
  energiesIdentified: EnergyType[];
  authorizedWorkerUids?: string[];
}

export interface ApplyLockInput {
  pointId: string;
  description: string;
  energyType: EnergyType;
  tagId: string;
}

export function createLotoApplication(
  projectId: string,
  input: CreateLotoInput,
): Promise<{ application: LotoApplication }> {
  return lotoPost(`/api/sprint-k/${projectId}/loto`, input);
}

export function applyLotoLock(
  projectId: string,
  appId: string,
  input: ApplyLockInput,
): Promise<{ application: LotoApplication }> {
  return lotoPost(`/api/sprint-k/${projectId}/loto/${appId}/apply-lock`, input);
}

export function verifyLotoZeroEnergy(
  projectId: string,
  appId: string,
  pointId: string,
): Promise<{ application: LotoApplication }> {
  return lotoPost(`/api/sprint-k/${projectId}/loto/${appId}/verify-zero-energy`, { pointId });
}

export function releaseLoto(
  projectId: string,
  appId: string,
): Promise<{ application: LotoApplication }> {
  return lotoPost(`/api/sprint-k/${projectId}/loto/${appId}/release`, {});
}
