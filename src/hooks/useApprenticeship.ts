// Praeventio Guard — §244-250 Aprendices + Mentoría hooks.
//
// Pareja cliente de `src/server/routes/apprenticeship.ts`. Migrado del
// monolito `useSprintK.ts` (2026-05-17) — Sprint K reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import { apiAuthHeader } from '../lib/apiAuth';

export type ApprenticeAuthLevel = 'none' | 'observer' | 'supervised' | 'autonomous';
export type ApprenticeRole = 'aprendiz' | 'nuevo_ingreso' | 'practicante' | 'trabajador_general';
export type ApprenticeExposureOutcome = 'success' | 'partial' | 'unsafe';

export interface ApprenticeRecentExposure {
  id: string;
  taskKind: string;
  recordedAt: string;
  supervisedBy: string;
  outcome: ApprenticeExposureOutcome;
}

export interface ApprenticeRecord {
  workerUid: string;
  mentorUid: string;
  role: ApprenticeRole;
  startDate: string;
  currentLevel: ApprenticeAuthLevel;
  taskAuthorizations: Record<string, ApprenticeAuthLevel>;
  progress: number;
  recentExposures: ApprenticeRecentExposure[];
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export interface ApprenticesResponse {
  apprentices: ApprenticeRecord[];
}

export interface MentorAvailability {
  mentorUid: string;
  apprenticeUids: string[];
  currentLoad: number;
  maxLoad: number;
  available: boolean;
  availableSlots: number;
}

export interface MentorAvailabilityResponse {
  mentors: MentorAvailability[];
  maxLoad: number;
}

export function useApprentices(projectId: string | null) {
  return useEndpoint<ApprenticesResponse>(
    projectId ? `/api/sprint-k/${projectId}/apprentices` : null,
  );
}

export function useMentorAvailability(projectId: string | null) {
  return useEndpoint<MentorAvailabilityResponse>(
    projectId ? `/api/sprint-k/${projectId}/mentors/availability` : null,
  );
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { 'Authorization': authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export interface RegisterApprenticePayload {
  uid: string;
  mentorUid: string;
  role: ApprenticeRole;
  startDate: string;
}

export interface RegisterApprenticeResult {
  ok: true;
  apprentice: ApprenticeRecord;
}

export async function registerApprentice(
  projectId: string,
  payload: RegisterApprenticePayload,
): Promise<RegisterApprenticeResult> {
  return postJson(`/api/sprint-k/${projectId}/apprentices`, payload);
}

export interface AuthorizeApprenticePayload {
  taskKind: string;
  toLevel: Exclude<ApprenticeAuthLevel, 'none'>;
  signedByUid: string;
  evidence: string;
}

export interface AuthorizeApprenticeResult {
  ok: true;
  workerUid: string;
  taskKind: string;
  toLevel: Exclude<ApprenticeAuthLevel, 'none'>;
  currentLevel: ApprenticeAuthLevel;
  progress: number;
}

export async function authorizeApprentice(
  projectId: string,
  uid: string,
  payload: AuthorizeApprenticePayload,
): Promise<AuthorizeApprenticeResult> {
  return postJson(`/api/sprint-k/${projectId}/apprentices/${uid}/authorize`, payload);
}

export interface RecordExposurePayload {
  taskKind: string;
  supervisedBy: string;
  outcome: ApprenticeExposureOutcome;
  recordedAt?: string;
  notes?: string;
}

export interface RecordExposureResult {
  ok: true;
  exposure: {
    id: string;
    workerUid: string;
    taskKind: string;
    supervisedBy: string;
    outcome: ApprenticeExposureOutcome;
    recordedAt: string;
    notes?: string;
    createdAt: string;
    createdBy: string;
  };
}

export async function recordExposure(
  projectId: string,
  uid: string,
  payload: RecordExposurePayload,
): Promise<RecordExposureResult> {
  return postJson(`/api/sprint-k/${projectId}/apprentices/${uid}/expose`, payload);
}
