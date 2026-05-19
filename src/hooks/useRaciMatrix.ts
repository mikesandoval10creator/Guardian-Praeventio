// Praeventio Guard — RACI Matrix client hook (6 mutators).

import { auth } from '../services/firebase';
import type {
  TaskRoleAssignment,
  RaciMatrix,
  RaciValidationResult,
  RoleOverloadReport,
  CriticalGap,
} from '../services/raciMatrix/raciMatrixEngine';

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

// ── 1. build ───────────────────────────────────────────────────────────

export interface BuildRaciMatrixInput {
  taskId: string;
  taskTitle: string;
  assignments: TaskRoleAssignment[];
  critical?: boolean;
}
export interface BuildRaciMatrixResponse {
  matrix: RaciMatrix;
}

export async function buildRaciMatrixRemote(
  projectId: string,
  input: BuildRaciMatrixInput,
): Promise<BuildRaciMatrixResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/raci-matrix/build`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildRaciMatrixResponse>(res);
}

// ── 2. validate ────────────────────────────────────────────────────────

export interface ValidateRaciInput {
  matrix: RaciMatrix;
}
export interface ValidateRaciResponse {
  result: RaciValidationResult;
}

export async function validateRaciMatrix(
  projectId: string,
  input: ValidateRaciInput,
): Promise<ValidateRaciResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/raci-matrix/validate`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateRaciResponse>(res);
}

// ── 3. detect-overload ─────────────────────────────────────────────────

export interface DetectOverloadInput {
  matrices: RaciMatrix[];
  uid: string;
}
export interface DetectOverloadResponse {
  report: RoleOverloadReport;
}

export async function detectRaciRoleOverload(
  projectId: string,
  input: DetectOverloadInput,
): Promise<DetectOverloadResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/raci-matrix/detect-overload`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectOverloadResponse>(res);
}

// ── 4. find-critical-gaps ──────────────────────────────────────────────

export interface MatricesInput {
  matrices: RaciMatrix[];
}
export interface FindCriticalGapsResponse {
  gaps: CriticalGap[];
}

export async function findRaciCriticalGaps(
  projectId: string,
  input: MatricesInput,
): Promise<FindCriticalGapsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/raci-matrix/find-critical-gaps`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FindCriticalGapsResponse>(res);
}

// ── 5. list-uids ───────────────────────────────────────────────────────

export interface ListUidsResponse {
  uids: string[];
}

export async function listRaciUidsInMatrices(
  projectId: string,
  input: MatricesInput,
): Promise<ListUidsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/raci-matrix/list-uids`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ListUidsResponse>(res);
}

// ── 6. summarize-health ────────────────────────────────────────────────

export interface SummarizeHealthResponse {
  summary: {
    totalMatrices: number;
    validMatrices: number;
    criticalGapCount: number;
    overloadedUids: string[];
  };
}

export async function summarizeRaciHealthRemote(
  projectId: string,
  input: MatricesInput,
): Promise<SummarizeHealthResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/raci-matrix/summarize-health`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeHealthResponse>(res);
}
