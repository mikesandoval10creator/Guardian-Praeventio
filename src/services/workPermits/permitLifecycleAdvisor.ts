// Praeventio Guard — Sprint 42 F.15: Permit Lifecycle Advisor.
//
// Sub-task del Plan F.15 (Control Permisos de Trabajo). El engine
// `workPermitEngine.ts` ya cubre validación / emisión / cancel /
// fulfill. Este módulo añade la **capa de lifecycle / OUTPUTS** que
// el resto de la app (UI, dispatch, panel supervisión) consume:
//
//   - PermitLifecycleStage: estados expandidos (incluye 'in_grace').
//   - advanceStage(): transitions determinísticas sin tocar el engine.
//   - requiredApprovalsForKind(): matriz de roles aprobadores por kind.
//   - checklistForPermitKind(): items canónicos (espejo del engine,
//     pero retornados como ChecklistItem armable por la UI).
//   - daysUntilExpiry(): cálculo en días (negativo si ya venció).
//   - escalateOverduePermits(): filtra permits activos vencidos.
//
// API pura. Sin LLM. Sin Firestore. El caller persiste.

import type {
  WorkPermit,
  WorkPermitKind,
  WorkPermitChecklist,
} from './workPermitEngine.js';
import { REQUIRED_CHECKLIST_BY_KIND } from './workPermitEngine.js';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type PermitLifecycleStage =
  | 'preparation'
  | 'issued'
  | 'active'
  | 'in_grace'
  | 'expired'
  | 'closed'
  | 'cancelled';

export type LifecycleEventKind =
  | 'submit_for_approval'
  | 'approve'
  | 'start_work'
  | 'enter_grace'
  | 'expire'
  | 'fulfill'
  | 'cancel';

export interface ChecklistItemTemplate {
  id: string;
  label: string;
  checked: boolean;
}

/** Roles capaces de aprobar cada kind de permiso. */
export const REQUIRED_APPROVALS_BY_KIND: Record<WorkPermitKind, readonly string[]> = {
  altura: ['supervisor', 'prevencionista'],
  caliente: ['supervisor', 'prevencionista'],
  confinado: ['supervisor', 'prevencionista', 'gerente'],
  loto: ['supervisor', 'prevencionista'],
  excavacion: ['supervisor', 'prevencionista'],
  izaje_critico: ['supervisor', 'prevencionista', 'gerente'],
};

/** Ventana de "in_grace": el permit ya venció pero damos N horas antes de cerrarlo. */
export const GRACE_PERIOD_HOURS = 2;

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function isoToMs(iso: string): number {
  return Date.parse(iso);
}

/**
 * Convierte el `WorkPermit` actual (con su status del engine) al stage de
 * lifecycle, considerando la ventana de gracia y `validUntil`.
 */
export function currentStage(permit: WorkPermit, now: Date = new Date()): PermitLifecycleStage {
  if (permit.status === 'cancelled') return 'cancelled';
  if (permit.status === 'fulfilled') return 'closed';
  if (permit.status === 'draft') return 'preparation';
  if (permit.status === 'pending_approval') return 'issued';

  const nowMs = now.getTime();
  const endMs = isoToMs(permit.validUntil);
  const graceEndMs = endMs + GRACE_PERIOD_HOURS * 3_600_000;

  if (permit.status === 'expired' || nowMs >= graceEndMs) return 'expired';
  if (nowMs >= endMs) return 'in_grace';
  return 'active';
}

/**
 * Transitions determinísticas. Devuelve el siguiente stage para un evento
 * dado, o el mismo stage si el evento no aplica (no-op en lugar de throw,
 * para que la UI maneje feedback sin try/catch en cada click).
 */
export function advanceStage(
  stage: PermitLifecycleStage,
  eventKind: LifecycleEventKind,
  _now: Date = new Date(),
): PermitLifecycleStage {
  switch (stage) {
    case 'preparation':
      if (eventKind === 'submit_for_approval') return 'issued';
      if (eventKind === 'cancel') return 'cancelled';
      return stage;
    case 'issued':
      if (eventKind === 'approve' || eventKind === 'start_work') return 'active';
      if (eventKind === 'cancel') return 'cancelled';
      return stage;
    case 'active':
      if (eventKind === 'fulfill') return 'closed';
      if (eventKind === 'cancel') return 'cancelled';
      if (eventKind === 'enter_grace') return 'in_grace';
      if (eventKind === 'expire') return 'expired';
      return stage;
    case 'in_grace':
      if (eventKind === 'fulfill') return 'closed';
      if (eventKind === 'expire') return 'expired';
      if (eventKind === 'cancel') return 'cancelled';
      return stage;
    case 'expired':
    case 'closed':
    case 'cancelled':
      return stage;
  }
}

/** Roles que pueden aprobar un permiso de este kind. */
export function requiredApprovalsForKind(kind: WorkPermitKind): readonly string[] {
  return REQUIRED_APPROVALS_BY_KIND[kind];
}

/**
 * Items de checklist canónicos para un kind, ya en formato armable por la UI
 * (id determinístico, label, checked=false por defecto).
 */
export function checklistForPermitKind(kind: WorkPermitKind): ChecklistItemTemplate[] {
  return REQUIRED_CHECKLIST_BY_KIND[kind].map((label, i) => ({
    id: `${kind}-check-${i}`,
    label,
    checked: false,
  }));
}

/** Construye un `WorkPermitChecklist` listo para pasar al engine. */
export function buildEmptyChecklist(kind: WorkPermitKind): WorkPermitChecklist {
  return { items: checklistForPermitKind(kind) };
}

/**
 * Días hasta expirar. Negativo si ya venció. Redondeo hacia arriba para
 * que "2.1 días" se muestre como 3 (lectura amigable supervisor).
 */
export function daysUntilExpiry(
  permit: Pick<WorkPermit, 'validUntil'>,
  now: Date = new Date(),
): number {
  const diffMs = isoToMs(permit.validUntil) - now.getTime();
  const diffDays = diffMs / 86_400_000;
  return diffDays >= 0 ? Math.ceil(diffDays) : Math.floor(diffDays);
}

/**
 * Filtra permits que pasaron `validUntil` y siguen marcados como 'active'.
 * Caller los reportará al supervisor o dispatch worker.
 */
export function escalateOverduePermits(
  permits: readonly WorkPermit[],
  now: Date = new Date(),
): WorkPermit[] {
  const nowMs = now.getTime();
  return permits.filter(
    (p) => p.status === 'active' && isoToMs(p.validUntil) < nowMs,
  );
}

/**
 * % de items del checklist completados (0..1). Útil para barras de progreso UI.
 */
export function checklistCompletion(checklist: WorkPermitChecklist): number {
  if (checklist.items.length === 0) return 0;
  const done = checklist.items.filter((i) => i.checked).length;
  return done / checklist.items.length;
}

/** True si todos los items requeridos están marcados. */
export function isChecklistReady(kind: WorkPermitKind, checklist: WorkPermitChecklist): boolean {
  const required = REQUIRED_CHECKLIST_BY_KIND[kind];
  const checked = new Set(checklist.items.filter((i) => i.checked).map((i) => i.label));
  return required.every((label) => checked.has(label));
}
