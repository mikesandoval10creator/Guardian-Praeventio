// Praeventio Guard — §61-63 Culture Pulse hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import { apiAuthHeader } from '../lib/apiAuth';

export type CulturePulseQuestionKey =
  | 'felt_safe_today'
  | 'manager_listens'
  | 'free_to_stop'
  | 'reported_incident_safely'
  | 'has_resources_to_be_safe';

export interface CulturePulseSnapshot {
  surveyId: string | null;
  status: 'open' | 'closed' | null;
  openAt: string | null;
  closeAt: string | null;
  cultureIndex: number;
  level: 'low' | 'fair' | 'good' | 'strong';
  totalResponses: number;
  expectedRespondents: number | null;
  participationRate: number | null;
  punitiveCulturedFlagged: boolean;
  byQuestion: Record<CulturePulseQuestionKey, number>;
  topConcerns: Array<{
    key: CulturePulseQuestionKey;
    label: string;
    score: number;
  }>;
  topStrengths: Array<{
    key: CulturePulseQuestionKey;
    label: string;
    score: number;
  }>;
  hasResponded: boolean;
  insufficientResponses?: boolean;
  currentCount?: number;
  threshold?: number;
}

export interface CulturePulseResponse {
  snapshot: CulturePulseSnapshot;
}

export function useCulturePulse(projectId: string | null) {
  return useEndpoint<CulturePulseResponse>(
    projectId ? `/api/sprint-k/${projectId}/culture-pulse` : null,
  );
}

export interface CulturePulseHistoryPoint {
  surveyId: string;
  openAt: string;
  closeAt: string | null;
  cultureIndex: number;
  totalResponses: number;
  level: 'low' | 'fair' | 'good' | 'strong';
}

export interface CulturePulseHistoryResponse {
  history: CulturePulseHistoryPoint[];
}

export function useCulturePulseHistory(projectId: string | null) {
  return useEndpoint<CulturePulseHistoryResponse>(
    projectId
      ? `/api/sprint-k/${projectId}/culture-pulse/history`
      : null,
  );
}

export interface CulturePulseSchedulePayload {
  surveyId: string;
  openAt: string;
  closeAt: string;
  title?: string;
  expectedRespondents?: number;
}

export async function scheduleCulturePulse(
  projectId: string,
  payload: CulturePulseSchedulePayload,
): Promise<{ ok: true }> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/culture-pulse/survey`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return { ok: true };
}

export interface CulturePulseResponsePayload {
  workerRole: string;
  area: string;
  answers: Record<CulturePulseQuestionKey, number>;
}

export async function submitCulturePulseResponse(
  projectId: string,
  surveyId: string,
  payload: CulturePulseResponsePayload,
): Promise<{ ok: true }> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/culture-pulse/survey/${surveyId}/respond`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return { ok: true };
}
