// SPDX-License-Identifier: MIT
// Sprint 16 — AlertSchedulerMount
//
// Mounted in RootLayout when both a project AND a crew are selected.
// Every 60s evaluates the 15 Bernoulli probes against current context
// (weather, IoT, etc. — provided by `useAutonomousAlerts` upstream) and,
// when `alertScheduler.evaluateProbes` returns alerts with leadTimeMin
// > 5, dispatches a high-priority push payload built by
// `buildPushPayload`. The "Atendido" action posts to
// /api/predictive-alerts/ack which awards 30 XP per
// XP_AMOUNTS.evadir_riesgo_predictivo.
//
// This component renders nothing — it's purely a side-effect hook
// container. Returning JSX (an empty fragment) keeps it valid as a
// React node so RootLayout can `<AlertSchedulerMount />` it.

import { useEffect, useRef, useState } from 'react';
import { evaluateProbes, buildPushPayload, type GeneratorProbe, type ScheduledAlert } from '../../services/predictiveAlerts/alertScheduler';
import { auth } from '../../services/firebase';

const POLL_MS = 60_000;
const MIN_LEAD_TIME_MIN = 5;

export interface AlertSchedulerMountProps {
  projectId: string;
  crewId: string;
  /**
   * Probe snapshots are produced upstream (e.g. useAutonomousAlerts +
   * weather/IoT context). Pass empty array to disable evaluation while
   * keeping the mount stable.
   */
  probes: GeneratorProbe[];
  /** Optional injectable for tests. */
  notify?: (payload: ReturnType<typeof buildPushPayload>) => void;
}

/**
 * Default notifier: routes through the browser Notifications API when
 * permission has been granted. Capacitor / FCM push is wired separately
 * in usePushNotifications — we only need the local visual cue here.
 */
function defaultNotify(payload: ReturnType<typeof buildPushPayload>): void {
  if (typeof window === 'undefined') return;
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(payload.title, { body: payload.body });
    }
  } catch {
    // ignore — notifications unavailable
  }
}

/**
 * POST /api/predictive-alerts/ack — acknowledges a fired alert and
 * triggers the +30 XP award server-side. Returns the awarded amount.
 */
export async function ackPredictiveAlert(args: {
  projectId: string;
  crewId: string;
  generatorId: string;
}): Promise<number> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) return 0;
  try {
    const res = await fetch('/api/predictive-alerts/ack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) return 0;
    const j = await res.json();
    return j?.xpAwarded ?? 0;
  } catch {
    return 0;
  }
}

export function AlertSchedulerMount({ projectId, crewId, probes, notify = defaultNotify }: AlertSchedulerMountProps) {
  // Dedupe: the same generator+leadTime within 30 minutes shouldn't fire
  // again. Map<generatorId, lastFiredEpochMs>.
  const firedRef = useRef<Map<string, number>>(new Map());
  const [lastAlerts, setLastAlerts] = useState<ScheduledAlert[]>([]);

  useEffect(() => {
    if (!projectId || !crewId) return;
    if (probes.length === 0) return;

    const tick = () => {
      const alerts = evaluateProbes({ probes, minLeadTimeMin: MIN_LEAD_TIME_MIN });
      const now = Date.now();
      const out: ScheduledAlert[] = [];
      for (const a of alerts) {
        const last = firedRef.current.get(a.generatorId) ?? 0;
        if (now - last < 30 * 60 * 1000) continue;
        firedRef.current.set(a.generatorId, now);
        const payload = buildPushPayload(a);
        try {
          notify(payload);
        } catch {
          // ignore notifier failures
        }
        out.push(a);
      }
      if (out.length > 0) setLastAlerts(out);
    };

    // First tick immediately so a freshly-mounted scheduler doesn't sit
    // idle for a minute when there's already a pending risk.
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [projectId, crewId, probes, notify]);

  // Render nothing — pure side effect. We expose the last-alerts state
  // for tests via a `data-` attribute on a hidden span so jsdom-based
  // assertions can inspect without exporting internals.
  return (
    <span
      data-testid="alert-scheduler-mount"
      data-last-alerts={lastAlerts.length}
      className="sr-only"
      aria-hidden="true"
    />
  );
}
