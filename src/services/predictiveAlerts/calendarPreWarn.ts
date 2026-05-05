// SPDX-License-Identifier: MIT
//
// Sprint 29 Bucket DD F-E — Predictive × Calendar pre-warning.
//
// Scans upcoming tasks for the next `daysAhead` days and cross-checks
// each one against weather forecast + seismic + DAYS_OF_RISK heuristics.
// When a task–hazard match is detected (e.g. `at-height` + viento >40km/h
// previsto, `confined-space` + heat-index >30°C, `outdoor` + sismic
// activity > magnitude 5) the service:
//   • emits a push pre-warning to the assigned crew supervisor,
//   • emails the project gerente with the same payload, and
//   • inserts a Google Calendar event tagged "RIESGO: …" 24h BEFORE the
//     task is scheduled to start.
//
// Idempotency: a synthetic key `prewarn_${projectId}_${taskId}_${hazard}`
// keeps the dispatcher from spamming the same crew if the cron retries.
// Mirrors `sendSusesoReminders.ts` (Sprint 28 follow-up): per-task failures
// never abort the scan, the dispatcher is DI'd so tests can mock it.

import {
  shouldFireWindowed,
  type ForecastFn,
} from './windowedTrigger.js';

export interface UpcomingTask {
  /** Document id within `projects/{pid}/tasks` (or analogous). */
  id: string;
  /** Free-form title used in the Calendar event summary. */
  title: string;
  /** Crew/cuadrilla owning the task. */
  cuadrillaId?: string;
  /** Supervisor uid (push recipient). */
  supervisorUid?: string;
  /**
   * Hazard tags attached at planning time. Drives the cross-check:
   *   • 'at-height'        → viento + lluvia
   *   • 'confined-space'   → temperatura + ventilación
   *   • 'outdoor'          → temperatura + sismo
   *   • 'heavy-lifting'    → viento
   *   • 'electrical'       → lluvia
   */
  hazardTags: Array<'at-height' | 'confined-space' | 'outdoor' | 'heavy-lifting' | 'electrical'>;
  /** ISO-8601 datetime the task is supposed to start. */
  scheduledAt: string;
}

export interface WeatherForecastSnapshot {
  /** km/h — peak forecast wind during the task window. */
  peakWindKmh?: number;
  /** mm — total expected rain. */
  rainMm?: number;
  /** °C — peak temperature. */
  peakTempC?: number;
  /** % — peak humidity. */
  peakHumidityPct?: number;
}

export interface SeismicSnapshot {
  /** Richter magnitude of recent quakes within radius of the project. */
  recentMagnitude?: number;
}

/** Days-of-risk multiplier (1.0 = baseline, >1 = elevated). Sprint 24-29. */
export type DaysOfRiskFn = (date: Date) => number;

export interface PreWarnContext {
  weather: WeatherForecastSnapshot;
  seismic: SeismicSnapshot;
  daysOfRisk: number;
}

export type DispatchPushFn = (input: {
  recipientUid: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}) => Promise<{ ok: boolean }>;

export type DispatchEmailFn = (input: {
  recipientUid: string;
  subject: string;
  body: string;
}) => Promise<{ ok: boolean }>;

export type CreateCalendarEventFn = (input: {
  uid: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
}) => Promise<{ id: string | null }>;

export interface ScanInputs {
  projectId: string;
  /** Forecast horizon in days (default 3). */
  daysAhead?: number;
  /** All upcoming tasks for the project within the horizon. */
  tasks: UpcomingTask[];
  /** Returns the weather snapshot for the [start, end] window of a task. */
  getWeather: (task: UpcomingTask) => Promise<WeatherForecastSnapshot> | WeatherForecastSnapshot;
  /** Returns seismic activity at the project location. */
  getSeismic: () => Promise<SeismicSnapshot> | SeismicSnapshot;
  /** DAYS_OF_RISK lookup. */
  daysOfRisk: DaysOfRiskFn;
  /** Push dispatcher. */
  dispatchPush: DispatchPushFn;
  /** Email dispatcher. */
  dispatchEmail: DispatchEmailFn;
  /** Google-Calendar creator. */
  createCalendarEvent: CreateCalendarEventFn;
  /** Project gerente uid (email recipient). */
  gerenteUid?: string;
  /** Idempotency store. */
  alreadyWarned: (key: string) => Promise<boolean> | boolean;
  markWarned: (key: string) => Promise<void> | void;
  /** Override clock for tests. */
  now?: () => Date;
}

export interface ScanResult {
  scanned: number;
  warned: number;
  warnings: Array<{
    taskId: string;
    hazard: string;
    reason: string;
    pushSent: boolean;
    emailSent: boolean;
    calendarEventId: string | null;
  }>;
}

// ───────────────────────────────────────────────────────────────────────
// Hazard rule table (pure)
// ───────────────────────────────────────────────────────────────────────

interface HazardMatch {
  hazardId: string;
  reason: string;
}

function detectHazards(
  task: UpcomingTask,
  ctx: PreWarnContext,
): HazardMatch[] {
  const out: HazardMatch[] = [];
  const dorMul = Number.isFinite(ctx.daysOfRisk) && ctx.daysOfRisk > 0 ? ctx.daysOfRisk : 1;
  const wind = ctx.weather.peakWindKmh ?? 0;
  const rain = ctx.weather.rainMm ?? 0;
  const temp = ctx.weather.peakTempC ?? 0;
  const seismicMag = ctx.seismic.recentMagnitude ?? 0;

  if (task.hazardTags.includes('at-height') && wind * dorMul >= 40) {
    out.push({
      hazardId: 'wind-at-height',
      reason: `Viento previsto ${wind} km/h × DOR ${dorMul.toFixed(2)} excede 40 km/h en tarea de altura`,
    });
  }
  if (task.hazardTags.includes('at-height') && rain >= 5) {
    out.push({
      hazardId: 'rain-at-height',
      reason: `Lluvia ${rain} mm con tarea en altura`,
    });
  }
  if (task.hazardTags.includes('heavy-lifting') && wind >= 35) {
    out.push({
      hazardId: 'wind-lifting',
      reason: `Viento ${wind} km/h con izaje de carga`,
    });
  }
  if (task.hazardTags.includes('confined-space') && temp >= 30) {
    out.push({
      hazardId: 'heat-confined',
      reason: `Temperatura ${temp}°C con espacio confinado`,
    });
  }
  if (task.hazardTags.includes('electrical') && rain >= 1) {
    out.push({
      hazardId: 'rain-electrical',
      reason: `Lluvia ${rain} mm con trabajo eléctrico`,
    });
  }
  if (task.hazardTags.includes('outdoor') && seismicMag >= 5) {
    out.push({
      hazardId: 'seismic-outdoor',
      reason: `Sismo reciente magnitud ${seismicMag} con tarea outdoor`,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// scanUpcomingTasks
// ───────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export async function scanUpcomingTasks(input: ScanInputs): Promise<ScanResult> {
  const now = (input.now ?? (() => new Date()))();
  const horizonMs = now.getTime() + (input.daysAhead ?? 3) * DAY_MS;

  let scanned = 0;
  let warned = 0;
  const warnings: ScanResult['warnings'] = [];

  for (const task of input.tasks) {
    const startMs = Date.parse(task.scheduledAt);
    if (Number.isNaN(startMs)) continue;
    if (startMs <= now.getTime()) continue;
    if (startMs > horizonMs) continue;
    scanned += 1;

    let weather: WeatherForecastSnapshot;
    let seismic: SeismicSnapshot;
    try {
      weather = await Promise.resolve(input.getWeather(task));
      seismic = await Promise.resolve(input.getSeismic());
    } catch {
      continue;
    }
    const dor = input.daysOfRisk(new Date(startMs));
    const hazards = detectHazards(task, { weather, seismic, daysOfRisk: dor });
    if (hazards.length === 0) continue;

    for (const hazard of hazards) {
      const key = `prewarn_${input.projectId}_${task.id}_${hazard.hazardId}`;
      let already = false;
      try {
        already = (await Promise.resolve(input.alreadyWarned(key))) === true;
      } catch {
        already = false;
      }
      if (already) continue;

      const summary = `RIESGO: ${task.title}`;
      const body = `Pre-alerta predictiva — ${hazard.reason}. Se recomienda revisar PTS antes de iniciar.`;
      const calendarStart = new Date(startMs - 24 * 3600 * 1000).toISOString();
      const calendarEnd = new Date(startMs - 23 * 3600 * 1000).toISOString();

      let pushSent = false;
      let emailSent = false;
      let calendarEventId: string | null = null;

      if (task.supervisorUid) {
        try {
          const r = await input.dispatchPush({
            recipientUid: task.supervisorUid,
            title: 'Praeventio — Pre-alerta predictiva',
            body,
            data: { taskId: task.id, hazard: hazard.hazardId },
          });
          pushSent = r.ok === true;
        } catch {
          /* per-task failure must not abort scan */
        }
      }
      if (input.gerenteUid) {
        try {
          const r = await input.dispatchEmail({
            recipientUid: input.gerenteUid,
            subject: summary,
            body,
          });
          emailSent = r.ok === true;
        } catch {
          /* per-task failure must not abort scan */
        }
      }
      try {
        const evt = await input.createCalendarEvent({
          uid: task.supervisorUid ?? input.gerenteUid ?? '',
          summary,
          description: body,
          startsAt: calendarStart,
          endsAt: calendarEnd,
        });
        calendarEventId = evt.id ?? null;
      } catch {
        /* per-task failure must not abort scan */
      }

      try {
        await Promise.resolve(input.markWarned(key));
      } catch {
        /* idempotency-store write failure logged upstream */
      }

      warned += 1;
      warnings.push({
        taskId: task.id,
        hazard: hazard.hazardId,
        reason: hazard.reason,
        pushSent,
        emailSent,
        calendarEventId,
      });
    }
  }

  return { scanned, warned, warnings };
}

// ───────────────────────────────────────────────────────────────────────
// Cron-style entry point — wired from `routes/maintenance.ts` after the
// SUSESO reminders job. Pure-ish (factories injected for tests).
// ───────────────────────────────────────────────────────────────────────

export interface RunPreWarnCronOptions {
  loadProjects: () => Promise<Array<{ id: string; gerenteUid?: string }>>;
  loadTasksForProject: (projectId: string) => Promise<UpcomingTask[]>;
  getWeatherForTask: (task: UpcomingTask) => Promise<WeatherForecastSnapshot>;
  getSeismicForProject: (projectId: string) => Promise<SeismicSnapshot>;
  daysOfRisk: DaysOfRiskFn;
  dispatchPush: DispatchPushFn;
  dispatchEmail: DispatchEmailFn;
  createCalendarEvent: CreateCalendarEventFn;
  alreadyWarned: (key: string) => Promise<boolean>;
  markWarned: (key: string) => Promise<void>;
  daysAhead?: number;
  now?: () => Date;
}

export async function runCalendarPreWarnCron(
  opts: RunPreWarnCronOptions,
): Promise<{ scanned: number; warned: number; perProject: Array<{ projectId: string; result: ScanResult }> }> {
  const projects = await opts.loadProjects();
  let scanned = 0;
  let warned = 0;
  const perProject: Array<{ projectId: string; result: ScanResult }> = [];
  for (const p of projects) {
    try {
      const tasks = await opts.loadTasksForProject(p.id);
      const result = await scanUpcomingTasks({
        projectId: p.id,
        daysAhead: opts.daysAhead,
        tasks,
        gerenteUid: p.gerenteUid,
        getWeather: opts.getWeatherForTask,
        getSeismic: () => opts.getSeismicForProject(p.id),
        daysOfRisk: opts.daysOfRisk,
        dispatchPush: opts.dispatchPush,
        dispatchEmail: opts.dispatchEmail,
        createCalendarEvent: opts.createCalendarEvent,
        alreadyWarned: opts.alreadyWarned,
        markWarned: opts.markWarned,
        now: opts.now,
      });
      scanned += result.scanned;
      warned += result.warned;
      perProject.push({ projectId: p.id, result });
    } catch {
      /* per-project failure must not abort the cron */
    }
  }
  return { scanned, warned, perProject };
}

// Re-export for callers that still want the legacy `shouldFireWindowed`
// API alongside the calendar pre-warn (kept for type-only consumers).
export { shouldFireWindowed };
export type { ForecastFn };
