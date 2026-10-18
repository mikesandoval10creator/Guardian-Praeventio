// Praeventio Guard — global bridge from an active lone-worker session to the
// Android-owned ManDown foreground service.
//
// This is deliberately mounted above routes. Navigating away from Emergencia
// must not stop protection; only ending/removing the worker's own session does.
// On web/iOS it is an honest no-op: the native service is the only component
// that can continue sampling while Capacitor's WebView is suspended.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFirebase } from "../../contexts/FirebaseContext";
import { useProject } from "../../contexts/ProjectContext";
import { subscribeActiveLoneWorkerSessions } from "../../services/loneWorker/loneWorkerStore";
import type { LoneWorkerSession } from "../../services/loneWorker/loneWorkerService";
import { mintNativeManDownCapability } from "../../hooks/useLoneWorker";
import {
  isAndroidNativeManDown,
  startNativeManDown,
  stopNativeManDown,
  type NativeManDownStopResult,
} from "../../services/mobile/nativeManDownClient";
import { logger } from "../../utils/logger";

const DEFAULT_INACTIVITY_MS = 30_000;
const DEFAULT_IMPACT_THRESHOLD_MPS2 = 25;
const DEFAULT_NATIVE_CANCEL_WINDOW_MS = 20_000;

type SessionSubscription = {
  projectId: string;
  workerUid: string;
  session: LoneWorkerSession | null;
  state: "ready" | "error";
};

/**
 * Links exactly one authenticated worker's active session to Android FGS.
 * It never creates sessions, never writes Firestore, and never changes safety
 * decisions in the WebView. The server checks the capability/session again at
 * native event ingest time, so a stale process is fail-closed.
 */
export function NativeManDownBridge() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [subscription, setSubscription] =
    useState<SessionSubscription | null>(null);
  const [stopFailed, setStopFailed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const mounted = useRef(false);
  const pendingStop = useRef<Promise<NativeManDownStopResult> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const stopMonitoring = useCallback(() => {
    if (pendingStop.current) return pendingStop.current;
    if (mounted.current) setStopping(true);
    // Register the pending operation before invoking native code, including
    // unexpected synchronous failures. Keep all completion handlers on one chain.
    const pending = Promise.resolve().then(() => stopNativeManDown())
      .catch((error: unknown): NativeManDownStopResult => ({
        stopped: false,
        reason: "native_error",
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((result) => {
        if (!result.stopped && result.reason === "native_error") {
          logger.error("native_mandown_stop_failed", result.error);
        }
        if (mounted.current && (result.stopped || result.reason === "native_error")) {
          setStopFailed(!result.stopped);
        }
        return result;
      })
      .finally(() => {
        pendingStop.current = null;
        if (mounted.current) setStopping(false);
      });
    pendingStop.current = pending;
    return pending;
  }, []);

  const projectId = selectedProject?.id ?? null;
  const workerUid = user?.uid ?? null;
  const previousIdentity = useRef({ projectId, workerUid });

  useEffect(() => {
    const previous = previousIdentity.current;
    previousIdentity.current = { projectId, workerUid };
    if ((previous.projectId !== projectId || previous.workerUid !== workerUid) &&
        isAndroidNativeManDown()) {
      void stopMonitoring();
    }
    setSubscription(null);
    if (!projectId || !workerUid) {
      return undefined;
    }
    let active = true;
    const unsubscribe = subscribeActiveLoneWorkerSessions(
      projectId,
      (sessions) => {
        if (!active) return;
        setSubscription({
          projectId,
          workerUid,
          state: "ready",
          session: sessions.find((candidate) => candidate.workerUid === workerUid) ?? null,
        });
      },
      (error) => {
        if (!active) return;
        // A failed read is not an end-session signal. Existing native authority
        // still expires on Android and is revalidated by the server on ingestion.
        logger.warn("native_mandown_session_subscription_failed", {
          error: String(error),
        });
        setSubscription((previous) => ({
          projectId,
          workerUid,
          state: "error",
          session:
            previous?.projectId === projectId && previous.workerUid === workerUid
              ? previous.session : null,
        }));
      },
    );
    return () => {
      active = false;
      unsubscribe();
      // React unmount/replay is not proof of a terminated safety session.
      // Identity transitions above and confirmed session end stop explicitly.
    };
  }, [projectId, workerUid, stopMonitoring]);

  const ownsSubscription =
    subscription?.projectId === projectId &&
    subscription?.workerUid === workerUid;
  const session = ownsSubscription ? subscription?.session : null;

  // An overdue/help-requested session remains an open safety session. Native
  // fall detection must continue until it is explicitly ended or disappears.
  const openSessionId =
    session && session.status !== "ended" && !session.endedAt
      ? session.id
      : null;
  const ready = ownsSubscription && subscription?.state === "ready";
  const mustStop = !projectId || !workerUid || (ready && !openSessionId);

  useEffect(() => {
    let cancelled = false;
    if (!isAndroidNativeManDown()) return undefined;

    if (mustStop) {
      void stopMonitoring();
      return undefined;
    }
    if (!projectId || !workerUid || !openSessionId || !ready) return undefined;

    const inactivityThresholdMs = Math.max(
      5_000,
      selectedProject?.settings?.manDownInactivityThreshold ??
        DEFAULT_INACTIVITY_MS,
    );
    // Project settings currently configure inactivity and WebView movement
    // sensitivity, not a native acceleration-impact threshold. Keep the native
    // threshold explicit until a separately reviewed calibration setting exists.
    const impactThresholdMps2 = DEFAULT_IMPACT_THRESHOLD_MPS2;

    void (async () => {
      try {
        // A late stop for the previous identity must not terminate its replacement.
        if (pendingStop.current) await pendingStop.current;
        if (cancelled) return;
        const minted = await mintNativeManDownCapability(
          projectId,
          openSessionId,
        );
        if (cancelled) return;
        if (pendingStop.current) await pendingStop.current;
        if (cancelled) return;
        const result = await startNativeManDown({
          projectId,
          sessionId: openSessionId,
          capability: minted.capability,
          capabilityExpiresAt: minted.expiresAt,
          inactivityThresholdMs,
          impactThresholdMps2,
          cancelWindowMs: DEFAULT_NATIVE_CANCEL_WINDOW_MS,
        });
        if (!result.applied) {
          logger.warn("native_mandown_not_started", {
            reason: result.reason,
            error: result.error,
          });
        }
      } catch (error) {
        // Fail loud to telemetry; do not silently claim background monitoring.
        logger.error("native_mandown_start_failed", {
          error: String(error),
          projectId,
          sessionId: openSessionId,
        });
      }
    })();

    return () => {
      // Do not stop here: React can re-run this effect for configuration changes
      // while the native process is holding a persisted “Estoy bien” countdown.
      // The next effect explicitly stops only when the session is absent/ended.
      cancelled = true;
    };
  }, [
    projectId,
    workerUid,
    openSessionId,
    ready,
    mustStop,
    stopMonitoring,
    selectedProject?.settings?.manDownInactivityThreshold,
  ]);

  if (!stopFailed && !stopping) return null;
  return (
    <div role={stopFailed ? "alert" : "status"} className="pointer-events-auto rounded-2xl border border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-xl dark:bg-zinc-900 dark:text-amber-200">
      <p className="font-bold">{stopFailed
        ? t("native_mandown_stop.failed_title", "Cierre de ManDown pendiente")
        : t("native_mandown_stop.pending_title", "Confirmando cierre de ManDown")}</p>
      <p className="mt-1 text-sm">{stopFailed
        ? t("native_mandown_stop.failed_detail", "No pudimos confirmar el cierre anterior de ManDown.")
        : t("native_mandown_stop.pending_detail", "Esperando la confirmación del cierre anterior.")}</p>
      {stopFailed && !mustStop && <p className="mt-2 text-sm">{t("native_mandown_stop.retry_blocked", "El reintento estará disponible cuando no haya una sesión activa.")}</p>}
      {stopFailed && <button
        type="button"
        disabled={!mustStop || stopping}
        onClick={() => { if (mustStop) void stopMonitoring(); }}
        className="mt-3 rounded-xl bg-amber-200 px-4 py-2 font-bold text-amber-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("native_mandown_stop.retry", "Reintentar cierre de ManDown")}
      </button>}
    </div>
  );
}
