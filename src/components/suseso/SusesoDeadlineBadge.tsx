// Praeventio Guard — Sprint 28 follow-up.
//
// Visual badge indicating the legal-deadline state of a SUSESO DIAT/DIEP
// form. Shown next to a form row in the SUSESO dashboard so the gerente
// can see at a glance which forms are about to age out.
//
// IMPORTANT semantics: this badge tracks whether the EMPRESA submitted
// the form to the mutualidad — Praeventio does NOT submit it. Reminders
// + this badge are how we keep the empresa accountable to the plazo.

import React from 'react';
import {
  daysUntilDeadline,
  escalationLevel,
  type EscalationLevel,
  type SusesoDeadlineStatus,
  type SusesoFormKindLocal,
} from '../../services/suseso/reminders';

export interface SusesoDeadlineBadgeProps {
  /** ISO-8601 legal deadline (incidentDate + 5 días corridos). */
  deadline: string;
  /** Lifecycle of the empresa's submission obligation. */
  status: SusesoDeadlineStatus;
  /** DIAT or DIEP — used in the visible label. */
  formKind: SusesoFormKindLocal;
  /** Optional override of "now" — primarily for testing. */
  now?: number;
}

// Aligns with the 4-mode token semantics (normal-light + normal-dark):
// teal #4db6ac is the primary brand; semantic green/yellow/orange/red
// match the existing palette used by SOS / EPP badges.
const LEVEL_STYLES: Record<EscalationLevel, { bg: string; fg: string }> = {
  green:   { bg: '#10b981', fg: '#ffffff' },
  yellow:  { bg: '#f59e0b', fg: '#1c1917' },
  orange:  { bg: '#f97316', fg: '#ffffff' },
  red:     { bg: '#dc2626', fg: '#ffffff' },
  overdue: { bg: '#7f1d1d', fg: '#fee2e2' },
};

const SUBMITTED_STYLE = { bg: '#4db6ac', fg: '#0b1f1d' };

/** Build the visible Spanish label. */
function buildLabel(
  formKind: SusesoFormKindLocal,
  level: EscalationLevel,
  daysLeft: number,
): string {
  if (level === 'red') {
    return `${formKind} — vence HOY`;
  }
  if (level === 'overdue') {
    return `${formKind} — vencido (envío manual urgente)`;
  }
  if (daysLeft === 1) return `${formKind} — vence en 1 día`;
  return `${formKind} — vence en ${daysLeft} días`;
}

export const SusesoDeadlineBadge: React.FC<SusesoDeadlineBadgeProps> = ({
  deadline,
  status,
  formKind,
  now,
}) => {
  if (status === 'submitted_by_company') {
    return (
      <span
        role="status"
        data-testid="suseso-deadline-badge"
        data-status="submitted_by_company"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          background: SUBMITTED_STYLE.bg,
          color: SUBMITTED_STYLE.fg,
        }}
      >
        ✓ Enviado por la empresa
      </span>
    );
  }

  // [P0][VIDA-SAFETY][Ley 16.744] Hy3-audit 3c6aa66d-73fe-819e-9955-c7fea64efbc8
  // (reabierto 2026-08-24): si status='overdue' pero el deadline es
  // todavía futuro (cron de marquee desincronizado, cambio de fecha
  // legal retroactivo, datos importados), el badge mostraba "vence
  // en N días" contradiciendo el estado BD. Riesgo de cumplimiento
  // Ley 16.744 — el operador veía un plazo legal futuro cuando ya
  // estaba vencido. Forzamos level='overdue' cuando status='overdue'.
  let level: EscalationLevel;
  let daysLeft: number;
  if (status === 'overdue') {
    level = 'overdue';
    daysLeft = 0;
  } else {
    daysLeft = daysUntilDeadline(deadline, now);
    level = escalationLevel(daysLeft);
  }
  const palette = LEVEL_STYLES[level];
  const label = buildLabel(formKind, level, daysLeft);

  return (
    <span
      role="status"
      data-testid="suseso-deadline-badge"
      data-level={level}
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {label}
    </span>
  );
};

export default SusesoDeadlineBadge;
