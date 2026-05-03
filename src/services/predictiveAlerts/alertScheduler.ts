// SPDX-License-Identifier: MIT
// Sprint 15 — Predictive alert scheduler.
//
// Orchestrates the 15 Bernoulli generators against weather/IoT readings.
// Pure-ish: side-effects (push notifications, timers) are passed in via
// dependency injection so the orchestrator stays unit-testable.

import {
  shouldFireWindowed,
  type ForecastFn,
  type WindowedDecision,
  RECOMMENDED_ACTIONS_ES,
} from './windowedTrigger';

export interface GeneratorProbe {
  /** Bernoulli generator id, e.g. 'scaffold-uplift'. */
  id: string;
  /** Threshold above which the underlying generator considers risk. */
  threshold: number;
  /** Snapshot of "now". */
  currentValue: number;
  /** Forecast curve; same closure semantics as `windowedTrigger`. */
  forecast: ForecastFn;
}

export interface ScheduledAlert {
  generatorId: string;
  decision: WindowedDecision;
  /** Spanish-CL push body suitable for the supervisor's phone. */
  body: string;
  /** ISO-8601 timestamp the alert was scheduled at. */
  scheduledAt: string;
}

export interface SchedulerInputs {
  probes: GeneratorProbe[];
  /** Allows overriding lead-time + window per probe. */
  windowMinutes?: number;
  minLeadTimeMin?: number;
  /** Stub for unit tests; defaults to Date.now(). */
  now?: () => Date;
}

/**
 * Pure: take a snapshot of probes, return the alerts that should fire.
 * No I/O. The caller (e.g. a hook in RootLayout) is responsible for the
 * push notification side effect and for awarding XP on "Atendido".
 */
export function evaluateProbes(input: SchedulerInputs): ScheduledAlert[] {
  const now = input.now ? input.now() : new Date();
  const out: ScheduledAlert[] = [];
  for (const probe of input.probes) {
    const decision = shouldFireWindowed(
      { currentValue: probe.currentValue, threshold: probe.threshold, generatorId: probe.id },
      probe.forecast,
      {
        windowMinutes: input.windowMinutes,
        minLeadTimeMin: input.minLeadTimeMin,
        recommendedAction: RECOMMENDED_ACTIONS_ES[probe.id] ?? 'Reevaluar la tarea.',
      }
    );
    if (!decision.fire) continue;
    const body = `Alerta predictiva (${decision.leadTimeMin} min): ${decision.recommendedAction}`;
    out.push({
      generatorId: probe.id,
      decision,
      body,
      scheduledAt: now.toISOString(),
    });
  }
  return out;
}

/**
 * Build the standard push payload for a scheduled predictive alert. The
 * "Atendido" action is wired by the receiver UI: clicking it calls
 * /api/processes/:id/close-alert (or just locally awards XP via the
 * SkillTree positive API). The push payload itself is informative-only,
 * never punitive.
 */
export function buildPushPayload(alert: ScheduledAlert): {
  title: string;
  body: string;
  priority: 'high';
  data: { generatorId: string; leadTimeMin: number; xpRewardOnAck: number };
} {
  return {
    title: 'Praeventio — Alerta predictiva',
    body: alert.body,
    priority: 'high',
    data: {
      generatorId: alert.generatorId,
      leadTimeMin: alert.decision.leadTimeMin,
      // Mirrors XP_AMOUNTS.evadir_riesgo_predictivo in src/types/organic.ts.
      xpRewardOnAck: 30,
    },
  };
}
