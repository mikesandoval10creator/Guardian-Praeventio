// Praeventio Guard — Sprint 51 §188-190: Pack supervisor + Resumen reunión
// + Briefing pre-turno.
//
// Cierra §188 (pack briefing supervisor pre-turno), §189 (resumen
// reunión auto post-discusión), §190 (action items extraction).
//
// 100% determinístico. NO usa LLM — toma snapshots estructurados y
// produce paquetes formateados.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type MeetingKind =
  | 'pre_shift_briefing'
  | 'cphs_monthly'
  | 'incident_review'
  | 'toolbox_talk'
  | 'project_status'
  | 'lessons_learned';

export interface AttendeeRecord {
  uid: string;
  name: string;
  role: string;
  attended: boolean;
  /** Si no asistió, motivo. */
  absenceReason?: string;
}

export interface DiscussionPoint {
  id: string;
  topic: string;
  /** Quién planteó el tema. */
  raisedByUid?: string;
  /** Resumen 1-3 líneas. */
  summary: string;
  /** Decisión tomada (si hay). */
  decision?: string;
}

export interface ActionItemDraft {
  description: string;
  assignedToUid: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface MeetingSnapshot {
  meetingId: string;
  kind: MeetingKind;
  scheduledFor: string;
  durationMinutes: number;
  /** Quien condujo la reunión. */
  facilitatorUid: string;
  attendees: AttendeeRecord[];
  discussionPoints: DiscussionPoint[];
  actionItems: ActionItemDraft[];
}

export interface MeetingSummary {
  meetingId: string;
  kind: MeetingKind;
  conductedAt: string;
  durationMinutes: number;
  /** Quorum: asistieron / convocados. */
  quorum: { attended: number; invited: number; ratio: number };
  /** Si hubo quorum mínimo (depende del kind). */
  quorumValid: boolean;
  decisions: Array<{ topic: string; decision: string }>;
  actionItems: ActionItemDraft[];
  /** Si la reunión tuvo follow-up requerido (decisiones críticas, actions sin asignar). */
  requiresFollowUp: boolean;
  followUpReasons: string[];
  /** Lista de no-asistentes para informar / agendar make-up. */
  absentees: AttendeeRecord[];
}

// ────────────────────────────────────────────────────────────────────────
// Quorum policy per meeting kind
// ────────────────────────────────────────────────────────────────────────

const MIN_QUORUM_RATIO: Record<MeetingKind, number> = {
  pre_shift_briefing: 0.8, // 80% del crew
  cphs_monthly: 0.5,        // 50% mínimo CPHS quorum legal
  incident_review: 0.6,
  toolbox_talk: 0.7,
  project_status: 0.5,
  lessons_learned: 0.4,
};

export function buildMeetingSummary(snapshot: MeetingSnapshot): MeetingSummary {
  const attendedCount = snapshot.attendees.filter((a) => a.attended).length;
  const invitedCount = snapshot.attendees.length;
  const ratio = invitedCount === 0 ? 0 : attendedCount / invitedCount;
  const minQuorum = MIN_QUORUM_RATIO[snapshot.kind];
  const quorumValid = ratio >= minQuorum;

  const decisions = snapshot.discussionPoints
    .filter((d) => d.decision)
    .map((d) => ({ topic: d.topic, decision: d.decision! }));

  const followUpReasons: string[] = [];
  if (!quorumValid) {
    followUpReasons.push(
      `Quorum insuficiente: ${(ratio * 100).toFixed(0)}% asistencia vs ${(minQuorum * 100).toFixed(0)}% requerido.`,
    );
  }
  const unassignedActions = snapshot.actionItems.filter((a) => !a.assignedToUid);
  if (unassignedActions.length > 0) {
    followUpReasons.push(`${unassignedActions.length} action item(s) sin asignar.`);
  }
  const criticalActions = snapshot.actionItems.filter((a) => a.priority === 'critical');
  if (criticalActions.length > 0) {
    followUpReasons.push(`${criticalActions.length} action(s) crítica(s) requieren validación supervisor.`);
  }

  return {
    meetingId: snapshot.meetingId,
    kind: snapshot.kind,
    conductedAt: snapshot.scheduledFor,
    durationMinutes: snapshot.durationMinutes,
    quorum: { attended: attendedCount, invited: invitedCount, ratio: Math.round(ratio * 100) / 100 },
    quorumValid,
    decisions,
    actionItems: snapshot.actionItems,
    requiresFollowUp: followUpReasons.length > 0,
    followUpReasons,
    absentees: snapshot.attendees.filter((a) => !a.attended),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Supervisor briefing pack (§188) — pre-turno
// ────────────────────────────────────────────────────────────────────────

export interface BriefingInputs {
  supervisorUid: string;
  projectId: string;
  shiftStart: string;
  /** Trabajadores asignados al turno. */
  workersAssigned: Array<{
    uid: string;
    name: string;
    role: string;
    /** Si tiene restricciones operacionales activas. */
    activeRestrictions?: string[];
    /** Si fatigue level es alto. */
    fatigueLevel?: 'low' | 'medium' | 'high' | 'critical';
    /** Si tiene certificaciones vencidas. */
    expiredCerts?: string[];
  }>;
  /** Riesgos críticos para hoy. */
  criticalRisksForToday: Array<{ id: string; description: string; severity: 'high' | 'critical' | 'sif' }>;
  /** Acciones correctivas pendientes para el supervisor. */
  pendingActions: Array<{ id: string; description: string; dueDate: string }>;
  /** Clima esperado. */
  weather?: { temperatureC: number; precipitation?: string; uvIndex?: number };
  /** Recordatorios manuales del prevencionista. */
  customNotes?: string[];
}

export interface SupervisorBriefingPack {
  supervisorUid: string;
  shiftStart: string;
  /** Headline más urgente (1 línea). */
  headline: string;
  /** Workers que requieren atención especial. */
  flaggedWorkers: Array<{
    uid: string;
    name: string;
    flagKind: 'restriction' | 'fatigue' | 'expired_cert' | 'newcomer';
    detail: string;
  }>;
  criticalRisks: Array<{ id: string; description: string; severity: string }>;
  pendingActions: BriefingInputs['pendingActions'];
  weatherAdvisory?: string;
  /** Recomendaciones priorizadas (≤7). */
  recommendations: string[];
  /** Si la entrega del turno debe ser presencial obligatoria. */
  inPersonHandoverRequired: boolean;
}

export function buildSupervisorBriefingPack(input: BriefingInputs): SupervisorBriefingPack {
  const flaggedWorkers: SupervisorBriefingPack['flaggedWorkers'] = [];
  for (const w of input.workersAssigned) {
    if (w.activeRestrictions && w.activeRestrictions.length > 0) {
      flaggedWorkers.push({
        uid: w.uid,
        name: w.name,
        flagKind: 'restriction',
        detail: `Restricciones activas: ${w.activeRestrictions.join(', ')}`,
      });
    }
    if (w.fatigueLevel === 'high' || w.fatigueLevel === 'critical') {
      flaggedWorkers.push({
        uid: w.uid,
        name: w.name,
        flagKind: 'fatigue',
        detail: `Nivel fatiga ${w.fatigueLevel} — considerar reasignación.`,
      });
    }
    if (w.expiredCerts && w.expiredCerts.length > 0) {
      flaggedWorkers.push({
        uid: w.uid,
        name: w.name,
        flagKind: 'expired_cert',
        detail: `Certs vencidas: ${w.expiredCerts.join(', ')} — NO autorizar tareas asociadas.`,
      });
    }
  }

  // Headline
  let headline = `Turno ${input.shiftStart.slice(0, 10)} · ${input.workersAssigned.length} trabajadores asignados`;
  const sifRisks = input.criticalRisksForToday.filter((r) => r.severity === 'sif');
  const criticalRisks = input.criticalRisksForToday.filter((r) => r.severity === 'critical');
  if (sifRisks.length > 0) {
    headline = `⚠️ ${sifRisks.length} riesgo(s) SIF activo(s) — briefing presencial obligatorio.`;
  } else if (criticalRisks.length > 0) {
    headline = `⚠️ ${criticalRisks.length} riesgo(s) crítico(s) hoy — revisar antes de iniciar.`;
  } else if (flaggedWorkers.length > 0) {
    headline = `📋 ${flaggedWorkers.length} trabajador(es) con flags — revisar asignación.`;
  }

  // Weather advisory
  let weatherAdvisory: string | undefined;
  if (input.weather) {
    const w = input.weather;
    const issues: string[] = [];
    if (w.temperatureC >= 32) issues.push(`Calor extremo ${w.temperatureC}°C — protocolo WBGT activo.`);
    if (w.temperatureC <= 5) issues.push(`Frío extremo ${w.temperatureC}°C — pausas + vestimenta térmica.`);
    if (w.precipitation && w.precipitation !== 'none') issues.push(`Precipitación: ${w.precipitation} — superficies resbaladizas.`);
    if (w.uvIndex && w.uvIndex >= 8) issues.push(`UV ${w.uvIndex} muy alto — bloqueador + sombra obligatorios.`);
    if (issues.length > 0) weatherAdvisory = issues.join(' ');
  }

  const recommendations: string[] = [];
  if (sifRisks.length > 0) recommendations.push('Briefing presencial obligatorio — usar Acta CPHS firma WebAuthn.');
  if (criticalRisks.length > 0) recommendations.push('Revisar criticalControlsLibrary antes de autorizar tareas.');
  if (flaggedWorkers.filter((f) => f.flagKind === 'expired_cert').length > 0) {
    recommendations.push('Reasignar tareas de trabajadores con certs vencidas.');
  }
  if (flaggedWorkers.filter((f) => f.flagKind === 'fatigue').length > 0) {
    recommendations.push('Aplicar fatigue check-in pre-turno.');
  }
  if (input.pendingActions.length > 5) {
    recommendations.push(`${input.pendingActions.length} acciones pendientes — priorizar overdue.`);
  }
  if (weatherAdvisory) recommendations.push('Ajustar plan por clima.');

  const inPersonHandoverRequired = sifRisks.length > 0 || criticalRisks.length >= 2 || flaggedWorkers.length >= 5;

  return {
    supervisorUid: input.supervisorUid,
    shiftStart: input.shiftStart,
    headline,
    flaggedWorkers,
    criticalRisks: input.criticalRisksForToday,
    pendingActions: input.pendingActions,
    weatherAdvisory,
    recommendations: recommendations.slice(0, 7),
    inPersonHandoverRequired,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Action item extractor (§190) — toma texto libre y propone action items
// formales
// ────────────────────────────────────────────────────────────────────────

/**
 * Detector simple de action items basado en heurísticas regex
 * (caller puede mejorar con NLP — este es el motor determinístico
 * baseline para producción).
 */
export interface ActionItemSuggestion {
  description: string;
  /** Trigger phrase que detonó la sugerencia. */
  triggerPhrase: string;
  /** UID asignado si el texto mencionaba @nombre. */
  proposedAssigneeUid?: string;
  /** Fecha si mencionada (ISO). */
  proposedDueDate?: string;
  confidence: number;
}

const ACTION_TRIGGER_PATTERNS: Array<{ pattern: RegExp; confidence: number }> = [
  { pattern: /\b(debe(mos)?|hay que|tiene que)\s+([^.,;]+)/i, confidence: 0.85 },
  { pattern: /\b(quedan?|queda)\s+pendiente\s+([^.,;]+)/i, confidence: 0.8 },
  { pattern: /\b(acción|action item|tarea):\s*([^.,;]+)/i, confidence: 0.95 },
  { pattern: /\b(se acordó|acordamos|acuerdo)\s+([^.,;]+)/i, confidence: 0.9 },
];

export function extractActionItems(text: string): ActionItemSuggestion[] {
  const out: ActionItemSuggestion[] = [];
  const lines = text.split(/[.;\n]+/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 8) continue;

    for (const { pattern, confidence } of ACTION_TRIGGER_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const description = (match[3] ?? match[2] ?? '').trim();
        if (description.length < 5) continue;

        // Detectar @uid
        const uidMatch = line.match(/@([a-zA-Z0-9_-]+)/);
        const proposedAssigneeUid = uidMatch?.[1];

        // Detectar fecha (formato ISO o "el 15 de mayo")
        let proposedDueDate: string | undefined;
        const isoMatch = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (isoMatch) proposedDueDate = isoMatch[1];

        out.push({
          description,
          triggerPhrase: match[0],
          proposedAssigneeUid,
          proposedDueDate,
          confidence,
        });
        break; // un trigger por línea
      }
    }
  }

  return out;
}
