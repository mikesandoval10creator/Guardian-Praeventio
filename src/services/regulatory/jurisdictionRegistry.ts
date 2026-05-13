// Sprint 48 E.4 — Registry de perfiles de jurisdicción.
//
// API pública para resolver `JurisdictionProfile` por código, listar
// jurisdicciones soportadas y comparar dos regímenes (útil para clientes
// multi-país).
//
// No reemplaza `registry.ts` (cita de controles ISO 45001 por país); esta
// capa es ortogonal y agrupa información de regulators/comités/privacidad
// que `registry.ts` no maneja.

import type { JurisdictionCode } from './types.js';
import {
  JURISDICTION_PROFILES,
  type JurisdictionProfile,
} from './profiles.js';
import {
  getRegime,
  type PrivacyRegime,
  type PrivacyRegimeCode,
} from './privacyRegimes.js';

export type {
  JurisdictionProfile,
  IncidentReporting,
  MandatoryCommittee,
  LocalizedEmergencyNumbers,
  JurisdictionRegulationEntry,
} from './profiles.js';

/**
 * Devuelve el perfil completo o `null` si la jurisdicción no está
 * codificada todavía.
 */
export function getJurisdiction(code: JurisdictionCode): JurisdictionProfile | null {
  return JURISDICTION_PROFILES[code] ?? null;
}

/**
 * Lista de códigos soportados, orden estable (alfabético, ISO-45001 al
 * inicio si está). ISO-45001 nunca tiene perfil propio (es baseline).
 */
export function listSupportedJurisdictions(): JurisdictionCode[] {
  const codes = Object.keys(JURISDICTION_PROFILES) as JurisdictionCode[];
  return codes.slice().sort((a, b) => a.localeCompare(b));
}

// ────────────────────────────────────────────────────────────────────────
// compareRegimes — diff entre 2 jurisdicciones
// ────────────────────────────────────────────────────────────────────────

export interface RegimeDiff {
  a: JurisdictionCode;
  b: JurisdictionCode;
  /** Si ambas comparten el mismo privacy regime code. */
  samePrivacyRegime: boolean;
  privacyRegimeA: PrivacyRegimeCode | null;
  privacyRegimeB: PrivacyRegimeCode | null;
  /** Diferencia de horas para breach notification (a − b). Negativo = a más estricto. */
  breachNotificationHoursDelta: number | null;
  /** Diferencia de días en deadline de incidente laboral (a − b). */
  incidentDeadlineDaysDelta: number;
  /** Reguladores distintos. */
  differentPrimaryRegulators: boolean;
  /** Cantidad de comités obligatorios en cada uno. */
  mandatoryCommitteesCount: { a: number; b: number };
  /**
   * Categorías de datos que requieren consentimiento explícito en A pero
   * no en B (y viceversa).
   */
  consentDeltaAOnly: string[];
  consentDeltaBOnly: string[];
  /** Resumen humano-legible (1 línea). */
  summary: string;
}

export function compareRegimes(
  a: JurisdictionCode,
  b: JurisdictionCode,
): RegimeDiff | null {
  const profA = getJurisdiction(a);
  const profB = getJurisdiction(b);
  if (!profA || !profB) return null;

  const regimeA: PrivacyRegime | null = getRegime(profA.privacyRegime);
  const regimeB: PrivacyRegime | null = getRegime(profB.privacyRegime);

  const consentA = new Set(regimeA?.alwaysRequireExplicitConsent ?? []);
  const consentB = new Set(regimeB?.alwaysRequireExplicitConsent ?? []);
  const aOnly = [...consentA].filter((k) => !consentB.has(k));
  const bOnly = [...consentB].filter((k) => !consentA.has(k));

  const breachDelta =
    regimeA && regimeB
      ? regimeA.breachNotificationHours - regimeB.breachNotificationHours
      : null;

  const incidentDelta =
    profA.incidentReporting.deadlineDays - profB.incidentReporting.deadlineDays;

  const summaryParts: string[] = [];
  summaryParts.push(`${profA.code} vs ${profB.code}`);
  if (profA.privacyRegime !== profB.privacyRegime) {
    summaryParts.push(
      `privacy: ${profA.privacyRegime}/${profB.privacyRegime}`,
    );
  } else {
    summaryParts.push(`privacy: ${profA.privacyRegime} (same)`);
  }
  if (breachDelta !== null && breachDelta !== 0) {
    summaryParts.push(`breach Δ${breachDelta}h`);
  }
  if (incidentDelta !== 0) {
    summaryParts.push(`incident Δ${incidentDelta}d`);
  }

  return {
    a,
    b,
    samePrivacyRegime: profA.privacyRegime === profB.privacyRegime,
    privacyRegimeA: regimeA?.code ?? null,
    privacyRegimeB: regimeB?.code ?? null,
    breachNotificationHoursDelta: breachDelta,
    incidentDeadlineDaysDelta: incidentDelta,
    differentPrimaryRegulators: profA.primaryRegulator !== profB.primaryRegulator,
    mandatoryCommitteesCount: {
      a: profA.mandatoryCommittees.length,
      b: profB.mandatoryCommittees.length,
    },
    consentDeltaAOnly: aOnly,
    consentDeltaBOnly: bOnly,
    summary: summaryParts.join(' · '),
  };
}
