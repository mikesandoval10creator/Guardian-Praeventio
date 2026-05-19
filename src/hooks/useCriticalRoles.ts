// Praeventio Guard — Critical Roles client hook (4 mutators).

import { auth } from '../services/firebase';
import type {
  Industry,
  CriticalRoleDefinition,
  WorkerProfile,
  RoleCoverage,
  TrainingPlan,
} from '../services/criticalRoles/criticalRolesMap';

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
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. for-industry ────────────────────────────────────────────────────

export interface ForIndustryInput {
  industry: Industry;
}
export interface ForIndustryResponse {
  roles: CriticalRoleDefinition[];
}

export async function getCriticalRolesForIndustry(
  projectId: string,
  input: ForIndustryInput,
): Promise<ForIndustryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-roles/for-industry`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ForIndustryResponse>(res);
}

// ── 2. find-by-code ────────────────────────────────────────────────────

export interface FindByCodeInput {
  code: string;
}
export interface FindByCodeResponse {
  role: CriticalRoleDefinition;
}

export async function findCriticalRoleByCode(
  projectId: string,
  input: FindByCodeInput,
): Promise<FindByCodeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-roles/find-by-code`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FindByCodeResponse>(res);
}

// ── 3. build-coverage ──────────────────────────────────────────────────

export interface BuildCoverageInput {
  role: CriticalRoleDefinition;
  workers: WorkerProfile[];
}
export interface BuildCoverageResponse {
  coverage: RoleCoverage;
}

export async function buildCriticalRoleCoverage(
  projectId: string,
  input: BuildCoverageInput,
): Promise<BuildCoverageResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-roles/build-coverage`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildCoverageResponse>(res);
}

// ── 4. suggest-training ────────────────────────────────────────────────

export interface SuggestTrainingInput {
  coverage: RoleCoverage;
  workers: WorkerProfile[];
}
export interface SuggestTrainingResponse {
  plan: TrainingPlan;
}

export async function suggestCriticalRoleTraining(
  projectId: string,
  input: SuggestTrainingInput,
): Promise<SuggestTrainingResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-roles/suggest-training`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SuggestTrainingResponse>(res);
}
