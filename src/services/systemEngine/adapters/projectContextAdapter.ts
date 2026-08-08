// SPDX-License-Identifier: MIT
//
// SystemEngine — Project context adapter (real producer).
//
// Sprint 50 E.15 P1 H11 — closes ticket
// 39aaa66d-73fe-81a6-84f8-fd311af55f45 (one slice of the 8-adapter
// backlog). This adapter now emits a real event when `selectedProject`
// changes — previously it was a no-op placeholder.
//
// Emitted event: `tier_changed` (reused existing event type, with
// `fromTier`/`toTier` carrying the project IDs). Reusing an existing
// type keeps the SystemEvent schema unchanged and avoids "decorative
// events that nobody consumes" — `tier_changed` already has a policy
// subscriber (tierChangeReactivityPolicy).
//
// Why this matters: when a user switches projects mid-session, the
// subscription context, feature flags, and cached zones are stale.
// tierChangeReactivityPolicy already calls `invalidate_subscription` on
// `tier_changed`, which now triggers automatically on project switch.
//
// Future extensions (separate tickets):
//   - `appModeContextAdapter`: emit `tier_changed` when mode flips
//     to/from 'mine' or 'highway' (forces SLM readiness re-evaluation).
//   - `themeContextAdapter`: emit a derived `audit_log_appended` event
//     for SOC2-style audit trail of UI personalization changes.

import { useEffect, useRef } from 'react';

import { useFirebase } from '../../../contexts/FirebaseContext';
import { useProject } from '../../../contexts/ProjectContext';
import { buildEnvelope, emit } from '../eventLog';
import { logger } from '../../../utils/logger';

export interface ProjectAdapterOptions {
  tenantId: string;
}

/**
 * Project context adapter — emits a `tier_changed` event whenever
 * `selectedProject.id` changes. The event payload carries the project
 * IDs in `fromTier`/`toTier` so existing policies (tierChangeReactivity)
 * can react without schema changes.
 */
export function useProjectContextAdapter({ tenantId }: ProjectAdapterOptions): void {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const lastProjectIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!tenantId) return;
    const newId = selectedProject?.id;
    const prevId = lastProjectIdRef.current;

    // Skip the first render (nothing to compare against).
    if (prevId === undefined) {
      lastProjectIdRef.current = newId;
      return;
    }
    // Skip no-op transitions (selectedProject reference change without
    // id change).
    if (prevId === newId) return;

    lastProjectIdRef.current = newId;

    const userId = user?.uid ?? '';
    const fromTier = prevId;
    const toTier = newId ?? 'none';

    void emit({
      ...buildEnvelope({
        tenantId,
        projectId: newId,
        actorUid: user?.uid ?? null,
        // Idempotency: project-switch events are rare (user-driven) so
        // a per-timestamp key is safe. If the same switch is replayed
        // (e.g. offline outbox), the idempotencyKey includes the prev→
        // new pair which is unique per actual switch.
        idempotencyKey: `project_switch:${userId}:${fromTier}->${toTier}`,
        metadata: {
          previousProjectId: prevId,
          newProjectId: newId ?? null,
          source: 'project_context_adapter',
          reason: 'project_switch',
        },
      }),
      type: 'tier_changed',
      payload: {
        userId,
        fromTier,
        toTier,
        // Repurpose the `source` field — `admin` is the closest semantic
        // match for an internal context-driven switch. The policy
        // consumer doesn't branch on `source` for invalidation.
        source: 'admin',
      },
    }).catch((err) =>
      logger.warn('projectContextAdapter: emit failed', { err: String(err) }),
    );
  }, [selectedProject?.id, tenantId, user?.uid]);
}
