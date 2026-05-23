// SPDX-License-Identifier: MIT
//
// useObjectLifecycle — wires `deriveLifecycleTransition` (pure orchestrator)
// to the actual side-effects:
//   - ZK node persistence via `useRiskEngine().addNode`
//   - Calendar event persistence via Firestore `calendar_events` collection
//
// This is the bridge between Brecha C foundation (pure specs) and the
// runtime Firestore writes — kept in a hook so React components consume
// a single async callback.

import { useCallback } from 'react';
import { NodeType } from '../types';
import type { RiskNode } from '../types';
import { useRiskEngine } from './useRiskEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  deriveLifecycleTransition,
  type LifecycleTransitionResult,
} from '../services/digitalTwin/lifecycle/objectLifecycleOrchestrator';
import type { PlacedObject } from '../services/digitalTwin/photogrammetry/types';
import { db, auth, collection, addDoc, updateDoc, serverTimestamp } from '../services/firebase';
import { logger } from '../utils/logger';
import { apiAuthHeader } from '../lib/apiAuth';

export type UseObjectLifecycleCallback = (
  previous: PlacedObject | null,
  next: PlacedObject,
) => Promise<LifecycleTransitionResult>;

/**
 * Dependencies for the pure runner. Extracted so tests can inject mocks
 * without rendering a React tree.
 */
export interface ObjectLifecycleDeps {
  projectId: string;
  actorUserId?: string;
  addNode: (node: Omit<RiskNode, 'id' | 'createdAt' | 'updatedAt'>) => Promise<unknown>;
  /** Persist a calendar event document. Resolves when the write completes. */
  addCalendarEvent: (data: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Pure async runner — same behavior as the hook callback but without
 * React/Firebase coupling. The hook below wires real deps; tests inject
 * spies.
 */
export async function runObjectLifecycle(
  previous: PlacedObject | null,
  next: PlacedObject,
  deps: ObjectLifecycleDeps,
): Promise<LifecycleTransitionResult> {
  const result = deriveLifecycleTransition({
    previous,
    next,
    projectId: deps.projectId,
    actorUserId: deps.actorUserId,
  });

  if (result.zkNodeSpec) {
    const spec = result.zkNodeSpec;
    const nodeData: Omit<RiskNode, 'id' | 'createdAt' | 'updatedAt'> = {
      type: spec.type as NodeType,
      title: spec.title,
      description: spec.description,
      tags: spec.tags,
      connections: spec.connections,
      projectId: spec.projectId,
      metadata: spec.metadata as Record<string, unknown> as Record<string, any>,
    };
    await deps.addNode(nodeData);
  }

  for (const calSpec of result.calendarEventSpecs) {
    await deps.addCalendarEvent({ ...calSpec });
  }

  return result;
}

export function useObjectLifecycle(projectId: string): UseObjectLifecycleCallback {
  const { addNode } = useRiskEngine();
  const { user } = useFirebase();

  return useCallback(
    async (previous: PlacedObject | null, next: PlacedObject) => {
      return runObjectLifecycle(previous, next, {
        projectId,
        actorUserId: user?.uid,
        addNode: (n) => addNode(n),
        addCalendarEvent: async (data) => {
          // (1) Persistir local en Firestore con syncStatus=pending. El
          // job remoto (Google Calendar) puede fallar — el doc local
          // queda como source of truth y un retry job lo recoge.
          const calRef = collection(db, 'calendar_events');
          const localRef = await addDoc(calRef, {
            ...data,
            syncStatus: 'pending',
            createdAt: serverTimestamp(),
          });

          // (2) Best-effort sync a Google Calendar via /api/calendar/sync.
          // Si no hay token Google linked, el endpoint devuelve 401 y el
          // doc queda 'pending' — comportamiento aceptable para Ola 3.
          try {
            // §2.20 (2026-05-23) — apiAuthHeader unified.
            const authHeader = await apiAuthHeader();
            if (authHeader) {
              const res = await fetch('/api/calendar/sync', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(authHeader ? { 'Authorization': authHeader } : {}),
                },
                body: JSON.stringify({
                  event: data,
                  localRef: localRef.id,
                  // El endpoint actual del server consume `challenges` —
                  // mandamos también un fallback con el título para que
                  // si el wire futuro de calendar sync se pliega al
                  // formato del orchestrator, no rompamos compat.
                  challenges: [
                    typeof data.title === 'string'
                      ? data.title
                      : 'Mantención Praeventio',
                  ],
                }),
                credentials: 'include',
              });
              if (res.ok) {
                const body = (await res.json().catch(() => ({}))) as {
                  googleEventId?: string;
                  results?: Array<{ id?: string }>;
                };
                const googleEventId =
                  body.googleEventId ??
                  body.results?.[0]?.id ??
                  null;
                await updateDoc(localRef, {
                  syncStatus: 'synced',
                  ...(googleEventId ? { googleEventId } : {}),
                });
              } else {
                logger.warn('calendar_sync_non_ok', { status: res.status });
              }
            }
          } catch (err) {
            // syncStatus queda 'pending' — un retry job lo recoge después.
            logger.warn('calendar_sync_deferred', { err: String(err) });
          }

          return localRef;
        },
      });
    },
    [projectId, addNode, user?.uid],
  );
}
