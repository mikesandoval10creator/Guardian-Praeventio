// Commute data contracts, FIFO helpers and cross-tree incident tagging.
// Persistence and foreground sampling live in useCommuteRecorder through the
// authenticated HTTP API; this module never writes directly to Firestore.
// The shared hint carries ownerUid so another worker on a shared device cannot
// inherit the previous driver's trayecto classification.

import { MAX_SAMPLES } from './commuteLimits';
export { MAX_SAMPLES } from './commuteLimits';

// ─── Types ──────────────────────────────────────────────────────────

export type CommuteType = 'home-to-site' | 'site-to-home' | 'between-sites';

/** A single GPS sample appended to `samples[]`. Pure data; no Firestore types. */
export interface CommuteSample {
  lat: number;
  lng: number;
  speedKmh: number;
  accuracyM: number;
  /** Wall-clock epoch ms. */
  timestamp: number;
}

export interface CommuteSession {
  id: string;
  projectId: string;
  type: CommuteType;
  startedAt: number;
  endedAt: number | null;
  samples: CommuteSample[];
}

// ─── Constants ──────────────────────────────────────────────────────

/** Sampling cadence — every 60 seconds. */
export const SAMPLE_INTERVAL_MS = 60_000;

// ─── Pure helpers ───────────────────────────────────────────────────

/**
 * Append a sample to a session's buffer with the FIFO cap. Returns a NEW
 * array so callers can rely on referential equality for memoization.
 */
export function appendCappedSample(
  current: CommuteSample[],
  next: CommuteSample,
  cap: number = MAX_SAMPLES,
): CommuteSample[] {
  if (current.length < cap) return [...current, next];
  // Drop the oldest, keep the most recent (cap - 1) + new = cap.
  return [...current.slice(current.length - (cap - 1)), next];
}

/**
 * Predicate: is `t` one of the recognized commute types?
 */
export function isCommuteType(t: unknown): t is CommuteType {
  return t === 'home-to-site' || t === 'site-to-home' || t === 'between-sites';
}

/**
 * Decorate an outgoing incident payload with `tipo: 'trayecto'` and the
 * active session id when a commute is in progress for `projectId`.
 *
 * Pure function: no Firestore reads. The active-session lookup is passed
 * in by the caller (the hook's `current` ref) so the helper is testable
 * without React.
 */
export function tagIncidentTipo<T extends Record<string, unknown>>(
  payload: T,
  active: { projectId: string; sessionId: string; ownerUid?: string } | null,
): T & { tipo?: 'trayecto'; commuteSessionId?: string } {
  if (!active) return payload;
  if (payload.projectId !== active.projectId) return payload;
  if (active.ownerUid && payload.workerId !== active.ownerUid) return payload;
  return {
    ...payload,
    tipo: 'trayecto',
    commuteSessionId: active.sessionId,
  };
}

// ─── Firestore path helpers ─────────────────────────────────────────

export function commuteSessionsPath(tenantId: string): string {
  return `tenants/${tenantId}/commute_sessions`;
}

// ─── Module-level singleton for cross-component tagging ─────────────
//
// FallDetectionMonitor lives at App.tsx scope while `useCommuteRecorder`
// lives in the Driving page tree. The cleanest cross-tree handshake we
// can ship without a new context is a module-level "active session"
// reference owned by the hook. Subscribers read it via `getActiveSession()`
// and treat it as a *hint* — the source of truth remains the Firestore
// session doc.

let _activeSession: { projectId: string; sessionId: string; ownerUid?: string } | null = null;

export function getActiveSession(): { projectId: string; sessionId: string; ownerUid?: string } | null {
  return _activeSession;
}

/**
 * Public setter for the active commute session. The driver-mode UI
 * (SafeDrivingMode) persists the session via the audited /api/commute server
 * route (Admin SDK — no client write rule needed) and calls this to flip the
 * in-memory hint so a fall/ManDown during the commute is tagged tipo:'trayecto'
 * for SUSESO (read by useManDownDetection via getActiveSession()). Pass null on
 * commute end.
 */
export function setActiveCommuteSession(
  s: { projectId: string; sessionId: string; ownerUid?: string } | null,
): void {
  _activeSession = s;
}

/** Test helper. Prefer `useCommuteRecorder` or `setActiveCommuteSession`. */
export function _setActiveSessionForTesting(
  s: { projectId: string; sessionId: string; ownerUid?: string } | null,
): void {
  _activeSession = s;
}
