// Praeventio Guard — Bloque 4.3 useIncidentFlow client hook.
//
// Wraps the 7 endpoints exposed by `src/server/routes/incidentFlow.ts`.
// Reuses the `_fetchUtils` `useEndpoint` for the GET (status) and exposes
// imperative mutators for each POST step. Returns refetch handles so the
// UI can refresh the status overview after each step.

import { apiAuthHeaders } from '../lib/apiAuth';
import { useEndpoint } from './_fetchUtils';
import type { PdcaStatus } from '../services/zettelkasten/flows/incidentLessonTrainingFlow';

export interface IncidentReportPayload {
  incidentId: string;
  occurredAtIso: string;
  description: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  involvedWorkerUids?: string[];
  location?: string;
  photoStorageUrl?: string;
}

export interface OpenInvestigationPayload {
  investigatorUid: string;
  openedAtIso: string;
  scopeNotes: string;
  report: IncidentReportPayload;
}

export interface ConcludeInvestigationPayload {
  concludedAtIso: string;
  rootCauseSummary: string;
  contributingFactor?: string;
  preventiveActions: string[];
  opening: {
    investigatorUid: string;
    openedAtIso: string;
    scopeNotes: string;
  };
}

export interface PublishLessonPayload {
  lessonId: string;
  publishedAtIso: string;
  summary: string;
  audienceUids: string[];
  tags: string[];
  riskCategories: string[];
  conclusion: {
    concludedAtIso: string;
    rootCauseSummary: string;
    contributingFactor?: string;
    preventiveActions: string[];
    closedByUid: string;
  };
}

export interface AssignMicrotrainingPayload {
  moduleId: string;
  workerUids: string[];
  assignedAtIso: string;
  lesson: {
    lessonId: string;
    publishedAtIso: string;
    summary: string;
    audienceUids: string[];
    tags: string[];
    riskCategories: string[];
    publishedByUid: string;
  };
}

export interface CompleteMicrotrainingPayload {
  incidentId: string;
  moduleId: string;
  workerUid: string;
  completedAtIso: string;
  score: number;
  passed: boolean;
  certified: boolean;
  assignment: {
    assignedAtIso: string;
    assignedByUid: string;
    derivedFromLessonId: string;
  };
}

export interface StatusResponse {
  status: PdcaStatus;
  nodeCount: number;
}

async function authedPost(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await apiAuthHeaders()),
    },
    body: JSON.stringify(body),
  });
}

async function postOrThrow<T>(path: string, body: unknown): Promise<T> {
  const res = await authedPost(path, body);
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ────────────────────────────────────────────────────────────────────────
// Status — GET with auto-refresh handle
// ────────────────────────────────────────────────────────────────────────

export function useIncidentFlowStatus(
  projectId: string | null,
  incidentId: string | null,
) {
  const path =
    projectId && incidentId
      ? `/api/sprint-k/${projectId}/incident-flow/${incidentId}/status`
      : null;
  return useEndpoint<StatusResponse>(path);
}

// ────────────────────────────────────────────────────────────────────────
// Mutators — one per step
// ────────────────────────────────────────────────────────────────────────

export interface StepResponse {
  ok: true;
  nodeIds: string[];
  edgeIds: string[];
}

export async function reportIncident(
  projectId: string,
  payload: IncidentReportPayload,
): Promise<StepResponse & { incidentId: string }> {
  return postOrThrow<StepResponse & { incidentId: string }>(
    `/api/sprint-k/${projectId}/incident-flow/report`,
    payload,
  );
}

export async function openInvestigation(
  projectId: string,
  incidentId: string,
  payload: OpenInvestigationPayload,
): Promise<StepResponse> {
  return postOrThrow<StepResponse>(
    `/api/sprint-k/${projectId}/incident-flow/${incidentId}/open-investigation`,
    payload,
  );
}

export async function concludeInvestigation(
  projectId: string,
  incidentId: string,
  payload: ConcludeInvestigationPayload,
): Promise<StepResponse> {
  return postOrThrow<StepResponse>(
    `/api/sprint-k/${projectId}/incident-flow/${incidentId}/conclude-investigation`,
    payload,
  );
}

export async function publishLesson(
  projectId: string,
  incidentId: string,
  payload: PublishLessonPayload,
): Promise<StepResponse> {
  return postOrThrow<StepResponse>(
    `/api/sprint-k/${projectId}/incident-flow/${incidentId}/publish-lesson`,
    payload,
  );
}

export interface AssignMicrotrainingResponse extends StepResponse {
  assignments: Array<{
    workerUid: string;
    assignmentId: string;
    nodeIds: string[];
  }>;
}

export async function assignMicrotraining(
  projectId: string,
  incidentId: string,
  payload: AssignMicrotrainingPayload,
): Promise<AssignMicrotrainingResponse> {
  return postOrThrow<AssignMicrotrainingResponse>(
    `/api/sprint-k/${projectId}/incident-flow/${incidentId}/assign-microtraining`,
    payload,
  );
}

export async function completeMicrotraining(
  projectId: string,
  assignmentId: string,
  payload: CompleteMicrotrainingPayload,
): Promise<StepResponse> {
  return postOrThrow<StepResponse>(
    `/api/sprint-k/${projectId}/incident-flow/training/${assignmentId}/complete`,
    payload,
  );
}

export type { PdcaStatus };
