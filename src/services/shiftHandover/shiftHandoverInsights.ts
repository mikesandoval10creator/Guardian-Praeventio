// Praeventio Guard — Sprint K: Shift Handover Insights.
//
// Extiende `shiftHandoverService` (existente) con análisis derivado:
//   - Quality score del handover (cobertura de las 9 categorías canónicas)
//   - Drift entre turno saliente y entrante (omisiones)
//   - Continuidad de pendingFollowUps (no se pierdan tareas entre turnos)
//
// Determinístico, sin LLM.

import type {
  ShiftRecord,
  HandoverCategory,
  ShiftHandoverNote,
} from './shiftHandoverService.js';

// ────────────────────────────────────────────────────────────────────────
// Quality score
// ────────────────────────────────────────────────────────────────────────

const CRITICAL_CATEGORIES: HandoverCategory[] = [
  'open_incidents',
  'equipment_down',
  'pending_controls',
  'active_permits',
];

export interface HandoverQualityReport {
  shiftId: string;
  /** 0-100. */
  qualityScore: number;
  level: 'poor' | 'fair' | 'good' | 'excellent';
  /** Categorías críticas SIN notas (deberían tener). */
  missingCriticalCategories: HandoverCategory[];
  totalNotes: number;
  urgentNotes: number;
  followUpsLogged: number;
}

export function computeHandoverQuality(shift: ShiftRecord): HandoverQualityReport {
  const noteCategories = new Set(shift.handoverNotes.map((n) => n.category));
  const missingCritical = CRITICAL_CATEGORIES.filter((c) => !noteCategories.has(c));
  const urgentNotes = shift.handoverNotes.filter((n) => n.severity === 'urgent').length;
  const followUpsLogged = shift.logEntries.filter((e) => e.requiresFollowUp).length;

  // Score: base 100 - 15 por cada crítica faltante + bonus por followups
  let score = 100;
  score -= missingCritical.length * 15;
  if (shift.handoverNotes.length === 0) score -= 30;
  if (followUpsLogged === 0 && shift.logEntries.length > 0) score -= 10;
  score = Math.max(0, Math.min(100, score));

  let level: 'poor' | 'fair' | 'good' | 'excellent';
  if (score >= 85) level = 'excellent';
  else if (score >= 70) level = 'good';
  else if (score >= 50) level = 'fair';
  else level = 'poor';

  return {
    shiftId: shift.id,
    qualityScore: score,
    level,
    missingCriticalCategories: missingCritical,
    totalNotes: shift.handoverNotes.length,
    urgentNotes,
    followUpsLogged,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Cross-shift continuity (§19-20)
// ────────────────────────────────────────────────────────────────────────

export interface ContinuityIssue {
  /** UID del turno saliente. */
  outgoingShiftId: string;
  /** UID del turno entrante. */
  incomingShiftId: string;
  kind: 'unacknowledged_handover' | 'dropped_followups' | 'silent_handover';
  message: string;
}

/**
 * Verifica que el turno entrante haya acusado recibo del saliente y
 * que las tareas pendientes del saliente aparezcan en el log del entrante.
 */
export function detectContinuityIssues(
  outgoing: ShiftRecord,
  incoming: ShiftRecord,
): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];

  if (!outgoing.acknowledgedAt) {
    issues.push({
      outgoingShiftId: outgoing.id,
      incomingShiftId: incoming.id,
      kind: 'unacknowledged_handover',
      message: 'Turno saliente sin acuse de recibo del entrante.',
    });
  }

  if (outgoing.handoverNotes.length === 0 && outgoing.logEntries.some((e) => e.requiresFollowUp)) {
    issues.push({
      outgoingShiftId: outgoing.id,
      incomingShiftId: incoming.id,
      kind: 'silent_handover',
      message: 'Turno saliente tiene followups pero NO dejó notas de handover.',
    });
  }

  // Drop: followups del saliente que NO se reflejan en logs del entrante (heurística)
  const outgoingFollowUps = outgoing.logEntries.filter((e) => e.requiresFollowUp).length;
  if (
    outgoingFollowUps > 0 &&
    incoming.logEntries.length === 0
  ) {
    issues.push({
      outgoingShiftId: outgoing.id,
      incomingShiftId: incoming.id,
      kind: 'dropped_followups',
      message: `Turno saliente dejó ${outgoingFollowUps} followup(s) pero entrante no registró entradas.`,
    });
  }

  return issues;
}

// ────────────────────────────────────────────────────────────────────────
// Severity rollup
// ────────────────────────────────────────────────────────────────────────

export interface UrgentNoteAggregation {
  shiftId: string;
  urgentNotes: ShiftHandoverNote[];
  /** Quién es el supervisor entrante (para escalar). */
  incomingSupervisorUid?: string;
}

export function extractUrgentForIncoming(
  shift: ShiftRecord,
  incomingShift?: ShiftRecord,
): UrgentNoteAggregation {
  return {
    shiftId: shift.id,
    urgentNotes: shift.handoverNotes.filter((n) => n.severity === 'urgent'),
    incomingSupervisorUid: incomingShift?.supervisorUid,
  };
}
