// SystemEngine — Executor.
//
// Dispatches `Action[]` to the existing service surfaces. Reuses what's
// already in the codebase: `triggerEmergency` (EmergencyContext),
// `addNotification` (NotificationContext), `auditService.logAuditAction`,
// FCM/email adapters. Each action is fire-and-forget so a slow Firestore
// write or a failing FCM token doesn't block the rest of the dispatch.

import { logger } from '../../utils/logger';
import { logAuditAction } from '../auditService';
import { emit } from './eventLog';
import type { Action } from './policies/policy.types';

export interface ExecutorBindings {
  /** Live `triggerEmergency` from EmergencyContext. */
  triggerEmergency?: (type: string, projectId?: string) => Promise<void> | void;
  /** Live `addNotification` from NotificationContext. */
  addNotification?: (n: {
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
  }) => void;
  /** Live SubscriptionContext.refresh() (or similar). */
  invalidateSubscription?: () => void | Promise<void>;
  /** Live ProjectContext invalidator. */
  invalidateProject?: () => void | Promise<void>;
  /** Live NormativeContext invalidator. */
  invalidateNormative?: () => void | Promise<void>;
  /** Live UniversalKnowledgeContext invalidator. */
  invalidateUniversalKnowledge?: () => void | Promise<void>;
  /** Live feature-flag refresher. */
  refreshFeatureFlags?: (userId: string) => void | Promise<void>;
}

let bindings: ExecutorBindings = {};

/**
 * Wires the executor to live context callbacks. Call this once from a
 * provider that has access to the React contexts (SystemEngineProvider).
 * Bindings can be partial: actions whose binding is missing are logged and
 * skipped — failure-soft so a missing binding doesn't crash the engine.
 */
export function bindExecutor(b: ExecutorBindings): void {
  bindings = { ...bindings, ...b };
}

export function unbindExecutor(): void {
  bindings = {};
}

export async function execute(actions: Action[]): Promise<void> {
  for (const action of actions) {
    try {
      await dispatch(action);
    } catch (err) {
      logger.warn('systemEngine.executor: action threw', {
        kind: action.kind,
        err: String(err),
      });
    }
  }
}

async function dispatch(action: Action): Promise<void> {
  switch (action.kind) {
    case 'trigger_emergency':
      if (!bindings.triggerEmergency) {
        logger.warn('systemEngine.executor: triggerEmergency not bound', { reason: action.reason });
        return;
      }
      await bindings.triggerEmergency(action.emergencyType, action.projectId);
      return;

    case 'notify_user':
      if (!bindings.addNotification) return;
      bindings.addNotification({
        title: action.title,
        message: action.message,
        type: action.severity,
      });
      return;

    case 'invalidate_context':
      switch (action.contextName) {
        case 'subscription': await bindings.invalidateSubscription?.(); return;
        case 'project': await bindings.invalidateProject?.(); return;
        case 'normative': await bindings.invalidateNormative?.(); return;
        case 'universalKnowledge': await bindings.invalidateUniversalKnowledge?.(); return;
      }
      return;

    case 'refresh_feature_flags':
      await bindings.refreshFeatureFlags?.(action.userId);
      return;

    case 'audit':
      try {
        await logAuditAction(
          action.action,
          'systemEngine',
          { resourceId: action.resourceId, ...action.metadata },
        );
      } catch (err) {
        logger.warn('systemEngine.executor: audit log failed', { err: String(err) });
      }
      return;

    case 'emit':
      void emit(action.event);
      return;
  }
}
