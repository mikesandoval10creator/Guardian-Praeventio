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
import { auth } from '../../services/firebase';
import { logger } from '../../utils/logger';
// 16th wave (Bucket B) analytics: catalog row 66 — wire
// `emergency.sos.triggered` at the moment the long-press confirmed and the
// payload was committed (i.e. the request was issued). The catalog row
// requires the SOS ring buffer in Sentry breadcrumbs to discriminate
// trigger source (long-press here) from auto-detection paths.
import { analytics } from '../../services/analytics';

const HOLD_MS = 3_000;
const GEO_TIMEOUT_MS = 5_000;
// Hard deadline for the SOS POST: if the server stalls (e.g. Firestore
// outage with no express-async-errors forwarding in older deploys), the
// worker should fall through to the tel: deeplink within this window
// rather than waiting indefinitely.  7 s is short enough to feel fast
// but long enough for a slow mobile data connection to succeed.
const SOS_FETCH_TIMEOUT_MS = 7_000;

interface GeoPoint {
  lat: number;
  lng: number;
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
        uid: user?.uid ?? null,
        projectId,
        geo,
        timestamp: new Date().toISOString(),
      };
      // 7-second hard timeout: if the server stalls (Firestore outage, no
      // async-error forwarding), abort so the worker reaches the tel: fallback
      // quickly rather than waiting indefinitely.  The controller is cleaned up
      // in the finally block regardless of the outcome.
      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), SOS_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch('/api/emergency/sos', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify(body),
          signal: abortCtrl.signal,
        });
      } finally {
        clearTimeout(abortTimer);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The server records the SOS even when it reached NO responder (0 push +
      // 0 backup email): then `delivered` is false. Do NOT show the green
      // "supervisores notificados" toast in that case — fall through to the tel:
      // deeplink so a human is actually reached. (#1 life-safety: never falsely
      // reassure a worker that help is coming when it isn't.) An ambiguous /
      // non-JSON 2xx is treated as undelivered (safer → tel:).
      const sosResult =
        typeof res.json === 'function'
          ? ((await res.json().catch(() => ({ delivered: false }))) as { delivered?: boolean })
          : {};
      // Analytics: the SOS WAS triggered and accepted by the server (a row was
      // written) regardless of reach — emit BEFORE the delivered check so the
      // ops funnel still counts zero-reach attempts (the gap this PR surfaces).
      // `role_hash` uses the uid as a coarse stand-in until a salted hash lands.
      try {
        void analytics.track('emergency.sos.triggered', {
          sos_type: 'unknown',
          trigger_source: 'long_press',
          role_hash: user?.uid ?? 'anonymous',
        });
      } catch { /* analytics must never break user flow */ }
      if (sosResult.delivered === false) throw new Error('sos_not_delivered');
      showToast('Alerta enviada — supervisores notificados');
    } catch (err) {
      // Two distinct failures land here:
      //  • transport failure (network / !res.ok) — the server may NOT have the
      //    SOS, so enqueue it for offline retry.
      //  • 'sos_not_delivered' — the SOS IS recorded server-side but reached no
      //    responder; re-POSTing would DUPLICATE the alert doc, so do NOT
      //    enqueue — just reach a human directly via tel:.
      const zeroReach = err instanceof Error && err.message === 'sos_not_delivered';
      logger.warn(
        zeroReach
          ? 'SOSButton: SOS recorded but reached no responder; tel: fallback (no re-enqueue)'
          : 'SOSButton: /api/emergency/sos failed; queueing offline + tel: fallback',
        { err },
      );
      // Offline-first: persist a TRANSPORT failure so it RETRIES on reconnect
      // (the engine retains it, dead-letters after max retries — never silently
      // dropped). tel: stays the immediate human fallback. A zero-reach SOS is
      // already on the server, so we skip the enqueue to avoid duplicate alerts.
      const projectId = selectedProject?.id;
      let queued = false;
      if (!zeroReach && projectId) {
        try {
          const { enqueueSos } = await import('../../services/emergency/sosOutboxClient');
          await enqueueSos({
            clientEventId:
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `sos-${Date.now()}`,
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
