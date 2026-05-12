// Praeventio Guard — Sprint 39 Fase L.5: extensiones criticalControls.
//
// Cierra: Documento usuario "§302-310, §332-337" — Top usuario #3, #4, #9
//
// Sin tocar el motor existente (`criticalControlsLibrary.ts`), agregamos:
//   - EnergyType (gravedad, eléctrica, mecánica, química, térmica, presión,
//     radiación, biológica) por control
//   - ControlVerificationFrequency (per_task, daily, weekly, monthly, per_event)
//   - barrierCount(riskCategory) → cuántas capas vivas hay para un riesgo
//   - detectSingleBarrier(riskCategory) → flag si el riesgo solo tiene 1 capa
//   - controlRobustnessScore(control) → puntuación (elimination=alta, epp=baja)
//   - findControlSuperiorTo(level) → sugiere subir en jerarquía
//   - ControlFailureMode → por qué falló un control cuando se verificó
//
// Determinístico, sin LLM. Todo extensible vía PR pequeño.

import type {
  CriticalControl,
  ControlLevel,
  ControlValidation,
} from './criticalControlsLibrary.js';

// ────────────────────────────────────────────────────────────────────────
// New extensible types
// ────────────────────────────────────────────────────────────────────────

export type EnergyType =
  | 'gravity'
  | 'electric'
  | 'mechanical'
  | 'chemical'
  | 'thermal'
  | 'pressure'
  | 'radiation'
  | 'biological';

export type ControlVerificationFrequency =
  | 'per_task'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'per_event';

/**
 * Modos canónicos de falla. Cuando se verifica un control y resulta
 * `present=false`, el supervisor puede clasificar la causa con esto.
 * Sirve para análisis estadístico ("el 40% de los controles falla por
 * 'no_mantenido' → priorizar mantenimiento preventivo").
 */
export type ControlFailureMode =
  | 'no_disponible'
  | 'no_usado'
  | 'no_adecuado'
  | 'no_mantenido'
  | 'no_entendido'
  | 'no_supervisado';

/**
 * Metadata extra para controles (no modifica el shape canónico —
 * la agregamos en un mapa paralelo para evitar churn de la lib base).
 */
export interface ControlExtension {
  energyType?: EnergyType;
  verificationFrequency?: ControlVerificationFrequency;
  /** Días aceptables entre verificaciones (para escalamiento §310). */
  maxDaysBetweenVerifications?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Robustness scoring (jerarquía ISO 45001 + HCA)
// ────────────────────────────────────────────────────────────────────────

const LEVEL_SCORE: Record<ControlLevel, number> = {
  elimination: 100,
  substitution: 80,
  engineering: 60,
  administrative: 30,
  epp: 10,
};

const LEVEL_ORDER: Record<ControlLevel, number> = {
  elimination: 0,
  substitution: 1,
  engineering: 2,
  administrative: 3,
  epp: 4,
};

/**
 * Puntúa la robustez de un control. La jerarquía ISO 45001 dice que:
 *   eliminación > sustitución > ingeniería > admin > EPP
 * Esto convierte esa jerarquía en número 0..100 para ordenar / ranking.
 */
export function controlRobustnessScore(control: Pick<CriticalControl, 'level'>): number {
  return LEVEL_SCORE[control.level];
}

/**
 * Dada una jerarquía actual, sugiere qué niveles superiores podrías
 * intentar. Útil para §305 — "si tu riesgo solo tiene EPP, evalúa
 * encapsulamiento, ventilación o barrera física antes".
 */
export function findControlSuperiorTo(level: ControlLevel): ControlLevel[] {
  const currentIdx = LEVEL_ORDER[level];
  return (Object.keys(LEVEL_ORDER) as ControlLevel[])
    .filter((l) => LEVEL_ORDER[l] < currentIdx)
    .sort((a, b) => LEVEL_ORDER[a] - LEVEL_ORDER[b]);
}

// ────────────────────────────────────────────────────────────────────────
// Barrier counting (§302-303)
// ────────────────────────────────────────────────────────────────────────

export interface BarrierAnalysis {
  riskCategory: string;
  /** Total de capas distintas presentes. */
  barrierCount: number;
  /** Capas por nivel de control. */
  layersByLevel: Record<ControlLevel, number>;
  /** True si depende de UNA sola capa (§303 detector barrera única). */
  isSingleBarrier: boolean;
  /** Nombre humano de las barreras vivas. */
  liveBarrierLabels: string[];
}

/**
 * Cuenta barreras "vivas" para un riesgo: controles que YA fueron
 * verificados como presentes (`ControlValidation.present === true`).
 * No incluye los del catálogo que NO se han verificado.
 */
export function buildBarrierAnalysis(
  riskCategory: string,
  catalog: CriticalControl[],
  validations: ControlValidation[],
): BarrierAnalysis {
  const presentIds = new Set(
    validations.filter((v) => v.present).map((v) => v.controlId),
  );
  const liveControls = catalog
    .filter((c) => c.riskCategory === riskCategory && presentIds.has(c.id));

  const layersByLevel: Record<ControlLevel, number> = {
    elimination: 0,
    substitution: 0,
    engineering: 0,
    administrative: 0,
    epp: 0,
  };
  for (const c of liveControls) {
    layersByLevel[c.level] += 1;
  }

  return {
    riskCategory,
    barrierCount: liveControls.length,
    layersByLevel,
    isSingleBarrier: liveControls.length === 1,
    liveBarrierLabels: liveControls.map((c) => c.label),
  };
}

/**
 * Detecta riesgos que dependen de una SOLA barrera — útil para alertar
 * al prevencionista que el sistema es frágil para esa categoría.
 */
export function detectSingleBarrierRisks(
  riskCategories: string[],
  catalog: CriticalControl[],
  validations: ControlValidation[],
): BarrierAnalysis[] {
  return riskCategories
    .map((cat) => buildBarrierAnalysis(cat, catalog, validations))
    .filter((b) => b.isSingleBarrier);
}

// ────────────────────────────────────────────────────────────────────────
// Verification calendar (§308-310)
// ────────────────────────────────────────────────────────────────────────

export interface ControlVerificationStatus {
  controlId: string;
  /** Última verificación (ISO-8601). */
  lastVerifiedAt?: string;
  /** Frecuencia esperada. */
  frequency: ControlVerificationFrequency;
  /** Días desde la última verificación. */
  daysSinceLastVerification: number;
  /** True si está dentro del SLA. */
  isInWindow: boolean;
  /** True si NO se verificó dentro del plazo → ESCALAR (§310). */
  needsEscalation: boolean;
}

const FREQUENCY_MAX_DAYS: Record<ControlVerificationFrequency, number> = {
  per_task: 1,
  daily: 1,
  weekly: 7,
  monthly: 30,
  per_event: 30, // arbitrario — depende del evento, default mensual
};

export function computeVerificationStatus(
  controlId: string,
  frequency: ControlVerificationFrequency,
  lastVerifiedAt: string | undefined,
  nowIso: string = new Date().toISOString(),
): ControlVerificationStatus {
  const maxDays = FREQUENCY_MAX_DAYS[frequency];
  if (!lastVerifiedAt) {
    return {
      controlId,
      lastVerifiedAt,
      frequency,
      daysSinceLastVerification: Infinity,
      isInWindow: false,
      needsEscalation: true,
    };
  }
  const days = Math.floor((Date.parse(nowIso) - Date.parse(lastVerifiedAt)) / 86_400_000);
  return {
    controlId,
    lastVerifiedAt,
    frequency,
    daysSinceLastVerification: days,
    isInWindow: days <= maxDays,
    needsEscalation: days > maxDays * 1.5,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Energy-aware matrix (§332-337)
// ────────────────────────────────────────────────────────────────────────

/**
 * Tabla canónica que asocia controles con la energía que mitigan.
 * Extensible: agregar entry = 1 línea. La función `controlsByEnergy`
 * agrupa el catálogo por tipo de energía para la matriz §332.
 */
export const ENERGY_BY_CONTROL: Record<string, EnergyType> = {
  // Altura → gravedad
  'alt-eng-baranda': 'gravity',
  'alt-eng-linea': 'gravity',
  'alt-epp-arnes': 'gravity',
  'alt-adm-permit': 'gravity',
  'alt-adm-supervisor': 'gravity',
  // Eléctrico → eléctrica
  'elec-elim-corte': 'electric',
  'elec-eng-loto': 'electric',
  'elec-epp-dielectrico': 'electric',
  'elec-adm-licencia': 'electric',
  // Confinado → química (atm) + biológica (gases)
  'conf-eng-ventilacion': 'chemical',
  'conf-eng-medicion': 'chemical',
  'conf-adm-vigia': 'chemical',
  'conf-adm-rescate': 'chemical',
  // Caliente → térmica
  'cal-sub-no-soldar': 'thermal',
  'cal-eng-extintor': 'thermal',
  'cal-adm-vigia-fuego': 'thermal',
  // Químico → química
  'qui-sub-menos-toxico': 'chemical',
  'qui-eng-extraccion': 'chemical',
  'qui-adm-hds': 'chemical',
};

export function getEnergyTypeForControl(controlId: string): EnergyType | undefined {
  return ENERGY_BY_CONTROL[controlId];
}

/**
 * Agrupa los controles del catálogo por tipo de energía. Útil para
 * el panel §332 "Matriz Controles por Energía".
 */
export function controlsByEnergy(catalog: CriticalControl[]): Record<EnergyType, CriticalControl[]> {
  const result = {
    gravity: [],
    electric: [],
    mechanical: [],
    chemical: [],
    thermal: [],
    pressure: [],
    radiation: [],
    biological: [],
  } as Record<EnergyType, CriticalControl[]>;

  for (const c of catalog) {
    const energy = getEnergyTypeForControl(c.id);
    if (energy) result[energy].push(c);
  }
  return result;
}
