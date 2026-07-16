// Praeventio Guard — Sprint 12.
//
// `commuteSession.ts` implements the "accidente de trayecto" workflow
// (Ley 16.744, Art. 5°, Chile — coverage applies to commute incidents
// "directo, sin desviaciones" between home and worksite). When the driver
// flips into driving mode and starts a commute, we open a session under
//
//   tenants/{tenantId}/commute_sessions/{sessionId}
//
// and append a low-frequency GPS sample (1 / 60s, capped at 240 entries
// = 4h) so a later mandown / fall event can be classified as `tipo:
// 'trayecto'` for SUSESO reporting.
//
// Why pure functions + a thin React hook:
//   • The 4h cap, the type taxonomy, and the tagging predicate are
//     deterministic and unit-testable. They live as exported pure helpers
//     so `commuteSession.test.ts` can verify them under jsdom without
//     spinning up Firestore.
//   • The hook is a thin coordinator: it owns the active sessionId, the
//     setInterval handle, and forwards `tagIncidentTipo()` to subscribers.
//
// Tagging hook contract (NOT incident creation):
//   • Other modules (e.g. FallDetectionMonitor) call
//     `tagIncidentTipoTrayecto(payload)` to decorate their own outgoing
//     incident write. If a session is active for `payload.projectId`
//     when the call lands, the helper returns `{ ...payload, tipo:
//     'trayecto' }` (with sessionId attached for traceability). Otherwise
//     it returns the payload unchanged.
//   • This keeps incident creation logic in the existing emergency
//     pipeline; commuteSession only contributes a label.

import { randomId } from '../../utils/randomId';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  db,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from '../firebase';
import { arrayUnion } from 'firebase/firestore';

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

/** 4h × 60 (1 sample / minute) ⇒ hard upper bound on `samples[]`. */
export const MAX_SAMPLES = 240;

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
  active: { projectId: string; sessionId: string } | null,
): T & { tipo?: 'trayecto'; commuteSessionId?: string } {
  if (!active) return payload;
  if ((payload as any).projectId !== active.projectId) return payload;
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
// FallDetectionMonitor lives at App.tsx scope while `useCommuteSession`
// lives in the Driving page tree. The cleanest cross-tree handshake we
// can ship without a new context is a module-level "active session"
// reference owned by the hook. Subscribers read it via `getActiveSession()`
// and treat it as a *hint* — the source of truth remains the Firestore
// session doc.

let _activeSession: { projectId: string; sessionId: string } | null = null;

export function getActiveSession(): { projectId: string; sessionId: string } | null {
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
  s: { projectId: string; sessionId: string } | null,
): void {
  _activeSession = s;
}

/** Test helper. Prefer `useCommuteSession.start/end` or `setActiveCommuteSession`. */
export function _setActiveSessionForTesting(
  s: { projectId: string; sessionId: string } | null,
): void {
  _activeSession = s;
}

// ─── React hook ─────────────────────────────────────────────────────

export interface UseCommuteSessionApi {
  current: CommuteSession | null;
  start: (type: CommuteType) => Promise<string>;
  append: (sample: CommuteSample) => Promise<void>;
  end: () => Promise<void>;
}

interface UseCommuteSessionDeps {
  /**
   * Optional injection point for tests / SSR. When omitted, the hook uses
   * `navigator.geolocation` and a real Firestore connection.
   */
  now?: () => number;
}

/**
 * Manage the active commute session for a project. The hook owns the
 * sampling timer; consumers don't need to feed samples manually unless
 * they want to (e.g. test harnesses).
 */
export function useCommuteSession(
  tenantId: string | null,
  projectId: string | null,
  deps: UseCommuteSessionDeps = {},
): UseCommuteSessionApi {
  const now = deps.now ?? (() => Date.now());
  const [current, setCurrent] = useState<CommuteSession | null>(null);
  const currentRef = useRef<CommuteSession | null>(null);
  currentRef.current = current;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSampling = useCallback((): void => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const append = useCallback(
    async (sample: CommuteSample): Promise<void> => {
      const sess = currentRef.current;
      if (!sess || sess.endedAt !== null) return;
      if (!tenantId) return;
      const updatedSamples = appendCappedSample(sess.samples, sample);
      // Optimistic local update so the cap is enforced regardless of
      // Firestore latency.
      setCurrent({ ...sess, samples: updatedSamples });
      try {
        await updateDoc(doc(db, commuteSessionsPath(tenantId), sess.id), {
          // Use arrayUnion only when below the cap; once at cap we
          // overwrite samples wholesale to enforce the FIFO drop.
          samples:
            updatedSamples.length < MAX_SAMPLES
              ? arrayUnion(sample)
              : updatedSamples,
        });
      } catch {
        // Non-fatal — local buffer remains correct; reconcile on retry.
      }
    },
    [tenantId],
  );

  const start = useCallback(
    async (type: CommuteType): Promise<string> => {
      if (!tenantId || !projectId) {
        throw new Error('useCommuteSession: tenantId and projectId required to start');
      }
      const sessionId = `cs_${now()}_${randomId()}`;
      const startedAt = now();
      const session: CommuteSession = {
        id: sessionId,
        projectId,
        type,
        startedAt,
        endedAt: null,
        samples: [],
      };
      setCurrent(session);
      currentRef.current = session;
      _activeSession = { projectId, sessionId };

      try {
        await setDoc(doc(db, commuteSessionsPath(tenantId), sessionId), {
          id: sessionId,
          projectId,
          type,
          startedAt: serverTimestamp(),
          endedAt: null,
          samples: [],
        });
      } catch {
        // Non-fatal — session continues locally.
      }

      // Background sampler — every 60s.
      stopSampling();
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        intervalRef.current = setInterval(() => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              void append({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                speedKmh: ((pos.coords.speed ?? 0) < 0 ? 0 : (pos.coords.speed ?? 0)) * 3.6,
                accuracyM: pos.coords.accuracy ?? 0,
                timestamp: pos.timestamp ?? now(),
              });
            },
            () => {
              // Permission denied / timeout — skip this tick.
            },
            { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
          );
        }, SAMPLE_INTERVAL_MS);
      }

      return sessionId;
    },
    [tenantId, projectId, now, append, stopSampling],
  );

  const end = useCallback(async (): Promise<void> => {
    const sess = currentRef.current;
    if (!sess || sess.endedAt !== null) return;
    if (!tenantId) return;
    stopSampling();
    const endedAt = now();
    setCurrent({ ...sess, endedAt });
    _activeSession = null;
    try {
      await updateDoc(doc(db, commuteSessionsPath(tenantId), sess.id), {
        endedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal.
    }
  }, [tenantId, now, stopSampling]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopSampling();
    };
  }, [stopSampling]);

  return useMemo(
    () => ({ current, start, append, end }),
    [current, start, append, end],
  );
}
