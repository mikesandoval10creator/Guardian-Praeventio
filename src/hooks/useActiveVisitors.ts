// Praeventio Guard — §23-24 Visitor Control hook (active list).
//
// Hook fetch-based para `GET /api/visitors?projectId=…` (router canónico
// `src/server/routes/visitors.ts`, mounted en `/api/visitors` desde
// `server.ts`). Devuelve `{ ok, visitors }` con `visitors` ya filtrado a
// las visitas activas (`checkOutAt == null`) server-side.
//
// FIX 2026-06-20 (feat/mount-visitor-checkin): este hook apuntaba al
// endpoint legacy `/api/sprint-k/:projectId/visitors/active` que NO existe
// en el backend (el monolito `useSprintK.ts` se desmontó), por lo que el
// hook era un huérfano que jamás habría servido datos reales. Se reapunta
// al endpoint canónico real y se alinea el tipo de retorno con el contrato
// REAL del router (`Visitor[]` de `visitorControl/visitorRegistry.ts`), NO
// el `VisitorAccess` del servicio de control de acceso, que no tiene
// endpoint HTTP y cuyos campos (`identityDocument`, `organization`, `kind`,
// `checkedInAt`) el backend nunca emite — devolverlos sería dato fabricado.

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Visitor } from '../services/visitorControl/visitorRegistry';
import { apiAuthHeader } from '../lib/apiAuth';

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

export interface ActiveVisitorsResponse {
  ok: true;
  /** Already filtered to active visits (no `checkOutAt`) by the router. */
  visitors: Visitor[];
}

/**
 * Subscribe to the active-visit list for a project. Returns `{ data, loading,
 * error, refetch }` where `data.visitors` is the REAL `Visitor[]` served by
 * `GET /api/visitors?projectId=…`. Passing `null` (no project / not signed in)
 * disables the fetch and yields `{ data: null, loading: false }`.
 */
export function useActiveVisitors(projectId: string | null) {
  return useEndpoint<ActiveVisitorsResponse>(
    projectId
      ? `/api/visitors?projectId=${encodeURIComponent(projectId)}`
      : null,
  );
}
