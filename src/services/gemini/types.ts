// Praeventio Guard — §12.5.1 split step 17: shared contract for the
// AI Hub predictive incidents endpoint.
//
// WHY THIS FILE EXISTS
// --------------------
// `predictGlobalIncidentsImpl` (risk.ts) consumed por la UI en
// `components/ai/PredictiveAnalysis.tsx`. Antes de este contrato cada
// lado definía su propio shape y la UI renderizaba `undefined%` y
// probabilidades del LLM (Alta/Media/Baja) como si fueran % calibrados.
//
// Este módulo es EL ÚNICO contrato frontend/backend para el shape
// devuelto por `predictGlobalIncidents`. Types TS simples (el repo no
// usa Zod para estos shapes — patrón observado en predictions.ts,
// emergency.ts).

import { AI_MODEL_FAST } from '../../config/aiModels';

/**
 * Mapeo de etiquetas cualitativas del LLM a valores numéricos (0-100).
 *
 * Alta = 70, Media = 40, Baja = 15. Estos valores son heurísticos y, por
 * lo tanto, NO calibrados estadísticamente. El disclaimer en el contrato
 * principal lo hace explícito al UI.
 */
export const PROBABILIDAD_MAP: Record<'Alta' | 'Media' | 'Baja', number> = {
  Alta: 70,
  Media: 40,
  Baja: 15,
};

/**
 * Orden de severidad para criticidad. Las keys coinciden con las labels
 * femeninas que el LLM devuelve ('Alta'/'Media'/'Baja'). El nivel de
 * riesgo global ('Alto'/'Medio'/'Bajo'/'Crítico') se deriva de este orden.
 * 'Crítico' no lo devuelve el LLM — se eleva cuando criticidad 'Alta'
 * AND probabilidad 'Alta'.
 */
export const CRITICIDAD_ORDEN: Record<'Alta' | 'Media' | 'Baja', number> = {
  Baja: 1,
  Media: 2,
  Alta: 3,
};

export type ProbabilidadLabel = 'Alta' | 'Media' | 'Baja';
export type CriticidadLabel = 'Alta' | 'Media' | 'Baja';

export interface PrediccionIncidente {
  /** ID del nodo del grafo de riesgos al que se refiere (opcional). */
  nodoId?: string;
  /** Título corto de la predicción. */
  titulo: string;
  /** Razón / descripción detallada de la predicción. */
  razon: string;
  /** Acción preventiva sugerida por el LLM. */
  mitigacionSugerida: string;
  /** Fundamento legal aplicable (string vacío si no hay dato). */
  fundamentoLegal?: string;
  /** Criticidad declarada por el LLM. */
  criticidad: CriticidadLabel;
  /** Probabilidad cualitativa declarada por el LLM. */
  probabilidad: ProbabilidadLabel;
}

export interface PredictiveIncidentResult {
  /**
   * Probabilidad global agregada (0-100). Derivada del promedio de las
   * predicciones individuales mapeando Alta/Media/Baja → 70/40/15.
   * NO calibrada estadísticamente — ver `disclaimer`.
   */
  probabilidadGlobal: number;
  /**
   * Nivel de riesgo global. Máximo entre las criticidades de las
   * predicciones. 'Crítico' solo si hay alguna predicción con criticidad
   * 'Alta' AND probabilidad 'Alta'.
   */
  nivelRiesgo: 'Bajo' | 'Medio' | 'Alto' | 'Crítico';
  /**
   * Confianza de la IA (0-100). Valor fijo bajo (30) para hacer evidente
   * que NO está calibrada. Ver `disclaimer`.
   */
  confianza: number;
  /** Predicciones individuales del LLM, reshapes al contrato de la UI. */
  predicciones: PrediccionIncidente[];
  /** Timestamp ISO-8601 de cuando se generó la predicción. */
  generatedAt: string;
  /** SKU del modelo Gemini que produjo la respuesta. */
  modelVersion: string;
  /** Disclaimer literal — debe mostrarse SIEMPRE en la UI. */
  disclaimer: string;
}

/** Disclaimer literal requerido por el ticket. */
export const DISCLAIMER_AI_HUB =
  'Asistencia IA, no decisión. Probabilidades no calibradas.' as const;

/** Modelo usado por `predictGlobalIncidents`. */
export const MODEL_VERSION_AI_HUB = AI_MODEL_FAST;
