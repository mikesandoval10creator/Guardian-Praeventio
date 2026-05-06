// SystemEngine — Policy registry.
//
// Policies opt-in via `registerPolicy()`. The decisionEngine queries
// `policiesFor(event.type)` and runs them concurrently, collecting all
// actions for the executor to dispatch.
//
// Why a registry vs. a hard-coded switch: rules in `useAutonomousAlerts`
// today are hard-coded; adding one means editing the hook. With a registry,
// policies are addressable by id, can be unit-tested in isolation, and can
// be feature-flagged at registration time without touching the engine.

import type { AnyPolicy, Policy } from './policy.types';
import type { SystemEventType } from '../eventTypes';

const registry = new Map<string, AnyPolicy>();

export function registerPolicy<T extends SystemEventType>(policy: Policy<T>): void {
  if (registry.has(policy.id)) {
    throw new Error(`Policy id collision: ${policy.id}`);
  }
  registry.set(policy.id, policy as unknown as AnyPolicy);
}

export function unregisterPolicy(id: string): boolean {
  return registry.delete(id);
}

export function policiesFor(eventType: SystemEventType): AnyPolicy[] {
  const out: AnyPolicy[] = [];
  for (const policy of registry.values()) {
    if (policy.trigger.includes(eventType)) out.push(policy);
  }
  return out;
}

export function listPolicies(): AnyPolicy[] {
  return Array.from(registry.values());
}

/** Test-only. */
export function __resetRegistryForTests(): void {
  registry.clear();
}
