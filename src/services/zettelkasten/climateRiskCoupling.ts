/**
 * Climate ↔ Zettelkasten coupling.
 *
 * Pure module that turns a 3-day climate forecast (or any list of forecast
 * days) into RiskNode payloads ready to be inserted into the Zettelkasten
 * via useRiskEngine.addNode. The actual Firestore write happens elsewhere.
 *
 * Outputs are deterministic given the inputs — no IO, no Date.now().
 */

import {
  dynamicPressure,
  windLoadOnSurface,
  windSpeedKmhToMs,
} from '../physics/bernoulliEngine';

const AIR_DENSITY_KG_M3 = 1.225;

// Venturi-warning thresholds (NCh 432 — wind action; informational at tunnel mouths).
const VENTURI_WIND_KMH_TRIGGER = 40;
const VENTURI_DYNAMIC_PRESSURE_PA_TRIGGER = 200;

// Windload-warning thresholds (NCh 432 — Cargas de viento sobre construcciones).
const WINDLOAD_KMH_TRIGGER = 60;
const WINDLOAD_TYPICAL_AREA_M2 = 20;
const WINDLOAD_PRESSURE_COEFF = 0.8;
// Per NCh 432, temporary structures should not sustain wind loads beyond their
// design envelope; ~10 kN on a 20 m² panel is an informational early-warning.
const WINDLOAD_FORCE_N_TRIGGER = 10000;

const TUNNEL_KEYWORDS = ['tunel', 'túnel', 'mina subterránea', 'mina subterranea'];
const TEMP_STRUCTURE_KEYWORDS = [
  'grua', 'grúa', 'andamio', 'andamios', 'campamento', 'campamento modular',
  'estructura temporal', 'estructuras temporales', 'modular',
];

function hasKeyword(workTypes: string[], keywords: string[]): boolean {
  return workTypes.some((w) => {
    const lw = w.toLowerCase();
    return keywords.some((k) => lw.includes(k));
  });
}

export interface ClimateForecastDay {
  date: Date;
  conditionCode:
    | 'sunny'
    | 'rainy'
    | 'stormy'
    | 'windy'
    | 'extreme-heat'
    | 'cold-snap'
    | 'snow';
  temperatureC: number;
  windKmh?: number;
  precipMm?: number;
}

export type ClimateRiskFactor =
  | 'slippery-surface'
  | 'lightning-exposure'
  | 'heat-stress'
  | 'hypothermia'
  | 'reduced-visibility'
  | 'falling-objects'
  | 'electrical-hazard';

export interface ClimateProjectContext {
  id: string;
  workTypes: string[];
  outdoor: boolean;
}

export type ClimateRiskNodeType =
  | 'CLIMATE_RISK'
  | 'venturi-warning'
  | 'windload-warning';

export interface ClimateRiskNodePayload {
  title: string;
  description: string;
  type: ClimateRiskNodeType;
  metadata: {
    conditionCode: ClimateForecastDay['conditionCode'];
    temperatureC: number;
    windKmh?: number;
    precipMm?: number;
    forecastDateISO: string;
    riskFactors: ClimateRiskFactor[];
  };
  connections: string[];
}

export interface ClimateRiskAssessment {
  projectId: string;
  forecast: ClimateForecastDay;
  riskFactors: ClimateRiskFactor[];
  recommendedControls: string[];
  riskNodePayload: ClimateRiskNodePayload;
}

/* -------------------------------------------------------------------------- */
/* Risk assessment                                                              */
/* -------------------------------------------------------------------------- */

const ELECTRICAL_KEYWORDS = ['electric', 'eléctric', 'electrico', 'tablero', 'media tensión'];
const HEIGHT_KEYWORDS = ['altura', 'andamio', 'arnes', 'arnés'];

function involvesElectricalWork(workTypes: string[]): boolean {
  return workTypes.some((w) =>
    ELECTRICAL_KEYWORDS.some((k) => w.toLowerCase().includes(k)),
  );
}

function involvesHeightWork(workTypes: string[]): boolean {
  return workTypes.some((w) =>
    HEIGHT_KEYWORDS.some((k) => w.toLowerCase().includes(k)),
  );
}

export function assessClimateRisk(
  forecast: ClimateForecastDay,
  projectContext: { workTypes: string[]; outdoor: boolean },
): ClimateRiskFactor[] {
  const factors = new Set<ClimateRiskFactor>();
  const { conditionCode, temperatureC, windKmh, precipMm } = forecast;
  const electrical = involvesElectricalWork(projectContext.workTypes);
  const height = involvesHeightWork(projectContext.workTypes);

  if (conditionCode === 'rainy') {
    if (projectContext.outdoor) factors.add('slippery-surface');
    if (electrical && projectContext.outdoor) factors.add('electrical-hazard');
    if ((precipMm ?? 0) >= 20) factors.add('reduced-visibility');
  }

  if (conditionCode === 'stormy') {
    if (projectContext.outdoor) {
      factors.add('lightning-exposure');
      factors.add('reduced-visibility');
      factors.add('slippery-surface');
    }
    if (electrical && projectContext.outdoor) factors.add('electrical-hazard');
  }

  if (conditionCode === 'extreme-heat' || temperatureC >= 35) {
    if (projectContext.outdoor) factors.add('heat-stress');
  }

  if (conditionCode === 'cold-snap' || temperatureC <= 0) {
    if (projectContext.outdoor) factors.add('hypothermia');
  }

  if (conditionCode === 'windy') {
    if (projectContext.outdoor && (windKmh ?? 0) >= 40) {
      factors.add('falling-objects');
    }
    if (height && (windKmh ?? 0) >= 30 && projectContext.outdoor) {
      factors.add('falling-objects');
    }
  }

  if (conditionCode === 'snow') {
    if (projectContext.outdoor) {
      factors.add('slippery-surface');
      factors.add('reduced-visibility');
      factors.add('hypothermia');
    }
  }

  // Sunny / benign: no factors.
  return Array.from(factors);
}

/* -------------------------------------------------------------------------- */
/* Recommended controls (Spanish)                                              */
/* -------------------------------------------------------------------------- */

const CONTROLS_BY_FACTOR: Record<ClimateRiskFactor, string[]> = {
  'slippery-surface': [
    'Demarcar y señalizar pisos mojados; reforzar EPP antideslizante.',
    'Suspender trabajos sobre superficies inclinadas mojadas.',
  ],
  'lightning-exposure': [
    'Suspender trabajos en altura y a la intemperie ante actividad eléctrica atmosférica.',
    'Activar protocolo de refugio (regla 30/30) y desconectar equipos eléctricos exteriores.',
  ],
  'heat-stress': [
    'Pausas activas y rotación de cuadrillas; hidratación cada 20 min.',
    'Reprogramar tareas pesadas a horario de menor radiación (antes de 11:00 y después de 16:00).',
  ],
  hypothermia: [
    'Entregar EPP térmico (capas, guantes, calzado aislado) y limitar exposición continua al frío.',
    'Habilitar sala de calefacción para descansos.',
  ],
  'reduced-visibility': [
    'Reforzar señalización lumínica y chalecos reflectantes; reducir velocidad de maquinaria.',
    'Suspender maniobras críticas si la visibilidad es inferior al umbral seguro.',
  ],
  'falling-objects': [
    'Asegurar materiales sueltos y herramientas en altura; instalar mallas de contención.',
    'Suspender trabajos en altura con vientos sobre 50 km/h.',
  ],
  'electrical-hazard': [
    'Desenergizar circuitos expuestos; verificar puesta a tierra y bloqueo/etiquetado (LOTO).',
    'Suspender trabajo eléctrico en exterior con lluvia o tormenta.',
  ],
};

function buildControls(factors: ClimateRiskFactor[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of factors) {
    for (const c of CONTROLS_BY_FACTOR[f] ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Title / description helpers                                                 */
/* -------------------------------------------------------------------------- */

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const CONDITION_LABEL: Record<ClimateForecastDay['conditionCode'], string> = {
  sunny: 'cielo despejado',
  rainy: 'lluvia intensa',
  stormy: 'tormenta eléctrica',
  windy: 'vientos fuertes',
  'extreme-heat': 'ola de calor',
  'cold-snap': 'ola de frío',
  snow: 'nevazón',
};

function formatSpanishDate(d: Date): string {
  return `${d.getUTCDate()} ${SPANISH_MONTHS[d.getUTCMonth()]}`;
}

function buildTitle(forecast: ClimateForecastDay, projectId: string): string {
  return `Riesgo climático: ${CONDITION_LABEL[forecast.conditionCode]} ${formatSpanishDate(forecast.date)} en proyecto ${projectId}`;
}

function buildDescription(
  forecast: ClimateForecastDay,
  factors: ClimateRiskFactor[],
  controls: string[],
): string {
  const lines = [
    `Pronóstico para el ${formatSpanishDate(forecast.date)}: ${CONDITION_LABEL[forecast.conditionCode]}, ${forecast.temperatureC}°C.`,
    forecast.windKmh != null ? `Viento: ${forecast.windKmh} km/h.` : null,
    forecast.precipMm != null ? `Precipitación: ${forecast.precipMm} mm.` : null,
    `Factores de riesgo identificados: ${factors.join(', ') || 'ninguno'}.`,
    'Controles recomendados:',
    ...controls.map((c) => `- ${c}`),
  ];
  return lines.filter((l): l is string => l != null).join('\n');
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export function buildClimateRiskNodes(
  forecasts: ClimateForecastDay[],
  projects: ClimateProjectContext[],
): ClimateRiskAssessment[] {
  const out: ClimateRiskAssessment[] = [];
  for (const project of projects) {
    for (const forecast of forecasts) {
      const factors = assessClimateRisk(forecast, {
        outdoor: project.outdoor,
        workTypes: project.workTypes,
      });
      if (factors.length > 0) {
        const controls = buildControls(factors);
        const payload: ClimateRiskNodePayload = {
          title: buildTitle(forecast, project.id),
          description: buildDescription(forecast, factors, controls),
          type: 'CLIMATE_RISK',
          metadata: {
            conditionCode: forecast.conditionCode,
            temperatureC: forecast.temperatureC,
            windKmh: forecast.windKmh,
            precipMm: forecast.precipMm,
            forecastDateISO: forecast.date.toISOString(),
            riskFactors: factors,
          },
          connections: [project.id],
        };
        out.push({
          projectId: project.id,
          forecast,
          riskFactors: factors,
          recommendedControls: controls,
          riskNodePayload: payload,
        });
      }

      // Bernoulli-driven additive nodes (NCh 432).
      const venturi = generateVenturiRiskNode(forecast, project);
      if (venturi) out.push(venturi);

      const windload = generateWindloadRiskNode(forecast, project);
      if (windload) out.push(windload);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Bernoulli-driven climate-risk generators (NCh 432)                         */
/* -------------------------------------------------------------------------- */

/**
 * generateVenturiRiskNode — emits a venturi-warning node when winds exceed
 * 40 km/h at a project tagged as a tunnel or underground mine. The dynamic
 * pressure (½·ρ·v²) is reported and compared against a 200 Pa informational
 * threshold for tunnel-mouth suction effects.
 *
 * Ref.: NCh 432 (Cargas de viento sobre construcciones).
 */
export function generateVenturiRiskNode(
  forecast: ClimateForecastDay,
  project: ClimateProjectContext,
): ClimateRiskAssessment | null {
  const windKmh = forecast.windKmh ?? 0;
  if (windKmh <= VENTURI_WIND_KMH_TRIGGER) return null;
  if (!hasKeyword(project.workTypes, TUNNEL_KEYWORDS)) return null;

  const vMs = windSpeedKmhToMs(windKmh);
  const qPa = dynamicPressure(AIR_DENSITY_KG_M3, vMs);
  const exceedsThreshold = qPa > VENTURI_DYNAMIC_PRESSURE_PA_TRIGGER;

  const description = [
    `Pronóstico para el ${formatSpanishDate(forecast.date)}: viento ${windKmh} km/h en proyecto ${project.id}.`,
    `Presión dinámica calculada: ${qPa.toFixed(1)} Pa (ρ=${AIR_DENSITY_KG_M3} kg/m³).`,
    exceedsThreshold
      ? `Supera el umbral informativo de ${VENTURI_DYNAMIC_PRESSURE_PA_TRIGGER} Pa: riesgo elevado de succión por efecto Venturi en bocas de túnel.`
      : `Bajo el umbral de ${VENTURI_DYNAMIC_PRESSURE_PA_TRIGGER} Pa, mantener vigilancia.`,
    'Ref.: NCh 432.',
  ].join('\n');

  const payload: ClimateRiskNodePayload = {
    title: 'Posible succión por efecto Venturi en boca de túnel',
    description,
    type: 'venturi-warning',
    metadata: {
      conditionCode: forecast.conditionCode,
      temperatureC: forecast.temperatureC,
      windKmh: forecast.windKmh,
      precipMm: forecast.precipMm,
      forecastDateISO: forecast.date.toISOString(),
      riskFactors: [],
    },
    connections: [project.id],
  };

  return {
    projectId: project.id,
    forecast,
    riskFactors: [],
    recommendedControls: [
      'Cerrar accesos vehiculares en bocas de túnel hasta normalizar el viento.',
      'Reforzar fijación de carteles, mallas y elementos sueltos cerca del portal.',
    ],
    riskNodePayload: payload,
  };
}

/**
 * generateWindloadRiskNode — emits a windload-warning node when winds exceed
 * 60 km/h at a project that includes temporary structures (cranes,
 * scaffolding, modular camps). Computes F = Cp · ½·ρ·v² · A on a typical
 * 20 m² panel and compares against the NCh 432 informational threshold.
 */
export function generateWindloadRiskNode(
  forecast: ClimateForecastDay,
  project: ClimateProjectContext,
): ClimateRiskAssessment | null {
  const windKmh = forecast.windKmh ?? 0;
  if (windKmh <= WINDLOAD_KMH_TRIGGER) return null;
  if (!hasKeyword(project.workTypes, TEMP_STRUCTURE_KEYWORDS)) return null;

  const vMs = windSpeedKmhToMs(windKmh);
  const forceN = windLoadOnSurface(
    WINDLOAD_TYPICAL_AREA_M2,
    vMs,
    WINDLOAD_PRESSURE_COEFF,
    AIR_DENSITY_KG_M3,
  );
  const exceedsLimit = forceN > WINDLOAD_FORCE_N_TRIGGER;

  const description = [
    `Pronóstico para el ${formatSpanishDate(forecast.date)}: viento ${windKmh} km/h en proyecto ${project.id}.`,
    `Carga estimada sobre 20 m² (Cp=${WINDLOAD_PRESSURE_COEFF}): ${(forceN / 1000).toFixed(1)} kN.`,
    exceedsLimit
      ? `Supera el umbral NCh 432 informativo de ${(WINDLOAD_FORCE_N_TRIGGER / 1000).toFixed(0)} kN: riesgo crítico para estructuras temporales.`
      : `Bajo el umbral NCh 432, mantener vigilancia.`,
    'Ref.: NCh 432 (Cargas de viento sobre construcciones).',
  ].join('\n');

  const payload: ClimateRiskNodePayload = {
    title: 'Carga de viento crítica para estructuras temporales',
    description,
    type: 'windload-warning',
    metadata: {
      conditionCode: forecast.conditionCode,
      temperatureC: forecast.temperatureC,
      windKmh: forecast.windKmh,
      precipMm: forecast.precipMm,
      forecastDateISO: forecast.date.toISOString(),
      riskFactors: [],
    },
    connections: [project.id],
  };

  return {
    projectId: project.id,
    forecast,
    riskFactors: [],
    recommendedControls: [
      'Detener operación de grúas torre y plumas; bajar a posición de bandera.',
      'Asegurar andamios y campamentos modulares; suspender izajes.',
    ],
    riskNodePayload: payload,
  };
}
