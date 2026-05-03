// SPDX-License-Identifier: MIT
// Sprint 15 — Organic structure: Project → Crew → Process → Task.
//
// These types power the nested gamified planning model. The XP economy is
// strictly POSITIVE — XP is awarded for safe behaviors, predictive-alert
// response, autocuidado biomecánico, and process completion. XP is NEVER
// removed for uncontrollable events (wind, rain, seismic, heat, predictive
// alert raised). See `src/services/organic/processService.ts` for the
// closing-XP formula and `src/components/emergency/SkillTree.tsx` for the
// individual + collective tracks.

/**
 * A Crew is a working group inside a Project. Members are project members
 * who have been explicitly enrolled in this crew. The Project model is NOT
 * broken: a project can have zero crews (legacy / single-team mode) and a
 * lazy "default" crew is created on-demand the first time a process is
 * started without a crew context. See `getOrCreateDefaultCrew`.
 */
export interface Crew {
  id: string;
  projectId: string;
  name: string;
  memberUids: string[];
  createdAt: string; // ISO-8601 timestamp
  totalProcessesCompleted: number;
  daysWithoutIncident: number;
  xp: number;
  /** ISO-8601 timestamp of last incident, or null if none ever recorded. */
  lastIncidentAt: string | null;
}

/**
 * Process types map 1:1 to color buckets in `GanttProjectView`. Adding a
 * new type requires updating the color map in the Gantt component AND the
 * `baseXpForProcessType` table in `processService.ts`.
 */
export type ProcessType =
  | 'concreto'
  | 'fachada'
  | 'movimiento_tierras'
  | 'soldadura'
  | 'mantenimiento'
  | 'demolicion'
  | 'instalacion_electrica'
  | 'pintura'
  | 'topografia'
  | 'transporte'
  | 'otro';

export type ProcessStatus = 'planning' | 'active' | 'paused' | 'completed' | 'aborted';

/**
 * A Process is a time-bounded scope of work executed by a Crew. The
 * `complianceScore` (0-100) is a manual or auto-derived rating at close
 * time; multiplied with `baseXpForProcessType(type)` and a small bonus per
 * `alertsResponded` gives the XP awarded to the crew on close.
 */
export interface Process {
  id: string;
  crewId: string;
  projectId: string;
  type: ProcessType;
  name: string;
  description: string;
  /** ISO-8601 when the process moved to status 'active'. */
  startedAt: string | null;
  /** ISO-8601 when the process moved to a terminal status (completed/aborted). */
  endedAt: string | null;
  /** ISO-8601 date (YYYY-MM-DD or full ISO) targeted for completion. */
  plannedEndDate: string | null;
  status: ProcessStatus;
  /** 0-100, the cumulative compliance score used for XP calculation. */
  complianceScore: number;
  incidentsDuringProcess: number;
  /** Counter incremented every time a predictive alert is "Atendida". */
  alertsResponded: number;
  /** XP actually awarded at close. Null until the process is closed. */
  xpAwardedAtClose: number | null;
}

/**
 * A Task is a single planned activity inside a Process. Tasks are
 * lightweight — assignment is by uid, status is a 3-step pipeline.
 */
export interface Task {
  id: string;
  processId: string;
  crewId: string;
  projectId: string;
  /** YYYY-MM-DD planned execution date. */
  date: string;
  description: string;
  assignedUids: string[];
  status: 'pending' | 'doing' | 'done';
  /** ISO-8601 when status moved to 'done'. */
  completedAt: string | null;
}

/**
 * Reasons for awarding XP. The list is closed — additions require updates
 * in `awardXp` and the SkillTree medallas table. Negative reasons are
 * intentionally absent: gamification is positive-only.
 */
export type XpReason =
  | 'process_completed'
  | 'days_no_incident'
  | 'autocuidado_biomecanico'
  | 'reportar_nearmiss'
  | 'evadir_riesgo_predictivo'
  | 'wisdom_capsule_completed'
  | 'task_done';

/** Default XP amounts per reason (positive integers only). */
export const XP_AMOUNTS: Record<XpReason, number> = {
  process_completed: 0, // computed dynamically per process
  days_no_incident: 5,
  autocuidado_biomecanico: 10,
  reportar_nearmiss: 20,
  evadir_riesgo_predictivo: 30,
  wisdom_capsule_completed: 5,
  task_done: 2,
};
