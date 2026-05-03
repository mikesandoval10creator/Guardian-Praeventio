// SPDX-License-Identifier: MIT
// Sprint 15 — Positive-only XP API.
//
// Single front door for awarding XP. Anything that crosses this module
// is positive (>= 0). The call signature uses XpReason from
// `src/types/organic.ts` so the reason set is closed and auditable.
//
// IMPORTANT: there is intentionally NO `decrementXp` exported. If a
// caller really wants to reduce XP, they need to add a new reason to the
// XpReason union AND a new code path here — both of which would surface
// in code review. This file is the chokepoint that enforces the
// "gamificación SOLO positiva" requirement at the type level.

import { XP_AMOUNTS, type XpReason } from '../../types/organic';

export interface AwardXpResult {
  reason: XpReason;
  amount: number;
  context?: Record<string, unknown>;
  awardedAt: string;
  /** True when the call was a no-op (non-positive amount). */
  skipped: boolean;
}

/**
 * Award XP to the caller. The amount defaults to the canonical XP_AMOUNTS
 * value for the reason; callers may override (e.g. process_completed
 * passes a dynamically computed amount), but only with positive ints.
 */
export function awardXp(
  reason: XpReason,
  amount?: number,
  context?: Record<string, unknown>
): AwardXpResult {
  const requested = typeof amount === 'number' ? amount : XP_AMOUNTS[reason];
  if (!Number.isFinite(requested) || requested <= 0) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[awardXp] non-positive amount ${requested} for reason ${reason} — ignored`);
    }
    return { reason, amount: 0, context, awardedAt: new Date().toISOString(), skipped: true };
  }
  return {
    reason,
    amount: Math.floor(requested),
    context,
    awardedAt: new Date().toISOString(),
    skipped: false,
  };
}

/**
 * Medallas (badges) keyed by milestone. Unlock conditions are pure: the
 * caller passes the latest crew/individual stats and gets back the IDs
 * of medals that just turned eligible. UI displays them.
 */
export interface MedallaCondition {
  id: string;
  label: string;
  description: string;
  /** Returns true iff the medal should be unlocked for these stats. */
  isUnlocked: (s: MedallaStats) => boolean;
}

export interface MedallaStats {
  totalProcessesCompleted: number;
  daysWithoutIncident: number;
  alertsResponded: number;
  wisdomCapsulesCompleted: number;
  nearMissesReported: number;
}

export const MEDALLAS: MedallaCondition[] = [
  {
    id: 'procesos-10',
    label: '10 procesos cerrados',
    description: 'La cuadrilla cerró diez procesos con cumplimiento alto.',
    isUnlocked: (s) => s.totalProcessesCompleted >= 10,
  },
  {
    id: 'sin-accidentes-100',
    label: '100 días sin accidentes',
    description: 'Cien días consecutivos sin accidentes registrados.',
    isUnlocked: (s) => s.daysWithoutIncident >= 100,
  },
  {
    id: 'alertas-5',
    label: '5 alertas predictivas atendidas',
    description: 'La cuadrilla respondió a cinco alertas antes del riesgo.',
    isUnlocked: (s) => s.alertsResponded >= 5,
  },
  {
    id: 'capsulas-30',
    label: '30 cápsulas de sabiduría',
    description: 'Treinta días con la cápsula matutina completada.',
    isUnlocked: (s) => s.wisdomCapsulesCompleted >= 30,
  },
  {
    id: 'nearmiss-10',
    label: '10 near-miss reportados',
    description: 'Diez observaciones tempranas reportadas a tiempo.',
    isUnlocked: (s) => s.nearMissesReported >= 10,
  },
];

export function evaluateMedallas(stats: MedallaStats): string[] {
  return MEDALLAS.filter((m) => m.isUnlocked(stats)).map((m) => m.id);
}
