// SPDX-License-Identifier: MIT
//
// Normativa rules engine — valida la colocación de objetos virtuales
// en el Digital Twin contra las regulaciones chilenas.
//
// Cada regla recibe (objeto, contexto del entorno) y devuelve un veredicto
// { compliant: boolean, severity, citation, suggestion }.
//
// Aplicación:
//   - Cuando el usuario arrastra un extintor virtual al modelo 3D, se
//     ejecutan las reglas DS 594 art. 45-49 + NCh 1410 + DS 132.
//   - Si alguna falla (ej. "extintor a más de 25m del puesto de trabajo"),
//     se muestra un warning antes de confirmar la colocación.
//   - El reporte consolidado alimenta los DS 109 / IPER PDFs con
//     evidencia normativa.
//
// Las reglas son data-driven (objetos puros) — fácil agregar nuevas
// sin tocar el motor.

import type { PlacedObject, PlacedObjectKind } from '../photogrammetry/types';

export type Severity = 'error' | 'warning' | 'info';

export interface RuleViolation {
  /** ID de la regla violada. */
  ruleId: string;
  severity: Severity;
  /** Mensaje legible (ya en español). */
  message: string;
  /** Cita normativa (ej. "DS 594 art. 47"). */
  citation: string;
  /** Sugerencia de cómo corregir. */
  suggestion?: string;
  /** Objetos involucrados (típicamente el que se está colocando). */
  objectIds: string[];
}

export interface PlacementContext {
  /** Todos los objetos ya colocados en el twin (incluyendo el que se evalúa). */
  placedObjects: PlacedObject[];
  /**
   * Puntos de trabajo / áreas pobladas — se usan para reglas de
   * cobertura (ej. extintor accesible desde cada puesto).
   */
  workstations?: { id: string; position: { x: number; y: number; z: number } }[];
  /** Salidas de emergencia conocidas. */
  emergencyExits?: { id: string; position: { x: number; y: number; z: number } }[];
  /** Industria del proyecto — afecta qué reglas aplican (mining, construction, etc.). */
  industryCode?: string;
}

/** Distancia euclidiana 3D entre dos puntos. */
function distance3D(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const EXTINGUISHER_KINDS: ReadonlyArray<PlacedObjectKind> = [
  'extinguisher_pqs',
  'extinguisher_co2',
  'extinguisher_water',
];

function isExtinguisher(obj: PlacedObject): boolean {
  return EXTINGUISHER_KINDS.includes(obj.kind);
}

// ─────────────────────────────────────────────────────────────────────────
// REGLA: DS 594 art. 47 — Extintores a máximo 25m de cualquier puesto.
// ─────────────────────────────────────────────────────────────────────────
export const DS594_EXTINGUISHER_MAX_DISTANCE_M = 25;

/**
 * DS 594 art. 47: "La distancia máxima desde cualquier punto del lugar
 * de trabajo hasta un extintor no excederá de 25 m, salvo casos
 * justificados técnicamente."
 *
 * Verifica que TODOS los workstations tengan al menos un extintor
 * dentro de 25m. Si alguno no, devuelve violation por ese workstation.
 */
export function ruleExtinguisherCoverage(context: PlacementContext): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const extinguishers = context.placedObjects.filter(
    (o) => isExtinguisher(o) && (o.lifecycle === 'active' || o.lifecycle === 'installed' || o.lifecycle === 'planning'),
  );
  const workstations = context.workstations ?? [];

  for (const ws of workstations) {
    const closest = extinguishers
      .map((e) => distance3D(ws.position, e.position))
      .reduce((min, d) => Math.min(min, d), Infinity);

    if (closest > DS594_EXTINGUISHER_MAX_DISTANCE_M) {
      violations.push({
        ruleId: 'ds594-art47-extinguisher-coverage',
        severity: 'error',
        message: `Puesto de trabajo "${ws.id}" está a ${closest.toFixed(1)}m del extintor más cercano (máximo legal 25m).`,
        citation: 'DS 594 art. 47',
        suggestion: 'Colocar un extintor adicional dentro de 25m del puesto, idealmente en una vía de circulación.',
        objectIds: [ws.id],
      });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────
// REGLA: DS 594 art. 48 — Mínimo 1 extintor cada 150m² de superficie.
// ─────────────────────────────────────────────────────────────────────────
export const DS594_EXTINGUISHER_AREA_PER_UNIT_M2 = 150;

/**
 * DS 594 art. 48: razón mínima de extintores por superficie. Es una
 * heurística — el reglamento real distingue por clase de fuego (A/B/C).
 * Aquí simplificamos: 1 extintor cada 150 m². Para refinamiento por
 * clase ver `extinguisherClassByMaterials.ts` (Sprint 21+).
 */
export function ruleExtinguisherDensity(
  context: PlacementContext,
  facilityAreaM2: number,
): RuleViolation[] {
  if (facilityAreaM2 <= 0) return [];
  const required = Math.ceil(facilityAreaM2 / DS594_EXTINGUISHER_AREA_PER_UNIT_M2);
  const have = context.placedObjects.filter(
    (o) => isExtinguisher(o) && o.lifecycle !== 'retired',
  ).length;

  if (have < required) {
    return [
      {
        ruleId: 'ds594-art48-extinguisher-density',
        severity: 'error',
        message: `Se requieren al menos ${required} extintores para una superficie de ${facilityAreaM2} m² (actualmente ${have}).`,
        citation: 'DS 594 art. 48',
        suggestion: `Agregar ${required - have} extintor(es) más al modelo.`,
        objectIds: [],
      },
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────
// REGLA: NCh 1410 — Señalética visible cada vía de evacuación.
// ─────────────────────────────────────────────────────────────────────────
export function ruleEvacuationSignage(context: PlacementContext): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const evacSigns = context.placedObjects.filter((o) => o.kind === 'sign_evacuation');
  const exits = context.emergencyExits ?? [];

  // Para cada salida de emergencia debe haber al menos 1 sign_evacuation
  // dentro de 10m (heurística de visibilidad).
  for (const exit of exits) {
    const closest = evacSigns
      .map((s) => distance3D(exit.position, s.position))
      .reduce((min, d) => Math.min(min, d), Infinity);

    if (closest > 10) {
      violations.push({
        ruleId: 'nch1410-evacuation-signage',
        severity: 'warning',
        message: `Salida de emergencia "${exit.id}" no tiene señalética visible dentro de 10m (más cercana: ${closest === Infinity ? 'ninguna' : closest.toFixed(1) + 'm'}).`,
        citation: 'NCh 1410 — Señalización de seguridad',
        suggestion: 'Colocar un cartel de evacuación cerca de la salida.',
        objectIds: [exit.id],
      });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────
// REGLA: Objetos críticos no deben estar dentro de 1m de otros objetos
// críticos (DS 132 minería + buenas prácticas generales).
// ─────────────────────────────────────────────────────────────────────────
const CRITICAL_KINDS: ReadonlyArray<PlacedObjectKind> = [
  'extinguisher_pqs',
  'extinguisher_co2',
  'extinguisher_water',
  'hydrant',
  'aed',
  'first_aid_kit',
  'emergency_shower',
  'eye_wash_station',
];

export function ruleCriticalObjectsSpacing(context: PlacementContext): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const critical = context.placedObjects.filter((o) => CRITICAL_KINDS.includes(o.kind));

  for (let i = 0; i < critical.length; i++) {
    for (let j = i + 1; j < critical.length; j++) {
      const d = distance3D(critical[i].position, critical[j].position);
      if (d < 1.0) {
        violations.push({
          ruleId: 'critical-objects-spacing',
          severity: 'warning',
          message: `Dos objetos críticos (${critical[i].kind} y ${critical[j].kind}) están a ${d.toFixed(2)}m — recomendado mínimo 1m de separación.`,
          citation: 'DS 132 / buenas prácticas',
          suggestion: 'Distribuir geográficamente para no perder ambos en un mismo incidente.',
          objectIds: [critical[i].id, critical[j].id],
        });
      }
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────
// MOTOR — corre todas las reglas aplicables y consolida.
// ─────────────────────────────────────────────────────────────────────────

export interface ComplianceReport {
  /** Veredicto global. true sii no hay violations de severity 'error'. */
  compliant: boolean;
  violations: RuleViolation[];
  /** Conteo por severidad. */
  summary: { error: number; warning: number; info: number };
  /** Cuándo se generó (ms epoch). */
  generatedAt: number;
}

export interface ComplianceCheckOptions {
  /** Superficie total de la faena en m² — opcional, habilita reglas de densidad. */
  facilityAreaM2?: number;
}

/**
 * Corre todas las reglas aplicables al contexto y devuelve el reporte.
 * Pure function — sin side effects, determinístico.
 */
export function runComplianceCheck(
  context: PlacementContext,
  options: ComplianceCheckOptions = {},
): ComplianceReport {
  const violations: RuleViolation[] = [];

  violations.push(...ruleExtinguisherCoverage(context));
  if (options.facilityAreaM2 !== undefined) {
    violations.push(...ruleExtinguisherDensity(context, options.facilityAreaM2));
  }
  violations.push(...ruleEvacuationSignage(context));
  violations.push(...ruleCriticalObjectsSpacing(context));

  const summary = { error: 0, warning: 0, info: 0 };
  for (const v of violations) summary[v.severity]++;

  return {
    compliant: summary.error === 0,
    violations,
    summary,
    generatedAt: Date.now(),
  };
}
