// Praeventio Guard — Sprint 39 Fase I.2: Biblioteca de Controles Críticos + Validación.
//
// Cierra: Documento usuario "Recomendaciones nuevas §11, §12"
//
// Base de controles críticos por tipo de riesgo (jerarquía ISO 45001 +
// HCA hierarchy of controls). Antes de una tarea crítica, supervisor
// valida en terreno que los controles estén presentes.

export type ControlLevel =
  | 'elimination' // mejor — eliminar el peligro
  | 'substitution' // sustituir por menos peligroso
  | 'engineering' // controles físicos / técnicos
  | 'administrative' // procedimientos, capacitación, rotación
  | 'epp'; // último recurso

export interface CriticalControl {
  id: string;
  riskCategory: string; // 'altura', 'electric', 'confinado', etc.
  /** Etiqueta del control. */
  label: string;
  level: ControlLevel;
  /** Si la presencia se verifica visualmente / con instrumento. */
  verificationMethod: 'visual' | 'instrument' | 'documental' | 'procedural';
  /** Cita normativa. */
  normReference: string;
}

/**
 * Biblioteca canónica (Chile + ISO).
 */
export const CRITICAL_CONTROLS_LIBRARY: CriticalControl[] = [
  // Altura
  { id: 'alt-eng-baranda', riskCategory: 'altura', label: 'Barandas perimetrales', level: 'engineering', verificationMethod: 'visual', normReference: 'DS 594 art. 53' },
  { id: 'alt-eng-linea', riskCategory: 'altura', label: 'Línea de vida instalada', level: 'engineering', verificationMethod: 'visual', normReference: 'DS 594 art. 53' },
  { id: 'alt-epp-arnes', riskCategory: 'altura', label: 'Arnés certificado vigente', level: 'epp', verificationMethod: 'visual', normReference: 'DS 594' },
  { id: 'alt-adm-permit', riskCategory: 'altura', label: 'Permiso trabajo en altura firmado', level: 'administrative', verificationMethod: 'documental', normReference: 'DS 76' },
  { id: 'alt-adm-supervisor', riskCategory: 'altura', label: 'Supervisor competente presente', level: 'administrative', verificationMethod: 'procedural', normReference: 'DS 594' },

  // Eléctrico
  { id: 'elec-elim-corte', riskCategory: 'electric', label: 'Energía cortada (try-out cero V)', level: 'elimination', verificationMethod: 'instrument', normReference: 'DS 132' },
  { id: 'elec-eng-loto', riskCategory: 'electric', label: 'LOTO instalado y rotulado', level: 'engineering', verificationMethod: 'visual', normReference: 'DS 132' },
  { id: 'elec-epp-dielectrico', riskCategory: 'electric', label: 'EPP dieléctrico certificado', level: 'epp', verificationMethod: 'visual', normReference: 'DS 109' },
  { id: 'elec-adm-licencia', riskCategory: 'electric', label: 'Operador con licencia SEC vigente', level: 'administrative', verificationMethod: 'documental', normReference: 'Reglamento SEC' },

  // Confinado
  { id: 'conf-eng-ventilacion', riskCategory: 'confinado', label: 'Ventilación forzada operativa', level: 'engineering', verificationMethod: 'visual', normReference: 'DS 132' },
  { id: 'conf-eng-medicion', riskCategory: 'confinado', label: 'Medición de gases conforme', level: 'engineering', verificationMethod: 'instrument', normReference: 'Protocolo MINSAL' },
  { id: 'conf-adm-vigia', riskCategory: 'confinado', label: 'Vigía exterior en posición', level: 'administrative', verificationMethod: 'visual', normReference: 'DS 132' },
  { id: 'conf-adm-rescate', riskCategory: 'confinado', label: 'Equipo de rescate disponible', level: 'administrative', verificationMethod: 'visual', normReference: 'DS 132' },

  // Caliente
  { id: 'cal-sub-no-soldar', riskCategory: 'caliente', label: 'Alternativa fría disponible', level: 'substitution', verificationMethod: 'procedural', normReference: 'NFPA 51B' },
  { id: 'cal-eng-extintor', riskCategory: 'caliente', label: 'Extintor portátil verificado', level: 'engineering', verificationMethod: 'visual', normReference: 'NFPA 10' },
  { id: 'cal-adm-vigia-fuego', riskCategory: 'caliente', label: 'Vigía contra incendio asignado', level: 'administrative', verificationMethod: 'procedural', normReference: 'NFPA 51B' },

  // Hazmat / químicos
  { id: 'qui-sub-menos-toxico', riskCategory: 'quimico', label: 'Sustitución por menos tóxica considerada', level: 'substitution', verificationMethod: 'documental', normReference: 'DS 78' },
  { id: 'qui-eng-extraccion', riskCategory: 'quimico', label: 'Extracción localizada activa', level: 'engineering', verificationMethod: 'instrument', normReference: 'DS 594' },
  { id: 'qui-adm-hds', riskCategory: 'quimico', label: 'HDS disponible y leída', level: 'administrative', verificationMethod: 'documental', normReference: 'NCh 2245' },
];

export function getControlsForRisk(category: string): CriticalControl[] {
  return CRITICAL_CONTROLS_LIBRARY.filter((c) => c.riskCategory === category);
}

const LABEL_BY_CONTROL_ID: Record<string, string> = Object.fromEntries(
  CRITICAL_CONTROLS_LIBRARY.map((c) => [c.id, c.label]),
);

/** Human label for a controlId; falls back to the id for unknown controls. */
export function getControlLabel(controlId: string): string {
  return LABEL_BY_CONTROL_ID[controlId] ?? controlId;
}

// ────────────────────────────────────────────────────────────────────────
// Validation in terreno
// ────────────────────────────────────────────────────────────────────────

export interface ControlValidation {
  controlId: string;
  /** Si el supervisor verificó presencia/estado. */
  present: boolean;
  validatedByUid: string;
  validatedAt: string;
  /** Foto / evidencia. */
  evidenceUrl?: string;
  notes?: string;
}

export interface PreTaskValidationResult {
  riskCategory: string;
  controlsRequired: number;
  controlsPresent: number;
  missing: CriticalControl[];
  /** % cobertura controles presentes. */
  coveragePercent: number;
  /** Si la jerarquía de controles está balanceada (no solo EPP). */
  isHierarchyBalanced: boolean;
  /** ¿Se autoriza iniciar la tarea? Verde solo si missing = [] AND balanced. */
  authorizedToStart: boolean;
  validatedByUid: string;
  validatedAt: string;
}

export function validatePreTask(
  riskCategory: string,
  validations: ControlValidation[],
  validatedByUid: string,
  now: Date = new Date(),
): PreTaskValidationResult {
  const required = getControlsForRisk(riskCategory);
  const presentSet = new Set(
    validations.filter((v) => v.present).map((v) => v.controlId),
  );
  const present = required.filter((c) => presentSet.has(c.id));
  const missing = required.filter((c) => !presentSet.has(c.id));

  // Hierarchy balance: si TODOS los controles presentes son nivel 'epp',
  // marcar como NO balanceado (es la auditoría de calidad §44 del doc
  // del usuario que detecta abuso de EPP).
  const levelsPresent = new Set(present.map((c) => c.level));
  const isHierarchyBalanced =
    levelsPresent.size > 1 ||
    (levelsPresent.size === 1 && !levelsPresent.has('epp'));

  return {
    riskCategory,
    controlsRequired: required.length,
    controlsPresent: present.length,
    missing,
    coveragePercent:
      required.length === 0
        ? 100
        : Math.round((present.length / required.length) * 100),
    isHierarchyBalanced,
    authorizedToStart: missing.length === 0 && isHierarchyBalanced,
    validatedByUid,
    validatedAt: now.toISOString(),
  };
}
