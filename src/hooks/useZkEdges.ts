// Praeventio Guard — §ZK-5 PR-3c: hook para fetchear ZkEdge[] del backend.
//
// El endpoint POST /api/zettelkasten/get-edges (PR-3a, mergeado) retorna el
// ZkEdge[] COMPLETO con weight, validFrom, validUntil, decayFn, decayHalfLifeMs.
// Este hook cierra el loop frontend consumiendo esas aristas y exponiéndolas
// para que graphAnalytics (nodesToRiskGraphWithEdges) aplique effectiveWeight().
//
// Contracto:
//   - Si no hay projectId → no fetch (devuelve edges: []).
//   - Si hay projectId → POST /api/zettelkasten/get-edges con { projectId, limit }.
//   - Retorna { edges, loading, error }.
//   - Si el fetch falla → fallback a edges=[] (comportamiento legacy sigue).

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ZkEdge } from '../services/zettelkasten/edges';
import { apiAuthHeaderOrThrow } from '../lib/apiAuth';
import { logger } from '../utils/logger';

/**
 * Hook que fetchea las aristas ZkEdge de un proyecto desde el backend.
 *
 * @param projectId - ID del proyecto activo. Si es undefined/null, no hace fetch.
 * @returns { edges: ZkEdge[], loading: boolean, error?: string }
 *
 * Pattern: similar a useUniversalKnowledge — guarda projectId en dependency,
 * fetch con AbortController, normaliza la respuesta a ZkEdge[].
 */
export function useZkEdges(projectId?: string | null): {
  edges: ZkEdge[];
  loading: boolean;
  error?: string;
} {
  const [edges, setEdges] = useState<ZkEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestSequence = useRef(0);

  const fetchEdges = useCallback(async (pid: string, sequence: number) => {
    setLoading(true);
    setError(undefined);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const authHeader = await apiAuthHeaderOrThrow();
      const res = await fetch('/api/zettelkasten/get-edges', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({ projectId: pid, limit: 2000 }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${detail.error ?? res.statusText}`);
      }

      // El endpoint /get-edges ya retorna ZkEdge[] completo (PR-3a, ver brief).
      // No necesitamos normalización — confiamos en el contrato del backend.
      const data = (await res.json()) as { edges?: ZkEdge[] };
      const aristas = Array.isArray(data.edges) ? data.edges : [];

      if (requestSequence.current === sequence) {
        setEdges(aristas);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request cancelado — no seteamos error, es operacional.
        return;
      }
      if (requestSequence.current !== sequence) return;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('useZkEdges fetch failed', { projectId: pid, error: msg });
      setError(msg);
      setEdges([]);
    } finally {
      clearTimeout(timeoutId);
      if (requestSequence.current === sequence) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const sequence = ++requestSequence.current;

    if (!projectId) {
      setEdges([]);
      setError(undefined);
      setLoading(false);
      return;
    }

    // Clear the previous project's graph immediately. An older response may
    // still resolve after a project switch, so only the current sequence can
    // publish data or loading/error state.
    setEdges([]);
    void fetchEdges(projectId, sequence);
  }, [projectId, fetchEdges]);

  return { edges, loading, error };
}
