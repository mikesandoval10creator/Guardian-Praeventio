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

// ──────────────────────────────────────────────────────────────────────
// Aliases + stubs expected by orphan UI consumers (rescue-450 PR #501)
// ──────────────────────────────────────────────────────────────────────
//
// `src/components/shiftHandover/ShiftHandoverPanel.tsx` and
// `src/components/shiftHandover/ShiftHandoverHistoryList.tsx` are NOT
// mounted in any route yet — they were wired ahead of the API surface
// being finalised. The exports below let typecheck pass; real impl
// (especially `fetchShiftHandoverHistory` which needs a new GET endpoint
// and `addShiftHandoverDiscrepancy` which needs a new POST endpoint) is
// tracked in TODO §13 + `docs/stubs-inventory.md`.

/**
 * Quality breakdown produced by the future `GET /api/sprint-k/{projectId}/
 * shift-handover/history` endpoint. Computed server-side from the shift's
 * note count, urgent severity flags, and acknowledged status.
 */
export interface ShiftHandoverQuality {
  totalNotes: number;
  urgentNotes: number;
  qualityScore: number;
  level: 'excellent' | 'good' | 'fair' | 'poor';
}

/**
 * Historical handover record returned by the future history endpoint.
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
 * Stub — needs new `GET /api/sprint-k/{projectId}/shift-handover/history`
 * endpoint. Returns `{ shifts: [] }` so the orphan
 * `ShiftHandoverHistoryList.tsx` renders its empty-state branch. Tracked
 * TODO §13.
 */
export async function fetchShiftHandoverHistory(
  _projectId: string,
  _opts?: { days?: number },
): Promise<ShiftHandoverHistoryResponse> {
  return { shifts: [] };
}

/**
 * Stub — `ShiftHandoverPanel.tsx` calls this as
 * `createShiftHandover(projectId, { id, kind, startedAt, ... }, idempotencyKey)`,
 * which is a richer signature than {@link startShiftApi}. Until the
 * panel is mounted in a route, the stub just echoes a minimal shift
 * with the provided id so the optimistic UI path completes. Tracked
 * TODO §13.
 */
export async function createShiftHandover(
  _projectId: string,
  input: {
    id: string;
    kind: ShiftKind;
    startedAt: string;
    supervisorUid: string;
    // `at` is server-stamped in the real endpoint, so the panel passes
    // entries without it — we accept the relaxed shape here for parity.
    logEntries: Array<Omit<ShiftLogEntry, 'at'> & { at?: string }>;
    handoverNotes: ShiftHandoverNote[];
  },
  _idempotencyKey: string,
): Promise<ShiftPayload> {
  return {
    shift: {
      id: input.id,
      projectId: _projectId,
      kind: input.kind,
      startedAt: input.startedAt,
      supervisorUid: input.supervisorUid,
      logEntries: input.logEntries as ShiftLogEntry[],
      handoverNotes: input.handoverNotes,
    } as ShiftRecord,
  };
}

/**
 * Stub — `ShiftHandoverPanel.tsx` calls this as
 * `acknowledgeShiftHandover(projectId, shiftId, { notes? }, idempotencyKey)`.
 * The existing {@link acknowledgeShiftApi} takes `{ shift, notes? }`
 * instead of `(shiftId, opts)`, so we can't simple-alias. Stub returns
 * an empty-but-typed payload. Tracked TODO §13.
 */
export async function acknowledgeShiftHandover(
  _projectId: string,
  shiftId: string,
  _opts: { notes?: string },
  _idempotencyKey: string,
): Promise<ShiftPayload> {
  return { shift: { id: shiftId } as ShiftRecord };
}

/**
 * Stub — needs new `POST /api/sprint-k/{projectId}/shift-handover/{shiftId}/
 * discrepancy` endpoint. `ShiftHandoverPanel.tsx` calls this as
 * `addShiftHandoverDiscrepancy(projectId, shiftId, { text }, idempotencyKey)`.
 * Tracked TODO §13.
 */
export async function addShiftHandoverDiscrepancy(
  _projectId: string,
  shiftId: string,
  _input: { text: string },
  _idempotencyKey: string,
): Promise<ShiftPayload> {
  return { shift: { id: shiftId } as ShiftRecord };
}
