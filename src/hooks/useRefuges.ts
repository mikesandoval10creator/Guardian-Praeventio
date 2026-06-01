// Praeventio Guard — Mountain Refuges client hook (3 mutators).

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  MountainRefuge,
  RefugeWithDistance,
} from '../services/refuges/mountainRefuges';

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

// ── 1. list-catalog ────────────────────────────────────────────────────

export async function listRefugesCatalogApi(
  projectId: string,
  input: { region?: MountainRefuge['region']; requireYearRound?: boolean },
): Promise<{ refuges: MountainRefuge[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/refuges/list-catalog`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ refuges: MountainRefuge[] }>(res);
}

// ── 2. find-nearest ────────────────────────────────────────────────────

export async function findNearestRefugesApi(
  projectId: string,
  input: {
    lat: number;
    lng: number;
    count?: number;
    region?: MountainRefuge['region'];
    requireYearRound?: boolean;
  },
): Promise<{ refuges: RefugeWithDistance[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/refuges/find-nearest`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ refuges: RefugeWithDistance[] }>(res);
}

// ── 3. availability ────────────────────────────────────────────────────

export async function getRefugeAvailabilityApi(
  projectId: string,
  input: { season: MountainRefuge['season'] },
): Promise<{ availability: 'open' | 'check' | 'closed' }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/refuges/availability`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ availability: 'open' | 'check' | 'closed' }>(res);
}
