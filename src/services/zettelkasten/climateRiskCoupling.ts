/**
 * Climate ↔ Zettelkasten coupling.
 *
 * Pure module that turns a 3-day climate forecast (or any list of forecast
 * days) into RiskNode payloads ready to be inserted into the Zettelkasten
 * via useRiskEngine.addNode. The actual Firestore write happens elsewhere.
 *
 * Outputs are deterministic given the inputs — no IO, no Date.now().
 */

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

export interface ClimateRiskNodePayload {
  title: string;
  description: string;
  type: 'CLIMATE_RISK';
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
      if (factors.length === 0) continue;

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
  }
  return out;
}
