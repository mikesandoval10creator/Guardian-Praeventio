/**
 * Per-project Chilean normativa alerts.
 *
 * Only project-size rules are implemented in this round (Ley 16.744 art. 66
 * and DS 54). Time-based rules are scaffolded as types but not yet wired —
 * see TODO at the bottom of this file.
 *
 * IMPORTANT semantic: per-project, NOT aggregate. Three projects of 10
 * workers each does NOT trigger Comité Paritario, because the law applies
 * "por cada faena, sucursal o agencia" (Ley 16.744 art. 66 / DS 54 art. 1).
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

/** Threshold constants (Ley 16.744). */
const COMITE_PARITARIO_MIN_WORKERS = 25;
const DEPARTAMENTO_PREVENCION_MIN_WORKERS = 100;

export function evaluateNormativeAlerts(
  perProjectWorkers: ProjectInfo[],
): NormativeAlert[] {
  const alerts: NormativeAlert[] = [];

  for (const project of perProjectWorkers) {
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
  }

  return alerts;
}

/*
 * TODO (next round) — time-based rules:
 *
 *   evaluateNormativeAlerts(projects, {
 *     lastCphsMeetingByProject: Record<string, ISODate>,
 *     lastOdiByProject:         Record<string, ISODate>,
 *     prexorDoseByWorker:       Record<string, { dB: number; hours: number }>,
 *   })
 *
 * Rules to implement:
 *   - cphs-monthly-meeting-due  (DS 54 art. 24 — monthly meeting)
 *       severity 'warning' at 25 days, 'critical' at 30+.
 *   - odi-semestral-due         (Ley 16.744 art. 21 / DS 40 — ODI cada 6 meses)
 *       severity 'warning' at 5 months, 'critical' at 6+.
 *   - audiometria-prexor-due    (PREXOR — exposición acumulada > 82 dB(A) sobre
 *       jornada normalizada → audiometría obligatoria).
 *
 * Kept out of this round to keep the surface small and deterministic;
 * project-size rules are the highest-impact / blocking ones.
 */
