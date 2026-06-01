// Praeventio Guard — Project Comparator client hook (1 mutator).

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  ProjectSnapshot,
  ComparisonReport,
} from '../services/projectComparator/projectComparator';

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

export interface CompareProjectsInput {
  snapshots: ProjectSnapshot[];
}
export interface CompareProjectsResponse {
  report: ComparisonReport;
}

export async function compareProjectsApi(
  projectId: string,
  input: CompareProjectsInput,
): Promise<CompareProjectsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/project-comparator/compare`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CompareProjectsResponse>(res);
}
