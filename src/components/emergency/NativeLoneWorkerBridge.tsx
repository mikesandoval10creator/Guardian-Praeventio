// Praeventio Guard — global bridge from an open lone-worker session to the
// Android-owned heartbeat/location service.
//
// Mounted above the route tree so navigating away from /lone-worker/check-in
// does not stop protection. The native service keeps its own schedule and
// outbox after the WebView is suspended; this component only mints/revokes the
// short-lived session authority while authenticated Firestore state is visible.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFirebase } from "../../contexts/FirebaseContext";
import { useProject } from "../../contexts/ProjectContext";
import { subscribeActiveLoneWorkerSessions } from "../../services/loneWorker/loneWorkerStore";
import type { LoneWorkerSession } from "../../services/loneWorker/loneWorkerService";
import { mintNativeLoneWorkerCapability } from "../../hooks/useLoneWorker";
import {
  isAndroidNativeLoneWorker,
  startNativeLoneWorker,
  stopNativeLoneWorker,
  type NativeLoneWorkerStopResult,
} from "../../services/mobile/nativeLoneWorkerClient";
import { logger } from "../../utils/logger";

const NATIVE_HEARTBEAT_INTERVAL_MS = 30_000;

type SubscriptionState = "idle" | "ready" | "error";

/**
 * Links one authenticated worker's open session to Android FGS. It never
 * creates sessions and never treats a native notification as proof of safety;
 * the server re-checks capability, session status, expiry, and event id on each
 * heartbeat.
 */
export function NativeLoneWorkerBridge() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [session, setSession] = useState<LoneWorkerSession | null>(null);
  const [subscriptionState, setSubscriptionState] =
    useState<SubscriptionState>("idle");
  const [subscriptionOwnerKey, setSubscriptionOwnerKey] = useState<string | null>(null);
  const [stopFailed, setStopFailed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const mounted = useRef(false);
  const pendingStop = useRef<Promise<NativeLoneWorkerStopResult> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const stopWithFeedback = useCallback(() => {
    if (pendingStop.current) return pendingStop.current;
    if (mounted.current) setStopping(true);
    // Always yield before invoking the bridge so even a synchronous refusal
    // is handled after the in-flight stop has been registered.
    const pending = Promise.resolve().then(() => stopNativeLoneWorker())
      .catch((error: unknown): NativeLoneWorkerStopResult => ({
        stopped: false,
        reason: "native_error",
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((result) => {
        if (!result.stopped && result.reason === "native_error") {
          logger.error("native_lone_worker_stop_failed", result.error);
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
  const identityKey = projectId && workerUid ? `${projectId}:${workerUid}` : null;

  useEffect(() => {
    if (!projectId || !workerUid) {
      setSession(null);
      setSubscriptionOwnerKey(null);
      setSubscriptionState("ready");
      return undefined;
    }

    setSession(null);
    setSubscriptionOwnerKey(null);
    setSubscriptionState("idle");
    const unsubscribe = subscribeActiveLoneWorkerSessions(
      projectId,
      (sessions) => {
        setSession(
          sessions.find((candidate) => candidate.workerUid === workerUid) ??
            null,
        );
        setSubscriptionOwnerKey(`${projectId}:${workerUid}`);
        setSubscriptionState("ready");
      },
      (error) => {
        // Never interpret a failed read as proof that the session ended. Keep
        // the existing native authority alive; its server-side expiry/revoke
        // checks remain the fail-closed boundary.
        logger.warn("native_lone_worker_session_subscription_failed", {
          error: String(error),
        });
        setSubscriptionState("error");
      },
    );
    return () => {
      unsubscribe();
      // A project/user identity change or logout is an explicit authority
      // boundary. Ordinary route navigation does not rerun this effect.
      void stopWithFeedback();
    };
  }, [projectId, workerUid, stopWithFeedback]);

  const openSessionId =
    subscriptionOwnerKey === identityKey &&
    session &&
    session.status !== "ended" &&
    !session.endedAt
      ? session.id
      : null;

  // Unknown subscription state is never permission to retry a destructive
  // native stop: a newly observed open session may already be protected.
  const mustStop =
    !projectId || !workerUid ||
    (subscriptionState === "ready" && subscriptionOwnerKey === identityKey && !openSessionId);

  useEffect(() => {
    let cancelled = false;
    if (!isAndroidNativeLoneWorker()) return undefined;

    // No authenticated worker means the session authority is no longer
    // attributable to this app instance. A real session subscription that is
    // ready but empty likewise proves the explicit stop condition.
    if (mustStop) {
      void stopWithFeedback();
      return undefined;
    }
    // A transient subscription error is not an end-session signal.
    if (!openSessionId || subscriptionState !== "ready") return undefined;

    void (async () => {
      try {
        // Do not let a late boundary stop shut down the replacement session.
        if (pendingStop.current) await pendingStop.current;
        if (cancelled) return;
        const minted = await mintNativeLoneWorkerCapability(
          projectId,
          openSessionId,
        );
        if (cancelled) return;
        if (pendingStop.current) await pendingStop.current;
        if (cancelled) return;
        const result = await startNativeLoneWorker({
          projectId,
          sessionId: openSessionId,
          capability: minted.capability,
          capabilityExpiresAt: minted.expiresAt,
          heartbeatIntervalMs: NATIVE_HEARTBEAT_INTERVAL_MS,
        });
        if (!result.applied) {
          logger.error("native_lone_worker_not_started", {
            reason: result.reason,
            error: result.error,
            projectId,
            sessionId: openSessionId,
          });
        }
      } catch (error) {
        logger.error("native_lone_worker_start_failed", {
          error: String(error),
          projectId,
          sessionId: openSessionId,
        });
      }
    })();

    return () => {
      // Deliberately do not stop on ordinary React effect cleanup. Route
      // navigation and WebView re-rendering are not session termination.
      cancelled = true;
    };
  }, [projectId, workerUid, openSessionId, subscriptionState, mustStop, stopWithFeedback]);

  if (!stopFailed && !stopping) return null;
  return (
    <div role={stopFailed ? "alert" : "status"} className="fixed bottom-4 inset-x-4 z-[160] mx-auto max-w-md rounded-2xl border border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-xl dark:bg-zinc-900 dark:text-amber-200">
      <p className="font-bold">{stopFailed ? "Cierre de vigilancia pendiente" : "Confirmando cierre de vigilancia"}</p>
      <p className="mt-1 text-sm">{stopFailed ? "No pudimos confirmar el cierre anterior." : "Esperando la confirmación del cierre anterior."}</p>
      {stopFailed && !mustStop && <p className="mt-2 text-sm">El reintento estará disponible cuando no haya una sesión activa.</p>}
      {stopFailed && <button
        type="button"
        disabled={!mustStop || stopping}
        onClick={() => { if (mustStop) void stopWithFeedback(); }}
        className="mt-3 rounded-xl bg-amber-200 px-4 py-2 text-sm font-bold text-amber-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reintentar cierre
      </button>}
    </div>
  );
}
