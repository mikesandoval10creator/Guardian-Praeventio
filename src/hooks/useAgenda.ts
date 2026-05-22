// Praeventio Guard — Agenda client hook (5 mutators).

import type {
  AgendaItem,
  UserPreferences,
  ScheduledReminder,
  ReminderUrgency,
  DeliveryChannel,
  DigestInputs,
  DailyDigest,
} from '../services/agenda/agendaScheduler';
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

// ── 1. schedule-reminders ──────────────────────────────────────────────

export interface ScheduleRemindersInput {
  item: AgendaItem;
}
export interface ScheduleRemindersResponse {
  reminders: ScheduledReminder[];
}

export async function scheduleAgendaReminders(
  projectId: string,
  input: ScheduleRemindersInput,
): Promise<ScheduleRemindersResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/agenda/schedule-reminders`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ScheduleRemindersResponse>(res);
}

// ── 2. select-channel ──────────────────────────────────────────────────

export interface SelectChannelInput {
  prefs: UserPreferences;
  urgency: ReminderUrgency;
}
export interface SelectChannelResponse {
  channel: DeliveryChannel;
}

export async function selectAgendaChannel(
  projectId: string,
  input: SelectChannelInput,
): Promise<SelectChannelResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/agenda/select-channel`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SelectChannelResponse>(res);
}

// ── 3. should-deliver ──────────────────────────────────────────────────

export interface ShouldDeliverInput {
  reminder: ScheduledReminder;
  prefs: UserPreferences;
  nowIso: string;
}
export interface ShouldDeliverResponse {
  decision: { deliver: boolean; reason: string };
}

export async function shouldAgendaDeliverNow(
  projectId: string,
  input: ShouldDeliverInput,
): Promise<ShouldDeliverResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/agenda/should-deliver`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShouldDeliverResponse>(res);
}

// ── 4. in-focus-block ──────────────────────────────────────────────────

export interface InFocusBlockInput {
  items: AgendaItem[];
  nowIso: string;
}
export interface InFocusBlockResponse {
  focus: AgendaItem | null;
}

export async function isAgendaInFocusBlock(
  projectId: string,
  input: InFocusBlockInput,
): Promise<InFocusBlockResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/agenda/in-focus-block`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<InFocusBlockResponse>(res);
}

// ── 5. build-daily-digest ──────────────────────────────────────────────

export interface BuildDailyDigestInput {
  workerUid: string;
  forDate: string;
  inputs: DigestInputs;
}
export interface BuildDailyDigestResponse {
  digest: DailyDigest;
}

export async function buildAgendaDailyDigest(
  projectId: string,
  input: BuildDailyDigestInput,
): Promise<BuildDailyDigestResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/agenda/build-daily-digest`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildDailyDigestResponse>(res);
}
