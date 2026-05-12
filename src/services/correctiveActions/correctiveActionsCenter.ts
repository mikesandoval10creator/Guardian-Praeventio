// Praeventio Guard — Sprint 40 Fase F.4: Centro de Acciones Correctivas (PDCA).
//
// Cierra el ciclo PDCA del SGSST: sin este módulo el sistema sólo observa.
// Consolida acciones desde 5 fuentes (inspecciones, auditorías, vencimientos
// documentales, incidentes y brechas de capacitación) en un único registro
// con verificación de eficacia obligatoria (F.11), impacto sobre el semáforo
// (F.2) y wire a vencimientos (B.9).
//
// Determinístico. Sin LLM. Sin I/O. Extiende — no duplica — el modelo simple
// de `weakActionDetector.ts`, que sigue siendo la fuente para detección de
// lenguaje débil + balance + duplicados + recidivismo.

import type {
  CorrectiveAction as LegacyCorrectiveAction,
  CorrectiveActionLevel,
} from './weakActionDetector.js';

// ────────────────────────────────────────────────────────────────────────
// Modelo extendido (plan F.4)
// ────────────────────────────────────────────────────────────────────────

export type CorrectiveActionSource =
  | 'inspection'
  | 'audit'
  | 'document_expiry'
  | 'incident'
  | 'training_gap';

export type PdcaPhase = 'plan' | 'do' | 'check' | 'act';

export type CorrectiveActionStatus =
  | 'open'
  | 'in_progress'
  | 'closed'
  | 'verified'
  | 'reopened';

export interface CorrectiveActionRecord {
  /** ID determinístico: ca_{source}_{sourceNodeId}_{slug(dueDate)} */
  id: string;
  source: CorrectiveActionSource;
  sourceNodeId: string;
  /** UID del responsable. Requerido — sin dueño no hay PDCA. */
  responsibleUid: string;
  /** ISO 8601. Requerido. */
  dueDate: string;
  status: CorrectiveActionStatus;
  /** Descripción libre — se reusa en weakActionDetector. */
  description: string;
  level?: CorrectiveActionLevel;
  /** ¿Requiere evidencia adjunta para cerrar? */
  evidenceRequired: boolean;
  /** Cuándo agendar el review de eficacia. ISO 8601. Null hasta que se cierra. */
  effectivenessReviewAt: string | null;
  /** ISO 8601 — cuando pasó a `closed`. Null si no cerrada. */
  closedAt?: string | null;
  /** Sistémica: aplica a múltiples proyectos. */
  isSystemic?: boolean;
}

export interface CorrectiveActionInput {
  source: CorrectiveActionSource;
  sourceNodeId: string;
  responsibleUid: string;
  dueDate: string;
  description: string;
  level?: CorrectiveActionLevel;
  evidenceRequired?: boolean;
  isSystemic?: boolean;
  status?: CorrectiveActionStatus;
}

// ────────────────────────────────────────────────────────────────────────
// createCorrectiveAction — ID determinístico + validación
// ────────────────────────────────────────────────────────────────────────

const VALID_SOURCES: ReadonlySet<CorrectiveActionSource> = new Set([
  'inspection',
  'audit',
  'document_expiry',
  'incident',
  'training_gap',
]);

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function createCorrectiveAction(input: CorrectiveActionInput): CorrectiveActionRecord {
  if (!input || typeof input !== 'object') {
    throw new TypeError('createCorrectiveAction: input requerido');
  }
  if (!VALID_SOURCES.has(input.source)) {
    throw new RangeError(`createCorrectiveAction: source inválido "${input.source}"`);
  }
  if (!input.sourceNodeId || typeof input.sourceNodeId !== 'string') {
    throw new TypeError('createCorrectiveAction: sourceNodeId requerido');
  }
  if (!input.responsibleUid || typeof input.responsibleUid !== 'string') {
    throw new TypeError('createCorrectiveAction: responsibleUid requerido');
  }
  if (!input.dueDate || Number.isNaN(Date.parse(input.dueDate))) {
    throw new RangeError('createCorrectiveAction: dueDate ISO inválido');
  }
  if (!input.description || input.description.trim().length === 0) {
    throw new TypeError('createCorrectiveAction: description requerida');
  }

  const id = `ca_${input.source}_${slug(input.sourceNodeId)}_${slug(input.dueDate)}`;

  return {
    id,
    source: input.source,
    sourceNodeId: input.sourceNodeId,
    responsibleUid: input.responsibleUid,
    dueDate: input.dueDate,
    status: input.status ?? 'open',
    description: input.description.trim(),
    level: input.level,
    evidenceRequired: input.evidenceRequired ?? true,
    effectivenessReviewAt: null,
    closedAt: null,
    isSystemic: input.isSystemic ?? false,
  };
}

// ────────────────────────────────────────────────────────────────────────
// PDCA progress
// ────────────────────────────────────────────────────────────────────────

export interface PdcaProgressReport {
  total: number;
  /** Conteo por fase PDCA. */
  byPhase: Record<PdcaPhase, number>;
  /** % por fase (0..1). */
  shareByPhase: Record<PdcaPhase, number>;
  /** % cerrado el ciclo (verified). */
  closureRate: number;
  /** True si hay acciones reabiertas (señal de mala eficacia). */
  hasReopened: boolean;
  message: string;
}

/** Map status → fase PDCA (Plan-Do-Check-Act). */
export function phaseOf(status: CorrectiveActionStatus): PdcaPhase {
  switch (status) {
    case 'open':
      return 'plan';
    case 'in_progress':
      return 'do';
    case 'closed':
      return 'check';
    case 'verified':
      return 'act';
    case 'reopened':
      return 'plan';
  }
}

export function assessProgressPDCA(actions: CorrectiveActionRecord[]): PdcaProgressReport {
  const byPhase: Record<PdcaPhase, number> = { plan: 0, do: 0, check: 0, act: 0 };
  let reopened = 0;
  for (const a of actions) {
    byPhase[phaseOf(a.status)] += 1;
    if (a.status === 'reopened') reopened += 1;
  }
  const total = actions.length;
  const shareByPhase: Record<PdcaPhase, number> = { plan: 0, do: 0, check: 0, act: 0 };
  if (total > 0) {
    (Object.keys(byPhase) as PdcaPhase[]).forEach((k) => {
      shareByPhase[k] = byPhase[k] / total;
    });
  }
  const closureRate = total > 0 ? byPhase.act / total : 0;
  const hasReopened = reopened > 0;
  let message = `PDCA ${Math.round(closureRate * 100)}% cerrado.`;
  if (hasReopened) {
    message = `${reopened} acción(es) reabierta(s) — eficacia insuficiente, revisar causa raíz.`;
  } else if (total > 0 && closureRate === 0) {
    message = 'Ninguna acción verificada todavía — el ciclo PDCA no se ha cerrado.';
  }
  return { total, byPhase, shareByPhase, closureRate, hasReopened, message };
}

// ────────────────────────────────────────────────────────────────────────
// F.11 — verificación de eficacia (30d después de cerrar)
// ────────────────────────────────────────────────────────────────────────

export interface EffectivenessReviewEntry {
  actionId: string;
  reviewAt: string;
  prompt: string;
  responsibleUid: string;
}

/**
 * Agenda review de eficacia daysAfterClose días después de `closedAt`.
 * Si la acción aún no está cerrada, retorna null.
 */
export function scheduleEffectivenessReview(
  action: CorrectiveActionRecord,
  daysAfterClose = 30,
): EffectivenessReviewEntry | null {
  if (action.status !== 'closed' && action.status !== 'verified') return null;
  if (!action.closedAt || Number.isNaN(Date.parse(action.closedAt))) return null;
  const reviewAt = new Date(Date.parse(action.closedAt) + daysAfterClose * 86_400_000).toISOString();
  return {
    actionId: action.id,
    reviewAt,
    prompt: '¿El problema volvió? Verifica eficacia de la acción correctiva.',
    responsibleUid: action.responsibleUid,
  };
}

/** Marca una acción como cerrada y agenda automáticamente el review. */
export function closeAction(
  action: CorrectiveActionRecord,
  closedAt: string,
  daysAfterClose = 30,
): CorrectiveActionRecord {
  if (Number.isNaN(Date.parse(closedAt))) {
    throw new RangeError('closeAction: closedAt ISO inválido');
  }
  const next: CorrectiveActionRecord = {
    ...action,
    status: 'closed',
    closedAt,
    effectivenessReviewAt: new Date(
      Date.parse(closedAt) + daysAfterClose * 86_400_000,
    ).toISOString(),
  };
  return next;
}

// ────────────────────────────────────────────────────────────────────────
// F.2 wire — impacto en el semáforo
// ────────────────────────────────────────────────────────────────────────

export type SemaforoColor = 'green' | 'amber' | 'red';

export interface SemaforoImpact {
  actionId: string;
  color: SemaforoColor;
  weight: number;
  reason: string;
}

/**
 * Convierte una acción en su impacto sobre el semáforo F.2.
 *
 * Reglas (determinísticas):
 *  - reopened o vencida (dueDate < hoy) y abierta → red, peso 3
 *  - en progreso o abierta y due en <=7d → amber, peso 2
 *  - cerrada/verified → green, peso 0
 *  - otra → green, peso 1
 */
export function linkToSemaforo(
  action: CorrectiveActionRecord,
  now: Date = new Date(),
): SemaforoImpact {
  const dueMs = Date.parse(action.dueDate);
  const overdue = !Number.isNaN(dueMs) && dueMs < now.getTime();
  const sevenDaysMs = 7 * 86_400_000;
  const dueSoon = !Number.isNaN(dueMs) && dueMs - now.getTime() <= sevenDaysMs;

  if (action.status === 'reopened') {
    return {
      actionId: action.id,
      color: 'red',
      weight: 3,
      reason: 'Acción reabierta: causa raíz no resuelta.',
    };
  }
  if ((action.status === 'open' || action.status === 'in_progress') && overdue) {
    return {
      actionId: action.id,
      color: 'red',
      weight: 3,
      reason: 'Acción vencida sin cerrar.',
    };
  }
  if ((action.status === 'open' || action.status === 'in_progress') && dueSoon) {
    return {
      actionId: action.id,
      color: 'amber',
      weight: 2,
      reason: 'Vence pronto (≤7 días).',
    };
  }
  if (action.status === 'closed' || action.status === 'verified') {
    return {
      actionId: action.id,
      color: 'green',
      weight: 0,
      reason: 'Ciclo PDCA cerrado.',
    };
  }
  return {
    actionId: action.id,
    color: 'green',
    weight: 1,
    reason: 'En plazo.',
  };
}

// ────────────────────────────────────────────────────────────────────────
// B.9 wire — vencimientos
// ────────────────────────────────────────────────────────────────────────

/** True si la acción se origina en (o actúa sobre) un vencimiento documental. */
export function linkToExpiration(action: CorrectiveActionRecord): boolean {
  return action.source === 'document_expiry';
}

// ────────────────────────────────────────────────────────────────────────
// Bridge legacy
// ────────────────────────────────────────────────────────────────────────

/** Adapta el record extendido al modelo legacy `CorrectiveAction`. */
export function toLegacy(record: CorrectiveActionRecord): LegacyCorrectiveAction {
  let legacyStatus: LegacyCorrectiveAction['status'] = 'open';
  if (record.status === 'verified') legacyStatus = 'verified';
  else if (record.status === 'closed') legacyStatus = 'closed';
  return {
    id: record.id,
    description: record.description,
    status: legacyStatus,
    isSystemic: record.isSystemic ?? false,
    level: record.level,
    sourceCause: record.sourceNodeId,
  };
}
