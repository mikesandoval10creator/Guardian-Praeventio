// Praeventio Guard — Sprint K: Control de Línea de Fuego.
//
// Cierra: Documento usuario "§339-340"
//
// "Línea de fuego" = exposición del trabajador a una energía liberable
// (carga suspendida, equipo móvil, proyección de partículas, energía
// almacenada). Es la causa #1 de fatalidades industriales.
//
// Antes de iniciar una tarea, validamos:
//   - ¿Hay alguna exposición de línea de fuego identificada?
//   - Si la hay, ¿tiene controles específicos?
//   - Si no los tiene, BLOQUEO duro.
//
// Determinístico — checklist + reglas.

export type LineOfFireKind =
  | 'suspended_load'      // carga suspendida (grúa, polipasto)
  | 'mobile_equipment'    // equipo móvil cerca de personas
  | 'projection'          // proyección de partículas (esmerilado, soldadura)
  | 'stored_energy'       // energía almacenada (resortes, presión, hidráulica)
  | 'pressurized_line'    // línea presurizada (latigazo)
  | 'falling_object'      // objeto en altura puede caer
  | 'rotating_machinery'  // maquinaria rotativa (eje, polea, banda)
  | 'electric_arc'        // arco eléctrico
  | 'release_chemical';   // liberación de químico bajo presión

export interface LineOfFireExposure {
  kind: LineOfFireKind;
  /** Descripción específica del contexto. */
  description: string;
  /** Distancia mínima a la zona de impacto (m). */
  proximityMeters: number;
  /** ¿Las personas están en la trayectoria? */
  personnelInPath: boolean;
}

export interface LineOfFireMitigation {
  /** Tipo de línea de fuego que mitiga. */
  appliesTo: LineOfFireKind;
  controlId: string;
  label: string;
}

const REQUIRED_MITIGATIONS: Record<LineOfFireKind, string[]> = {
  suspended_load: [
    'zona de exclusión bajo carga',
    'tag-line para guiar carga',
    'señalero entrenado',
  ],
  mobile_equipment: [
    'rutas separadas peatón/máquina',
    'alarma de retroceso',
    'contacto visual operador-peatón',
  ],
  projection: [
    'mampara o barrera física',
    'protección facial + ocular',
    'distancia mínima a no operadores',
  ],
  stored_energy: [
    'liberación controlada previa',
    'verificación cero energía',
    'pin de seguridad',
  ],
  pressurized_line: [
    'despresurización antes de intervenir',
    'verificación de cero presión',
    'whip-check / restraint en mangueras',
  ],
  falling_object: [
    'rodapié + malla en niveles superiores',
    'herramientas amarradas',
    'casco con barbiquejo',
  ],
  rotating_machinery: [
    'guarda física en partes móviles',
    'LOTO si intervención',
    'prohibición de ropa suelta y joyas',
  ],
  electric_arc: [
    'distancia mínima por nivel de tensión',
    'EPP arc-rated (faceshield + guantes clase)',
    'desenergización antes de intervenir',
  ],
  release_chemical: [
    'línea cerrada / vacuum break',
    'EPP químico apropiado',
    'mampara protectora + extracción',
  ],
};

export function getRequiredMitigationsForKind(kind: LineOfFireKind): string[] {
  return REQUIRED_MITIGATIONS[kind];
}

export interface LineOfFireValidationResult {
  exposure: LineOfFireExposure;
  /** Lista de mitigaciones ESPERADAS según el kind. */
  expectedMitigations: string[];
  /** Lista de mitigaciones DECLARADAS por el caller. */
  declaredMitigations: string[];
  /** Mitigaciones faltantes (intersección). */
  missingMitigations: string[];
  /** Si pasa la validación (zero missing) AND no hay personnelInPath. */
  passes: boolean;
  /** Si debe bloquear inicio de tarea. */
  blockTask: boolean;
  message: string;
}

/**
 * Valida una exposición de línea de fuego declarada. Recibe las
 * mitigaciones que ya están en sitio. Si falta alguna esperada, lo
 * marca como missing. Bloquea si hay personas en trayectoria sin
 * suficientes mitigaciones.
 */
export function validateLineOfFire(
  exposure: LineOfFireExposure,
  declaredMitigations: string[],
): LineOfFireValidationResult {
  const expectedMitigations = getRequiredMitigationsForKind(exposure.kind);
  const normalizedDeclared = declaredMitigations.map((m) => m.toLowerCase().trim());
  const missingMitigations = expectedMitigations.filter(
    (em) => !normalizedDeclared.some((dm) => dm.includes(em.toLowerCase().split(' ')[0])),
  );

  // Bloqueo: personas en trayectoria sin TODAS las mitigaciones.
  const blockTask = exposure.personnelInPath && missingMitigations.length > 0;
  const passes = missingMitigations.length === 0;

  let message: string;
  if (blockTask) {
    message = `BLOQUEO: ${exposure.kind} con personas en trayectoria y ${missingMitigations.length} mitigaciones faltantes.`;
  } else if (passes) {
    message = `Línea de fuego ${exposure.kind} con todas las mitigaciones declaradas.`;
  } else {
    message = `${exposure.kind} parcialmente mitigada: faltan ${missingMitigations.join(', ')}.`;
  }

  return {
    exposure,
    expectedMitigations,
    declaredMitigations,
    missingMitigations,
    passes,
    blockTask,
    message,
  };
}

/** Resumen para dashboard. */
export interface LineOfFireReport {
  totalExposures: number;
  byKind: Record<LineOfFireKind, number>;
  blockingCount: number;
  passesCount: number;
}

export function summarizeLineOfFire(
  results: LineOfFireValidationResult[],
): LineOfFireReport {
  const byKind = {
    suspended_load: 0,
    mobile_equipment: 0,
    projection: 0,
    stored_energy: 0,
    pressurized_line: 0,
    falling_object: 0,
    rotating_machinery: 0,
    electric_arc: 0,
    release_chemical: 0,
  } as Record<LineOfFireKind, number>;

  let blockingCount = 0;
  let passesCount = 0;
  for (const r of results) {
    byKind[r.exposure.kind] += 1;
    if (r.blockTask) blockingCount += 1;
    if (r.passes) passesCount += 1;
  }

  return {
    totalExposures: results.length,
    byKind,
    blockingCount,
    passesCount,
  };
}
