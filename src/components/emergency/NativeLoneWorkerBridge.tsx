// Praeventio Guard — global bridge from an open lone-worker session to the
// Android-owned heartbeat/location service.
//
// Mounted above the route tree so navigating away from /lone-worker/check-in
// does not stop protection. The native service keeps its own schedule and
// outbox after the WebView is suspended; this component only mints/revokes the
// short-lived session authority while authenticated Firestore state is visible.

import { useEffect, useState } from "react";
import { useFirebase } from "../../contexts/FirebaseContext";
import { useProject } from "../../contexts/ProjectContext";
import { subscribeActiveLoneWorkerSessions } from "../../services/loneWorker/loneWorkerStore";
import type { LoneWorkerSession } from "../../services/loneWorker/loneWorkerService";
import { mintNativeLoneWorkerCapability } from "../../hooks/useLoneWorker";
import {
  isAndroidNativeLoneWorker,
  startNativeLoneWorker,
  stopNativeLoneWorker,
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
      void stopNativeLoneWorker();
    };
  }, [projectId, workerUid]);

  const openSessionId =
    subscriptionOwnerKey === identityKey &&
    session &&
    session.status !== "ended" &&
    !session.endedAt
      ? session.id
      : null;

  useEffect(() => {
    let cancelled = false;
    if (!isAndroidNativeLoneWorker()) return undefined;

    // No authenticated worker means the session authority is no longer
    // attributable to this app instance. A real session subscription that is
    // ready but empty likewise proves the explicit stop condition.
    const mustStop =
      !projectId ||
      !workerUid ||
      (subscriptionState === "ready" &&
        subscriptionOwnerKey === identityKey &&
        !openSessionId);
    if (mustStop) {
      void stopNativeLoneWorker();
      return undefined;
    }
    // A transient subscription error is not an end-session signal.
    if (!openSessionId || subscriptionState !== "ready") return undefined;

    void (async () => {
      try {
        const minted = await mintNativeLoneWorkerCapability(
          projectId,
          openSessionId,
        );
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
  }, [projectId, workerUid, identityKey, openSessionId, subscriptionOwnerKey, subscriptionState]);

  return null;
}
