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
