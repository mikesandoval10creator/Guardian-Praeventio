// Praeventio Guard — SLA Watch items hook.
//
// Fetches the project's REAL open incidents already assessed against their
// (kind × severity) SLA by the server (`GET /api/sprint-k/:projectId/sla-watch`,
// backed by the pure `assessSla` engine over genuine `createdAt`/`ts`).
//
// This replaced an earlier client-side mapper that stamped
// `createdAt: new Date()` on every corrective action — which made every item
// look brand-new and forever `within_sla` (a cascarón: the panel rendered but
// the SLA clock was fabricated). The age + severity now come from real docs.

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiAuthHeader } from '../lib/apiAuth';
import type { AssessedItem } from '../components/escalation/SlaWatchPanel';

interface SlaWatchResponse {
  now: string;
  items: AssessedItem[];
}

export function useSlaWatchItems(projectId: string | null) {
  const [items, setItems] = useState<AssessedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<Error | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchItems = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    controllerRef.current = ctl;
    setLoading(true);
    setError(null);
    try {
      const authHeader = await apiAuthHeader();
      const res = await fetch(`/api/sprint-k/${projectId}/sla-watch`, {
        signal: ctl.signal,
        headers: authHeader ? { Authorization: authHeader } : undefined,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `http_${res.status}`);
      }
      const json = (await res.json()) as SlaWatchResponse;
      if (!ctl.signal.aborted) {
        setItems(Array.isArray(json.items) ? json.items : []);
        setLoading(false);
      }
    } catch (err) {
      if (ctl.signal.aborted) return;
      setItems([]);
      setError(err as Error);
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchItems();
    return () => controllerRef.current?.abort();
  }, [fetchItems]);

  return { items, loading, error, refetch: fetchItems };
}
