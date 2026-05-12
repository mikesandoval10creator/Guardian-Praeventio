// Praeventio Guard — Sprint 40 Fase F.8: Bandeja Inbox del Prevencionista.
//
// Cierra Plan F.8 "Bandeja de Trabajo del Prevencionista (vista única
// pendientes hoy)".
//
// Agrega N feeds heterogéneos (docs por aprobar, incidents pending,
// acciones F.4 abiertas, EPP por validar, workers nuevos sin onboarding,
// alerts F.13) en un único stream ordenado por urgencia y emite quick-
// actions (approve, assign, postpone).
//
// 100% determinístico. El caller hace los fetches; este motor combina
// + ordena + decora con quick-actions.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type InboxItemKind =
  | 'document_pending_approval'
  | 'incident_pending_review'
  | 'corrective_action_open'
  | 'epp_pending_validation'
  | 'worker_pending_onboarding'
  | 'alert_repeating_risk'
  | 'data_quality_gap'
  | 'sif_precursor_pending'
  | 'legal_obligation_due'
  | 'exception_expiring';

export type InboxUrgency = 'urgent' | 'high' | 'medium' | 'low';

export type QuickActionKind =
  | 'approve'
  | 'reject'
  | 'assign'
  | 'postpone'
  | 'mark_done'
  | 'open_detail';

export interface QuickAction {
  kind: QuickActionKind;
  label: string;
  /** Si la acción debería confirmar antes (delete/reject typically). */
  needsConfirm?: boolean;
}

export interface InboxItem {
  /** ID estable para idempotency / dedupe / persist quick-action. */
  id: string;
  kind: InboxItemKind;
  /** Título corto para card header. */
  title: string;
  /** Descripción 1-2 líneas. */
  description: string;
  urgency: InboxUrgency;
  /** UID del usuario al que está asignado (prevencionista típicamente). */
  assignedToUid: string;
  /** Sub-ref del item original — para deep-link "ir al detalle". */
  sourceRef: { collection: string; docId: string };
  /** ISO-8601 cuando se creó. */
  createdAt: string;
  /** ISO-8601 due date (opcional). */
  dueAt?: string;
  /** Quick actions disponibles para este item. */
  quickActions: QuickAction[];
  /** Si el usuario lo despidió/posteopuso (para filtrar de la vista). */
  dismissedAt?: string;
  /** Score 0-100 derivado de urgencia + due + tipo. */
  priorityScore: number;
}

// ────────────────────────────────────────────────────────────────────────
// Raw feed inputs (lo que el caller pasa, antes de aggregation)
// ────────────────────────────────────────────────────────────────────────

export interface FeedInputs {
  /** docs status='pending_approval' con metadata mínima. */
  documentsPending: Array<{ id: string; title: string; createdAt: string; submittedByUid: string }>;
  /** incidents status='pending_review'. */
  incidentsPending: Array<{
    id: string;
    summary: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    occurredAt: string;
  }>;
  /** acciones correctivas abiertas con due. */
  correctiveActionsOpen: Array<{
    id: string;
    label: string;
    dueDate: string;
    daysOverdue?: number;
  }>;
  /** EPP assignments pendientes de validación (foto + checklist). */
  eppPendingValidation: Array<{
    id: string;
    workerName: string;
    eppLabel: string;
    submittedAt: string;
  }>;
  /** Workers sin onboarding completo. */
  workersPendingOnboarding: Array<{ id: string; fullName: string; daysSinceHire: number }>;
  /** Alertas riesgos repetidos (F.13). */
  repeatingRiskAlerts: Array<{
    id: string;
    label: string;
    occurrences: number;
    lastSeenAt: string;
  }>;
  /** Gaps de calidad de datos (F.9). */
  dataQualityGaps: Array<{ id: string; description: string }>;
  /** SIF precursors pendientes revisión ejecutiva (L.4). */
  sifPrecursorsPending: Array<{
    id: string;
    kind: string;
    summary: string;
    createdAt: string;
  }>;
  /** Obligaciones legales próximas a vencer (J.2). */
  legalObligationsDueSoon: Array<{
    id: string;
    label: string;
    nextDueAt: string;
    daysUntil: number;
  }>;
  /** Excepciones próximas a expirar (auto-expire cron). */
  exceptionsExpiringSoon: Array<{
    id: string;
    subjectRef: string;
    validUntil: string;
    hoursLeft: number;
  }>;
  /** UID del prevencionista actual (asignación default). */
  responsibleUid: string;
}

// ────────────────────────────────────────────────────────────────────────
// Quick action templates per kind
// ────────────────────────────────────────────────────────────────────────

const QUICK_ACTIONS_BY_KIND: Record<InboxItemKind, QuickAction[]> = {
  document_pending_approval: [
    { kind: 'approve', label: 'Aprobar' },
    { kind: 'reject', label: 'Rechazar', needsConfirm: true },
    { kind: 'postpone', label: 'Posponer 24h' },
  ],
  incident_pending_review: [
    { kind: 'open_detail', label: 'Ir a investigación' },
    { kind: 'assign', label: 'Asignar' },
  ],
  corrective_action_open: [
    { kind: 'mark_done', label: 'Marcar realizada' },
    { kind: 'assign', label: 'Reasignar' },
    { kind: 'postpone', label: 'Reprogramar' },
  ],
  epp_pending_validation: [
    { kind: 'approve', label: 'Validar' },
    { kind: 'reject', label: 'Rechazar', needsConfirm: true },
  ],
  worker_pending_onboarding: [
    { kind: 'open_detail', label: 'Continuar onboarding' },
    { kind: 'assign', label: 'Asignar mentor' },
  ],
  alert_repeating_risk: [
    { kind: 'open_detail', label: 'Ver patrón' },
    { kind: 'assign', label: 'Asignar análisis' },
  ],
  data_quality_gap: [
    { kind: 'open_detail', label: 'Completar dato' },
    { kind: 'postpone', label: 'Posponer 72h' },
  ],
  sif_precursor_pending: [
    { kind: 'open_detail', label: 'Revisión ejecutiva' },
    { kind: 'assign', label: 'Escalar gerencia' },
  ],
  legal_obligation_due: [
    { kind: 'open_detail', label: 'Ver cronograma' },
    { kind: 'mark_done', label: 'Marcar cumplido' },
    { kind: 'postpone', label: 'Reprogramar' },
  ],
  exception_expiring: [
    { kind: 'mark_done', label: 'Renovar' },
    { kind: 'reject', label: 'Dejar expirar' },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// Urgency derivation
// ────────────────────────────────────────────────────────────────────────

function severityToUrgency(s: 'low' | 'medium' | 'high' | 'critical'): InboxUrgency {
  if (s === 'critical') return 'urgent';
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

function daysUntilToUrgency(days: number): InboxUrgency {
  if (days <= 0) return 'urgent';
  if (days <= 3) return 'high';
  if (days <= 14) return 'medium';
  return 'low';
}

function urgencyToScore(u: InboxUrgency): number {
  switch (u) {
    case 'urgent':
      return 100;
    case 'high':
      return 70;
    case 'medium':
      return 40;
    case 'low':
      return 15;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Aggregation
// ────────────────────────────────────────────────────────────────────────

export interface AggregationOptions {
  /** Override now. */
  now?: Date;
  /** Si true, excluye items con dismissedAt. */
  hideDismissed?: boolean;
  /** Filtro por urgencia mínima. */
  minUrgency?: InboxUrgency;
}

const URGENCY_ORDER: Record<InboxUrgency, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function aggregateInbox(
  feeds: FeedInputs,
  options: AggregationOptions = {},
): InboxItem[] {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const items: InboxItem[] = [];

  for (const d of feeds.documentsPending) {
    items.push({
      id: `doc_${d.id}`,
      kind: 'document_pending_approval',
      title: d.title,
      description: `Documento enviado por ${d.submittedByUid}`,
      urgency: 'medium',
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'documents', docId: d.id },
      createdAt: d.createdAt,
      quickActions: QUICK_ACTIONS_BY_KIND.document_pending_approval,
      priorityScore: urgencyToScore('medium'),
    });
  }

  for (const i of feeds.incidentsPending) {
    const urgency = severityToUrgency(i.severity);
    items.push({
      id: `inc_${i.id}`,
      kind: 'incident_pending_review',
      title: i.summary,
      description: `Incidente ${i.severity}`,
      urgency,
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'incidents', docId: i.id },
      createdAt: i.occurredAt,
      quickActions: QUICK_ACTIONS_BY_KIND.incident_pending_review,
      priorityScore: urgencyToScore(urgency),
    });
  }

  for (const a of feeds.correctiveActionsOpen) {
    const overdue = a.daysOverdue ?? 0;
    const urgency: InboxUrgency = overdue > 7 ? 'urgent' : overdue > 0 ? 'high' : 'medium';
    items.push({
      id: `ca_${a.id}`,
      kind: 'corrective_action_open',
      title: a.label,
      description: overdue > 0 ? `Vencida hace ${overdue} días` : `Vence ${a.dueDate.slice(0, 10)}`,
      urgency,
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'corrective_actions', docId: a.id },
      createdAt: nowIso,
      dueAt: a.dueDate,
      quickActions: QUICK_ACTIONS_BY_KIND.corrective_action_open,
      priorityScore: urgencyToScore(urgency),
    });
  }

  for (const e of feeds.eppPendingValidation) {
    items.push({
      id: `epp_${e.id}`,
      kind: 'epp_pending_validation',
      title: `${e.workerName} — ${e.eppLabel}`,
      description: `Esperando validación supervisor`,
      urgency: 'medium',
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'epp_assignments', docId: e.id },
      createdAt: e.submittedAt,
      quickActions: QUICK_ACTIONS_BY_KIND.epp_pending_validation,
      priorityScore: urgencyToScore('medium'),
    });
  }

  for (const w of feeds.workersPendingOnboarding) {
    const urgency: InboxUrgency = w.daysSinceHire > 7 ? 'high' : 'medium';
    items.push({
      id: `wkr_${w.id}`,
      kind: 'worker_pending_onboarding',
      title: w.fullName,
      description: `${w.daysSinceHire} días desde ingreso, onboarding incompleto`,
      urgency,
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'workers', docId: w.id },
      createdAt: nowIso,
      quickActions: QUICK_ACTIONS_BY_KIND.worker_pending_onboarding,
      priorityScore: urgencyToScore(urgency),
    });
  }

  for (const r of feeds.repeatingRiskAlerts) {
    const urgency: InboxUrgency = r.occurrences >= 5 ? 'high' : 'medium';
    items.push({
      id: `rpt_${r.id}`,
      kind: 'alert_repeating_risk',
      title: r.label,
      description: `Detectado ${r.occurrences} veces en período`,
      urgency,
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'risk_patterns', docId: r.id },
      createdAt: r.lastSeenAt,
      quickActions: QUICK_ACTIONS_BY_KIND.alert_repeating_risk,
      priorityScore: urgencyToScore(urgency),
    });
  }

  for (const g of feeds.dataQualityGaps) {
    items.push({
      id: `dq_${g.id}`,
      kind: 'data_quality_gap',
      title: 'Datos incompletos',
      description: g.description,
      urgency: 'low',
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'data_quality', docId: g.id },
      createdAt: nowIso,
      quickActions: QUICK_ACTIONS_BY_KIND.data_quality_gap,
      priorityScore: urgencyToScore('low'),
    });
  }

  for (const s of feeds.sifPrecursorsPending) {
    items.push({
      id: `sif_${s.id}`,
      kind: 'sif_precursor_pending',
      title: `SIF: ${s.summary}`,
      description: `Tipo: ${s.kind} — requiere revisión ejecutiva`,
      urgency: 'urgent',
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'sif_precursors', docId: s.id },
      createdAt: s.createdAt,
      quickActions: QUICK_ACTIONS_BY_KIND.sif_precursor_pending,
      priorityScore: urgencyToScore('urgent'),
    });
  }

  for (const l of feeds.legalObligationsDueSoon) {
    const urgency = daysUntilToUrgency(l.daysUntil);
    items.push({
      id: `leg_${l.id}`,
      kind: 'legal_obligation_due',
      title: l.label,
      description: `Vence en ${l.daysUntil} días (${l.nextDueAt.slice(0, 10)})`,
      urgency,
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'legal_obligations', docId: l.id },
      createdAt: nowIso,
      dueAt: l.nextDueAt,
      quickActions: QUICK_ACTIONS_BY_KIND.legal_obligation_due,
      priorityScore: urgencyToScore(urgency),
    });
  }

  for (const e of feeds.exceptionsExpiringSoon) {
    const urgency: InboxUrgency = e.hoursLeft < 2 ? 'urgent' : e.hoursLeft < 8 ? 'high' : 'medium';
    items.push({
      id: `exc_${e.id}`,
      kind: 'exception_expiring',
      title: `Excepción ${e.subjectRef}`,
      description: `Expira en ${e.hoursLeft}h`,
      urgency,
      assignedToUid: feeds.responsibleUid,
      sourceRef: { collection: 'exceptions', docId: e.id },
      createdAt: nowIso,
      dueAt: e.validUntil,
      quickActions: QUICK_ACTIONS_BY_KIND.exception_expiring,
      priorityScore: urgencyToScore(urgency),
    });
  }

  // Filter + sort
  let result = items;
  if (options.minUrgency) {
    const minScore = URGENCY_ORDER[options.minUrgency];
    result = result.filter((it) => URGENCY_ORDER[it.urgency] >= minScore);
  }
  if (options.hideDismissed) {
    result = result.filter((it) => !it.dismissedAt);
  }

  result.sort((a, b) => {
    if (URGENCY_ORDER[a.urgency] !== URGENCY_ORDER[b.urgency]) {
      return URGENCY_ORDER[b.urgency] - URGENCY_ORDER[a.urgency];
    }
    // Mismo urgency: por dueAt asc (lo más cercano primero), luego priorityScore
    const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return b.priorityScore - a.priorityScore;
  });

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Summary stats
// ────────────────────────────────────────────────────────────────────────

export interface InboxSummary {
  total: number;
  byUrgency: Record<InboxUrgency, number>;
  byKind: Partial<Record<InboxItemKind, number>>;
  overdueCount: number;
}

export function summarizeInbox(items: InboxItem[], nowIso?: string): InboxSummary {
  const byUrgency: Record<InboxUrgency, number> = {
    urgent: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const byKind: Partial<Record<InboxItemKind, number>> = {};
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  let overdueCount = 0;

  for (const it of items) {
    byUrgency[it.urgency] += 1;
    byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
    if (it.dueAt && Date.parse(it.dueAt) < now) overdueCount += 1;
  }

  return { total: items.length, byUrgency, byKind, overdueCount };
}
