// SPDX-License-Identifier: MIT
//
// Route climate assessment — evaluación de riesgo climático para una ruta
// combinando NASA POWER (baseline histórico hourly) + EONET (eventos
// extremos activos en bbox).
//
// 2026-05-16 (Sprint E): reemplaza la heurística de keywords pura que
// estaba en `src/pages/ClimateRoutes.tsx:51-78` (PR #275). Antes el status
// se derivaba SOLO del summary de Google Directions buscando palabras como
// "Libertadores" o "Cuesta". Esta función agrega evidencia REAL:
//
//   - Histórico: NASA POWER hourly de los últimos 7 días en el punto
//     medio de la ruta — viento promedio, precipitación total, días con
//     temperatura ≤ 0°C (riesgo de hielo).
//   - Eventos activos: EONET en bbox de la ruta — tormentas severas,
//     incendios, inundaciones que cruzan la ruta.
//
// El score combinado tiene 3 niveles operativos (safe/warning/danger)
// con razones tipadas para que el UI muestre el por qué del veredicto
// (no es una caja negra).

import { nasaPowerAdapter } from '../external/nasaPower/nasaPowerAdapter.js';
import { aggregateSeries } from '../external/nasaPower/nasaPowerAdapter.js';
import { eonetAdapter } from '../external/eonet/eonetAdapter.js';
import type { BBox, EonetEvent } from '../external/eonet/types.js';

export type RouteStatus = 'safe' | 'warning' | 'danger';

/**
 * Una razón individual que contribuyó al status final. Sirve para
 * UIs honestas que muestran POR QUÉ se marcó la ruta.
 */
export interface RouteRiskReason {
  level: RouteStatus;
  /** Categoría para iconografía / agrupación. */
  category:
    | 'wind'
    | 'precipitation'
    | 'frost'
    | 'mountain_pass'
    | 'distance_duration'
    | 'active_event';
  /** Texto humano, español Chile. */
  message: string;
  /** Fuente de la evidencia. */
  source: 'NASA_POWER' | 'EONET' | 'GOOGLE_DIRECTIONS' | 'HEURISTIC';
}

export interface RouteAssessmentInput {
  /** Punto medio de la ruta (lat/lng) para sondeo NASA POWER. */
  midpointLat: number;
  midpointLng: number;
  /** BBox que envuelve la ruta para query EONET. */
  bbox: BBox;
  /** Distancia total en metros (Google Directions). */
  totalDistanceM: number;
  /** Duración total en segundos (Google Directions). */
  totalDurationS: number;
  /** Summary devuelto por Google Directions (e.g. "Ruta CH-31 vía Los Libertadores"). */
  summary: string;
  /**
   * Opcional: días hacia atrás para NASA POWER histórico. Default 7.
   * Más días = mejor baseline pero más lento.
   */
  historicalDaysBack?: number;
}

export interface RouteAssessmentResult {
  status: RouteStatus;
  reasons: RouteRiskReason[];
  /** Telemetría útil para UI/debug — los números crudos. */
  metrics: {
    avgWindMs: number | null;
    maxWindMs: number | null;
    totalPrecipMm: number | null;
    frostHourCount: number;
    activeEventCount: number;
    distanceKm: number;
    durationHours: number;
    isMountainPass: boolean;
  };
  /** Eventos EONET que afectan la bbox (los primeros 5). */
  activeEvents: EonetEvent[];
  /**
   * Codex fix PR #279: indica qué fuentes externas NO pudieron consultarse
   * (offline, CSP bloqueado, 5xx, timeout). La UI debe distinguir
   * "no detectamos riesgos" (todas las fuentes respondieron OK y nada
   * salió de los thresholds) de "no podemos saber" (alguna fuente falló).
   *
   * Mostrar "Sin riesgos detectados" cuando hay `failedSources` activos
   * sería deshonesto y peligroso — el operador podría tomar decisiones
   * basándose en señal que no existe.
   */
  failedSources: Array<'NASA_POWER' | 'EONET'>;
}

// Thresholds operacionales (documentados para review).
const WIND_WARNING_MS = 8; // ~29 km/h — sostiene la copa de árbol
const WIND_DANGER_MS = 15; // ~54 km/h — Beaufort 7 (viento fuerte)
const PRECIP_WARNING_MM = 20; // 20mm acumulados en 7d
const PRECIP_DANGER_MM = 80; // 80mm = ~3x media chilena central → barro/aluvión
const FROST_WARNING_HOURS = 6; // 6 horas bajo 0°C en 7d
const FROST_DANGER_HOURS = 24; // 1 día acumulado de hielo
const DISTANCE_WARNING_KM = 200; // ruta interregional larga
const DURATION_WARNING_H = 3; // 3h al volante

const MOUNTAIN_PASS_KEYWORDS = [
  'libertadores',
  'cristo redentor',
  'agua negra',
  'pehuenche',
  'cardenal samoré',
  'cuesta',
  'paso ',
  'ch-115',
  'ch-31',
  'ch-117',
];

/**
 * Evalúa una ruta combinando NASA POWER + EONET + datos Google.
 *
 * Si los adapters externos fallan (timeout, 5xx), el assessment cae a
 * heurística pura (keywords + distancia/duración) en lugar de fallar.
 * Esto preserva utilidad: peor caso = comportamiento previo a Sprint E.
 */
export async function assessRouteClimate(
  input: RouteAssessmentInput,
): Promise<RouteAssessmentResult> {
  const reasons: RouteRiskReason[] = [];
  // Codex fix PR #279: trackeamos qué fuentes externas FALLARON para que
  // la UI distinga "no detectamos riesgos" (todo OK) de "no sabemos" (alguna
  // fuente bloqueada por CSP / offline / 5xx). Sin esto, el assessment
  // devolvía reasons=[] en ambos casos → operador podía tomar decisión
  // basada en señal que no existió.
  const failedSources: Array<'NASA_POWER' | 'EONET'> = [];
  const distanceKm = input.totalDistanceM / 1000;
  const durationHours = input.totalDurationS / 3600;
  const summaryLower = input.summary.toLowerCase();
  const isMountainPass = MOUNTAIN_PASS_KEYWORDS.some((k) =>
    summaryLower.includes(k),
  );

  // 1) Heurística de paso cordillerano (Google Directions summary) ─────
  if (isMountainPass) {
    reasons.push({
      level: 'warning',
      category: 'mountain_pass',
      message:
        'Ruta atraviesa paso cordillerano — verifica el estado vial antes de viajar (puede cerrar en invierno).',
      source: 'GOOGLE_DIRECTIONS',
    });
  }

  // 2) Distancia / duración (Google Directions) ─────────────────────────
  if (distanceKm > DISTANCE_WARNING_KM || durationHours > DURATION_WARNING_H) {
    reasons.push({
      level: 'warning',
      category: 'distance_duration',
      message: `Ruta interregional larga (${distanceKm.toFixed(0)} km, ${durationHours.toFixed(1)} h). Planifica descansos cada 2h.`,
      source: 'GOOGLE_DIRECTIONS',
    });
  }

  // 3) NASA POWER histórico ─────────────────────────────────────────────
  let avgWindMs: number | null = null;
  let maxWindMs: number | null = null;
  let totalPrecipMm: number | null = null;
  let frostHourCount = 0;
  try {
    const { series } = await nasaPowerAdapter.fetchAggregated({
      latitude: input.midpointLat,
      longitude: input.midpointLng,
      daysBack: input.historicalDaysBack ?? 7,
      parameters: ['WS10M', 'PRECTOTCORR', 'T2M'],
    });

    const wind = series.find((s) => s.parameter === 'WS10M');
    const precip = series.find((s) => s.parameter === 'PRECTOTCORR');
    const temp = series.find((s) => s.parameter === 'T2M');

    if (wind) {
      const agg = aggregateSeries(wind);
      avgWindMs = agg.mean;
      maxWindMs = agg.max;
      const referenceWind = agg.max ?? agg.mean ?? 0;
      if (referenceWind >= WIND_DANGER_MS) {
        reasons.push({
          level: 'danger',
          category: 'wind',
          message: `Viento histórico máximo en la zona ${(referenceWind * 3.6).toFixed(0)} km/h en últimos días — riesgo alto para vehículos altos / carga.`,
          source: 'NASA_POWER',
        });
      } else if (referenceWind >= WIND_WARNING_MS) {
        reasons.push({
          level: 'warning',
          category: 'wind',
          message: `Viento promedio reciente ${(referenceWind * 3.6).toFixed(0)} km/h — manejo con precaución, especialmente curvas y puentes.`,
          source: 'NASA_POWER',
        });
      }
    }

    if (precip) {
      const agg = aggregateSeries(precip);
      totalPrecipMm = agg.sum;
      const total = agg.sum ?? 0;
      if (total >= PRECIP_DANGER_MM) {
        reasons.push({
          level: 'danger',
          category: 'precipitation',
          message: `Precipitación acumulada ${total.toFixed(0)} mm en 7 días — riesgo de saturación de suelo, aluviones, derrumbes.`,
          source: 'NASA_POWER',
        });
      } else if (total >= PRECIP_WARNING_MM) {
        reasons.push({
          level: 'warning',
          category: 'precipitation',
          message: `Precipitación acumulada ${total.toFixed(0)} mm en 7 días — calzada puede estar resbaladiza, evita frenadas bruscas.`,
          source: 'NASA_POWER',
        });
      }
    }

    if (temp) {
      // Cuenta horas con T2M ≤ 0°C → riesgo de hielo nocturno persistente.
      let cnt = 0;
      for (const v of temp.samples.values()) {
        if (v !== null && v <= 0) cnt += 1;
      }
      frostHourCount = cnt;
      if (cnt >= FROST_DANGER_HOURS) {
        reasons.push({
          level: 'danger',
          category: 'frost',
          message: `Más de ${FROST_DANGER_HOURS} horas bajo 0°C en los últimos días — hielo en calzada altamente probable, especialmente al amanecer.`,
          source: 'NASA_POWER',
        });
      } else if (cnt >= FROST_WARNING_HOURS) {
        reasons.push({
          level: 'warning',
          category: 'frost',
          message: `${cnt} horas bajo 0°C en últimos días — posible hielo nocturno, lleva cadenas si subes a la cordillera.`,
          source: 'NASA_POWER',
        });
      }
    }
  } catch {
    // NASA POWER caído — registramos en failedSources para que la UI
    // muestre "sin datos NASA" en lugar de "sin riesgos detectados".
    failedSources.push('NASA_POWER');
  }

  // 4) EONET — eventos extremos activos en bbox ─────────────────────────
  let activeEvents: EonetEvent[] = [];
  try {
    activeEvents = await eonetAdapter.fetchEvents({
      bbox: input.bbox,
      days: 7,
      status: 'open',
      categories: ['severeStorms', 'wildfires', 'floods', 'landslides'],
    });
  } catch {
    // EONET caído — registramos en failedSources para que la UI sepa
    // que no podemos garantizar "sin eventos activos". Sin esto, la UI
    // mostraría verde "todo OK" cuando en realidad no consultamos.
    failedSources.push('EONET');
  }

  if (activeEvents.length > 0) {
    // Cualquier evento activo en la bbox de la ruta = danger.
    // (severeStorms/wildfires/floods/landslides son todos críticos para tránsito).
    reasons.push({
      level: 'danger',
      category: 'active_event',
      message: `${activeEvents.length} evento(s) climático(s) extremo(s) activo(s) en la zona (NASA EONET). Revisa el detalle antes de viajar.`,
      source: 'EONET',
    });
  }

  // 5) Combinar al peor nivel ────────────────────────────────────────────
  let status: RouteStatus = 'safe';
  for (const r of reasons) {
    if (r.level === 'danger') {
      status = 'danger';
      break;
    }
    if (r.level === 'warning') status = 'warning';
  }

  return {
    status,
    reasons,
    metrics: {
      avgWindMs,
      maxWindMs,
      totalPrecipMm,
      frostHourCount,
      activeEventCount: activeEvents.length,
      distanceKm,
      durationHours,
      isMountainPass,
    },
    activeEvents: activeEvents.slice(0, 5),
    failedSources,
  };
}
