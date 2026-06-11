// SystemEngine — React provider.
//
// Mounts:
//   1. The 3 critical context adapters (subscription, emergency, sensor).
//   2. The executor bindings (so server-side decisions can dispatch into
//      the running React contexts without prop-drilling).
//   3. An online listener that drains the offline outbox.
//   4. The decision engine: subscribes to the bus and runs registered
//      policies → executes actions.
//
// The provider is opt-in: an app can ship without it and the existing
// contexts continue to work unchanged.

import React, { useEffect, useRef } from 'react';

import { useEmergency } from './EmergencyContext';
import { useNotifications } from './NotificationContext';
import { useSubscription } from './SubscriptionContext';
import { useFirebase } from './FirebaseContext';
import { useProject } from './ProjectContext';
import {
  useEmergencyContextAdapter,
} from '../services/systemEngine/adapters/emergencyContextAdapter';
import {
  useSensorContextAdapter,
} from '../services/systemEngine/adapters/sensorContextAdapter';
import {
  useSubscriptionContextAdapter,
} from '../services/systemEngine/adapters/subscriptionContextAdapter';
import { bindExecutor, execute, unbindExecutor } from '../services/systemEngine/executor';
import { decide } from '../services/systemEngine/decisionEngine';
import { drainOutbox, onLocalEmit } from '../services/systemEngine/eventLog';
import { useSystemEvent } from '../services/systemEngine/subscriber';
import { ALL_EVENT_TYPES } from '../services/systemEngine/eventTypes';
import { registerPolicy, __resetRegistryForTests } from '../services/systemEngine/policies';
import { geofenceToSosPolicy } from '../services/systemEngine/policies/geofenceToSos';
import { tierChangeReactivityPolicy } from '../services/systemEngine/policies/tierChangeReactivity';
import { logger } from '../utils/logger';

export interface SystemEngineProviderProps {
  /**
   * Logical tenant id — INFORMATIONAL only since the A4 re-scope: it is
   * stamped inside event envelopes but the bus path is keyed by the
   * selected PROJECT (`projects/{pid}/system_events`).
   */
  tenantId: string;
  /** Master kill-switch. When false, nothing in the engine runs. */
  enabled?: boolean;
  children: React.ReactNode;
}

let policiesRegistered = false;

function registerDefaultPolicies(): void {
  if (policiesRegistered) return;
  try {
    registerPolicy(geofenceToSosPolicy);
    registerPolicy(tierChangeReactivityPolicy);
    policiesRegistered = true;
  } catch (err) {
    // Idempotent: if a hot reload re-registers, the duplicate-id check
    // throws — we swallow because the registry is already populated.
    logger.warn('SystemEngineProvider: policy registration noop', {
      err: String(err),
    });
  }
}

export function SystemEngineProvider({
  tenantId,
  enabled = true,
  children,
}: SystemEngineProviderProps): React.ReactElement {
  if (!enabled) return <>{children}</>;
  return (
    <SystemEngineInner tenantId={tenantId}>
      {children}
    </SystemEngineInner>
  );
}

function SystemEngineInner({
  tenantId,
  children,
}: {
  tenantId: string;
  children: React.ReactNode;
}): React.ReactElement {
  registerDefaultPolicies();

  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { triggerEmergency, isEmergencyActive } = useEmergency();
  const { addNotification } = useNotifications();
  const sub = useSubscription();

  // Adapters publish events to the bus. They are passive — they don't
  // change context state, only observe transitions.
  useEmergencyContextAdapter({ tenantId });
  useSubscriptionContextAdapter({ tenantId });
  useSensorContextAdapter({ tenantId });

  // Bind the executor so policies can dispatch actions into the live
  // React contexts. SubscriptionContext does not expose a `refresh`
  // primitive today (the plan is fetched on uid change). The
  // invalidateSubscription/refreshFeatureFlags bindings are intentionally
  // omitted here — the executor will log a missing-binding warning, which
  // is the desired soft-failure behaviour. A follow-up that adds a
  // `refresh()` method to SubscriptionContext will wire them.
  useEffect(() => {
    bindExecutor({
      triggerEmergency,
      addNotification: addNotification as never,
    });
    return () => unbindExecutor();
  }, [triggerEmergency, addNotification, sub]);

  // Subscribe to every event type and run the decision engine.
  // Closure-stable: cb captures latest tenantId/projectId from refs.
  // A4 re-scope (2026-06): the bus is PROJECT-scoped
  // (`projects/{pid}/system_events`) — the selected project keys the
  // Firestore subscription. With no project selected the engine stays
  // local-only (useSystemEvent skips the snapshot, onLocalEmit still runs).
  const projectRef = useRef(selectedProject?.id);
  projectRef.current = selectedProject?.id;
  // Live emergency state via ref so the decide-context callbacks (which are
  // closure-stable across renders) always read the CURRENT value. This was
  // previously hardcoded `() => false`, which defeated geofenceToSos's
  // anti-cascade guard — the policy would re-trigger an SOS even while an
  // emergency was already active. Reading the real state fixes that.
  const emergencyActiveRef = useRef(isEmergencyActive);
  emergencyActiveRef.current = isEmergencyActive;
  useSystemEvent(
    {
      projectId: selectedProject?.id,
      tenantId,
      types: ALL_EVENT_TYPES.slice(0, 30) as never,
      pageSize: 100,
    },
    (event) => {
      void decide(event, {
        tenantId,
        projectId: projectRef.current,
        isFeatureEnabled: () => true,
        hasActiveEmergency: () => emergencyActiveRef.current,
      })
        .then((result) => execute(result.actions))
        .catch((err) =>
          logger.warn('SystemEngineProvider: decide pipeline failed', { err: String(err) }),
        );
    },
  );

  // Also process in-process emits (lower latency than waiting for the
  // Firestore round-trip). This duplicates with the snapshot path; the
  // idempotency ring in eventLog dedupes downstream.
  useEffect(() => {
    return onLocalEmit((event) => {
      void decide(event, {
        tenantId,
        projectId: projectRef.current,
        isFeatureEnabled: () => true,
        hasActiveEmergency: () => emergencyActiveRef.current,
      })
        .then((result) => execute(result.actions))
        .catch((err) =>
          logger.warn('SystemEngineProvider: local decide failed', { err: String(err) }),
        );
    });
  }, [tenantId]);

  // Drain the offline outbox whenever the device comes back online.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOnline = () => {
      void drainOutbox().catch((err) =>
        logger.warn('SystemEngineProvider: drain failed', { err: String(err) }),
      );
    };
    window.addEventListener('online', onOnline);
    // Also drain on mount in case events were queued during boot.
    onOnline();
    return () => window.removeEventListener('online', onOnline);
  }, []);

  return <>{children}</>;
}

/** Test-only — resets the policy registry so tests can register their own. */
export function __resetSystemEngineProviderForTests(): void {
  policiesRegistered = false;
  __resetRegistryForTests();
}
