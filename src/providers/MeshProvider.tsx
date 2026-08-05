// SPDX-License-Identifier: MIT
//
// Sprint 35 — MeshProvider (closes ADR-0013 last-mile, Sprint 33 D3).
//
// CONTEXT
// =======
// Sprint 33 D3 wired `enqueueOutbound` from `EmergencyContext` into the
// mesh fallback path: when the server fan-out fails, we encode the SOS
// as a `MeshPacket` and ask the active `TransportFacade` to broadcast
// it. But D3 stopped at the surface — `registerMeshTransport(facade)`
// was exported, never CALLED, leaving `activeFacade = null` in runtime
// and `enqueueOutbound` returning `{enqueued:false, reason:'no-transport'}`.
//
// This provider closes the gap: it constructs the `MeshRelayQueue` +
// `TransportFacade`, starts the transport, and registers it with the
// fallback module. On unmount, it tears everything down cleanly.
//
// FLOW INFINITO
// =============
// Phase 2 — Adaptive Response — depends on this wire being live.
// Without this provider mounted, the mesh path is dead code and a
// worker in a tunnel with no network has no escalation channel.
// XP awards (Phase 3, Sprint 32 B3) ride on top via `makeRelayXpHandler`.
//
// PLATFORM
// ========
// On native (Capacitor), the underlying `@praeventio/capacitor-mesh`
// plugin proxies BLE GATT (Sprint 31). On web, it falls back to the
// BroadcastChannel-based simulator inside the plugin's web shim, so
// dev tabs still exercise the logical path with zero real packets.
// We do NOT need a custom adapter switch here — the facade already
// resolves `Mesh` via `Capacitor.isNativePlatform()` internally.
//
// FAILURE MODE
// ============
// Mesh failure is a degraded mode, not a crash. Every async error is
// captured via `getErrorTracker()` and logged; we never throw into
// the React tree. If `startMesh` rejects, the provider stays mounted
// with `activeFacade = null` — `enqueueOutbound` will return
// `'no-transport'` exactly as in dev, and the rest of the app works.

import { useEffect, useRef, type ReactNode } from 'react';

import { useFirebase } from '../contexts/FirebaseContext';
import { isAdminRole, isSupervisorRole } from '../types/roles';
import { useProject } from '../contexts/ProjectContext';
import { registerMeshTransport } from '../services/emergency/meshFallback';
import { useEmergency } from '../contexts/EmergencyContext';
import { MeshRelayQueue } from '../services/mesh/meshRelayQueue';
import { makeRelayXpHandler } from '../services/mesh/meshRelayXpWire';
import { MeshRequestRouter } from '../services/mesh/meshRequestRouter';
import {
  getMeshSigningKey,
  provisionMeshSigningKey,
} from '../services/mesh/meshKeyStore';
import { TransportFacade } from '../services/mesh/transportFacade';
import { getErrorTracker } from '../services/observability/index.js';
import { logger } from '../utils/logger';

interface MeshProviderProps {
  children: ReactNode;
}

function reportMeshError(err: unknown, step: string): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { tags: { service: 'mesh.provider', step } } as any,
    );
  } catch {
    /* observability never breaks the provider */
  }
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(`[MeshProvider] ${step} failed — degraded mode`, err);
  }
}

export function MeshProvider({ children }: MeshProviderProps) {
  const { user, userRole } = useFirebase();
  const { selectedProject } = useProject();
  // [P0][VIDA] Emergency escalation for incoming mesh SOS — the local
  // supervisor responds even when the network is down (mesh is the offline
  // transport). triggerEmergency fans out to brigade + Firestore.
  const { triggerEmergency } = useEmergency();

  const uid = user?.uid ?? null;
  const projectId = selectedProject?.id ?? null;

  // B16 wire (2026-06) — supervisors-delivery role for the relay queue.
  // Ref-backed so a role that resolves AFTER mount (users/{uid}.role getDoc
  // lands late, or the role changes mid-session) reaches the queue WITHOUT
  // entering the effect deps — tearing down/restarting the BLE transport on
  // a role refresh would drop in-flight packets. Admin-class roles
  // (admin/gerente) also receive supervisor-addressed life-safety events.
  const roleRef = useRef(userRole);
  roleRef.current = userRole;

  useEffect(() => {
    // Auth or project context still resolving — early return per
    // Sprint 35 D acceptance: do NOT construct a facade with empty
    // selfUid/projectId. Effect will re-fire when both arrive.
    if (!uid || !projectId) return undefined;

    let cancelled = false;
    let facade: TransportFacade | null = null;

    (async () => {
      // Provision the project mesh signing key while online (best-effort), then
      // load the cached key for offline verify-on-receive. Failure is a
      // degraded mode — the queue runs without verification until a key lands.
      await provisionMeshSigningKey(projectId).catch((err) =>
        reportMeshError(err, 'provisionMeshKey'),
      );
      const signingKey = await getMeshSigningKey(projectId).catch((err) => {
        reportMeshError(err, 'loadMeshKey');
        return null;
      });
      if (cancelled) return;

      const queue = new MeshRelayQueue({
        selfUid: uid,
        projectId,
        // verify-on-receive: forged SOS/packets are rejected against this key.
        signingKey,
        // Sprint 32 B3 wire — relayer earns +50 XP on each SOS rebroadcast
        // (Flow Infinito Phase 3: Consolidación de Conocimiento).
        onRelaySuccess: makeRelayXpHandler(),
        // B16 wire — live role check so packets addressed to 'supervisors'
        // are delivered locally on supervisor/admin devices (was hardcoded
        // false since Sprint 26, i.e. never delivered anywhere).
        isSupervisor: () =>
          isSupervisorRole(roleRef.current) || isAdminRole(roleRef.current),
      });

      facade = new TransportFacade({
        peerId: uid,
        projectId,
        queue,
        // [P0][VIDA] Route verified incoming packets to the local consumers.
        // Without a router the facade dropped every forLocal packet silently:
        // a supervisor physically in range of a worker's SOS got NOTHING.
        router: new MeshRequestRouter({
          selfUid: uid,
          projectId,
          queue,
          localFileLookup: async () => null,
          onFileComplete: () => {},
          // A verified SOS addressed to us/broadcast → local escalation.
          // Dedup: triggerEmergency is idempotent per type/project (the
          // Firestore write guards on existing open emergencies), and the
          // relay queue only delivers a packet once per node.
          onSosReceived: (packet) => {
            logger.info('mesh_sos_received', {
              fromUid: packet.fromUid ?? 'unknown',
              projectId: packet.payload.projectId,
              reason: packet.payload.triggerReason,
            });
            void triggerEmergency('fall', packet.payload.projectId || projectId || undefined);
          },
          // Supervisor-addressed events (B16): logged for observability;
          // per-type consumers (breadcrumbs, edge events) land in later
          // tickets — the router no longer drops them.
          onSupervisorEventReceived: (packet) => {
            logger.info('mesh_supervisor_event', {
              fromUid: packet.fromUid ?? 'unknown',
              eventType: packet.payload.eventType,
            });
          },
        }),
      });

      try {
        await facade.startMesh();
        if (cancelled) {
          // Provider unmounted before startMesh resolved — undo.
          await facade.stopMesh().catch((err) =>
            reportMeshError(err, 'stopMesh-after-cancel'),
          );
          return;
        }
        registerMeshTransport(facade);
      } catch (err) {
        reportMeshError(err, 'startMesh');
      }
    })();

    return () => {
      cancelled = true;
      // Drop the registration first so any in-flight `enqueueOutbound`
      // sees `no-transport` rather than a half-stopped facade.
      registerMeshTransport(null);
      const f = facade;
      facade = null;
      if (f) {
        void f.stopMesh().catch((err) => reportMeshError(err, 'stopMesh'));
      }
    };
  }, [uid, projectId]);

  return <>{children}</>;
}
