// SystemEngine — Policy + Action types.
//
// A `Policy<E,A>` is a pure function from (event, context) → actions. It
// MUST NOT have side effects: side effects belong in the executor. Policies
// are easy to test in isolation: compose a synthetic event, inject a stub
// PolicyContext, assert the produced actions match expectations.

import type { SystemEvent, SystemEventType, EventOfType } from '../eventTypes';

export type Priority = 'P0' | 'P1' | 'P2';

export interface PolicyContext {
  /** Tenant scope of the evaluation. */
  tenantId: string;
  /** Optional project scope. */
  projectId?: string;
  /** Read-only access to feature flags (tier-based). */
  isFeatureEnabled: (flag: string) => boolean;
  /** Whether an emergency is already active for the project (avoids cascading). */
  hasActiveEmergency: () => boolean;
  /** Optional now-ms override for deterministic tests. */
  nowMs?: () => number;
}

// ── Action types ─────────────────────────────────────────────────────

export type Action =
  | TriggerEmergencyAction
  | InvalidateContextAction
  | RefreshFeatureFlagsAction
  | NotifyUserAction
  | AuditAction
  | EmitDerivedEventAction;

export interface TriggerEmergencyAction {
  kind: 'trigger_emergency';
  emergencyType: string;
  projectId: string;
  reason: string;
}

export interface InvalidateContextAction {
  kind: 'invalidate_context';
  contextName: 'subscription' | 'project' | 'normative' | 'universalKnowledge';
}

export interface RefreshFeatureFlagsAction {
  kind: 'refresh_feature_flags';
  userId: string;
}

export interface NotifyUserAction {
  kind: 'notify_user';
  userId: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
}

export interface AuditAction {
  kind: 'audit';
  action: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface EmitDerivedEventAction {
  kind: 'emit';
  event: SystemEvent;
}

// ── Policy contract ──────────────────────────────────────────────────

export interface Policy<T extends SystemEventType = SystemEventType> {
  id: string;
  description: string;
  priority: Priority;
  trigger: T[];
  evaluate: (event: EventOfType<T>, ctx: PolicyContext) => Promise<Action[]> | Action[];
}

export type AnyPolicy = Policy<SystemEventType>;
