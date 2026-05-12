// Praeventio Guard — Sprint K: Reportes Confidenciales + Canal Denuncias + Protección Represalias.
//
// Cierra: Documento usuario "§211-213" + Ley 21.643 (Karin)
//
// Canal protegido para denunciar:
//   - Acoso sexual o laboral (Ley 21.643)
//   - Comportamiento inseguro
//   - Conflictos de interés
//   - Otros temas sensibles
//
// Diseño:
//   - Reportes con autor anonymizable (hash one-way de uid + salt secreto)
//   - Solo `confidential_handler` role puede leer
//   - Detector de represalias automático (despido / cambio turno tras reporte)
//   - Plazos legales (Ley Karin: 3 días investigación + 30 días resolución)
//
// Determinístico, sin LLM.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ConfidentialReportKind =
  | 'harassment_sexual'
  | 'harassment_workplace'
  | 'violence'
  | 'discrimination'
  | 'unsafe_behavior'
  | 'conflict_of_interest'
  | 'other_sensitive';

export type ReportStatus =
  | 'submitted'
  | 'acknowledged'
  | 'under_investigation'
  | 'resolved_substantiated'
  | 'resolved_unsubstantiated'
  | 'transferred_to_external';

export interface ConfidentialReport {
  id: string;
  /** Hash one-way del autor si decidió anonimato. */
  authorHash: string;
  /** True si el autor renunció a anonimato explícitamente. */
  authorIdentified: boolean;
  authorUid?: string; // solo si authorIdentified=true
  kind: ConfidentialReportKind;
  description: string;
  /** UIDs de personas involucradas (puede incluir presuntos victimarios). */
  involvedUids: string[];
  submittedAt: string;
  status: ReportStatus;
  /** UID del responsable de investigar (rol confidential_handler). */
  handlerUid?: string;
  /** ISO-8601 milestones. */
  acknowledgedAt?: string;
  investigationStartedAt?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Author anonymization
// ────────────────────────────────────────────────────────────────────────

export function hashAuthor(uid: string, salt: string): string {
  if (salt.length < 16) {
    throw new Error('salt must be ≥16 chars for confidential reports');
  }
  return bytesToHex(sha256(new TextEncoder().encode(`${salt}:${uid}`)));
}

// ────────────────────────────────────────────────────────────────────────
// Legal SLA (Ley 21.643 — Karin)
// ────────────────────────────────────────────────────────────────────────

export interface LegalDeadline {
  reportId: string;
  /** Cuándo debe acknowledged el reporte (24h). */
  acknowledgeBy: string;
  /** Cuándo debe iniciar investigación (3 días Ley Karin). */
  investigationStartBy: string;
  /** Cuándo debe resolverse (30 días Ley Karin). */
  resolveBy: string;
  /** Status SLA actual. */
  slaStatus: 'on_track' | 'at_risk' | 'breached';
}

export function computeLegalDeadlines(
  report: ConfidentialReport,
  nowIso: string = new Date().toISOString(),
): LegalDeadline {
  const submittedMs = Date.parse(report.submittedAt);
  const acknowledgeBy = new Date(submittedMs + 24 * 3_600_000).toISOString();
  const investigationStartBy = new Date(submittedMs + 3 * 86_400_000).toISOString();
  const resolveBy = new Date(submittedMs + 30 * 86_400_000).toISOString();
  const nowMs = Date.parse(nowIso);

  let slaStatus: 'on_track' | 'at_risk' | 'breached' = 'on_track';

  // Check each milestone vs current status
  if (
    report.status === 'submitted' &&
    nowMs > Date.parse(acknowledgeBy)
  ) {
    slaStatus = 'breached';
  } else if (
    !report.investigationStartedAt &&
    nowMs > Date.parse(investigationStartBy)
  ) {
    slaStatus = 'breached';
  } else if (
    !report.resolvedAt &&
    nowMs > Date.parse(resolveBy)
  ) {
    slaStatus = 'breached';
  } else {
    // Si está dentro del 80% del plazo → at_risk
    const reportSpan = Date.parse(resolveBy) - submittedMs;
    const elapsed = nowMs - submittedMs;
    if (elapsed / reportSpan > 0.8 && !report.resolvedAt) slaStatus = 'at_risk';
  }

  return { reportId: report.id, acknowledgeBy, investigationStartBy, resolveBy, slaStatus };
}

// ────────────────────────────────────────────────────────────────────────
// Retaliation detector (§213)
// ────────────────────────────────────────────────────────────────────────

export interface WorkerStateChange {
  workerUid: string;
  changedAt: string;
  changeKind: 'shift_change' | 'role_demotion' | 'termination' | 'salary_decrease' | 'transfer';
  changedByUid: string;
  rationale?: string;
}

export interface RetaliationFlag {
  reportId: string;
  workerUid: string;
  daysFromReport: number;
  changeKind: WorkerStateChange['changeKind'];
  severity: 'high' | 'critical';
  message: string;
}

const RETALIATION_WINDOW_DAYS = 90;

/**
 * Detecta cambios laborales adversos contra el autor o testigos
 * dentro de la ventana de represalias. NO determina culpabilidad —
 * solo levanta una alerta para investigación humana.
 */
export function detectRetaliation(
  reports: ConfidentialReport[],
  changes: WorkerStateChange[],
  nowIso: string = new Date().toISOString(),
): RetaliationFlag[] {
  const flags: RetaliationFlag[] = [];
  const nowMs = Date.parse(nowIso);

  for (const report of reports) {
    // Solo verificamos sobre reportes identificados (con uid conocido) o
    // sobre involvedUids que probablemente son testigos.
    const protectedUids = new Set<string>();
    if (report.authorUid) protectedUids.add(report.authorUid);
    for (const uid of report.involvedUids) {
      // No protegemos al presunto victimario — el resto sí.
      // Por simpleza, todos quedan protegidos; el handler humano decide.
      protectedUids.add(uid);
    }

    const submittedMs = Date.parse(report.submittedAt);
    for (const change of changes) {
      if (!protectedUids.has(change.workerUid)) continue;
      const changeMs = Date.parse(change.changedAt);
      if (changeMs <= submittedMs) continue; // antes del reporte → no es represalia
      const daysSinceReport = Math.floor((changeMs - submittedMs) / 86_400_000);
      if (daysSinceReport > RETALIATION_WINDOW_DAYS) continue;
      if (nowMs < changeMs) continue;

      const severity: 'high' | 'critical' =
        change.changeKind === 'termination' || change.changeKind === 'salary_decrease'
          ? 'critical'
          : 'high';

      flags.push({
        reportId: report.id,
        workerUid: change.workerUid,
        daysFromReport: daysSinceReport,
        changeKind: change.changeKind,
        severity,
        message: `${change.changeKind} aplicado a ${change.workerUid} ${daysSinceReport}d después del reporte ${report.id}. Investigar represalia.`,
      });
    }
  }
  return flags.sort((a, b) => (a.severity === 'critical' ? -1 : 1));
}

// ────────────────────────────────────────────────────────────────────────
// Access control (only confidential_handler can read)
// ────────────────────────────────────────────────────────────────────────

export interface ReportAccessRequest {
  reportId: string;
  requesterUid: string;
  requesterRole: string;
}

export interface ReportAccessDecision {
  allowed: boolean;
  reason: string;
}

const AUTHORIZED_ROLES = new Set(['confidential_handler', 'legal_counsel', 'hr_director']);

export function canAccessReport(
  request: ReportAccessRequest,
  report: ConfidentialReport,
): ReportAccessDecision {
  // El handler asignado siempre puede
  if (report.handlerUid === request.requesterUid) {
    return { allowed: true, reason: 'Handler asignado al reporte.' };
  }
  // El autor identificado puede ver SU reporte
  if (report.authorIdentified && report.authorUid === request.requesterUid) {
    return { allowed: true, reason: 'Autor del reporte.' };
  }
  // Roles autorizados pueden ver
  if (AUTHORIZED_ROLES.has(request.requesterRole)) {
    return { allowed: true, reason: `Rol autorizado: ${request.requesterRole}.` };
  }
  return { allowed: false, reason: 'No autorizado — solo handler, autor o roles confidenciales.' };
}
