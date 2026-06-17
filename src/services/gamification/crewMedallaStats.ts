// Praeventio Guard — project-level crew achievement stats for the SkillTree.
//
// SkillTree (EmergencySquadManager) previously rendered with NO stats, so it
// fell back to ZERO_STATS and evaluateMedallas() always returned [] — every
// medalla was permanently locked no matter the crews' real accomplishments.
// This aggregates the REAL data the project's crews/processes already record:
//   • totalProcessesCompleted — Σ over the project's crew docs (incremented on
//     process close, organic.ts).
//   • daysWithoutIncident     — best (max) streak across the project's crews.
//   • alertsResponded         — Σ over the project's process docs (incremented
//     when a crew responds to a predictive alert, organic.ts).
// `wisdomCapsulesCompleted` / `nearMissesReported` are not tracked at this level
// yet → honest 0 (their medallas stay locked; we never fabricate a count).
//
// Pure + unit-tested so the aggregation is verified without mounting the
// jsdom component.

import { type MedallaStats } from './positiveXp';

export interface CrewStatDoc {
  totalProcessesCompleted?: number;
  daysWithoutIncident?: number;
}

export interface ProcessStatDoc {
  alertsResponded?: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function aggregateCrewMedallaStats(
  crews: CrewStatDoc[],
  processes: ProcessStatDoc[],
): MedallaStats {
  return {
    totalProcessesCompleted: crews.reduce((s, c) => s + num(c.totalProcessesCompleted), 0),
    daysWithoutIncident: crews.reduce((m, c) => Math.max(m, num(c.daysWithoutIncident)), 0),
    alertsResponded: processes.reduce((s, p) => s + num(p.alertsResponded), 0),
    // Not tracked at project/crew level yet — honest 0, never a fabricated count.
    wisdomCapsulesCompleted: 0,
    nearMissesReported: 0,
  };
}
