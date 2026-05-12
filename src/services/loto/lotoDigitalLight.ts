// Praeventio Guard — Sprint K: LOTO Digital Liviano + Energías Peligrosas.
//
// Cierra: Documento usuario "§31-37"
//
// Lock-Out Tag-Out simplificado: registro de cada candado + tarjeta +
// energía bloqueada + verificación cero energía. NO sustituye al
// procedimiento físico — lo complementa con trazabilidad digital.
//
// Cada LotoApplication:
//   - Energías identificadas (gravity, electric, ..., cualquiera del catálogo)
//   - Lock points (cada uno con uid del trabajador que aplicó candado)
//   - Verificación cero energía (try-out)
//   - Liberación con firma
//
// Determinístico, sin LLM.

import type { EnergyType } from '../criticalControls/controlRobustness.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface LotoLockPoint {
  /** ID del punto de bloqueo. */
  pointId: string;
  description: string;
  energyType: EnergyType;
  /** Trabajador que aplicó el candado/tarjeta. */
  appliedByUid: string;
  appliedAt: string;
  /** Tag visible en sitio (color/número). */
  tagId: string;
  /** Verificado cero energía? */
  zeroEnergyVerified: boolean;
  /** Liberado por quién y cuándo. */
  releasedByUid?: string;
  releasedAt?: string;
}

export interface LotoApplication {
  id: string;
  equipmentId: string;
  /** Trabajador líder de la intervención. */
  leaderUid: string;
  /** Trabajadores autorizados a trabajar bajo LOTO. */
  authorizedWorkerUids: string[];
  /** Energías a aislar. */
  energiesIdentified: EnergyType[];
  /** Lock points aplicados. */
  lockPoints: LotoLockPoint[];
  appliedAt: string;
  /** ISO-8601 cuando se liberó todo. */
  fullyReleasedAt?: string;
  /** Razón de la intervención. */
  workDescription: string;
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export interface LotoValidationResult {
  applicationId: string;
  /** True si TODAS las energías identificadas tienen lock point aplicado. */
  allEnergiesLocked: boolean;
  /** True si TODOS los lock points tienen zeroEnergyVerified=true. */
  allZeroEnergyVerified: boolean;
  /** Energías sin lock point aplicado. */
  unlockedEnergies: EnergyType[];
  /** Lock points sin verificación cero energía. */
  unverifiedLockPoints: string[];
  /** Si autoriza inicio de trabajo. */
  authorizesWork: boolean;
  /** Mensajes. */
  messages: string[];
}

export function validateLotoApplication(app: LotoApplication): LotoValidationResult {
  const lockedEnergies = new Set<EnergyType>(app.lockPoints.map((lp) => lp.energyType));
  const unlockedEnergies = app.energiesIdentified.filter((e) => !lockedEnergies.has(e));
  const allEnergiesLocked = unlockedEnergies.length === 0;

  const unverifiedLockPoints = app.lockPoints
    .filter((lp) => !lp.zeroEnergyVerified)
    .map((lp) => lp.pointId);
  const allZeroEnergyVerified = unverifiedLockPoints.length === 0;

  const messages: string[] = [];
  if (!allEnergiesLocked) {
    messages.push(`Energías sin bloquear: ${unlockedEnergies.join(', ')}`);
  }
  if (!allZeroEnergyVerified) {
    messages.push(`Lock points sin try-out cero energía: ${unverifiedLockPoints.join(', ')}`);
  }
  if (app.lockPoints.some((lp) => lp.releasedAt) && !app.fullyReleasedAt) {
    messages.push('Lock points parcialmente liberados — confirmar plan de retorno a operación.');
  }

  return {
    applicationId: app.id,
    allEnergiesLocked,
    allZeroEnergyVerified,
    unlockedEnergies,
    unverifiedLockPoints,
    authorizesWork: allEnergiesLocked && allZeroEnergyVerified && !app.fullyReleasedAt,
    messages,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Release tracker
// ────────────────────────────────────────────────────────────────────────

export interface ReleaseAttempt {
  applicationId: string;
  /** Quién intenta liberar. */
  releaserUid: string;
  /** ISO-8601. */
  at: string;
}

export interface ReleaseValidationResult {
  applicationId: string;
  canRelease: boolean;
  reasons: string[];
}

/**
 * Valida que la liberación sea segura: solo el líder o un autorizado
 * pueden liberar, y solo si el LOTO está en estado consistente.
 */
export function validateRelease(
  app: LotoApplication,
  attempt: ReleaseAttempt,
): ReleaseValidationResult {
  const reasons: string[] = [];

  if (app.fullyReleasedAt) {
    reasons.push('La aplicación LOTO ya fue completamente liberada.');
  }
  if (attempt.releaserUid !== app.leaderUid && !app.authorizedWorkerUids.includes(attempt.releaserUid)) {
    reasons.push('El usuario que intenta liberar no es líder ni autorizado.');
  }

  return {
    applicationId: app.id,
    canRelease: reasons.length === 0,
    reasons,
  };
}

/**
 * Aplica liberación a TODOS los lock points pendientes. NO muta el
 * input — devuelve la copia actualizada (estilo Redux).
 */
export function applyFullRelease(
  app: LotoApplication,
  releaserUid: string,
  at: string,
): LotoApplication {
  return {
    ...app,
    fullyReleasedAt: at,
    lockPoints: app.lockPoints.map((lp) =>
      lp.releasedAt
        ? lp
        : { ...lp, releasedByUid: releaserUid, releasedAt: at },
    ),
  };
}
