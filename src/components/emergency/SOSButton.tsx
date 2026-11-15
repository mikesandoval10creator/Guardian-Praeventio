/**
 * Guardian Praeventio — Sprint 14 SOSButton.
 *
 * Floating bottom-center SOS button, only visible when the app is in
 * emergency mode (`useAppMode().mode === 'emergency'`). Uses a 3-second
 * long-press confirmation pattern to avoid accidental triggers — pure
 * `pointerdown`/`pointerup` (no touch/mouse pair, modern Capacitor-WebView
 * supports PointerEvents). The visual ring fills as the user holds.
 *
 * Confirmation pipeline:
 *   1. `navigator.geolocation.getCurrentPosition` (5s timeout, high-accuracy).
 *   2. POST `/api/emergency/sos` with `{type, uid, projectId, geo, timestamp}`.
 *   3. Spanish toast on success: "Alerta enviada — supervisores notificados".
 *   4. On HTTP/network failure, fall back to `tel:` deeplink to the
 *      project's `phone` field so the worker can still raise help even
 *      when the data path is degraded.
 *
 * The button intentionally lives OUTSIDE the EmergencyOverlay tree because
 * the overlay is a full-screen takeover with its own action surface —
 * SOSButton is the *trigger* that workers tap when overlay-driven autotrigger
 * has not yet fired (e.g., a near-miss, a coworker injury they want to
 * escalate manually).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppMode } from '../../contexts/AppModeContext';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { logger } from '../../utils/logger';
// 16th wave (Bucket B) analytics: catalog row 66 — wire
// `emergency.sos.triggered` at the moment the long-press confirmed and the
// payload was committed (i.e. the request was issued). The catalog row
// requires the SOS ring buffer in Sentry breadcrumbs to discriminate
// trigger source (long-press here) from auto-detection paths.
import { analytics } from '../../services/analytics';
import type { SosEvent } from '../../services/emergency/sosOutbox';
import { randomId } from '../../utils/randomId';

const HOLD_MS = 3_000;
const GEO_TIMEOUT_MS = 5_000;
// Hard deadline for the SOS POST: if the server stalls (e.g. Firestore
// outage with no express-async-errors forwarding in older deploys), the
// worker should fall through to the tel: deeplink within this window
// rather than waiting indefinitely.  7 s is short enough to feel fast
// but long enough for a slow mobile data connection to succeed.
const SOS_FETCH_TIMEOUT_MS = 7_000;

/**
 * Identity of one manual SOS attempt. It must be created before the initial
 * POST so a lost response can safely transition to the outbox without
 * changing the Idempotency-Key.
 */
export function createSosClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Preserve a distinct key in legacy runtimes without Web Crypto instead of
  // using a timestamp-only identity that can collide within the same millisecond.
  return `sos-${randomId()}`;
}

interface GeoPoint {
  lat: number;
  lng: number;
}

type SosRequestBody = {
  type: 'sos';
  uid: string;
  projectId: string | null;
  geo: GeoPoint | null;
  timestamp: string;
};

/** Build the audited SOS request shared by the initial POST and its replay key. */
export function buildSosRequest(
  clientEventId: string,
  authHeader: string | null,
  body: SosRequestBody,
): Pick<RequestInit, 'method' | 'headers' | 'body'> & { headers: Record<string, string> } {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': clientEventId,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  };
}

type SosAttemptResult =
  | { kind: 'delivered' }
  | { kind: 'zero_reach' }
  | { kind: 'transport_failure'; error: unknown; queued: boolean; queueError?: unknown };

/**
 * Submit one SOS attempt and durably queue transport failures using the same
 * clientEventId sent on the first POST. This is the production transition the
 * outbox retry tests exercise when the server commits but its response is lost.
 */
export async function submitSosAttempt(input: {
  clientEventId: string;
  authHeader: string | null;
  body: SosRequestBody;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  enqueue?: (event: SosEvent) => Promise<void>;
}): Promise<SosAttemptResult> {
  let response: Response;
  try {
    response = await input.fetcher(
      '/api/emergency/sos',
      buildSosRequest(input.clientEventId, input.authHeader, input.body),
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    let queued = false;
    let queueError: unknown;
    if (input.body.projectId && input.enqueue) {
      try {
        // The server fingerprints the full request body for this key. Build
        // the outbox event from that same snapshot so uid, geo and timestamp
        // cannot drift between a lost-response retry and the initial POST.
        await input.enqueue({
          clientEventId: input.clientEventId,
          workerUid: input.body.uid,
          reason: 'manual_button',
          projectId: input.body.projectId,
          coords: input.body.geo ?? undefined,
          occurredAt: input.body.timestamp,
        });
        queued = true;
      } catch (err) {
        queueError = err;
      }
    }
    return {
      kind: 'transport_failure',
      error,
      queued,
      ...(queueError !== undefined ? { queueError } : {}),
    };
  }

  const sosResult =
    typeof response.json === 'function'
      ? ((await response.json().catch(() => ({ delivered: false }))) as { delivered?: boolean })
      : {};
  return sosResult.delivered === false ? { kind: 'zero_reach' } : { kind: 'delivered' };
}

async function captureGeo(): Promise<GeoPoint | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

/**
 * Pure helper — exported for unit testing the long-press timing without
 * needing to mount the React tree. Returns whether `holdMs` elapsed
 * between `down` and `up`.
 */
export function isLongPress(downMs: number, upMs: number, holdMs: number = HOLD_MS): boolean {
  return upMs - downMs >= holdMs;
}

export function SOSButton(): React.ReactElement | null {
  const { mode } = useAppMode();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const [pressing, setPressing] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const downAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string): void => {
    setToast(text);
    setTimeout(() => setToast(null), 4_000);
  }, []);

  const cancelHold = useCallback((): void => {
    setPressing(false);
    setProgress(0);
    downAtRef.current = 0;
    if (rafRef.current != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  const fireSOS = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    // One identity for the complete attempt: initial POST and offline outbox.
    // If the server accepted the SOS but the response was lost, the retry
    // must replay the same idempotent request instead of creating a duplicate.
    const clientEventId = createSosClientEventId();
    // Hoisted so the catch can attach the captured location to the queued SOS.
    let geo: GeoPoint | null = null;
    try {
      geo = await captureGeo();
      // §2.20 (2026-05-23) — usar apiAuthHeader unified (prefiere E2E
      // header en MODE=test, cae a Bearer del idToken en producción).
      // SOSButton es vidas-críticas: el botón debe funcionar incluso si
      // el user está anónimo (sin auth) → no tiramos si authHeader es null.
      const { apiAuthHeader } = await import('../../lib/apiAuth');
      const authHeader = await apiAuthHeader();
      const projectId = selectedProject?.id ?? null;
      const body = {
        type: 'sos' as const,
        // The server derives identity from verifyAuth, not this field. Keep a
        // stable wire value for anonymous attempts so an outbox replay has the
        // exact same idempotency fingerprint.
        uid: user?.uid ?? 'anonymous',
        projectId,
        geo,
        timestamp: new Date().toISOString(),
      };
      const attempt = await submitSosAttempt({
        clientEventId,
        authHeader,
        body,
        // 7-second hard timeout: abort a stalled request so the worker reaches
        // the offline/tel fallback rather than waiting indefinitely.
        fetcher: async (url, init) => {
          const abortCtrl = new AbortController();
          const abortTimer = setTimeout(() => abortCtrl.abort(), SOS_FETCH_TIMEOUT_MS);
          try {
            return await fetch(url, { ...init, signal: abortCtrl.signal });
          } finally {
            clearTimeout(abortTimer);
          }
        },
        enqueue: async (event) => {
          const { enqueueSos } = await import('../../services/emergency/sosOutboxClient');
          await enqueueSos(event);
        },
      });

      if (attempt.kind === 'transport_failure') {
        logger.warn('SOSButton: /api/emergency/sos failed; queueing offline + tel: fallback', {
          err: attempt.error,
        });
        if (attempt.queueError !== undefined) {
          logger.error('SOSButton: failed to queue offline SOS', { qerr: attempt.queueError });
        }
        const phone = selectedProject?.phone;
        if (phone && typeof window !== 'undefined') {
          window.location.href = `tel:${phone.replace(/[^+\d]/g, '')}`;
        } else if (attempt.queued) {
          showToast('Sin red: tu alerta quedó en cola y se reenviará al recuperar señal.');
        } else {
          showToast('No se pudo enviar la alerta — contacta al supervisor.');
        }
        return;
      }

      // Analytics: the SOS was accepted and recorded even if no responder was
      // reached. Never show the success toast for a zero-reach result.
      try {
        void analytics.track('emergency.sos.triggered', {
          sos_type: 'unknown',
          trigger_source: 'long_press',
          role_hash: user?.uid ?? 'anonymous',
        });
      } catch { /* analytics must never break user flow */ }
      if (attempt.kind === 'zero_reach') throw new Error('sos_not_delivered');
      showToast('Alerta enviada — supervisores notificados');
    } catch (err) {
      // Transport/HTTP failures are queued by submitSosAttempt and return above.
      // This catch handles setup failures and the explicit zero-reach response.
      // A zero-reach SOS is already recorded server-side; re-POSTing would
      // duplicate it, so do NOT enqueue — reach a human directly via tel:.
      const zeroReach = err instanceof Error && err.message === 'sos_not_delivered';
      logger.warn(
        zeroReach
          ? 'SOSButton: SOS recorded but reached no responder; tel: fallback (no re-enqueue)'
          : 'SOSButton: SOS setup failed; queueing offline + tel: fallback',
        { err },
      );
      // Preserve an SOS that failed before the request could be handled by the
      // submit helper. The outbox retains it and dead-letters after max retries.
      const projectId = selectedProject?.id;
      let queued = false;
      if (!zeroReach && projectId) {
        try {
          const { enqueueSos } = await import('../../services/emergency/sosOutboxClient');
          await enqueueSos({
            clientEventId,
            workerUid: user?.uid ?? 'anonymous',
            reason: 'manual_button',
            projectId,
            coords: geo ? { lat: geo.lat, lng: geo.lng } : undefined,
            occurredAt: new Date().toISOString(),
          });
          queued = true;
        } catch (qerr) {
          logger.error('SOSButton: failed to queue offline SOS', { qerr });
        }
      }
      const phone = selectedProject?.phone;
      if (phone && typeof window !== 'undefined') {
        window.location.href = `tel:${phone.replace(/[^+\d]/g, '')}`;
      } else if (zeroReach) {
        showToast('Alerta registrada, pero sin confirmar a un responder — contacta directo a tu supervisor.');
      } else if (queued) {
        showToast('Sin red: tu alerta quedó en cola y se reenviará al recuperar señal.');
      } else {
        showToast('No se pudo enviar la alerta — contacta al supervisor.');
      }
    } finally {
      setSubmitting(false);
      cancelHold();
    }
  }, [user, selectedProject, showToast, cancelHold]);

  const onPointerDown = useCallback((): void => {
    if (submitting) return;
    setPressing(true);
    downAtRef.current = Date.now();
    const tick = (): void => {
      const elapsed = Date.now() - downAtRef.current;
      const p = Math.min(1, elapsed / HOLD_MS);
      setProgress(p);
      if (p < 1 && downAtRef.current > 0 && typeof window !== 'undefined') {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };
    if (typeof window !== 'undefined') {
      rafRef.current = window.requestAnimationFrame(tick);
    }
    confirmTimerRef.current = setTimeout(() => {
      void fireSOS();
    }, HOLD_MS);
  }, [submitting, fireSOS]);

  const onPointerUp = useCallback((): void => {
    if (submitting) return;
    const downAt = downAtRef.current;
    if (downAt > 0 && !isLongPress(downAt, Date.now())) {
      cancelHold();
    }
    // If the long-press already fired, fireSOS handles cleanup itself.
  }, [submitting, cancelHold]);

  useEffect(() => {
    return () => cancelHold();
  }, [cancelHold]);

  if (mode !== 'emergency') return null;

  const ringPct = Math.round(progress * 100);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] pointer-events-none">
      {toast && (
        <div
          role="status"
          data-testid="sos-toast"
          className="mb-3 mx-auto bg-zinc-900 text-white text-sm font-bold px-4 py-2 rounded-lg shadow-xl border border-white/20 pointer-events-auto"
        >
          {toast}
        </div>
      )}
      <button
        type="button"
        data-testid="sos-button"
        aria-label="Botón SOS — mantener presionado 3 segundos"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={cancelHold}
        disabled={submitting}
        className="pointer-events-auto relative w-24 h-24 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-black text-xl tracking-widest ring-4 ring-white/30 shadow-[0_0_30px_rgba(220,38,38,0.6)] flex items-center justify-center select-none touch-none disabled:opacity-60"
        style={{
          background: pressing
            ? `conic-gradient(#fff ${ringPct}%, #dc2626 ${ringPct}% 100%)`
            : undefined,
        }}
      >
        <span className="absolute inset-2 rounded-full bg-red-600 flex items-center justify-center">
          {submitting ? '...' : 'SOS'}
        </span>
      </button>
    </div>
  );
}

export default SOSButton;
