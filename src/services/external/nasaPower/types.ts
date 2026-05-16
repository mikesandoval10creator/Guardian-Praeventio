// SPDX-License-Identifier: MIT
//
// NASA POWER (Prediction Of Worldwide Energy Resources) types.
//
// API docs: https://power.larc.nasa.gov/docs/services/api/temporal/
// Endpoint: https://power.larc.nasa.gov/api/temporal/hourly/point
//
// Características clave (por qué la elegimos sobre OpenWeather):
//   - GRATIS, sin API key
//   - Global (no solo US como NWS)
//   - Granularidad horaria
//   - 30+ años de histórico
//   - Cache-friendly: la NASA actualiza los datos hourly con lag de
//     ~3-5 días (MERRA-2 reanalysis), por lo que la respuesta para un
//     período pasado es ESTABLE — perfecta para cachear 1h
//
// Limitaciones documentadas (NO esconder al usuario):
//   - Lag ~3-5 días — NO sirve para "el clima de ESTA hora ahora mismo"
//   - Cobertura: resolución MERRA-2 = 0.5° lat × 0.625° lon (~50km)
//     → para microclimas locales, valor agregado regional
//   - Sin "alertas" — para eventos extremos ACTIVOS usar EONET (ya
//     tenemos adapter)
//
// Caso de uso en Praeventio:
//   - ClimateRoutes: "este paso cordillerano tuvo X km/h viento promedio
//     y Y mm precipitación en los últimos 7 días → probabilidad de
//     condiciones similares hoy" (no es pronóstico, es base climática)
//   - Trend analysis: comparar mes actual vs promedios 30-año
//   - Riesgo de fatiga térmica: temp media + humedad → WBGT estimado
//
// Pattern matches `eonetAdapter`: read-only client, cache 1h, retry 2×
// con exponential backoff, Sentry capture en terminal errors.

import { z } from 'zod';

/**
 * Parámetros que pedimos a la API. Mantener mínimo para velocidad.
 * Lista completa: https://power.larc.nasa.gov/docs/services/api/parameters/
 */
export type NasaPowerParameter =
  | 'T2M'           // Temperatura a 2m sobre el suelo (Celsius)
  | 'T2M_MAX'       // Temperatura máxima diaria (solo daily endpoint)
  | 'T2M_MIN'       // Temperatura mínima diaria (solo daily endpoint)
  | 'WS10M'         // Velocidad viento a 10m (m/s)
  | 'WS50M'         // Velocidad viento a 50m (m/s — más estable, útil para faena minera)
  | 'WD10M'         // Dirección viento 10m (grados meteorológicos)
  | 'RH2M'          // Humedad relativa 2m (%)
  | 'PRECTOTCORR'   // Precipitación total corregida (mm/h en hourly, mm/día en daily)
  | 'ALLSKY_SFC_SW_DWN'  // Radiación solar superficial (W/m²)
  | 'CLOUD_AMT'     // Cobertura nubosa (%)
  | 'PS';           // Presión superficial (kPa)

export const NASA_POWER_DEFAULT_PARAMS: ReadonlyArray<NasaPowerParameter> = [
  'T2M',
  'WS10M',
  'WD10M',
  'RH2M',
  'PRECTOTCORR',
];

/**
 * Tipo de "comunidad" que define el dataset NASA POWER subyacente.
 *   - 'RE': Renewable Energy (default, balanced)
 *   - 'AG': Agroclimatology (más parámetros agrícolas)
 *   - 'SB': Sustainable Buildings
 */
export type NasaPowerCommunity = 'RE' | 'AG' | 'SB';

/**
 * Schema raw de respuesta de la API. La NASA wraps todo en GeoJSON Feature.
 */
export const NasaPowerResponseSchema = z.object({
  type: z.literal('Feature').optional(),
  geometry: z
    .object({
      type: z.string(),
      coordinates: z.array(z.number()),
    })
    .optional(),
  properties: z.object({
    parameter: z.record(z.string(), z.record(z.string(), z.number())),
  }),
  // Algunos endpoints incluyen header (metadata)
  header: z
    .object({
      title: z.string().optional(),
      api: z.object({ version: z.string() }).optional(),
      sources: z.array(z.string()).optional(),
      fill_value: z.number().optional(),
    })
    .optional(),
  messages: z.array(z.unknown()).optional(),
});

export type NasaPowerResponse = z.infer<typeof NasaPowerResponseSchema>;

/**
 * Resultado normalizado: una serie temporal por parámetro.
 * key = ISO timestamp 'YYYY-MM-DDTHH:00:00Z', value = numérico (o null si
 * la NASA reportó fill_value = "missing data").
 */
export interface ClimateTimeSeries {
  parameter: NasaPowerParameter;
  unit: string;
  /** Mapa ordenado: timestamp → valor. null si NASA marcó "missing". */
  samples: Map<string, number | null>;
}

/** Agregaciones útiles calculadas de la serie temporal. */
export interface ClimateAggregates {
  parameter: NasaPowerParameter;
  /** Cuenta de samples no-nulos. */
  count: number;
  /** Promedio aritmético sobre samples no-nulos. */
  mean: number | null;
  /** Mínimo registrado. */
  min: number | null;
  /** Máximo registrado. */
  max: number | null;
  /** Para precipitación: suma total. Para otros: equivalente a mean × count. */
  sum: number | null;
}

/** Unidades canónicas por parámetro (informativo, para UI). */
export const NASA_POWER_UNITS: Record<NasaPowerParameter, string> = {
  T2M: '°C',
  T2M_MAX: '°C',
  T2M_MIN: '°C',
  WS10M: 'm/s',
  WS50M: 'm/s',
  WD10M: '°',
  RH2M: '%',
  PRECTOTCORR: 'mm',
  ALLSKY_SFC_SW_DWN: 'W/m²',
  CLOUD_AMT: '%',
  PS: 'kPa',
};
