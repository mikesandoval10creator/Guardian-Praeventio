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
import { logger } from '../../utils/logger';

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
  /**
   * True cuando el preset se generó como fallback (prefix válido pero
   * sin mapeo específico). Telemetry consumers pueden alertar/filtrar
   * para detectar proyectos con subcobertura de riesgos/EPP del sector.
   */
  isFallback?: boolean;
  /**
   * [P0][VIDA-SAFETY] Hy3-audit 3c3aa66d-73fe-8102-9e44-e7f02d8152f0
   * (reabierto 2026-08-24): severity override por riskType. Si un riesgo
   * está aquí, su severity SIEMPRE se respeta (no cae al hardcodeado
   * "alta_tension" o "silice"). Permite declarar 'arco_electrico' = high,
   * 'espacio_confinado' = high, 'quimico' = high, etc. por sector.
   */
  severityOverrides?: Record<string, 'medium' | 'high'>;
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
    // [P0][VIDA-SAFETY] Hy3-audit 3c3aa66d-73fe-8102-9e44-e7f02d8152f0:
    // 'arco_electrico' caía a medium (no contiene 'alta_tension' como
    // substring y no es 'silice'/'altura' exacto). El preset declara
    // aquí la severidad correcta.
    severityOverrides: { arco_electrico: 'high' },
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

  // ── COMERCIO ── Trabajo en góndolas, carga manual, vehículos de reparto ──
  'GP-COM-MAY': {
    label: 'Comercio al por mayor y reparto (GP-COM-MAY)',
    typicalRisks: [
      'manejo_manual_carga_pesada',
      'caida_mismo_nivel_pisos_mojados',
      'atropello_vehiculo_reparto_patio',
      'fatiga_jornada_extendida',
    ],
    mandatoryDocuments: [
      'RIOHS',
      'Procedimiento Check Pre-Operacional Vehículos de Reparto',
      'Plan Trabajo Bodega / Carga Manual',
    ],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'manejo_manual_carga_25kg_por_persona',
      'manejo_defensivo_patio',
    ],
    applicableRegulations: ['DS 594', 'Ley 16.744'],
    minsalProtocols: ['TMERT_postura', 'PREXOR_ruido'],
  },
  'GP-COM-MEN': {
    label: 'Comercio al por menor (GP-COM-MEN)',
    typicalRisks: [
      'caida_mismo_nivel_pisos_mojados',
      'manejo_carga_gondola_altura',
      'estres_psicosocial_atencion_cliente',
    ],
    mandatoryDocuments: ['RIOHS', 'Plan Trabajo Local Comercial'],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'manejo_carga_gondola_8kg_mujeres_12kg_hombres',
    ],
    applicableRegulations: ['DS 594', 'Ley 16.744'],
    minsalProtocols: ['TMERT_postura'],
  },
  // ── TECNOLOGÍAS DE LA INFORMACIÓN (TI) ── Oficinas, datacenter, call center ──
  'GP-INF-TI': {
    label: 'Tecnologías de la información (GP-INF-TI)',
    typicalRisks: [
      'ergonomico_pantalla_postura',
      'electrico_baja_tension_datacenter',
      'estres_psicosocial_carga_mental',
      'sedentarismo_prolongado',
    ],
    mandatoryDocuments: [
      'RIOHS',
      'Plan Trabajo en Pantalla (DS 594 art. 95)',
      'Procedimiento Trabajo en Datacenter',
    ],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'ergonomia_trabajo_pantalla_4h',
      'electricidad_baja_tension_personal_no_electrico',
    ],
    applicableRegulations: ['DS 594', 'Ley 19.628'],
    minsalProtocols: ['TMERT_pantalla', 'PREXOR_carga_mental'],
  },
  // ── EDUCACIÓN ── Establecimientos educacionales (colegios, universidades) ──
  'GP-EDU-PRE': {
    label: 'Educación preescolar (GP-EDU-PRE)',
    typicalRisks: [
      'caida_mismo_nivel_pisos_mojados',
      'biologico_cambio_panales',
      'ergonomico_levantar_ninos',
    ],
    mandatoryDocuments: ['RIOHS', 'Plan Trabajo Establecimiento Educacional', 'Protocolo Bioseguridad'],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'manejo_ergonomico_cuidado_infantes',
      'bioseguridad_aula_inicial',
    ],
    applicableRegulations: ['DS 594', 'Ley 16.744'],
    minsalProtocols: ['TMERT_postura', 'PREXOR_riesgos_psicosociales'],
  },
  'GP-EDU-SUP': {
    label: 'Educación superior y universitaria (GP-EDU-SUP)',
    typicalRisks: [
      'ergonomico_pantalla_laboratorio',
      'quimico_reactivos_laboratorio',
      'estres_psicosocial_eval_docente',
    ],
    mandatoryDocuments: ['RIOHS', 'Plan Trabajo Campus Universitario', 'Plan Manejo Químicos'],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'bioseguridad_laboratorio_nivel_1',
      'manejo_quimicos_reactivos_compatibles',
    ],
    applicableRegulations: ['DS 594', 'Ley 16.744', 'DS 78'],
    minsalProtocols: ['PREXOR_riesgos_psicosociales', 'TMERT_postura_pantalla'],
  },
  // ── ALOJAMIENTO Y TURISMO ── Hoteles, restaurantes, actividades turísticas ──
  'GP-ALOJA-HOT': {
    label: 'Alojamiento / hoteles (GP-ALOJA-HOT)',
    typicalRisks: [
      'biologico_manipulacion_alimentos',
      'electrico_baja_tension_pisos_mojados',
      'caida_mismo_nivel_pisos_encerados',
      'quimico_productos_limpieza',
    ],
    mandatoryDocuments: [
      'RIOHS',
      'Plan Trabajo Alojamiento',
      'Plan HACCP / Manipulación Alimentos',
      'Procedimiento Trabajo Pisos Mojados',
    ],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'bioseguridad_manipulacion_alimentos_nivel_1',
      'manejo_quimicos_limpieza_seguros',
      'reba_basico_extintores',
    ],
    applicableRegulations: ['DS 594', 'Ley 16.744', 'DS 977'],
    minsalProtocols: ['PREXOR_riesgos_psicosociales', 'PREXOR_quimicos'],
  },
  // ── PROFESIONALES ── Oficinas profesionales (abogados, contadores, consultores) ──
  'GP-PRO-LEG': {
    label: 'Servicios jurídicos y notariales (GP-PRO-LEG)',
    typicalRisks: [
      'estres_psicosocial_alta_carga_mental',
      'ergonomico_pantalla_larga_duracion',
    ],
    mandatoryDocuments: ['RIOHS', 'Plan Trabajo Oficina'],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'ergonomia_trabajo_pantalla_4h',
      'prevencion_estres_laboral_oficina',
    ],
    applicableRegulations: ['DS 594', 'Ley 16.744'],
    minsalProtocols: ['TMERT_pantalla', 'PREXOR_riesgos_psicosociales'],
  },
  'GP-PRO-ARQING': {
    label: 'Arquitectura, ingeniería y actividades técnicas (GP-PRO-ARQING)',
    typicalRisks: [
      'altura_andamios_visitas_obra',
      'electrico_visita_instalaciones',
      'atropello_visita_faena',
      'ergonomico_pantalla_dibujo',
    ],
    mandatoryDocuments: [
      'RIOHS',
      'Procedimiento Visita a Faena',
      'Plan Trabajo Oficina Técnica',
    ],
    mandatoryTrainings: [
      'induccion_general_riesgos',
      'induccion_obra_visita_tecnica',
      'electricidad_baja_tension_basico',
    ],
    applicableRegulations: ['DS 594', 'Ley 16.744', 'DS 76'],
    minsalProtocols: ['TMERT_pantalla'],
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
      isFallback: false,
    };
  }
  // Fallback genérico
  logger.warn('industryRuleEngine: fallback preset used', {
    industryPrefix,
    reason: 'no specific preset mapped',
  });
  return {
    industryPrefix,
    label: `Genérico (${industryPrefix})`,
    typicalRisks: ['caida_mismo_nivel', 'manejo_carga', 'electrico'],
    mandatoryDocuments: ['RIOHS', 'ODI'],
    mandatoryTrainings: ['induccion_general'],
    baseEpp: epp.map((e) => e.label),
    applicableRegulations: ['DS 594', 'Ley 16.744'],
    minsalProtocols: [],
    isFallback: true,
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
      // [P0][VIDA-SAFETY] Hy3-audit 3c3aa66d-73fe-8102-9e44-e7f02d8152f0:
      // el severity override del preset tiene prioridad sobre el fallback
      // hardcodeado (alta_tension/silice/altura = high). Permite que
      // cada sector declare la severidad real de sus riesgos
      // (espacio_confinado=high, arco_electrico=high, etc.).
      severity:
        preset.severityOverrides?.[r] ??
        (r.includes('alta_tension') || r === 'silice' || r === 'altura' ? 'high' : 'medium'),
    })),
    documentsToGenerate: preset.mandatoryDocuments,
    trainingsToSchedule: preset.mandatoryTrainings,
    baseEppToAssign: preset.baseEpp,
    regulationsToLink: preset.applicableRegulations,
    protocolsToActivate: preset.minsalProtocols,
  };
}
