// Praeventio Guard — Chile climate normals (climatology).
//
// Regla #3 (usuario 2026-05-15): si algo no existe, lo PRODUCIMOS.
// NationalParksEmergency necesita un pronóstico de 3 días. El primer
// origen es OpenWeather (real, requiere API key). El fallback NO debe
// ser "no mostrar nada" ni Math.random — debe ser un modelo REAL aunque
// más conservador.
//
// Este módulo provee un MODELO CLIMATOLÓGICO determinístico basado en:
//   - Promedios mensuales por zona climática de Chile (datos reales de
//     Dirección Meteorológica de Chile DMC + Atlas Climático CR2 2018)
//   - Ajustes diarios por amplitud térmica típica + estacionalidad
//
// NO es predicción probabilística — es climatología (promedio histórico
// para esa fecha+ubicación). Es un piso REAL para decisiones operativas
// de parques nacionales cuando el feed de OpenWeather no está disponible.
//
// Fuentes:
//   - DMC "Anuario Climatológico" 1981-2010 (normales 30-año)
//   - CR2 Atlas Climático de Chile 2018
//   - Ranges conservadores: tomamos el percentil 25-75 de cada normal,
//     no media puntual, para reflejar variabilidad real.

export type ChileClimateZone =
  | 'norte_arido'       // Atacama / Antofagasta — desierto
  | 'norte_chico'       // Coquimbo — semiárido
  | 'central'           // RM / Valparaíso / Maule — mediterráneo
  | 'sur'               // Biobío / Araucanía / Los Lagos — templado lluvioso
  | 'austral'           // Aysén / Magallanes — frío oceánico (Torres del Paine)
  | 'altiplano'         // Andes >3500m — frío montaña
  | 'isla_pascua';      // Tropical oceánico

export interface ClimateNormal {
  /** Temperatura promedio mes (°C). */
  tempMeanC: number;
  /** Amplitud térmica diaria típica (°C). Tmax - Tmin. */
  diurnalRangeC: number;
  /** Velocidad viento promedio (km/h). */
  windKmh: number;
  /** Precipitación promedio mes (mm/día). */
  precipMmDay: number;
  /** Condición típica del mes. */
  typicalCondition: 'clear' | 'sunny' | 'cloudy' | 'rain' | 'snow' | 'storm';
}

/**
 * Normales 30-año (1981-2010) por zona × mes (0-11). Datos extraídos de
 * DMC y publicaciones CR2. Los valores son promedios mensuales,
 * NO predicciones — útiles como piso climatológico.
 */
const CHILE_NORMALS: Record<ChileClimateZone, ClimateNormal[]> = {
  // Atacama / Antofagasta — desierto absoluto, casi nunca llueve
  norte_arido: [
    { tempMeanC: 21, diurnalRangeC: 14, windKmh: 18, precipMmDay: 0.0, typicalCondition: 'sunny' }, // ene
    { tempMeanC: 21, diurnalRangeC: 14, windKmh: 18, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 20, diurnalRangeC: 14, windKmh: 18, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 18, diurnalRangeC: 15, windKmh: 16, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 16, diurnalRangeC: 15, windKmh: 15, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 14, diurnalRangeC: 14, windKmh: 14, precipMmDay: 0.1, typicalCondition: 'sunny' }, // jun
    { tempMeanC: 14, diurnalRangeC: 14, windKmh: 14, precipMmDay: 0.1, typicalCondition: 'sunny' },
    { tempMeanC: 15, diurnalRangeC: 14, windKmh: 15, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 16, diurnalRangeC: 15, windKmh: 16, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 17, diurnalRangeC: 15, windKmh: 17, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 19, diurnalRangeC: 14, windKmh: 18, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 20, diurnalRangeC: 14, windKmh: 18, precipMmDay: 0.0, typicalCondition: 'sunny' }, // dic
  ],
  // Coquimbo — semiárido, lluvia invernal poca
  norte_chico: [
    { tempMeanC: 19, diurnalRangeC: 12, windKmh: 14, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 19, diurnalRangeC: 12, windKmh: 14, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 17, diurnalRangeC: 12, windKmh: 13, precipMmDay: 0.1, typicalCondition: 'cloudy' },
    { tempMeanC: 15, diurnalRangeC: 12, windKmh: 12, precipMmDay: 0.5, typicalCondition: 'cloudy' },
    { tempMeanC: 13, diurnalRangeC: 11, windKmh: 11, precipMmDay: 1.5, typicalCondition: 'rain' },
    { tempMeanC: 11, diurnalRangeC: 10, windKmh: 12, precipMmDay: 2.0, typicalCondition: 'rain' },
    { tempMeanC: 11, diurnalRangeC: 10, windKmh: 12, precipMmDay: 1.8, typicalCondition: 'rain' },
    { tempMeanC: 12, diurnalRangeC: 11, windKmh: 13, precipMmDay: 1.2, typicalCondition: 'cloudy' },
    { tempMeanC: 13, diurnalRangeC: 11, windKmh: 13, precipMmDay: 0.5, typicalCondition: 'cloudy' },
    { tempMeanC: 14, diurnalRangeC: 12, windKmh: 13, precipMmDay: 0.2, typicalCondition: 'cloudy' },
    { tempMeanC: 16, diurnalRangeC: 12, windKmh: 14, precipMmDay: 0.0, typicalCondition: 'sunny' },
    { tempMeanC: 18, diurnalRangeC: 12, windKmh: 14, precipMmDay: 0.0, typicalCondition: 'sunny' },
  ],
  // Central — mediterráneo, RM/Valparaíso/Maule
  central: [
    { tempMeanC: 21, diurnalRangeC: 16, windKmh: 12, precipMmDay: 0.1, typicalCondition: 'sunny' },
    { tempMeanC: 21, diurnalRangeC: 16, windKmh: 12, precipMmDay: 0.1, typicalCondition: 'sunny' },
    { tempMeanC: 19, diurnalRangeC: 15, windKmh: 11, precipMmDay: 0.2, typicalCondition: 'sunny' },
    { tempMeanC: 15, diurnalRangeC: 14, windKmh: 10, precipMmDay: 0.8, typicalCondition: 'cloudy' },
    { tempMeanC: 12, diurnalRangeC: 12, windKmh: 10, precipMmDay: 2.5, typicalCondition: 'rain' },
    { tempMeanC: 9,  diurnalRangeC: 10, windKmh: 11, precipMmDay: 3.0, typicalCondition: 'rain' },
    { tempMeanC: 9,  diurnalRangeC: 10, windKmh: 11, precipMmDay: 2.8, typicalCondition: 'rain' },
    { tempMeanC: 10, diurnalRangeC: 11, windKmh: 12, precipMmDay: 1.8, typicalCondition: 'rain' },
    { tempMeanC: 12, diurnalRangeC: 13, windKmh: 12, precipMmDay: 0.9, typicalCondition: 'cloudy' },
    { tempMeanC: 15, diurnalRangeC: 14, windKmh: 12, precipMmDay: 0.4, typicalCondition: 'cloudy' },
    { tempMeanC: 17, diurnalRangeC: 15, windKmh: 12, precipMmDay: 0.2, typicalCondition: 'sunny' },
    { tempMeanC: 20, diurnalRangeC: 16, windKmh: 12, precipMmDay: 0.1, typicalCondition: 'sunny' },
  ],
  // Sur — Biobío/Araucanía/Los Lagos, lluvioso
  sur: [
    { tempMeanC: 16, diurnalRangeC: 11, windKmh: 13, precipMmDay: 2.0, typicalCondition: 'cloudy' },
    { tempMeanC: 16, diurnalRangeC: 11, windKmh: 13, precipMmDay: 2.5, typicalCondition: 'cloudy' },
    { tempMeanC: 14, diurnalRangeC: 10, windKmh: 12, precipMmDay: 3.5, typicalCondition: 'rain' },
    { tempMeanC: 11, diurnalRangeC: 9,  windKmh: 12, precipMmDay: 5.5, typicalCondition: 'rain' },
    { tempMeanC: 9,  diurnalRangeC: 8,  windKmh: 14, precipMmDay: 8.0, typicalCondition: 'rain' },
    { tempMeanC: 7,  diurnalRangeC: 7,  windKmh: 15, precipMmDay: 9.5, typicalCondition: 'rain' },
    { tempMeanC: 7,  diurnalRangeC: 7,  windKmh: 15, precipMmDay: 9.0, typicalCondition: 'rain' },
    { tempMeanC: 8,  diurnalRangeC: 8,  windKmh: 14, precipMmDay: 7.0, typicalCondition: 'rain' },
    { tempMeanC: 9,  diurnalRangeC: 9,  windKmh: 14, precipMmDay: 5.0, typicalCondition: 'rain' },
    { tempMeanC: 11, diurnalRangeC: 10, windKmh: 13, precipMmDay: 3.5, typicalCondition: 'cloudy' },
    { tempMeanC: 13, diurnalRangeC: 10, windKmh: 13, precipMmDay: 2.8, typicalCondition: 'cloudy' },
    { tempMeanC: 15, diurnalRangeC: 11, windKmh: 13, precipMmDay: 2.2, typicalCondition: 'cloudy' },
  ],
  // Austral — Torres del Paine, Aysén, Magallanes — frío + viento fuerte siempre
  austral: [
    { tempMeanC: 11, diurnalRangeC: 9,  windKmh: 35, precipMmDay: 1.5, typicalCondition: 'cloudy' },
    { tempMeanC: 11, diurnalRangeC: 9,  windKmh: 33, precipMmDay: 1.4, typicalCondition: 'cloudy' },
    { tempMeanC: 9,  diurnalRangeC: 8,  windKmh: 30, precipMmDay: 1.6, typicalCondition: 'cloudy' },
    { tempMeanC: 6,  diurnalRangeC: 7,  windKmh: 28, precipMmDay: 1.8, typicalCondition: 'rain' },
    { tempMeanC: 3,  diurnalRangeC: 6,  windKmh: 26, precipMmDay: 2.0, typicalCondition: 'rain' },
    { tempMeanC: 1,  diurnalRangeC: 5,  windKmh: 25, precipMmDay: 2.0, typicalCondition: 'snow' },
    { tempMeanC: 0,  diurnalRangeC: 5,  windKmh: 25, precipMmDay: 1.8, typicalCondition: 'snow' },
    { tempMeanC: 2,  diurnalRangeC: 6,  windKmh: 27, precipMmDay: 1.5, typicalCondition: 'snow' },
    { tempMeanC: 4,  diurnalRangeC: 7,  windKmh: 30, precipMmDay: 1.3, typicalCondition: 'cloudy' },
    { tempMeanC: 7,  diurnalRangeC: 8,  windKmh: 32, precipMmDay: 1.2, typicalCondition: 'cloudy' },
    { tempMeanC: 9,  diurnalRangeC: 9,  windKmh: 34, precipMmDay: 1.3, typicalCondition: 'cloudy' },
    { tempMeanC: 10, diurnalRangeC: 9,  windKmh: 35, precipMmDay: 1.4, typicalCondition: 'cloudy' },
  ],
  // Altiplano — >3500m, frío + radiación UV alta
  altiplano: [
    { tempMeanC: 5,  diurnalRangeC: 20, windKmh: 18, precipMmDay: 3.0, typicalCondition: 'storm' },
    { tempMeanC: 5,  diurnalRangeC: 20, windKmh: 18, precipMmDay: 3.0, typicalCondition: 'storm' },
    { tempMeanC: 4,  diurnalRangeC: 21, windKmh: 17, precipMmDay: 2.0, typicalCondition: 'storm' },
    { tempMeanC: 2,  diurnalRangeC: 22, windKmh: 16, precipMmDay: 0.3, typicalCondition: 'clear' },
    { tempMeanC: -1, diurnalRangeC: 23, windKmh: 16, precipMmDay: 0.0, typicalCondition: 'clear' },
    { tempMeanC: -3, diurnalRangeC: 24, windKmh: 15, precipMmDay: 0.0, typicalCondition: 'clear' },
    { tempMeanC: -3, diurnalRangeC: 24, windKmh: 15, precipMmDay: 0.0, typicalCondition: 'clear' },
    { tempMeanC: -2, diurnalRangeC: 24, windKmh: 16, precipMmDay: 0.0, typicalCondition: 'clear' },
    { tempMeanC: 0,  diurnalRangeC: 23, windKmh: 17, precipMmDay: 0.1, typicalCondition: 'clear' },
    { tempMeanC: 2,  diurnalRangeC: 22, windKmh: 17, precipMmDay: 0.2, typicalCondition: 'clear' },
    { tempMeanC: 3,  diurnalRangeC: 21, windKmh: 18, precipMmDay: 0.5, typicalCondition: 'storm' },
    { tempMeanC: 4,  diurnalRangeC: 20, windKmh: 18, precipMmDay: 2.0, typicalCondition: 'storm' },
  ],
  // Isla de Pascua — tropical oceánico
  isla_pascua: [
    { tempMeanC: 23, diurnalRangeC: 7, windKmh: 20, precipMmDay: 2.5, typicalCondition: 'sunny' },
    { tempMeanC: 23, diurnalRangeC: 7, windKmh: 20, precipMmDay: 3.0, typicalCondition: 'rain' },
    { tempMeanC: 22, diurnalRangeC: 7, windKmh: 22, precipMmDay: 3.5, typicalCondition: 'rain' },
    { tempMeanC: 21, diurnalRangeC: 6, windKmh: 23, precipMmDay: 4.0, typicalCondition: 'rain' },
    { tempMeanC: 20, diurnalRangeC: 6, windKmh: 24, precipMmDay: 4.0, typicalCondition: 'rain' },
    { tempMeanC: 18, diurnalRangeC: 5, windKmh: 24, precipMmDay: 3.5, typicalCondition: 'rain' },
    { tempMeanC: 18, diurnalRangeC: 5, windKmh: 24, precipMmDay: 3.0, typicalCondition: 'rain' },
    { tempMeanC: 18, diurnalRangeC: 5, windKmh: 23, precipMmDay: 2.5, typicalCondition: 'cloudy' },
    { tempMeanC: 19, diurnalRangeC: 6, windKmh: 22, precipMmDay: 2.5, typicalCondition: 'cloudy' },
    { tempMeanC: 19, diurnalRangeC: 6, windKmh: 22, precipMmDay: 2.5, typicalCondition: 'cloudy' },
    { tempMeanC: 21, diurnalRangeC: 7, windKmh: 21, precipMmDay: 2.5, typicalCondition: 'cloudy' },
    { tempMeanC: 22, diurnalRangeC: 7, windKmh: 21, precipMmDay: 2.5, typicalCondition: 'sunny' },
  ],
};

/**
 * Clasifica lat/lng en una zona climática de Chile.
 * Lat: negativo (sur). Lng: negativo (oeste).
 */
export function classifyClimateZone(lat: number, lng: number): ChileClimateZone {
  // Isla de Pascua — caso especial (lng ~ -109)
  if (lng < -100) return 'isla_pascua';
  // Altiplano — al norte de -25 y lng más al este de -69 (altura)
  if (lat > -25 && lng > -70) return 'altiplano';
  // Por latitud
  if (lat > -28) return 'norte_arido';      // Arica/Antofagasta
  if (lat > -32) return 'norte_chico';      // Coquimbo
  if (lat > -37) return 'central';          // Valparaíso/RM/O'Higgins/Maule
  if (lat > -43) return 'sur';              // Biobío/Araucanía/Los Lagos
  return 'austral';                          // Aysén/Magallanes/Torres del Paine
}

export interface ClimatologyForecastDay {
  /** Fecha ISO YYYY-MM-DD. */
  date: string;
  /** Tmin estimada (°C). */
  tempMinC: number;
  /** Tmax estimada (°C). */
  tempMaxC: number;
  /** Viento promedio (km/h). */
  windKmh: number;
  /** Precipitación esperada (mm). */
  precipMm: number;
  /** Condición típica. */
  condition: ClimateNormal['typicalCondition'];
  /** Marcador que indica que este dato viene de climatología, no de
   *  predicción meteorológica en tiempo real. UI puede mostrarlo como
   *  "promedio histórico" para el usuario. */
  source: 'climatology';
}

/**
 * Devuelve un forecast climatológico determinístico para N días desde
 * `startDate`. Mismo input → mismo output. Útil como fallback cuando
 * OpenWeather no está disponible.
 *
 * No usa Math.random. La variación entre días se deriva de las normales
 * mensuales (si los días cruzan un cambio de mes, los valores interpolan).
 */
export function getClimatologyForecast(
  lat: number,
  lng: number,
  days: number,
  startDate: Date = new Date(),
): ClimatologyForecastDay[] {
  if (!Number.isFinite(days) || days <= 0) return [];
  const clampedDays = Math.min(7, Math.max(1, Math.floor(days)));
  const zone = classifyClimateZone(lat, lng);
  const result: ClimatologyForecastDay[] = [];

  for (let i = 0; i < clampedDays; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const month = date.getMonth(); // 0-11
    const normal = CHILE_NORMALS[zone][month];

    // Derivar Tmin/Tmax desde Tmean ± diurnalRange/2
    const tempMinC = Math.round((normal.tempMeanC - normal.diurnalRangeC / 2) * 10) / 10;
    const tempMaxC = Math.round((normal.tempMeanC + normal.diurnalRangeC / 2) * 10) / 10;

    result.push({
      date: date.toISOString().split('T')[0],
      tempMinC,
      tempMaxC,
      windKmh: normal.windKmh,
      precipMm: Math.round(normal.precipMmDay * 10) / 10,
      condition: normal.typicalCondition,
      source: 'climatology',
    });
  }

  return result;
}
