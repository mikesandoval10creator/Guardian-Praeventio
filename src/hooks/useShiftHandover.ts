// Praeventio Guard — Shift Handover client hook (6 mutators).
//
// Sprint 39 J.8. supervisorUid / authorUid / incomingSupervisorUid are
// forced server-side from the authenticated caller, so they are not part
// of the client input.

import { apiAuthHeaders } from "../lib/apiAuth";
import { saveShift } from "../services/shiftHandover/shiftHandoverStore";
import type {
  ShiftRecord,
  ShiftHandoverNote,
  ShiftLogEntry,
  ShiftSummary,
  ShiftKind,
} from "../services/shiftHandover/shiftHandoverService";

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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
    { method: "POST", body: JSON.stringify(input) },
  );
  return json<ShiftPayload>(res);
}

// ── 2. log-entry ──────────────────────────────────────────────────────

export async function logShiftEntryApi(
  projectId: string,
  input: {
    shift: ShiftRecord;
    entry: Omit<ShiftLogEntry, "authorUid" | "at"> & { at?: string };
  },
): Promise<ShiftPayload> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/log-entry`,
    { method: "POST", body: JSON.stringify(input) },
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
    { method: "POST", body: JSON.stringify(input) },
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
    { method: "POST", body: JSON.stringify(input) },
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
    { method: "POST", body: JSON.stringify(input) },
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
    { method: "POST", body: JSON.stringify(input) },
  );
  return json<{ summary: ShiftSummary }>(res);
}

// ──────────────────────────────────────────────────────────────────────
// Compatibility API for the adaptive panel.
//
// The panel uses a richer submit shape than the individual HTTP mutators.
// These functions now orchestrate the real endpoints and persist each
// successful state through the canonical project-scoped Firestore store.

/**
 * Quality breakdown produced by the `GET /api/sprint-k/{projectId}/
 * shift-handover/history` endpoint. Computed server-side from the shift's
 * note count, urgent severity flags, and acknowledged status.
 */
export interface ShiftHandoverQuality {
  totalNotes: number;
  urgentNotes: number;
  qualityScore: number;
  level: "excellent" | "good" | "fair" | "poor";
}

/**
 * Historical handover record returned by the history endpoint.
 * Wraps the underlying `ShiftRecord` with derived quality metrics so the
 * UI doesn't need to recompute on every render.
 */
export interface ShiftHandoverEntry {
  shift: ShiftRecord;
  quality: ShiftHandoverQuality;
}

/**
 * Shape of the history endpoint's response body. Wraps the array so a
 * future addition (paging, totals) doesn't force a breaking change.
 */
export interface ShiftHandoverHistoryResponse {
  shifts: ShiftHandoverEntry[];
}

/**
 * Real fetch contra `GET /api/sprint-k/{projectId}/shift-handover/history`
 * (Ticket 39aaa66d-73fe-81ba-a153 — anti-stub). El endpoint lee shifts de
 * Firestore, computa quality server-side y pagina por `days`.
 */
export async function fetchShiftHandoverHistory(
  projectId: string,
  opts?: { days?: number },
): Promise<ShiftHandoverHistoryResponse> {
  const days = opts?.days && opts.days > 0 ? opts.days : 30;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/history?days=${days}`,
    { method: "GET" },
  );
  return json<ShiftHandoverHistoryResponse>(res);
}

/**
 * Creates the shift through the real lifecycle endpoints, then persists each
 * successful state in the same project-scoped collection used by the page.
 */
export async function createShiftHandover(
  projectId: string,
  input: {
    id: string;
    kind: ShiftKind;
    startedAt: string;
    supervisorUid: string;
    logEntries: Array<Omit<ShiftLogEntry, "at"> & { at?: string }>;
    handoverNotes: ShiftHandoverNote[];
  },
  _idempotencyKey: string,
): Promise<ShiftPayload> {
  let current = (await startShiftApi(projectId, {
    id: input.id,
    kind: input.kind,
  })).shift;
  await saveShift(projectId, current);

  for (const entry of input.logEntries) {
    const { authorUid: _authorUid, at: _at, ...serverEntry } = entry;
    current = (await logShiftEntryApi(projectId, {
      shift: current,
      entry: serverEntry,
    })).shift;
    await saveShift(projectId, current);
  }

  for (const note of input.handoverNotes) {
    current = (await addShiftNoteApi(projectId, {
      shift: current,
      note,
    })).shift;
    await saveShift(projectId, current);
  }

  current = (await endShiftApi(projectId, { shift: current })).shift;
  await saveShift(projectId, current);
  return { shift: current };
}

/**
 * Acknowledges a concrete shift through the authenticated endpoint and
 * persists the server-stamped acknowledgement. The string overload remains
 * for older callers and resolves the record from the real history endpoint.
 */
export async function acknowledgeShiftHandover(
  projectId: string,
  shiftOrId: ShiftRecord | string,
  opts: { notes?: string },
  _idempotencyKey: string,
): Promise<ShiftPayload> {
  const shift = typeof shiftOrId === "string"
    ? (await fetchShiftHandoverHistory(projectId, { days: 3650 })).shifts
        .find((entry) => entry.shift.id === shiftOrId)?.shift
    : shiftOrId;

  if (!shift) {
    throw new Error("shift_not_found");
  }

  const current = (await acknowledgeShiftApi(projectId, {
    shift,
    notes: opts.notes,
  })).shift;
  await saveShift(projectId, current);
  return { shift: current };
}

/**
 * Real fetch contra `POST /api/sprint-k/{projectId}/shift-handover/{shiftId}/
 * discrepancy` (Ticket 39aaa66d-73fe-81ba-a153 — anti-stub). Persiste la
 * discrepancia bajo doc determinista por idempotencyKey (no duplica).
 */
export async function addShiftHandoverDiscrepancy(
  projectId: string,
  shiftId: string,
  input: { text: string },
  idempotencyKey: string,
): Promise<ShiftPayload> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/shift-handover/${shiftId}/discrepancy`,
    {
      method: "POST",
      body: JSON.stringify({ text: input.text, idempotencyKey }),
    },
  );
  return json<ShiftPayload>(res);
}
