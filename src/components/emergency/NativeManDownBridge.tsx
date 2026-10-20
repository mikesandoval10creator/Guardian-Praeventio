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
  type NativeManDownApplyResult,
  type NativeManDownStopResult,
} from "../../services/mobile/nativeManDownClient";
import { setNativeManDownActive } from "../../services/mobile/nativeManDownState";
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

type StartFeedback = {
  projectId: string;
  workerUid: string;
  sessionId: string;
  phase: "pending" | "failed" | "retrying";
};

type NativeAuthority = {
  projectId: string;
  workerUid: string;
  sessionId: string;
  expiresAtMs: number;
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
  const [startFeedback, setStartFeedback] = useState<StartFeedback | null>(null);
  const [nativeAuthority, setNativeAuthority] = useState<NativeAuthority | null>(null);
  const [expiredAuthority, setExpiredAuthority] = useState<NativeAuthority | null>(null);
  const [startRetry, setStartRetry] = useState(0);
  const retryQueued = useRef(false);
  const pendingNativeStart = useRef<Promise<NativeManDownApplyResult> | null>(null);
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

  const activeAuthority = nativeAuthority?.projectId === projectId &&
    nativeAuthority.workerUid === workerUid && nativeAuthority.sessionId === openSessionId
    ? nativeAuthority : null;

  // Publish confirmed native ownership so the WebView fall detector yields.
  // Without this, Android could run two accelerometer detectors for the same
  // worker: two emergencies for one fall, and `Motion.stop()` from the WebView
  // can tear down the native listener app-wide.
  useEffect(() => {
    setNativeManDownActive(!!nativeAuthority && isAndroidNativeManDown());
    return () => {
      setNativeManDownActive(false);
    };
  }, [nativeAuthority]);

  useEffect(() => {
    if (!activeAuthority) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const checkExpiry = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      const remaining = activeAuthority.expiresAtMs - Date.now();
      if (remaining <= 0) {
        setExpiredAuthority(activeAuthority);
      } else {
        // Browser timers overflow beyond a signed 32-bit delay. Recheck the
        // absolute server deadline instead of assuming that a timer firing expires it.
        timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkExpiry();
    };
    checkExpiry();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // A subscription read error does not invalidate the last acknowledged
    // deadline. Keep checking it while the same safety session remains known.
  }, [activeAuthority]);

  useEffect(() => {
    let cancelled = false;
    retryQueued.current = false;
    if (!isAndroidNativeManDown()) return undefined;

    if (mustStop) {
      setStartFeedback(null);
      setNativeAuthority(null);
      setExpiredAuthority(null);
      void stopMonitoring();
      return undefined;
    }
    if (!projectId || !workerUid || !openSessionId || !ready) {
      // A failed session read cannot confirm a pending native start or permit retry.
      setStartFeedback((previous) => previous && previous.phase !== "failed"
        ? { ...previous, phase: "failed" } : previous);
      return undefined;
    }

    const owner = { projectId, workerUid, sessionId: openSessionId };
    setStartFeedback((previous) => ({
      ...owner,
      phase: previous?.projectId === projectId && previous.workerUid === workerUid &&
        previous.sessionId === openSessionId && previous.phase !== "pending"
        ? "retrying" : "pending",
    }));

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
        const expiresAtMs = Date.parse(minted.expiresAt);
        if (!Number.isFinite(expiresAtMs)) throw new Error("native_mandown_invalid_authority_expiry");
        if (pendingStop.current) await pendingStop.current;
        if (cancelled) return;
        // Serialize native dispatch only. An obsolete mint request must not
        // prevent a different identity from obtaining its own fresh authority.
        if (pendingNativeStart.current) {
          await pendingNativeStart.current.catch(() => undefined);
        }
        if (cancelled) return;
        const nativeStart = startNativeManDown({
          projectId,
          sessionId: openSessionId,
          capability: minted.capability,
          capabilityExpiresAt: minted.expiresAt,
          inactivityThresholdMs,
          impactThresholdMps2,
          cancelWindowMs: DEFAULT_NATIVE_CANCEL_WINDOW_MS,
        });
        pendingNativeStart.current = nativeStart;
        let result: NativeManDownApplyResult;
        try {
          result = await nativeStart;
        } finally {
          if (pendingNativeStart.current === nativeStart) pendingNativeStart.current = null;
        }
        if (!result.applied) {
          logger.warn("native_mandown_not_started", {
            reason: result.reason,
            error: result.error,
          });
        }
        if (!cancelled && mounted.current) {
          if (result.applied) setNativeAuthority({ ...owner, expiresAtMs });
          setStartFeedback(result.applied ? null : { ...owner, phase: "failed" });
        }
      } catch (error) {
        // Fail loud to telemetry; do not silently claim background monitoring.
        logger.error("native_mandown_start_failed", {
          error: String(error),
          projectId,
          sessionId: openSessionId,
        });
        if (!cancelled && mounted.current) setStartFeedback({ ...owner, phase: "failed" });
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
    startRetry,
    selectedProject?.settings?.manDownInactivityThreshold,
  ]);

  const visibleStart = startFeedback?.projectId === projectId &&
    startFeedback.workerUid === workerUid && startFeedback.sessionId === openSessionId
    ? startFeedback : null;
  const startBusy = visibleStart?.phase === "pending" || visibleStart?.phase === "retrying";
  const authorityExpired = !!activeAuthority && expiredAuthority === activeAuthority;
  const startFailed = authorityExpired || (visibleStart && visibleStart.phase !== "pending");
  const canRetryStart = ready && !!openSessionId && !stopping && !startBusy;

  if (!stopFailed && !stopping && !visibleStart && !authorityExpired) return null;
  return (
    <>
    {(visibleStart || authorityExpired) && <div role={startFailed ? "alert" : "status"} className="pointer-events-auto rounded-2xl border border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-xl dark:bg-zinc-900 dark:text-amber-200">
      <p className="font-bold">{authorityExpired
        ? t("native_mandown_start.expired_title", "Autorización de ManDown vencida")
        : startFailed
        ? t("native_mandown_start.failed_title", "Inicio de ManDown sin confirmar")
        : t("native_mandown_start.pending_title", "Confirmando inicio de ManDown")}</p>
      <p className="mt-1 text-sm">{authorityExpired
        ? t("native_mandown_start.expired_detail", "La autorización del monitoreo nativo venció. Reintenta el inicio con una sesión activa confirmada.")
        : startFailed
        ? t("native_mandown_start.failed_detail", "No pudimos confirmar que el monitoreo nativo esté activo.")
        : t("native_mandown_start.pending_detail", "Esperando la confirmación de Android.")}</p>
      {startFailed && (!ready || stopping) && <p className="mt-2 text-sm">{t("native_mandown_start.retry_blocked", "El reintento requiere una sesión activa confirmada y que no haya un cierre en curso.")}</p>}
      {startFailed && <button
        type="button"
        disabled={!canRetryStart}
        onClick={() => {
          if (canRetryStart && !retryQueued.current && !pendingNativeStart.current) {
            retryQueued.current = true;
            setStartRetry((previous) => previous + 1);
          }
        }}
        className="mt-3 rounded-xl bg-amber-200 px-4 py-2 font-bold text-amber-950 disabled:cursor-not-allowed disabled:opacity-50"
      >{t("native_mandown_start.retry", "Reintentar inicio de ManDown")}</button>}
    </div>}
    {(stopFailed || stopping) &&
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
    </div>}
    </>
  );
}
