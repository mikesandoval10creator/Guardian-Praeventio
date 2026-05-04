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
import { db, collection, addDoc, serverTimestamp } from '../services/firebase';

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
          const calRef = collection(db, 'calendar_events');
          return addDoc(calRef, { ...data, createdAt: serverTimestamp() });
        },
      });
    },
    [projectId, addNode, user?.uid],
  );
}
