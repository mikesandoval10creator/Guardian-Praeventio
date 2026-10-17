// Praeventio Guard — global bridge from an active lone-worker session to the
// Android-owned ManDown foreground service.
//
// This is deliberately mounted above routes. Navigating away from Emergencia
// must not stop protection; only ending/removing the worker's own session does.
// On web/iOS it is an honest no-op: the native service is the only component
// that can continue sampling while Capacitor's WebView is suspended.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFirebase } from "../../contexts/FirebaseContext";
import { useProject } from "../../contexts/ProjectContext";
import { subscribeActiveLoneWorkerSessions } from "../../services/loneWorker/loneWorkerStore";
import type { LoneWorkerSession } from "../../services/loneWorker/loneWorkerService";
import { mintNativeManDownCapability } from "../../hooks/useLoneWorker";
import {
  isAndroidNativeManDown,
  startNativeManDown,
  stopNativeManDown,
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
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [subscription, setSubscription] =
    useState<SessionSubscription | null>(null);
  const pendingStop = useRef<Promise<void> | null>(null);
  const stopMonitoring = useCallback(() => {
    if (pendingStop.current) return pendingStop.current;
    const pending = stopNativeManDown().finally(() => {
      pendingStop.current = null;
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

  return null;
}
