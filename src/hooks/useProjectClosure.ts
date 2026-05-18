// Praeventio Guard — §131-138 Project Closure hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

export type ClosureRole = 'worker' | 'supervisor' | 'gerencia';

export interface ClosureState {
  status: 'open' | 'initiated' | 'finalized';
  initiatedAt: string | null;
  initiatedByUid: string | null;
  finalizedAt: string | null;
  finalizedByUid: string | null;
}

export interface ClosureStatusResponse {
  state: ClosureState;
  readinessPercent: number;
  canClose: boolean;
  blockers: string[];
  warnings: string[];
  pending: {
    openIncidents: number;
    openActions: number;
    openPermits: number;
    lessonsCaptured: number;
    decisionsLogged: number;
  };
}

export function useClosureStatus(projectId: string | null) {
  return useEndpoint<ClosureStatusResponse>(
    projectId ? `/api/sprint-k/${projectId}/closure/status` : null,
  );
}

export interface ClosureSummaryResponse {
  summary: {
    audience: 'management' | 'client' | 'operations' | 'regulatory';
    highlights: Array<{ label: string; value: string }>;
    narrative: string;
  };
  role: string;
  audience: string;
  counts: {
    lessons: number;
    decisions: number;
    incidents: number;
    criticalIncidents: number;
  };
}

export function useClosureSummary(
  projectId: string | null,
  role: ClosureRole,
) {
  const path =
    projectId !== null
      ? `/api/sprint-k/${projectId}/closure/summary?role=${encodeURIComponent(
          role,
        )}`
      : null;
  return useEndpoint<ClosureSummaryResponse>(path);
}

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function initiateClosure(
  projectId: string,
): Promise<ClosureState> {
  const json = await authedPost<{ ok: true; state: ClosureState }>(
    `/api/sprint-k/${projectId}/closure/initiate`,
    {},
  );
  return json.state;
}

export interface CaptureLessonPayload {
  summary: string;
  preventiveAction: string;
  industry: string;
  riskCategories?: string[];
  tags?: string[];
}

export interface CapturedLesson {
  id: string;
  summary: string;
  preventiveAction: string;
  riskCategories: string[];
  tags: string[];
  industry: string;
  capturedAt: string;
  capturedByUid: string;
  publishedLessonId: string | null;
}

export async function captureLesson(
  projectId: string,
  payload: CaptureLessonPayload,
): Promise<CapturedLesson> {
  const json = await authedPost<{ ok: true; lesson: CapturedLesson }>(
    `/api/sprint-k/${projectId}/closure/lessons`,
    payload,
  );
  return json.lesson;
}

export interface LogDecisionPayload {
  decidedAt: string;
  context: string;
  decision: string;
  outcome: 'positive' | 'neutral' | 'negative';
  decidedByUid?: string;
}

export interface LoggedDecision {
  id: string;
  decidedAt: string;
  context: string;
  decision: string;
  decidedByUid: string;
  outcome: 'positive' | 'neutral' | 'negative';
  loggedAt: string;
  loggedByUid: string;
}

export async function logDecision(
  projectId: string,
  payload: LogDecisionPayload,
): Promise<LoggedDecision> {
  const json = await authedPost<{ ok: true; decision: LoggedDecision }>(
    `/api/sprint-k/${projectId}/closure/decisions`,
    payload,
  );
  return json.decision;
}

export async function finalizeClosure(
  projectId: string,
): Promise<ClosureState> {
  const json = await authedPost<{ ok: true; state: ClosureState }>(
    `/api/sprint-k/${projectId}/closure/finalize`,
    {},
  );
  return json.state;
}
