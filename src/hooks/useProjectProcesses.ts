// Praeventio Guard — project processes client hook.
//
// Reads the organic Crew→Process pipeline for a project. Backed by
// GET /api/processes?projectId=… (organic.ts), which reads the REAL top-level
// `processes` collection (server is the single writer for the positive-XP
// economy) filtered by projectId and tenant-gated by assertProjectMember.
//
// Returns an empty list (NOT fabricated rows) until the fetch resolves or if the
// project has no processes yet — the consumer renders an honest empty state.

import { useCallback, useEffect, useState } from 'react';
import { apiAuthHeaders } from '../lib/apiAuth';
import type { Process } from '../types/organic';

interface ProcessesResponse {
  processes: Process[];
}

export async function fetchProjectProcesses(projectId: string): Promise<Process[]> {
  const res = await fetch(`/api/processes?projectId=${encodeURIComponent(projectId)}`, {
    headers: { 'Content-Type': 'application/json', ...(await apiAuthHeaders()) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as ProcessesResponse;
  return data.processes ?? [];
}

/**
 * Loads the project's processes reactively. Exposes `refresh` so a consumer can
 * re-pull after closing a process (the close write happens via POST
 * /api/processes/:id/close).
 */
export function useProjectProcesses(projectId: string | null): {
  processes: Process[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setProcesses([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProjectProcesses(projectId)
      .then((p) => {
        if (!cancelled) setProcesses(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setProcesses([]);
          setError(err instanceof Error ? err.message : 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  return { processes, loading, error, refresh };
}
