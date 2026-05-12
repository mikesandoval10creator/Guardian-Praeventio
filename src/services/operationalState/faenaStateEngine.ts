// Praeventio Guard — Sprint 39 Fase G.5: Estado Operacional de Faena.
//
// Cierra: Documento usuario "Recomendaciones nuevas §25"
//         Plan integral Top 15 #2
//
// Calcula y representa el estado operativo de una faena en una pantalla
// tipo "centro de mando":
//
//   - Operativa
//   - Restringida (controles activos limitan operación)
//   - Parcialmente detenida (algunas zonas/equipos fuera)
//   - Detenida (paralización formal vigente)
//   - Emergencia (incidente activo)
//
// Determinístico, sin LLM. Pure function input → state.

export type FaenaOperationalState =
  | 'operativa'
  | 'restringida'
  | 'parcialmente_detenida'
  | 'detenida'
  | 'emergencia';

export interface FaenaStateInput {
  /** Hay un incidente abierto con severity ≥ high. */
  activeEmergencyIncidents: number;
  /** Hay paralización formal vigente. */
  activeStoppages: Array<{ id: string; reason: string; sinceIso: string }>;
  /** Zonas en estado restringido (no totalmente detenido). */
  restrictedZones: Array<{ id: string; reason: string }>;
  /** Equipos críticos fuera de servicio. */
  criticalEquipmentDown: Array<{ id: string; label: string }>;
  /** Findings críticos abiertos sin acción cerrada. */
  openCriticalFindings: number;
  /** Permisos de trabajo activos (no pre-condición de estado, solo info). */
  activeWorkPermits: number;
}

export interface FaenaStateResult {
  state: FaenaOperationalState;
  /** Resumen humano para el banner del dashboard. */
  reason: string;
  /** Detalles para drill-down. */
  affectedModules: string[];
  computedAt: string;
}

/**
 * Reglas de derivación (orden importa — primer match gana):
 *
 *   1. Emergencia activa → 'emergencia'
 *   2. Paralización formal vigente → 'detenida'
 *   3. Equipo crítico down O zona restringida → 'parcialmente_detenida'
 *      o 'restringida' según severidad combinada
 *   4. 2+ findings críticos abiertos → 'restringida'
 *   5. Default → 'operativa'
 */
export function computeFaenaState(
  input: FaenaStateInput,
  now: Date = new Date(),
): FaenaStateResult {
  const affected: string[] = [];

  // 1. Emergencia
  if (input.activeEmergencyIncidents > 0) {
    return {
      state: 'emergencia',
      reason: `${input.activeEmergencyIncidents} incidente(s) crítico(s) en curso`,
      affectedModules: ['emergency'],
      computedAt: now.toISOString(),
    };
  }

  // 2. Paralización formal
  if (input.activeStoppages.length > 0) {
    const first = input.activeStoppages[0];
    return {
      state: 'detenida',
      reason: `Paralización vigente: ${first.reason} (desde ${first.sinceIso.slice(0, 10)})`,
      affectedModules: ['stoppages'],
      computedAt: now.toISOString(),
    };
  }

  // 3. Equipos críticos down O zonas restringidas
  const hasEquipmentDown = input.criticalEquipmentDown.length > 0;
  const hasRestrictedZones = input.restrictedZones.length > 0;
  if (hasEquipmentDown && hasRestrictedZones) {
    affected.push('maintenance', 'zones');
    return {
      state: 'parcialmente_detenida',
      reason: `${input.criticalEquipmentDown.length} equipo(s) crítico(s) fuera + ${input.restrictedZones.length} zona(s) restringida(s)`,
      affectedModules: affected,
      computedAt: now.toISOString(),
    };
  }
  if (hasEquipmentDown) {
    return {
      state: 'parcialmente_detenida',
      reason: `${input.criticalEquipmentDown.length} equipo(s) crítico(s) fuera de servicio`,
      affectedModules: ['maintenance'],
      computedAt: now.toISOString(),
    };
  }
  if (hasRestrictedZones) {
    return {
      state: 'restringida',
      reason: `${input.restrictedZones.length} zona(s) bajo restricción`,
      affectedModules: ['zones'],
      computedAt: now.toISOString(),
    };
  }

  // 4. Findings críticos
  if (input.openCriticalFindings >= 2) {
    return {
      state: 'restringida',
      reason: `${input.openCriticalFindings} hallazgos críticos abiertos sin cierre`,
      affectedModules: ['findings'],
      computedAt: now.toISOString(),
    };
  }

  // 5. Default
  return {
    state: 'operativa',
    reason: 'Faena operando normal',
    affectedModules: [],
    computedAt: now.toISOString(),
  };
}
