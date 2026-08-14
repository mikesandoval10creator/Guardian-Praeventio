// Praeventio Guard — global bridge from an active lone-worker session to the
// Android-owned ManDown foreground service.
//
// This is deliberately mounted above routes. Navigating away from Emergencia
// must not stop protection; only ending/removing the worker's own session does.
// On web/iOS it is an honest no-op: the native service is the only component
// that can continue sampling while Capacitor's WebView is suspended.

import { useEffect, useState } from "react";
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

/**
 * Links exactly one authenticated worker's active session to Android FGS.
 * It never creates sessions, never writes Firestore, and never changes safety
 * decisions in the WebView. The server checks the capability/session again at
 * native event ingest time, so a stale process is fail-closed.
 */
export function NativeManDownBridge() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [session, setSession] = useState<LoneWorkerSession | null>(null);

  const projectId = selectedProject?.id ?? null;
  const workerUid = user?.uid ?? null;

  useEffect(() => {
    if (!projectId || !workerUid) {
      setSession(null);
      return undefined;
    }
    return subscribeActiveLoneWorkerSessions(
      projectId,
      (sessions) => {
        setSession(
          sessions.find((candidate) => candidate.workerUid === workerUid) ??
            null,
        );
      },
      (error) => {
        // A subscription failure must not be interpreted as "no active session":
        // stop native monitoring rather than keeping an authority we cannot prove.
        logger.warn("native_mandown_session_subscription_failed", {
          error: String(error),
        });
        setSession(null);
      },
    );
  }, [projectId, workerUid]);

  // An overdue/help-requested session remains an open safety session. Native
  // fall detection must continue until it is explicitly ended or disappears.
  const openSessionId =
    session && session.status !== "ended" && !session.endedAt
      ? session.id
      : null;

  useEffect(() => {
    let cancelled = false;
    if (!isAndroidNativeManDown()) return undefined;

    if (!projectId || !workerUid || !openSessionId) {
      void stopNativeManDown();
      return undefined;
    }

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
        const minted = await mintNativeManDownCapability(
          projectId,
          openSessionId,
        );
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
    selectedProject?.settings?.manDownInactivityThreshold,
  ]);

  return null;
}
