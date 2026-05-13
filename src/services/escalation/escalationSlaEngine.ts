// Praeventio Guard — Sprint 50 §206-210: Escalation engine + SLA cierre.
//
// Cierra §206 (escalamiento automático), §207 (SLA cierre por categoría),
// §208 (timer breach), §209 (re-asignación auto-ascendente),
// §210 (registro auditoría escalation) de la 2da tanda usuario.
//
// 100% determinístico. Engine puro que dado el estado actual de un item
// abierto (incident / corrective_action / nc / permit / SOS) decide:
//   - Si está dentro de SLA, near-breach o breached
//   - Si requiere escalation auto (subir un nivel)
//   - Audit trail con who/when/why
//   - Resolución automática de target uid (next supervisor in chain)

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type WorkflowItemKind =
  | 'incident'
  | 'corrective_action'
  | 'non_conformity'
  | 'work_permit'
  | 'sos_alert'
  | 'exception_request'
  | 'audit_finding';

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical' | 'sif';

export type SlaState = 'within_sla' | 'near_breach' | 'breached' | 'permanently_overdue';

export type EscalationLevel = 1 | 2 | 3 | 4 | 5;

export interface WorkflowItem {
  id: string;
  kind: WorkflowItemKind;
  severity: SeverityLevel;
  status: 'open' | 'in_progress' | 'pending_review' | 'closed' | 'rejected';
  createdAt: string;
  /** Última transición de estado para no escalar items en in_progress activo. */
  lastTransitionAt?: string;
  /** UID actualmente responsable (puede subir con escalation). */
  assignedToUid?: string;
  /** Nivel actual de escalation. */
  currentLevel?: EscalationLevel;
  /** Trail previo de escalations. */
  history?: EscalationHistoryEntry[];
}

export interface EscalationHistoryEntry {
  fromLevel: EscalationLevel;
  toLevel: EscalationLevel;
  fromUid?: string;
  toUid: string;
  at: string;
  reason: 'sla_breach' | 'severity_increase' | 'manual_escalation' | 'recipient_unavailable';
}

/**
 * Cadena de escalation por nivel — caller la inyecta. Cada level tiene
 * un fallback uid si el primary no está disponible (vacaciones, off).
 */
export interface EscalationChain {
  level1: { primary: string; fallback?: string; label: string };
  level2: { primary: string; fallback?: string; label: string };
  level3: { primary: string; fallback?: string; label: string };
  level4?: { primary: string; fallback?: string; label: string };
  level5?: { primary: string; fallback?: string; label: string };
}

// ────────────────────────────────────────────────────────────────────────
// SLA configuration por (kind, severity)
// ────────────────────────────────────────────────────────────────────────

/**
 * SLA en minutos para cierre del item, por (kind × severity).
 * Calibrado conservador — basado en práctica industrial Chile DS 6/Ley 16.744.
 */
const SLA_MINUTES_BY_KIND_SEVERITY: Record<WorkflowItemKind, Record<SeverityLevel, number>> = {
  sos_alert: {
    low: 5,
    medium: 3,
    high: 2,
    critical: 1,
    sif: 1,
  },
  incident: {
    low: 60 * 24 * 5, // 5 días
    medium: 60 * 24 * 3,
    high: 60 * 24,
    critical: 60 * 4, // 4h
    sif: 60, // 1h
  },
  corrective_action: {
    low: 60 * 24 * 30, // 30 días
    medium: 60 * 24 * 15,
    high: 60 * 24 * 7,
    critical: 60 * 24 * 3,
    sif: 60 * 24,
  },
  non_conformity: {
    low: 60 * 24 * 30,
    medium: 60 * 24 * 14,
    high: 60 * 24 * 7,
    critical: 60 * 24 * 3,
    sif: 60 * 24,
  },
  work_permit: {
    low: 60 * 24, // 1 día
    medium: 60 * 12,
    high: 60 * 4,
    critical: 60 * 2,
    sif: 60,
  },
  exception_request: {
    low: 60 * 24 * 7,
    medium: 60 * 24 * 3,
    high: 60 * 24,
    critical: 60 * 4,
    sif: 60,
  },
  audit_finding: {
    low: 60 * 24 * 60,
    medium: 60 * 24 * 30,
    high: 60 * 24 * 15,
    critical: 60 * 24 * 7,
    sif: 60 * 24 * 3,
  },
};

export function getSlaMinutes(kind: WorkflowItemKind, severity: SeverityLevel): number {
  return SLA_MINUTES_BY_KIND_SEVERITY[kind][severity];
}

/**
 * % del SLA en el que se dispara near_breach warning (default 80%).
 */
const NEAR_BREACH_PCT = 0.8;
/**
 * Multiplicador del SLA tras el cual ya no se intenta escalation más alto
 * (permanently_overdue — el item necesita intervención manual urgente).
 */
const PERMANENT_OVERDUE_MULT = 3.0;

// ────────────────────────────────────────────────────────────────────────
// SLA state computation
// ────────────────────────────────────────────────────────────────────────

export interface SlaAssessment {
  state: SlaState;
  slaMinutes: number;
  ageMinutes: number;
  /** Minutos restantes hasta breach (negativo si ya breached). */
  minutesUntilBreach: number;
  /** Fracción consumida del SLA (0..1+). */
  consumedFraction: number;
}

export function assessSla(item: WorkflowItem, now: Date): SlaAssessment {
  const slaMinutes = getSlaMinutes(item.kind, item.severity);
  const ageMs = now.getTime() - Date.parse(item.createdAt);
  const ageMinutes = Math.max(0, Math.floor(ageMs / 60_000));
  const minutesUntilBreach = slaMinutes - ageMinutes;
  const consumedFraction = ageMinutes / Math.max(1, slaMinutes);

  let state: SlaState;
  if (consumedFraction >= PERMANENT_OVERDUE_MULT) {
    state = 'permanently_overdue';
  } else if (consumedFraction >= 1) {
    state = 'breached';
  } else if (consumedFraction >= NEAR_BREACH_PCT) {
    state = 'near_breach';
  } else {
    state = 'within_sla';
  }

  return { state, slaMinutes, ageMinutes, minutesUntilBreach, consumedFraction };
}

// ────────────────────────────────────────────────────────────────────────
// Escalation decision
// ────────────────────────────────────────────────────────────────────────

export interface EscalationDecision {
  /** Si debe escalar. */
  shouldEscalate: boolean;
  /** Nuevo nivel si shouldEscalate=true. */
  toLevel?: EscalationLevel;
  /** Uid del nuevo asignado (primary o fallback). */
  toUid?: string;
  /** Razón canónica. */
  reason?: EscalationHistoryEntry['reason'];
  /** Detalle human-readable. */
  detail: string;
  /** Si la cadena se agotó (nivel max alcanzado). */
  chainExhausted: boolean;
}

export interface EscalationOptions {
  /** Uids que están temporalmente unavailable (vacaciones). */
  unavailableUids?: Set<string>;
  /** Si severity acaba de subir (force escalation aunque dentro de SLA). */
  severityJustIncreased?: boolean;
  /** Si caller fuerza una escalation manual. */
  manualEscalation?: boolean;
}

function resolveLevelTarget(
  chain: EscalationChain,
  level: EscalationLevel,
  unavailable: Set<string>,
): { uid: string; isPrimary: boolean } | null {
  const cfg =
    level === 1 ? chain.level1
      : level === 2 ? chain.level2
      : level === 3 ? chain.level3
      : level === 4 ? chain.level4
      : chain.level5;
  if (!cfg) return null;
  if (!unavailable.has(cfg.primary)) return { uid: cfg.primary, isPrimary: true };
  if (cfg.fallback && !unavailable.has(cfg.fallback)) return { uid: cfg.fallback, isPrimary: false };
  return null;
}

export function decideEscalation(
  item: WorkflowItem,
  chain: EscalationChain,
  now: Date,
  options: EscalationOptions = {},
): EscalationDecision {
  const sla = assessSla(item, now);
  const currentLevel: EscalationLevel = item.currentLevel ?? 1;
  const unavailable = options.unavailableUids ?? new Set<string>();

  // Closed/rejected → never escalate
  if (item.status === 'closed' || item.status === 'rejected') {
    return {
      shouldEscalate: false,
      detail: 'Item cerrado o rechazado — no aplica escalation.',
      chainExhausted: false,
    };
  }

  // Permanently overdue + at max level → no shouldEscalate, but caller debería
  // marcar el item como urgent_manual_intervention
  const maxLevel: EscalationLevel = chain.level5 ? 5 : chain.level4 ? 4 : 3;
  if (currentLevel >= maxLevel) {
    return {
      shouldEscalate: false,
      detail: `Nivel ${currentLevel} es el máximo de la cadena. Item requiere intervención manual urgente si está breached.`,
      chainExhausted: true,
    };
  }

  // Reasons que disparan escalation
  let reason: EscalationHistoryEntry['reason'] | null = null;
  if (options.manualEscalation) {
    reason = 'manual_escalation';
  } else if (options.severityJustIncreased) {
    reason = 'severity_increase';
  } else if (sla.state === 'breached' || sla.state === 'permanently_overdue') {
    reason = 'sla_breach';
  } else if (item.assignedToUid && unavailable.has(item.assignedToUid)) {
    reason = 'recipient_unavailable';
  }

  if (!reason) {
    return {
      shouldEscalate: false,
      detail: `Dentro de SLA (${sla.consumedFraction.toFixed(2)} consumido). No escalation requerida.`,
      chainExhausted: false,
    };
  }

  // Resolver el siguiente nivel
  const nextLevel = Math.min(currentLevel + 1, maxLevel) as EscalationLevel;
  const target = resolveLevelTarget(chain, nextLevel, unavailable);
  if (!target) {
    return {
      shouldEscalate: false,
      reason,
      detail: `Sin destino disponible en nivel ${nextLevel} (primary y fallback unavailable).`,
      chainExhausted: nextLevel === maxLevel,
    };
  }

  return {
    shouldEscalate: true,
    toLevel: nextLevel,
    toUid: target.uid,
    reason,
    detail: `Escalation por ${reason} → nivel ${nextLevel} (${target.isPrimary ? 'primary' : 'fallback'}).`,
    chainExhausted: nextLevel === maxLevel,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Apply escalation — devuelve nuevo WorkflowItem inmutable con audit trail
// ────────────────────────────────────────────────────────────────────────

export function applyEscalation(
  item: WorkflowItem,
  decision: EscalationDecision,
  now: Date,
): WorkflowItem {
  if (!decision.shouldEscalate || !decision.toLevel || !decision.toUid || !decision.reason) {
    return item;
  }
  const history: EscalationHistoryEntry[] = [
    ...(item.history ?? []),
    {
      fromLevel: item.currentLevel ?? 1,
      toLevel: decision.toLevel,
      fromUid: item.assignedToUid,
      toUid: decision.toUid,
      at: now.toISOString(),
      reason: decision.reason,
    },
  ];
  return {
    ...item,
    assignedToUid: decision.toUid,
    currentLevel: decision.toLevel,
    lastTransitionAt: now.toISOString(),
    history,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Batch processing para cron daily
// ────────────────────────────────────────────────────────────────────────

export interface BatchEscalationResult {
  evaluated: number;
  escalated: number;
  chainExhaustedCount: number;
  permanentlyOverdueCount: number;
  decisions: Array<{ itemId: string; decision: EscalationDecision; sla: SlaAssessment }>;
}

export function processBatchEscalations(
  items: ReadonlyArray<WorkflowItem>,
  chain: EscalationChain,
  now: Date,
  options: EscalationOptions = {},
): BatchEscalationResult {
  const decisions: BatchEscalationResult['decisions'] = [];
  let escalated = 0;
  let chainExhaustedCount = 0;
  let permanentlyOverdueCount = 0;

  for (const item of items) {
    const sla = assessSla(item, now);
    if (sla.state === 'permanently_overdue') permanentlyOverdueCount += 1;
    const decision = decideEscalation(item, chain, now, options);
    if (decision.shouldEscalate) escalated += 1;
    if (decision.chainExhausted) chainExhaustedCount += 1;
    decisions.push({ itemId: item.id, decision, sla });
  }

  return {
    evaluated: items.length,
    escalated,
    chainExhaustedCount,
    permanentlyOverdueCount,
    decisions,
  };
}
