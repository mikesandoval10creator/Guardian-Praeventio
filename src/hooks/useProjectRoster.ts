// Praeventio Guard — project worker roster client hook.
//
// Reads the project's worker roster (uid + display name) for member-selection
// UIs (e.g. CPHS committee election). Backed by GET /api/projects/:id/roster
// (organic.ts), which unions crew memberUids and resolves users.displayName.

import { useEffect, useState } from 'react';
import { apiAuthHeaders } from '../lib/apiAuth';

export interface RosterMember {
  uid: string;
  fullName: string;
}

interface RosterResponse {
  roster: RosterMember[];
}

export async function fetchProjectRoster(projectId: string): Promise<RosterMember[]> {
  const res = await fetch(`/api/projects/${projectId}/roster`, {
    headers: { 'Content-Type': 'application/json', ...(await apiAuthHeaders()) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as RosterResponse;
  return data.roster ?? [];
}

/**
 * Loads the project roster reactively. Returns an empty list (not fabricated
 * data) until the real fetch resolves or if the project has no crews yet.
 */
export function useProjectRoster(projectId: string | null): {
  roster: RosterMember[];
  loading: boolean;
} {
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRoster([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchProjectRoster(projectId)
      .then((r) => {
        if (!cancelled) setRoster(r);
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { roster, loading };
}
