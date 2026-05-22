// Praeventio Guard — Meeting pack + briefing client hook (3 mutators).

import type {
  MeetingSnapshot,
  MeetingSummary,
  SupervisorBriefingPack,
  ActionItemSuggestion,
} from '../services/meetingPack/meetingPackBuilder';
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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. build-summary ───────────────────────────────────────────────────

export interface BuildMeetingSummaryInput {
  snapshot: MeetingSnapshot;
}
export interface BuildMeetingSummaryResponse {
  summary: MeetingSummary;
}

export async function buildMeetingSummaryRemote(
  projectId: string,
  input: BuildMeetingSummaryInput,
): Promise<BuildMeetingSummaryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/meeting-pack/build-summary`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildMeetingSummaryResponse>(res);
}

// ── 2. build-supervisor-briefing (supervisorUid + projectId server-side) ─

export interface BuildBriefingWireInput {
  shiftStart: string;
  workersAssigned: Array<{
    uid: string;
    name: string;
    role: string;
    activeRestrictions?: string[];
    fatigueLevel?: 'low' | 'medium' | 'high' | 'critical';
    expiredCerts?: string[];
  }>;
  criticalRisksForToday: Array<{
    id: string;
    description: string;
    severity: 'high' | 'critical' | 'sif';
  }>;
  pendingActions: Array<{ id: string; description: string; dueDate: string }>;
  weather?: { temperatureC: number; precipitation?: string; uvIndex?: number };
  customNotes?: string[];
}
export interface BuildBriefingResponse {
  pack: SupervisorBriefingPack;
}

export async function buildSupervisorBriefingPackRemote(
  projectId: string,
  input: BuildBriefingWireInput,
): Promise<BuildBriefingResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/meeting-pack/build-supervisor-briefing`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildBriefingResponse>(res);
}

// ── 3. extract-action-items ────────────────────────────────────────────

export interface ExtractActionItemsInput {
  text: string;
}
export interface ExtractActionItemsResponse {
  suggestions: ActionItemSuggestion[];
}

export async function extractMeetingActionItems(
  projectId: string,
  input: ExtractActionItemsInput,
): Promise<ExtractActionItemsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/meeting-pack/extract-action-items`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ExtractActionItemsResponse>(res);
}
