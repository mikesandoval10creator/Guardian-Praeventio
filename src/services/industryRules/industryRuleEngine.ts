// Praeventio Guard — Sprint 39 Fase J.1: Motor de Reglas por Industria.
//
// Cierra: Documento usuario "Recomendaciones nuevas §16"
//
// Cuando se crea un proyecto y se selecciona industria, automáticamente
// se activan:
//   - Riesgos típicos del sector
//   - Documentos obligatorios
//   - Capacitaciones mínimas
//   - EPP base
//   - Normativas aplicables
//   - Protocolos MINSAL específicos
//
// Es un "preset" determinístico que evita configuración manual repetitiva.

import { EPP_BY_SECTOR, EPP_DEFAULT } from '../../constants.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface IndustryPreset {
  /** Prefijo del sector (GP-MIN, GP-CONS, etc.). */
  industryPrefix: string;
  /** Display name del preset. */
  label: string;
  /** Riesgos típicos del sector (riskType strings). */
  typicalRisks: string[];
  /** Documentos obligatorios (templates a generar). */
  mandatoryDocuments: string[];
  /** Capacitaciones mínimas (training codes). */
  mandatoryTrainings: string[];
  /** EPP base (labels). */
  baseEpp: string[];
  /** Normativas chilenas aplicables. */
  applicableRegulations: string[];
  /** Protocolos MINSAL específicos. */
  minsalProtocols: string[];
}

const PRESETS: Record<string, Omit<IndustryPreset, 'industryPrefix' | 'baseEpp'>> = {
  'GP-MIN': {
    label: 'Minería (GP-MIN)',
    typicalRisks: ['silice', 'espacio_confinado', 'maquinaria_pesada', 'ruido', 'altura'],
    mandatoryDocuments: ['Plan Emergencia', 'RIOHS', 'DDR Específico Mina', 'Procedimiento Rescate Minero'],
    mandatoryTrainings: ['rescate_minero', 'espacios_confinados', 'exposicion_silice', 'manejo_explosivos'],
    applicableRegulations: ['DS 132', 'DS 594', 'Ley 16.744', 'Ley 17.336'],
    minsalProtocols: ['PREXOR_silice', 'PREXOR_ruido', 'TMERT_postura'],
  },
  'GP-CONS': {
    label: 'Construcción (GP-CONS)',
    typicalRisks: ['altura', 'electrico', 'caliente', 'cargas', 'caida_objetos'],
    mandatoryDocuments: ['Plan Seguridad de Obra', 'RIOHS', 'ODI', 'Procedimientos Críticos'],
    mandatoryTrainings: ['trabajo_altura_r1', 'rescate_altura_basico', 'manejo_cargas', 'electricidad_baja_tension'],
    applicableRegulations: ['DS 76', 'DS 594', 'Ley 20.123', 'Ley 16.744'],
    minsalProtocols: ['TMERT_carga', 'PREXOR_ruido'],
  },
  'GP-AGR': {
    label: 'Agricultura (GP-AGR)',
    typicalRisks: ['quimico_agroquimicos', 'uv', 'maquinaria_agricola', 'fauna', 'biologico'],
    mandatoryDocuments: ['Plan Trabajo Vendimia', 'RIOHS', 'DDR Aplicación Pesticidas'],
    mandatoryTrainings: ['hazmat_nivel_1', 'manejo_agroquimicos', 'radiacion_uv_ocupacional'],
    applicableRegulations: ['DS 78', 'DS 594', 'Ley 16.744'],
    minsalProtocols: ['UV_ocupacional', 'PREXOR_agroquimicos'],
  },
  'GP-TRANS': {
    label: 'Transporte (GP-TRANS)',
    typicalRisks: ['fatiga', 'ruido', 'jornada_nocturna', 'manejo_carga_vehicular'],
    mandatoryDocuments: ['Plan Conducción Segura', 'RIOHS', 'Procedimiento Check Pre-Operacional'],
    mandatoryTrainings: ['manejo_defensivo', 'mecánica_básica', 'rutas_seguras'],
    applicableRegulations: ['DS 594', 'Ley 18.290', 'Ley 16.744'],
    minsalProtocols: ['TMERT_postura_conductor'],
  },
  'GP-SAL': {
    label: 'Salud (GP-SAL)',
    typicalRisks: ['biologico', 'ergonomico_pacientes', 'quimico_desinfectantes', 'jornada_nocturna'],
    mandatoryDocuments: ['Plan Bioseguridad', 'RIOHS', 'Protocolo Manejo Residuos Médicos'],
    mandatoryTrainings: ['higiene_respiratoria', 'manejo_residuos_REAS', 'movilizacion_pacientes'],
    applicableRegulations: ['DS 6 (REAS)', 'DS 594', 'Ley 19.937', 'Ley 16.744'],
    minsalProtocols: ['Protocolo_TBC', 'Protocolo_Hepatitis_B'],
  },
  'GP-ELEC': {
    label: 'Energía/Eléctrica (GP-ELEC)',
    typicalRisks: ['electrico_alta_tension', 'electrico_baja_tension', 'caida_distinto_nivel', 'arco_electrico'],
    mandatoryDocuments: ['Plan LOTO', 'Procedimientos Arco Eléctrico', 'RIOHS'],
    mandatoryTrainings: ['electricidad_baja_tension', 'electricidad_alta_tension', 'loto_bloqueo', 'rescate_electrico'],
    applicableRegulations: ['DS 109', 'DS 132 baja tensión', 'Reglamento SEC', 'NFPA 70E'],
    minsalProtocols: [],
  },
  'GP-MANU': {
    label: 'Manufactura (GP-MANU)',
    typicalRisks: ['maquinaria_movil', 'ruido', 'quimico', 'ergonomico_repetitivo'],
    mandatoryDocuments: ['Plan Seguridad Operacional', 'RIOHS', 'Procedimientos LOTO'],
    mandatoryTrainings: ['operacion_maquinaria', 'loto_bloqueo', 'ergonomia_carga'],
    applicableRegulations: ['DS 594', 'Ley 16.744'],
    minsalProtocols: ['PREXOR_ruido', 'TMERT_repetitivo'],
  },
};

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

/**
 * Devuelve el preset completo para una industria. Si el prefijo no
 * coincide con un preset específico, devuelve un preset genérico.
 */
export function getIndustryPreset(industryPrefix: string): IndustryPreset {
  const preset = PRESETS[industryPrefix];
  const epp = EPP_BY_SECTOR[industryPrefix] ?? EPP_DEFAULT;
  if (preset) {
    return {
      industryPrefix,
      baseEpp: epp.map((e) => e.label),
      ...preset,
    };
  }
  // Fallback genérico
  return {
    industryPrefix,
    label: `Genérico (${industryPrefix})`,
    typicalRisks: ['caida_mismo_nivel', 'manejo_carga', 'electrico'],
    mandatoryDocuments: ['RIOHS', 'ODI'],
    mandatoryTrainings: ['induccion_general'],
    baseEpp: epp.map((e) => e.label),
    applicableRegulations: ['DS 594', 'Ley 16.744'],
    minsalProtocols: [],
  };
}

export function listIndustryPresets(): Array<{ prefix: string; label: string }> {
  return Object.keys(PRESETS).map((prefix) => ({
    prefix,
    label: PRESETS[prefix].label,
  }));
}

/**
 * Aplica el preset a un proyecto recién creado: devuelve la lista de
 * acciones a ejecutar (crear nodos, documentos, etc.). El caller las
 * persiste.
 */
export interface PresetApplication {
  projectId: string;
  industryPrefix: string;
  /** Riesgos a crear como NodeType.RISK. */
  risksToCreate: Array<{ riskType: string; severity: 'medium' | 'high' }>;
  /** Documentos a generar (templates). */
  documentsToGenerate: string[];
  /** Capacitaciones a programar para nuevos workers. */
  trainingsToSchedule: string[];
  /** EPP base que se debe entregar. */
  baseEppToAssign: string[];
  /** Normativas a vincular vía edge 'regulates'. */
  regulationsToLink: string[];
  /** Protocolos MINSAL. */
  protocolsToActivate: string[];
}

export function buildPresetApplication(
  projectId: string,
  industryPrefix: string,
): PresetApplication {
  const preset = getIndustryPreset(industryPrefix);
  return {
    projectId,
    industryPrefix,
    risksToCreate: preset.typicalRisks.map((r) => ({
      riskType: r,
      severity: r.includes('alta_tension') || r === 'silice' || r === 'altura' ? 'high' : 'medium',
    })),
    documentsToGenerate: preset.mandatoryDocuments,
    trainingsToSchedule: preset.mandatoryTrainings,
    baseEppToAssign: preset.baseEpp,
    regulationsToLink: preset.applicableRegulations,
    protocolsToActivate: preset.minsalProtocols,
  };
}
