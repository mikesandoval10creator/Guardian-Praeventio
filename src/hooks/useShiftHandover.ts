// Praeventio Guard — Shift Handover client hook (6 mutators).
//
// Sprint 39 J.8. supervisorUid / authorUid / incomingSupervisorUid are
// forced server-side from the authenticated caller, so they are not part
// of the client input.

import { auth } from '../services/firebase';
import type {
  ShiftRecord,
  ShiftHandoverNote,
  ShiftLogEntry,
  ShiftSummary,
  ShiftKind,
} from '../services/shiftHandover/shiftHandoverService';

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

interface ShiftPayload {
  shift: ShiftRecord;
}

// ── 1. start ──────────────────────────────────────────────────────────

export async function startShiftApi(
  projectId: string,
  input: { id: string; kind: ShiftKind },
): Promise<ShiftPayload> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/start`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShiftPayload>(res);
}

// ── 2. log-entry ──────────────────────────────────────────────────────

export async function logShiftEntryApi(
  projectId: string,
  input: {
    shift: ShiftRecord;
    entry: Omit<ShiftLogEntry, 'authorUid' | 'at'> & { at?: string };
  },
): Promise<ShiftPayload> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/log-entry`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShiftPayload>(res);
}

// ── 3. add-note ───────────────────────────────────────────────────────

export async function addShiftNoteApi(
  projectId: string,
  input: { shift: ShiftRecord; note: ShiftHandoverNote },
): Promise<ShiftPayload> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/add-note`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShiftPayload>(res);
}

// ── 4. end ────────────────────────────────────────────────────────────

export async function endShiftApi(
  projectId: string,
  input: { shift: ShiftRecord },
): Promise<ShiftPayload> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/end`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShiftPayload>(res);
}

// ── 5. acknowledge ────────────────────────────────────────────────────

export async function acknowledgeShiftApi(
  projectId: string,
  input: { shift: ShiftRecord; notes?: string },
): Promise<ShiftPayload> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/acknowledge`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShiftPayload>(res);
}

// ── 6. summarize ──────────────────────────────────────────────────────

export async function summarizeShiftApi(
  projectId: string,
  input: { shift: ShiftRecord },
): Promise<{ summary: ShiftSummary }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ summary: ShiftSummary }>(res);
}
