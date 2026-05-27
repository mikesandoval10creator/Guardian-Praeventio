// Praeventio Guard — useOperationalChange (Bloque 3.17, adapter-backed MOC).
//
// Mirror del patrón useLoneWorker.ts + useCorrectiveActions.ts: wrappers
// para la superficie HTTP en `src/server/routes/operationalChange.ts`
// montada en `/api/sprint-k`.
//
// Distinto del existente `useChangeMgmt.ts` (pure-compute, ningún estado
// en Firestore): aquí el server persiste declaraciones + acks y permite
// listar pending/recientes. Pensado para banners de trabajador (pending
// acks) y dashboards admin (list + close).

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type {
  OperationalChange,
  ChangeKind,
  ChangeImpact,
  ChangeAcknowledgementSummary,
} from '../services/changeMgmt/operationalChangeService';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
    };
    const err = new Error(body.message ?? body.error ?? `http_${res.status}`);
    (err as Error & { code?: string; status?: number }).code = body.code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ── 1. declare ─────────────────────────────────────────────────────────

export interface DeclareMocInput {
  id?: string;
  kind: ChangeKind;
  whatChanged: string;
  previousValue: string;
  newValue: string;
  rationale: string;
  impact: ChangeImpact;
  affectedWorkerUids: string[];
  declaredByRole: string;
  effectiveFrom: string;
  referenceDocumentId?: string;
}

export interface DeclareMocResponse {
  change: OperationalChange;
}

export async function declareMoc(
  projectId: string,
  input: DeclareMocInput,
  idempotencyKey?: string,
): Promise<DeclareMocResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(`/api/sprint-k/${projectId}/moc/declare`, {
    method: 'POST',
    body: JSON.stringify(input),
    headers,
  });
  return json<DeclareMocResponse>(res);
}

// ── 2. pending-acks ────────────────────────────────────────────────────

export interface PendingAcksResponse {
  pending: OperationalChange[];
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
        const user = auth.currentUser;
        const token = user ? await user.getIdToken() : null;
        const res = await fetch(path, {
          signal: ctl.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `http_${res.status}`);
        }
        const data = (await res.json()) as T;
        if (!ctl.signal.aborted) {
          setState({ data, loading: false, error: null });
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

/**
 * MOCs declarados para los que el caller es worker afectado y AÚN no ha
 * acknowledgado. Para banner worker-facing.
 */
export function usePendingMocAcks(projectId: string | null) {
  const path = projectId ? `/api/sprint-k/${projectId}/moc/pending-acks` : null;
  return useEndpoint<PendingAcksResponse>(path);
}

// ── 3. acknowledge ─────────────────────────────────────────────────────

export interface AcknowledgeMocResponse {
  change: OperationalChange;
}

export async function acknowledgeMoc(
  projectId: string,
  mocId: string,
  ackedAt?: string,
  idempotencyKey?: string,
): Promise<AcknowledgeMocResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const body: { ackedAt?: string } = {};
  if (ackedAt) body.ackedAt = ackedAt;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/moc/${encodeURIComponent(mocId)}/acknowledge`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    },
  );
  return json<AcknowledgeMocResponse>(res);
}

// ── 4. list ────────────────────────────────────────────────────────────

export interface MocListResponse {
  items: OperationalChange[];
  summaries: ChangeAcknowledgementSummary[];
}

export interface UseMocListOpts {
  kind?: ChangeKind;
  limit?: number;
}

export function useMocList(
  projectId: string | null,
  opts: UseMocListOpts = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.kind) qs.set('kind', opts.kind);
    if (opts.limit) qs.set('limit', String(opts.limit));
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/moc/list${query ? `?${query}` : ''}`;
  }
  return useEndpoint<MocListResponse>(path);
}

// ── 5. close ───────────────────────────────────────────────────────────

export interface CloseMocResponse {
  ok: true;
  mocId: string;
  implementedAt: string;
  implementedBy: string;
}

export async function closeMoc(
  projectId: string,
  mocId: string,
  closingNote?: string,
  idempotencyKey?: string,
): Promise<CloseMocResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const body: { closingNote?: string } = {};
  if (closingNote) body.closingNote = closingNote;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/moc/${encodeURIComponent(mocId)}/close`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    },
  );
  return json<CloseMocResponse>(res);
}
