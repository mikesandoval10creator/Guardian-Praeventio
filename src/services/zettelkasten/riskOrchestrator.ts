// Praeventio Guard — Sprint 39 Fase B.8: Risk → EPP → Training orchestrator.
//
// Cuando se crea un nodo NodeType.RISK con metadatos `riskType` y/o
// `industry`, este orchestrator deriva sugerencias automáticas:
//
//   1. EPP requerido (vía `requires` edge desde RISK)
//   2. Training requerido (vía `requires` edge desde RISK)
//   3. Si el riesgo tiene `assignedWorkers`, también edges
//      `WORKER missing TRAINING` para los que no la tengan vigente.
//
// Cierra: Documento usuario "Ideas implementables §2.2"
//
// Diseño:
//   - Es PURO: el orchestrator NO escribe a Firestore. Devuelve la lista
//     de edges sugeridos. El caller decide persistirlos vía `edges.ts`.
//   - Mapeo riskType → EPP/Training es una tabla determinística, no
//     LLM. Las reglas son simples (regex sobre el descriptor del
//     riesgo). El LLM puede sumar sugerencias en una fase posterior.

import type { EdgeType } from './edges.js';
import { EPP_BY_SECTOR, EPP_DEFAULT } from '../../constants.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface RiskOrchestratorInput {
  /** ID del nodo RISK recién creado. */
  riskNodeId: string;
  /** Descriptor canónico del riesgo (lowercase recomendado). */
  riskType: string;
  /** Prefijo del sector (GP-MIN, GP-CONS, etc.) — usado para EPP base. */
  industryPrefix?: string;
  /** UIDs de trabajadores ya asignados al riesgo (si existe la info). */
  assignedWorkers?: Array<{ uid: string; activeTrainings: string[] }>;
}

export interface EdgeSuggestion {
  /** Origen y destino conceptuales — el caller los resuelve a node IDs reales. */
  fromNodeId: string;
  toNodeRef: NodeReference;
  type: EdgeType;
  /** Por qué se sugiere — útil para UI "explicabilidad de recomendaciones". */
  rationale: string;
}

/**
 * Referencia conceptual a un nodo. El caller resuelve a un ID real:
 *   - Si ya existe un nodo del catálogo con ese `kind:label`, usar su ID.
 *   - Si no, crear uno y luego materializar el edge.
 */
export interface NodeReference {
  kind: 'EPP' | 'TRAINING' | 'WORKER';
  /** Para EPP: label como aparece en EPP_BY_SECTOR ("Arnés seguridad").
   *  Para TRAINING: código canónico del curso ("trabajo_altura_r1").
   *  Para WORKER: el uid directamente. */
  label: string;
}

// ────────────────────────────────────────────────────────────────────────
// Catálogo de mapeos (riesgo → controles)
//
// Cada regla declara:
//   - patrón (substring case-insensitive sobre riskType)
//   - lista de EPP labels que el riesgo REQUIERE
//   - lista de TRAINING codes que el riesgo REQUIERE
//   - rationale para UI
//
// Las reglas son LITERALES y se evalúan en orden. La primera que matchea
// gana. Una regla puede contribuir EPP y/o trainings.
//
// Mantenibilidad: agregar nuevos riesgos aquí es 4 líneas; un PR pequeño.
// ────────────────────────────────────────────────────────────────────────

interface RiskRule {
  pattern: RegExp;
  eppLabels: string[];
  trainingCodes: string[];
  rationale: string;
}

const RISK_RULES: RiskRule[] = [
  {
    // Trabajo en altura (>1.8m) — DS 594 art. 53 + DS 76
    pattern: /altura|caida.*distinto.*nivel|caida.*altura|trabajo.*altura/i,
    eppLabels: ['Arnés seguridad', 'Casco', 'Botas punta acero', 'Lentes'],
    trainingCodes: ['trabajo_altura_r1', 'rescate_altura_basico'],
    rationale: 'Riesgo de caída de altura — DS 594 art. 53 exige arnés y capacitación específica',
  },
  {
    // Espacios confinados — DS 132 + protocolo MINSAL
    pattern: /confinado|espacio.*confinado/i,
    eppLabels: ['Respirador gases', 'Casco', 'Lentes', 'Guantes'],
    trainingCodes: ['espacios_confinados', 'rescate_confinados'],
    rationale: 'Espacio confinado — DS 132 obliga capacitación de rescate + respirador con suministro',
  },
  {
    // Trabajo en caliente — DS 132
    pattern: /caliente|soldadura|corte|chispa/i,
    eppLabels: ['Careta facial', 'Guantes', 'Traje arco eléctrico', 'Botas'],
    trainingCodes: ['trabajo_caliente', 'extincion_incendios'],
    rationale: 'Trabajo en caliente — DS 132 exige permiso + capacitación contra incendios',
  },
  {
    // Exposición eléctrica — DS 132 baja tensión + DS 109
    pattern: /electric|tension|loto|bloqueo.*energ/i,
    eppLabels: ['Casco dieléctrico', 'Guantes aislantes', 'Botas dieléctricas', 'Careta facial'],
    trainingCodes: ['electricidad_baja_tension', 'loto_bloqueo'],
    rationale: 'Exposición eléctrica — DS 132 baja tensión obliga LOTO + EPP dieléctrico certificado',
  },
  {
    // Sílice — Ley 16.744 + DS 594 + protocolo MINSAL
    pattern: /silice|silicosis|polvo.*respirable/i,
    eppLabels: ['Respirador gases', 'Mascarilla N95', 'Lentes'],
    trainingCodes: ['exposicion_silice', 'higiene_respiratoria'],
    rationale: 'Exposición a sílice — Protocolo MINSAL exige vigilancia médica + respirador',
  },
  {
    // Hazmat / sustancias peligrosas — DS 78
    pattern: /hazmat|sustancia.*peligrosa|quimico|toxico|gas/i,
    eppLabels: ['Respirador gases', 'Traje protección química', 'Guantes', 'Lentes', 'Botas'],
    trainingCodes: ['hazmat_nivel_1', 'derrames_quimicos'],
    rationale: 'Manejo de sustancias peligrosas — DS 78 + Ley 20.123',
  },
  {
    // Manejo manual de cargas — Ley 20.949
    pattern: /carga|levantamiento|manejo.*manual|ergonom/i,
    eppLabels: ['Guantes', 'Botas punta acero', 'Faja lumbar'],
    trainingCodes: ['ergonomia_carga', 'reba_basico'],
    rationale: 'Manejo manual de cargas — Ley 20.949 limita 25kg + capacitación REBA',
  },
  {
    // Ruido — DS 594
    pattern: /ruido|exposicion.*sonora|decibeles/i,
    eppLabels: ['Protec. auditivo'],
    trainingCodes: ['exposicion_ruido'],
    rationale: 'Exposición a ruido — DS 594 obliga protector auditivo sobre 85 dB(A)',
  },
  {
    // Radiación UV — protocolo MINSAL
    pattern: /uv|radiacion.*solar|exposicion.*solar/i,
    eppLabels: ['Lentes', 'Casco', 'Bloqueador solar', 'Manga larga'],
    trainingCodes: ['radiacion_uv_ocupacional'],
    rationale: 'Radiación UV — Protocolo MINSAL exposición ocupacional al sol',
  },
];

// ────────────────────────────────────────────────────────────────────────
// API principal
// ────────────────────────────────────────────────────────────────────────

/**
 * Calcula las sugerencias de edges para un nodo RISK recién creado.
 *
 * Estrategia:
 *   1. Match contra `RISK_RULES` por `riskType`. Suma EPP + trainings
 *      de la primera regla que matchea.
 *   2. Si no matchea ninguna regla específica, usa el EPP del
 *      `industryPrefix` (sector) — fallback genérico.
 *   3. Para cada `assignedWorker` sin el training en `activeTrainings`,
 *      sugiere edge `WORKER assigned_to TRAINING` (label "missing"
 *      implícito en la ausencia del training propio del worker).
 */
/** Strip diacritics so /electric/i matches "eléctrico" etc. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function suggestEdgesForRisk(input: RiskOrchestratorInput): EdgeSuggestion[] {
  const normalized = normalize(input.riskType);
  const matched = RISK_RULES.find((r) => r.pattern.test(normalized));
  const suggestions: EdgeSuggestion[] = [];

  // 1. EPP requirements
  const eppLabels = matched
    ? matched.eppLabels
    : eppLabelsForIndustry(input.industryPrefix);
  for (const label of eppLabels) {
    suggestions.push({
      fromNodeId: input.riskNodeId,
      toNodeRef: { kind: 'EPP', label },
      type: 'requires',
      rationale:
        matched?.rationale ??
        `EPP recomendado por sector ${input.industryPrefix ?? 'genérico'}`,
    });
  }

  // 2. Training requirements (solo si match específico)
  if (matched) {
    for (const code of matched.trainingCodes) {
      suggestions.push({
        fromNodeId: input.riskNodeId,
        toNodeRef: { kind: 'TRAINING', label: code },
        type: 'requires',
        rationale: matched.rationale,
      });
    }
  }

  // 3. Workers que no tienen los trainings requeridos
  if (matched && input.assignedWorkers) {
    for (const w of input.assignedWorkers) {
      for (const code of matched.trainingCodes) {
        if (!w.activeTrainings.includes(code)) {
          // Conceptualmente: WORKER assigned_to TRAINING que aún no tiene.
          // El caller crea el edge si el TRAINING node existe, y un
          // nodo FINDING "training_gap" para tracking.
          suggestions.push({
            fromNodeId: w.uid,
            toNodeRef: { kind: 'TRAINING', label: code },
            type: 'assigned_to',
            rationale: `Trabajador ${w.uid} no tiene training '${code}' vigente para este riesgo`,
          });
        }
      }
    }
  }

  return suggestions;
}

function eppLabelsForIndustry(prefix?: string): string[] {
  if (!prefix) return EPP_DEFAULT.map((e) => e.label);
  const found = EPP_BY_SECTOR[prefix];
  return (found ?? EPP_DEFAULT).map((e) => e.label);
}

// ────────────────────────────────────────────────────────────────────────
// Zettelkasten 2: Riesgo sin control = norma exigible violada
//
// Catálogo riesgo → norma + control sugerido + efectividad estimada.
// Usado por `detectUncontrolledRisks` para generar alertas OFFLINE
// cuando un nodo RIESGO no tiene ningún nodo CONTROL que lo mitigue.
// ────────────────────────────────────────────────────────────────────────

export interface RiskNormEntry {
  /** Patrón para matchear contra riskType normalizado. */
  pattern: RegExp;
  /** Código/clave de la norma chilena que exige el control. */
  normCode: string;
  /** Artículo o sección específica de la norma. */
  normArticle: string;
  /** Descripción legible de la medida exigida. */
  requiredMeasure: string;
  /** Control sugerido para mitigar el riesgo (label del nodo CONTROL). */
  suggestedControl: string;
  /** Efectividad estimada del control (0–100). */
  estimatedEffectiveness: number;
  /** Severidad si no se controla (para priorización en UI). */
  uncontrolledSeverity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Catálogo central: riesgo → norma chilena que exige control.
 *
 * Cada entrada declara qué norma exige qué medida y con qué efectividad
 * estimada se mitiga el riesgo si se implementa el control. El orden
 * importa: la primera regla que matchea gana.
 */
export const RISK_NORM_CATALOG: RiskNormEntry[] = [
  {
    pattern: /altura|caida.*distinto.*nivel|caida.*altura|trabajo.*altura/i,
    normCode: 'DS 594',
    normArticle: 'Art. 53',
    requiredMeasure: 'Protección contra caídas en trabajo sobre 1.80 m: barandas, redes o arnés con línea de vida',
    suggestedControl: 'Arnés con línea de vida + barandas perimetrales',
    estimatedEffectiveness: 92,
    uncontrolledSeverity: 'critical',
  },
  {
    pattern: /confinado|espacio.*confinado/i,
    normCode: 'DS 132',
    normArticle: 'Art. 8',
    requiredMeasure: 'Permiso de entrada, vigilante externo, detector de gases y respirador autónomo para espacios confinados',
    suggestedControl: 'Permiso de entrada + vigilante + detector de gases + SCBA',
    estimatedEffectiveness: 95,
    uncontrolledSeverity: 'critical',
  },
  {
    pattern: /caliente|soldadura|corte|chispa/i,
    normCode: 'DS 132',
    normArticle: 'Art. 10',
    requiredMeasure: 'Permiso de trabajo en caliente, extintor a ≤5 m, cortafuegos y vigilancia post-trabajo 30 min',
    suggestedControl: 'Permiso trabajo en caliente + extintor + cortafuegos + vigilancia 30 min',
    estimatedEffectiveness: 88,
    uncontrolledSeverity: 'high',
  },
  {
    pattern: /electric|tension|loto|bloqueo.*energ/i,
    normCode: 'DS 132',
    normArticle: 'Art. 12–14',
    requiredMeasure: 'Bloqueo/etiquetado (LOTO), EPP dieléctrico certificado, herramientas aisladas 1000 V',
    suggestedControl: 'LOTO + EPP dieléctrico certificado + herramientas aisladas',
    estimatedEffectiveness: 96,
    uncontrolledSeverity: 'critical',
  },
  {
    pattern: /silice|silicosis|polvo.*respirable/i,
    normCode: 'DS 594 + Protocolo MINSAL',
    normArticle: 'Art. 41 + Res. Ex. MINSAL',
    requiredMeasure: 'Control de exposición a sílice: ventilación, supresión de polvo, respirador N95/P100, vigilancia médica anual',
    suggestedControl: 'Extracción localizada + supresión húmeda + respirador P100 + vigilancia médica',
    estimatedEffectiveness: 85,
    uncontrolledSeverity: 'high',
  },
  {
    pattern: /hazmat|sustancia.*peligrosa|quimico|toxico|\bgas\b/i,
    normCode: 'DS 78',
    normArticle: 'Art. 1–15',
    requiredMeasure: 'Hojas de seguridad SDS, EPP químico, ducha/ lavaojos a ≤15 m, capacitación HazMat',
    suggestedControl: 'SDS accesible + EPP químico + ducha/lavaojos + capacitación HazMat Nivel 1',
    estimatedEffectiveness: 90,
    uncontrolledSeverity: 'high',
  },
  {
    pattern: /carga|levantamiento|manejo.*manual|ergonom/i,
    normCode: 'Ley 20.949',
    normArticle: 'Art. 76 bis',
    requiredMeasure: 'Límite 25 kg por persona, equipos mecánicos auxiliares, evaluación REBA/RULA',
    suggestedControl: 'Elevador mecánico + evaluación REBA + rotación de tareas',
    estimatedEffectiveness: 78,
    uncontrolledSeverity: 'medium',
  },
  {
    pattern: /ruido|exposicion.*sonora|decibeles/i,
    normCode: 'DS 594',
    normArticle: 'Art. 38–40',
    requiredMeasure: 'Protección auditiva obligatoria sobre 85 dB(A), programa de conservación auditiva, dosimetría',
    suggestedControl: 'Protectores auditivos + encerramiento fuente + programa conservación auditiva',
    estimatedEffectiveness: 82,
    uncontrolledSeverity: 'medium',
  },
  {
    pattern: /uv|radiacion.*solar|exposicion.*solar/i,
    normCode: 'Protocolo MINSAL',
    normArticle: 'Res. Ex. MINSAL 2019',
    requiredMeasure: 'Protección solar: bloqueador FPS 30+, ropa UPF, pausas en sombra cada 2 h',
    suggestedControl: 'Bloqueador FPS 30+ + ropa UPF + pausas en sombra + hidratación',
    estimatedEffectiveness: 75,
    uncontrolledSeverity: 'low',
  },
  {
    pattern: /incendio|fuego|combustible/i,
    normCode: 'DS 132',
    normArticle: 'Art. 5–7',
    requiredMeasure: 'Detectores de humo, extintores según riesgo, plan de evacuación, brigada capacitada',
    suggestedControl: 'Detección temprana + extintores ABC + plan evacuación + brigada',
    estimatedEffectiveness: 90,
    uncontrolledSeverity: 'critical',
  },
  {
    pattern: /caida.*plano|resbalon|pisada|superficie/i,
    normCode: 'DS 594',
    normArticle: 'Art. 25–27',
    requiredMeasure: 'Pisos antideslizantes, señalización de húmedo, pasillos libres de obstáculos, iluminación ≥100 lux',
    suggestedControl: 'Pisos antideslizantes + señalización + iluminación adecuada + orden y limpieza',
    estimatedEffectiveness: 80,
    uncontrolledSeverity: 'medium',
  },
  {
    pattern: /aplastamiento|atrapamiento|maquinaria|prensa|volcadura/i,
    normCode: 'DS 594',
    normArticle: 'Art. 48–52',
    requiredMeasure: 'Resguardos de máquinas, paradas de emergencia, bloqueo/etiquetado, capacitación operador',
    suggestedControl: 'Resguardos físicos + parada emergencia + LOTO + capacitación operador',
    estimatedEffectiveness: 94,
    uncontrolledSeverity: 'critical',
  },
  {
    pattern: /vehicular|transito|atropello|vehiculo|maquinaria.*movil/i,
    normCode: 'DS 594',
    normArticle: 'Art. 29–31',
    requiredMeasure: 'Separación peatón-vehículo, señalización, chaleco reflectante, espejos en esquinas',
    suggestedControl: 'Barrera peatonal + señalización vial + chaleco reflectante + demarcación',
    estimatedEffectiveness: 85,
    uncontrolledSeverity: 'high',
  },
  {
    pattern: /biologic|bacteria|virus|hongos|parasito|legionella/i,
    normCode: 'DS 594 + Ley 16.744',
    normArticle: 'Art. 41 + Art. 53',
    requiredMeasure: 'Vacunación, EPP biológico, protocolo de exposición a fluidos corporales, vigilancia epidemiológica',
    suggestedControl: 'Vacunación + EPP biológico + protocolo BEP + vigilancia epidemiológica',
    estimatedEffectiveness: 88,
    uncontrolledSeverity: 'high',
  },
  {
    pattern: /psicosocial|estres|acoso|violencia|sobrecarga|burnout/i,
    normCode: 'Ley 21.643',
    normArticle: 'Art. 154 bis',
    requiredMeasure: 'Evaluación de factores psicosociales, protocolo de acoso, límite de horas extraordinarias',
    suggestedControl: 'Evaluación psicosocial + protocolo acoso + gestión de carga laboral',
    estimatedEffectiveness: 70,
    uncontrolledSeverity: 'medium',
  },
  {
    pattern: /calor|golpe.*calor|deshidratacion|termico/i,
    normCode: 'DS 594 + Protocolo MINSAL',
    normArticle: 'Art. 41 + Res. Ex.',
    requiredMeasure: 'Hidratación obligatoria, pausas en sombra, aclimatación, ropa transpirable',
    suggestedControl: 'Hidratación + pausas sombra + aclimatación progresiva + ropa ligera',
    estimatedEffectiveness: 80,
    uncontrolledSeverity: 'medium',
  },
  {
    pattern: /vibracion|vibro/i,
    normCode: 'DS 594',
    normArticle: 'Art. 41',
    requiredMeasure: 'Límites de exposición a vibración mano-brazo y cuerpo entero, rotación, equipos antivibrátiles',
    suggestedControl: 'Herramientas antivibrátiles + rotación + guantes amortiguadores',
    estimatedEffectiveness: 75,
    uncontrolledSeverity: 'medium',
  },
];

export interface UncontrolledRiskAlert {
  /** ID del nodo RIESGO sin control. */
  riskNodeId: string;
  /** Título del riesgo (para UI). */
  riskTitle: string;
  /** Código de la norma violada. */
  normCode: string;
  /** Artículo específico. */
  normArticle: string;
  /** Medida exigida por la norma. */
  requiredMeasure: string;
  /** Control sugerido para mitigar. */
  suggestedControl: string;
  /** Efectividad estimada del control (0–100). */
  estimatedEffectiveness: number;
  /** Severidad si sigue sin controlar. */
  uncontrolledSeverity: 'low' | 'medium' | 'high' | 'critical';
  /** Mensaje de alerta formateado para UI. */
  alertMessage: string;
}

/**
 * Detecta nodos RIESGO que no tienen ningún nodo CONTROL conectado
 * vía edge `mitigates` (incoming al riesgo = CONTROL → RISK).
 *
 * Para cada riesgo sin control, genera una alerta con la cita normativa
 * y el control sugerido con efectividad estimada.
 *
 * Función PURA: no escribe a Firestore, no llama LLM. 100% OFFLINE.
 *
 * @param risks - Nodos de tipo RISK (o con type/riskType que matchee el catálogo)
 * @param riskNodeIdsWithMitigatingControl - Set de IDs de riesgos que YA tienen al menos un CONTROL conectado vía `mitigates`
 */
export function detectUncontrolledRisks(
  risks: Array<{ id: string; title: string; type?: string; metadata?: Record<string, any> }>,
  riskNodeIdsWithMitigatingControl: Set<string>,
): UncontrolledRiskAlert[] {
  const alerts: UncontrolledRiskAlert[] = [];

  for (const risk of risks) {
    // Si ya tiene un control que lo mitigue, no hay alerta
    if (riskNodeIdsWithMitigatingControl.has(risk.id)) continue;

    // Buscar la entrada del catálogo por riskType o type
    const riskDescriptor = risk.type ?? risk.metadata?.riskType ?? risk.title ?? '';
    const normalized = normalize(riskDescriptor);
    const entry = RISK_NORM_CATALOG.find((e) => e.pattern.test(normalized));

    if (entry) {
      alerts.push({
        riskNodeId: risk.id,
        riskTitle: risk.title,
        normCode: entry.normCode,
        normArticle: entry.normArticle,
        requiredMeasure: entry.requiredMeasure,
        suggestedControl: entry.suggestedControl,
        estimatedEffectiveness: entry.estimatedEffectiveness,
        uncontrolledSeverity: entry.uncontrolledSeverity,
        alertMessage: `RIESGO SIN CONTROL — ${entry.normCode} ${entry.normArticle} exige: ${entry.requiredMeasure}. Control sugerido: ${entry.suggestedControl} (efectividad estimada: ${entry.estimatedEffectiveness}%)`,
      });
    } else {
      // Riesgo no catalogado → alerta genérica con DS 594 como base
      alerts.push({
        riskNodeId: risk.id,
        riskTitle: risk.title,
        normCode: 'DS 594',
        normArticle: 'Art. 3 inc. 2',
        requiredMeasure: 'Identificar y controlar todo riesgo según jerarquía de controles (eliminación → sustitución → ingeniería → administrativos → EPP)',
        suggestedControl: 'Evaluar e implementar controles según jerarquía de la DS 594',
        estimatedEffectiveness: 50,
        uncontrolledSeverity: 'medium',
        alertMessage: `RIESGO SIN CONTROL — DS 594 Art. 3 inc. 2 exige identificar y controlar todo riesgo. Evaluar e implementar controles según jerarquía (efectividad estimada: 50%)`,
      });
    }
  }

  // Ordenar por severidad: critical > high > medium > low
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => severityOrder[a.uncontrolledSeverity] - severityOrder[b.uncontrolledSeverity]);

  return alerts;
}
