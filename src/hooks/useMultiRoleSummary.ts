// Praeventio Guard — Multi-Role Summary client hook (3 stateless mutators).

import type {
  LessonApplicabilityContext,
  ProjectSnapshot,
  RoleSummary,
  SummaryAudience,
  SummaryLanguage,
} from '../services/multiRoleSummary/roleSummaryComposer';
import { apiAuthHeaders } from '../lib/apiAuth';

async function authedFetch(
  path: string,
  init: RequestInit = {},

): Promise<Response> {
  // §2.20 migration (2026-05-21) — usa apiAuthHeaders() unificado:
  // prefiere E2E header en MODE=test, fallback a Bearer productivo.
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
  });
}

export interface ComposeRoleSummaryResponse {
  summary: RoleSummary;
}

export async function composeRoleSummary(
  projectId: string,
  snapshot: ProjectSnapshot,
  audience: SummaryAudience,
  language?: SummaryLanguage,
): Promise<ComposeRoleSummaryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/role-summary/compose`,
    {
      method: 'POST',
      body: JSON.stringify({ snapshot, audience, language }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as ComposeRoleSummaryResponse;
}

export interface ComposeAllAudiencesResponse {
  summaries: Record<SummaryAudience, RoleSummary>;
}

export async function composeAllAudiences(
  projectId: string,
  snapshot: ProjectSnapshot,
  language?: SummaryLanguage,
): Promise<ComposeAllAudiencesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/role-summary/compose-all`,
    {
      method: 'POST',
      body: JSON.stringify({ snapshot, language }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as ComposeAllAudiencesResponse;
}

export interface FilterLessonsResponse {
  lessons: NonNullable<ProjectSnapshot['transferableLessons']>;
}

export async function filterTransferableLessons(
  projectId: string,
  lessons: NonNullable<ProjectSnapshot['transferableLessons']>,
  context: LessonApplicabilityContext,
): Promise<FilterLessonsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/role-summary/filter-lessons`,
    {
      method: 'POST',
      body: JSON.stringify({ lessons, context }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as FilterLessonsResponse;
}
