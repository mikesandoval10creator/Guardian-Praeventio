/**
 * Per-project Chilean normativa alerts.
 *
 * Two families of rules are evaluated:
 *
 *   1. Project-size rules (Ley 16.744 art. 66 and DS 54): triggered purely
 *      by `workerCount` per project. These do not require a `context`.
 *
 *   2. Time-based rules (DS 54 art. 16/24, Ley 16.744 art. 21 / DS 40,
 *      NT MINSAL PREXOR): triggered by elapsed days since the last
 *      occurrence of the obligation. The caller passes per-project /
 *      per-worker last-event timestamps via `NormativeContext`.
 *
 * IMPORTANT semantic: per-project, NOT aggregate. Three projects of 10
 * workers each does NOT trigger Comité Paritario, because the law applies
 * "por cada faena, sucursal o agencia" (Ley 16.744 art. 66 / DS 54 art. 1).
 *
 * Pure: no IO, no implicit Date.now(). Pass `context.now` for deterministic
 * tests. When omitted, `new Date()` is used (production callers).
 *
 * Cadence constants are duplicated locally (CPHS_CADENCE_DAYS,
 * ODI_CADENCE_DAYS, AUDIO_BASE_CADENCE_DAYS, AUDIO_ACCELERATED_CADENCE_DAYS)
 * to keep this module independent of `src/services/calendar/legalObligations.ts`.
 * The values match `BASE_RULES` in that file (CPHS 30d, ODI 180d,
 * audiometría 365d / 180d when dose > 100 %); if they ever diverge, the
 * shared module wins. See OPEN QUESTIONS at the bottom of this file.
 */

import type { ProjectInfo } from './tierEvaluation';

export type ChileanNormativeRule =
  | 'comite-paritario-required'
  | 'departamento-prevencion-required'
  | 'cphs-monthly-meeting-due'
  | 'odi-semestral-due'
  | 'audiometria-prexor-due';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface NormativeAlert {
  rule: ChileanNormativeRule;
  projectId: string;
  message: string;
  severity: AlertSeverity;
  daysUntilDue?: number;
}

export interface NormativeContext {
  /** Per-project last CPHS meeting timestamp. Absent → "never met". */
  lastCphsMeetingByProject?: Record<string, Date>;
  /** Per-project last ODI training timestamp. Absent → "never trained". */
  lastOdiByProject?: Record<string, Date>;
  /** Per-worker last audiometría timestamp. Absent → "never tested". */
  lastAudiometriaByWorker?: Record<string, Date>;
  /** Per-worker cumulative noise dose as percentage of TLV (100 = límite). */
  prexorDoseByWorker?: Record<string, number>;
  /** Optional worker → project mapping so audiometría alerts carry projectId. */
  workerProjectMap?: Record<string, string>;
  /** Injectable now for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Threshold constants (Ley 16.744). */
const COMITE_PARITARIO_MIN_WORKERS = 25;
const DEPARTAMENTO_PREVENCION_MIN_WORKERS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** DS 54 art. 16 — sesión mensual del Comité Paritario. */
const CPHS_CADENCE_DAYS = 30;
const CPHS_WARNING_DAYS = 25;

/** Ley 16.744 art. 21 + DS 40 — ODI cada 6 meses. */
const ODI_CADENCE_DAYS = 180;
const ODI_WARNING_DAYS = 150; // ~5 meses

/** NT MINSAL PREXOR — vigilancia audiométrica. */
const AUDIO_BASE_CADENCE_DAYS = 365;
const AUDIO_ACCELERATED_CADENCE_DAYS = 180;
const AUDIO_DOSE_ACCELERATION_THRESHOLD = 100; // % TLV
const AUDIO_WARNING_RATIO = 0.8; // warning at ~80 % of cadence elapsed

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function evaluateNormativeAlerts(
  perProjectWorkers: ProjectInfo[],
  context?: NormativeContext,
): NormativeAlert[] {
  const alerts: NormativeAlert[] = [];
  const now = context?.now ?? new Date();

  for (const project of perProjectWorkers) {
    /* -------- Project-size rules (Ley 16.744 art. 66 / DS 54) ----------- */
    if (project.workerCount >= COMITE_PARITARIO_MIN_WORKERS) {
      alerts.push({
        rule: 'comite-paritario-required',
        projectId: project.id,
        severity: 'critical',
        message:
          `El proyecto "${project.id}" tiene ${project.workerCount} trabajadores ` +
          `(≥25). La Ley 16.744 y el DS 54 exigen constituir un Comité ` +
          `Paritario de Higiene y Seguridad por cada faena, sucursal o agencia.`,
      });
    }

    if (project.workerCount >= DEPARTAMENTO_PREVENCION_MIN_WORKERS) {
      alerts.push({
        rule: 'departamento-prevencion-required',
        projectId: project.id,
        severity: 'critical',
        message:
          `El proyecto "${project.id}" tiene ${project.workerCount} trabajadores ` +
          `(≥100). La Ley 16.744 art. 66 exige un Departamento de Prevención ` +
          `de Riesgos a cargo de un experto profesional o técnico.`,
      });
    }

    /* -------- Time-based rules (only when context provided) ------------- */
    if (!context) continue;

    /* CPHS — DS 54 art. 16/24 — sesión mensual */
    if (context.lastCphsMeetingByProject !== undefined) {
      const last = context.lastCphsMeetingByProject[project.id];
      if (last === undefined) {
        // No meeting recorded. Only an obligation when CPHS is required
        // (≥ 25 workers). Surface as critical: must constitute committee.
        if (project.workerCount >= COMITE_PARITARIO_MIN_WORKERS) {
          alerts.push({
            rule: 'cphs-monthly-meeting-due',
            projectId: project.id,
            severity: 'critical',
            message:
              `El proyecto "${project.id}" no registra reuniones de Comité ` +
              `Paritario. Constituye Comité Paritario y agenda primera ` +
              `reunión (DS 54 art. 16/24, sesión mensual obligatoria).`,
          });
        }
        // < 25 workers without CPHS history → no obligation, no alert.
      } else {
        const elapsed = daysBetween(last, now);
        const daysUntilDue = CPHS_CADENCE_DAYS - elapsed;
        if (elapsed >= CPHS_CADENCE_DAYS) {
          alerts.push({
            rule: 'cphs-monthly-meeting-due',
            projectId: project.id,
            severity: 'critical',
            daysUntilDue,
            message:
              `El proyecto "${project.id}" tiene ${elapsed} días desde la ` +
              `última sesión del Comité Paritario (cadencia mensual ` +
              `DS 54 art. 16). Agenda la próxima reunión de inmediato.`,
          });
        } else if (elapsed >= CPHS_WARNING_DAYS) {
          alerts.push({
            rule: 'cphs-monthly-meeting-due',
            projectId: project.id,
            severity: 'warning',
            daysUntilDue,
            message:
              `El proyecto "${project.id}" tiene ${elapsed} días desde la ` +
              `última sesión del Comité Paritario (DS 54 art. 16). ` +
              `Próxima sesión vence en ${daysUntilDue} días.`,
          });
        }
      }
    }

    /* ODI — Ley 16.744 art. 21 / DS 40 — semestral */
    if (context.lastOdiByProject !== undefined) {
      const last = context.lastOdiByProject[project.id];
      if (last === undefined) {
        alerts.push({
          rule: 'odi-semestral-due',
          projectId: project.id,
          severity: 'critical',
          message:
            `El proyecto "${project.id}" no registra capacitaciones ODI ` +
            `(Obligación de Informar). Ley 16.744 art. 21 y DS 40 exigen ` +
            `inducción semestral. Programa la primera ODI a la brevedad.`,
        });
      } else {
        const elapsed = daysBetween(last, now);
        const daysUntilDue = ODI_CADENCE_DAYS - elapsed;
        if (elapsed >= ODI_CADENCE_DAYS) {
          alerts.push({
            rule: 'odi-semestral-due',
            projectId: project.id,
            severity: 'critical',
            daysUntilDue,
            message:
              `El proyecto "${project.id}" tiene ${elapsed} días desde la ` +
              `última ODI (Ley 16.744 art. 21, cadencia semestral). ` +
              `Programa capacitación ODI de inmediato.`,
          });
        } else if (elapsed >= ODI_WARNING_DAYS) {
          alerts.push({
            rule: 'odi-semestral-due',
            projectId: project.id,
            severity: 'warning',
            daysUntilDue,
            message:
              `El proyecto "${project.id}" tiene ${elapsed} días desde la ` +
              `última ODI (Ley 16.744 art. 21). Próxima ODI vence en ` +
              `${daysUntilDue} días.`,
          });
        }
      }
    }
  }

  /* -------- Audiometría PREXOR — per-worker, project derived from map ---- */
  if (context && context.lastAudiometriaByWorker !== undefined) {
    const dose = context.prexorDoseByWorker ?? {};
    const map = context.workerProjectMap ?? {};
    for (const [workerId, last] of Object.entries(context.lastAudiometriaByWorker)) {
      const cadence =
        (dose[workerId] ?? 0) > AUDIO_DOSE_ACCELERATION_THRESHOLD
          ? AUDIO_ACCELERATED_CADENCE_DAYS
          : AUDIO_BASE_CADENCE_DAYS;
      const warningThreshold = Math.floor(cadence * AUDIO_WARNING_RATIO);
      const elapsed = daysBetween(last, now);
      const daysUntilDue = cadence - elapsed;
      const projectId = map[workerId] ?? '';

      if (elapsed >= cadence) {
        alerts.push({
          rule: 'audiometria-prexor-due',
          projectId,
          severity: 'critical',
          daysUntilDue,
          message:
            `Trabajador "${workerId}" lleva ${elapsed} días sin audiometría ` +
            `(cadencia ${cadence} días, NT MINSAL PREXOR). Programa control ` +
            `audiométrico de inmediato.`,
        });
      } else if (elapsed >= warningThreshold) {
        alerts.push({
          rule: 'audiometria-prexor-due',
          projectId,
          severity: 'warning',
          daysUntilDue,
          message:
            `Trabajador "${workerId}" lleva ${elapsed} días desde su última ` +
            `audiometría (cadencia ${cadence} días, NT MINSAL PREXOR). ` +
            `Próximo control en ${daysUntilDue} días.`,
        });
      }
    }
  }

  return alerts;
}

/*
 * OPEN QUESTIONS / next round:
 *
 *   1. Where does the calling UI obtain `lastCphsMeetingByProject`,
 *      `lastOdiByProject`, `lastAudiometriaByWorker` and
 *      `prexorDoseByWorker`?  Most likely from a query over `audit_logs`
 *      (e.g., latest event of type `cphs_meeting_held` per project) plus a
 *      column on `projects` / `workers` for the dose. Wire this in the
 *      provider layer (Capacity/Normativa context) — TODO N+1.
 *
 *   2. The cadence constants here are duplicated from
 *      `src/services/calendar/legalObligations.ts` to avoid coupling the
 *      capacity domain to the calendar domain. If a third caller appears,
 *      extract a shared `src/services/sst/cadences.ts`.
 */
