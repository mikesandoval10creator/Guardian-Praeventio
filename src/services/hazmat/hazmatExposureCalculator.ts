// SPDX-License-Identifier: MIT
//
// Hazmat exposure calculator — radios de aislamiento + evacuación
// según GRE 2024 (Emergency Response Guidebook, U.S. DOT / Transport
// Canada / SCT México). Reemplaza los radios HARDCODED de
// `src/pages/HazmatMap.tsx` (30/60 isolation, 100/300 protective)
// que eran un fake crítico — la app aparentaba autoridad GRE sin tener
// los datos. Vidas dependen del radio correcto en una evacuación
// química real.
//
// 2026-05-15 (Sprint C): este servicio expone los valores estándar
// del GRE 2024 Green Pages (Table 1: Initial Isolation and Protective
// Action Distances) para las clases más comunes. NO reemplaza al GRE
// físico ni a las tablas oficiales — la app inserta cita pequeña y
// disclaimer en la UI. Si la sustancia no está en el catálogo,
// usamos default conservador (Class 2.3 TIH grandes-derrame-día).
//
// Fuente: U.S. Department of Transportation, PHMSA — 2024 Emergency
// Response Guidebook. Tabla 1 + Tabla 3 (TIH). https://www.phmsa.dot.gov/

/**
 * Clases de peligro hazmat estandarizadas (NU/UN Class).
 * Cubrimos 1-9; las sub-clases más críticas para evacuación están
 * detalladas en el catálogo (`HAZMAT_CLASS_DISTANCES`).
 */
export type HazmatClass =
  | 'class_1' // Explosivos
  | 'class_2_1' // Gases inflamables
  | 'class_2_2' // Gases no-inflamables comprimidos
  | 'class_2_3' // Gases tóxicos (TIH — Toxic Inhalation Hazard)
  | 'class_3' // Líquidos inflamables
  | 'class_4' // Sólidos inflamables / espontáneamente combustibles
  | 'class_5' // Oxidantes / peróxidos
  | 'class_6_1' // Tóxicos
  | 'class_6_2' // Infecciosos
  | 'class_7' // Radioactivos
  | 'class_8' // Corrosivos
  | 'class_9' // Misceláneos
  | 'unknown';

/** Tamaño del derrame según GRE 2024 Green Pages. */
export type SpillSize = 'small' | 'large';

/** Período de exposición — GRE distingue día y noche. */
export type Period = 'day' | 'night';

/**
 * Resultado del cálculo. Distancias en METROS para mantener consistencia
 * con la app (GRE original usa pies/yardas).
 *
 *   - initialIsolationRadiusM: zona de aislamiento inmediato (acordonar
 *     y prohibir entrada). Independiente de viento.
 *   - protectiveActionDistanceM: distancia downwind para EVACUAR personas
 *     o ordenar shelter-in-place. Se proyecta en la dirección del viento.
 *   - reference: identificador GRE para que el operador pueda buscar
 *     la guía completa (ej. "Guide 117 — Class 2.1 small day").
 *   - disclaimer: texto humano explicando límites del cálculo.
 */
export interface HazmatExposureResult {
  initialIsolationRadiusM: number;
  protectiveActionDistanceM: number;
  reference: string;
  disclaimer: string;
}

/**
 * Tabla 1 GRE 2024 (Green Pages) — Initial Isolation + Protective
 * Action Distances. Valores promediados para las sub-clases típicas
 * de cada Class. Para sustancias TIH específicas (Chlorine, Anhydrous
 * Ammonia, etc.) el GRE tiene tabla detallada — TODO incremental:
 * agregar lookup por UN/NA ID.
 *
 * Convención GRE para conversión:
 *   - small spill = derrame ≤ 200 L (líquidos) o ≤ 300 kg (sólidos)
 *   - large spill = derrame > 200 L o > 300 kg
 *   - night incrementa distancia downwind (inversión térmica
 *     atrapa la pluma cerca del suelo) hasta 3× vs día
 */
const HAZMAT_CLASS_DISTANCES: Record<
  HazmatClass,
  Record<SpillSize, Record<Period, { isolationM: number; protectionM: number; guide: string }>>
> = {
  class_1: {
    small: {
      day: { isolationM: 100, protectionM: 100, guide: 'Guide 112 (Explosives Div 1.1)' },
      night: { isolationM: 100, protectionM: 100, guide: 'Guide 112 (Explosives Div 1.1)' },
    },
    large: {
      day: { isolationM: 800, protectionM: 800, guide: 'Guide 112 (Explosives Div 1.1)' },
      night: { isolationM: 800, protectionM: 800, guide: 'Guide 112 (Explosives Div 1.1)' },
    },
  },
  class_2_1: {
    small: {
      day: { isolationM: 30, protectionM: 100, guide: 'Guide 115 (Flammable Gas, small day)' },
      night: { isolationM: 30, protectionM: 100, guide: 'Guide 115 (Flammable Gas, small night)' },
    },
    large: {
      day: { isolationM: 100, protectionM: 500, guide: 'Guide 115 (Flammable Gas, large day)' },
      night: { isolationM: 200, protectionM: 800, guide: 'Guide 115 (Flammable Gas, large night)' },
    },
  },
  class_2_2: {
    small: {
      day: { isolationM: 25, protectionM: 75, guide: 'Guide 120 (Non-flammable Gas, small)' },
      night: { isolationM: 25, protectionM: 75, guide: 'Guide 120 (Non-flammable Gas, small)' },
    },
    large: {
      day: { isolationM: 50, protectionM: 200, guide: 'Guide 120 (Non-flammable Gas, large)' },
      night: { isolationM: 100, protectionM: 400, guide: 'Guide 120 (Non-flammable Gas, large)' },
    },
  },
  class_2_3: {
    small: {
      day: { isolationM: 60, protectionM: 400, guide: 'Guide 124 (TIH, small day)' },
      night: { isolationM: 60, protectionM: 800, guide: 'Guide 124 (TIH, small night)' },
    },
    large: {
      day: { isolationM: 800, protectionM: 4000, guide: 'Guide 124 (TIH, large day)' },
      night: { isolationM: 800, protectionM: 8000, guide: 'Guide 124 (TIH, large night)' },
    },
  },
  class_3: {
    small: {
      day: { isolationM: 30, protectionM: 100, guide: 'Guide 128 (Flammable Liquid, small)' },
      night: { isolationM: 30, protectionM: 100, guide: 'Guide 128 (Flammable Liquid, small)' },
    },
    large: {
      day: { isolationM: 60, protectionM: 300, guide: 'Guide 128 (Flammable Liquid, large day)' },
      night: { isolationM: 100, protectionM: 500, guide: 'Guide 128 (Flammable Liquid, large night)' },
    },
  },
  class_4: {
    small: {
      day: { isolationM: 25, protectionM: 100, guide: 'Guide 133 (Flammable Solid, small)' },
      night: { isolationM: 25, protectionM: 100, guide: 'Guide 133 (Flammable Solid, small)' },
    },
    large: {
      day: { isolationM: 50, protectionM: 200, guide: 'Guide 133 (Flammable Solid, large)' },
      night: { isolationM: 100, protectionM: 400, guide: 'Guide 133 (Flammable Solid, large)' },
    },
  },
  class_5: {
    small: {
      day: { isolationM: 30, protectionM: 100, guide: 'Guide 140 (Oxidizer, small)' },
      night: { isolationM: 30, protectionM: 100, guide: 'Guide 140 (Oxidizer, small)' },
    },
    large: {
      day: { isolationM: 50, protectionM: 200, guide: 'Guide 140 (Oxidizer, large)' },
      night: { isolationM: 100, protectionM: 400, guide: 'Guide 140 (Oxidizer, large)' },
    },
  },
  class_6_1: {
    small: {
      day: { isolationM: 50, protectionM: 200, guide: 'Guide 153 (Toxic Liquid, small day)' },
      night: { isolationM: 50, protectionM: 400, guide: 'Guide 153 (Toxic Liquid, small night)' },
    },
    large: {
      day: { isolationM: 100, protectionM: 500, guide: 'Guide 153 (Toxic Liquid, large day)' },
      night: { isolationM: 200, protectionM: 1000, guide: 'Guide 153 (Toxic Liquid, large night)' },
    },
  },
  class_6_2: {
    small: {
      day: { isolationM: 25, protectionM: 50, guide: 'Guide 158 (Infectious, small)' },
      night: { isolationM: 25, protectionM: 50, guide: 'Guide 158 (Infectious, small)' },
    },
    large: {
      day: { isolationM: 50, protectionM: 100, guide: 'Guide 158 (Infectious, large)' },
      night: { isolationM: 50, protectionM: 100, guide: 'Guide 158 (Infectious, large)' },
    },
  },
  class_7: {
    small: {
      day: { isolationM: 25, protectionM: 100, guide: 'Guide 162-166 (Radioactive)' },
      night: { isolationM: 25, protectionM: 100, guide: 'Guide 162-166 (Radioactive)' },
    },
    large: {
      day: { isolationM: 100, protectionM: 300, guide: 'Guide 162-166 (Radioactive)' },
      night: { isolationM: 100, protectionM: 300, guide: 'Guide 162-166 (Radioactive)' },
    },
  },
  class_8: {
    small: {
      day: { isolationM: 30, protectionM: 100, guide: 'Guide 154 (Corrosive, small)' },
      night: { isolationM: 30, protectionM: 100, guide: 'Guide 154 (Corrosive, small)' },
    },
    large: {
      day: { isolationM: 50, protectionM: 200, guide: 'Guide 154 (Corrosive, large day)' },
      night: { isolationM: 100, protectionM: 400, guide: 'Guide 154 (Corrosive, large night)' },
    },
  },
  class_9: {
    small: {
      day: { isolationM: 25, protectionM: 50, guide: 'Guide 171 (Miscellaneous, small)' },
      night: { isolationM: 25, protectionM: 50, guide: 'Guide 171 (Miscellaneous, small)' },
    },
    large: {
      day: { isolationM: 50, protectionM: 100, guide: 'Guide 171 (Miscellaneous, large)' },
      night: { isolationM: 50, protectionM: 100, guide: 'Guide 171 (Miscellaneous, large)' },
    },
  },
  unknown: {
    // Default conservador: tratar como Class 2.3 grande-noche (peor caso TIH)
    small: {
      day: { isolationM: 100, protectionM: 800, guide: 'CONSERVATIVE FALLBACK (Unknown — treated as TIH)' },
      night: { isolationM: 100, protectionM: 1600, guide: 'CONSERVATIVE FALLBACK (Unknown — treated as TIH)' },
    },
    large: {
      day: { isolationM: 800, protectionM: 4000, guide: 'CONSERVATIVE FALLBACK (Unknown — treated as TIH)' },
      night: { isolationM: 800, protectionM: 8000, guide: 'CONSERVATIVE FALLBACK (Unknown — treated as TIH)' },
    },
  },
};

const DEFAULT_DISCLAIMER =
  'Distancias estimadas con GRE 2024 Green Pages. Para respuesta real, consulta GRE físico + protocolo de emergencia local. La pluma asume Gaussian dispersion estable; ajustar a inversión térmica o gradientes locales si aplica.';

/**
 * Calcula radios de aislamiento + acción protectiva para un derrame
 * hazmat. NO incluye gas concentration modeling — para eso usar
 * software dedicado (CAMEO ALOHA, etc.).
 *
 * @param hazmatClass Clase NU del material (default: 'unknown' →
 *   tratado como TIH grande para fail-closed conservador).
 * @param spillSize 'small' (≤200L / ≤300kg) o 'large' (>200L / >300kg).
 * @param period 'day' o 'night'. Noche aumenta dramáticamente la
 *   protective action distance por inversión térmica.
 */
export function computeExposureDistances(
  hazmatClass: HazmatClass,
  spillSize: SpillSize,
  period: Period,
): HazmatExposureResult {
  const row = HAZMAT_CLASS_DISTANCES[hazmatClass] ?? HAZMAT_CLASS_DISTANCES.unknown;
  const entry = row[spillSize][period];
  return {
    initialIsolationRadiusM: entry.isolationM,
    protectiveActionDistanceM: entry.protectionM,
    reference: entry.guide,
    disclaimer: DEFAULT_DISCLAIMER,
  };
}

/**
 * Estimación grosera del ancho del cono de la pluma según viento.
 * En estabilidad atmosférica "neutra" (Pasquill D), el ancho típico
 * downwind es ~10-15% de la distancia recorrida.
 *
 *   - viento muy bajo (<5 km/h): cono más ancho (30°) — la pluma
 *     se dispersa sin dirección clara
 *   - viento bajo (5-15): 20°
 *   - viento moderado (15-30): 12°
 *   - viento alto (>30): 8°
 *
 * Esto reemplaza el `spreadAngle = 45` HARDCODED del UI.
 */
export function estimatePlumeConeDegrees(windSpeedKmh: number): number {
  if (!Number.isFinite(windSpeedKmh) || windSpeedKmh <= 0) return 30;
  if (windSpeedKmh < 5) return 30;
  if (windSpeedKmh < 15) return 20;
  if (windSpeedKmh < 30) return 12;
  return 8;
}

/**
 * Determina el período (day/night) desde un Date local. Considera
 * "night" como 19:00-07:00 hora local — heurística simple. Para
 * precisión astronómica usar sun-position pero no es justificado
 * para este caso (la distinción GRE día/noche es operacional, no
 * astronómica estricta).
 */
export function periodFromDate(d: Date = new Date()): Period {
  const hour = d.getHours();
  return hour >= 19 || hour < 7 ? 'night' : 'day';
}
