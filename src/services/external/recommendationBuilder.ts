// Calm-recommendation builder.
//
// REGLA CRÍTICA (directiva 4 del usuario):
//   "ellos nos dan la información de que habrá una tormenta por ejemplo,
//   nosotros para qué le vamos a decir en la recomendación 'la nasa
//   establece que habrá tormenta', mejor le damos una recomendación más
//   tranquila"
//
// Este builder convierte un evento crudo (EONET o USGS) en una
// recomendación neutra. El "organismo" de la fuente NUNCA aparece en
// title/body/actions; solo en `citation` con label genérico
// (`natural-event-feed`). El detalle especifico de la fuente puede vivir
// en `expandableDetail` (footer opt-in para auditoría/legal), nunca en
// la copia visible por defecto.
//
// Otras reglas:
//   - severity ∈ {info, caution, high} — sin 'critical' para fuentes externas.
//   - blockOperation === false SIEMPRE — la fuente externa no tiene
//     poder regulatorio, solo informa. Bloqueos los ordena CPHS / experto
//     interno.

import type { EonetEvent } from './eonet/types.js';
import type { UsgsEarthquake } from './usgs/types.js';

export type RecommendationSeverity = 'info' | 'caution' | 'high';

export interface RecommendationAction {
  kind:
    | 'review_protocols'
    | 'consult_weather'
    | 'activate_prevention_plan'
    | 'check_evacuation_routes'
    | 'monitor_continuously';
  label: string;
}

export interface RecommendationCitation {
  /**
   * Label genérico — NO menciona organismo. Permite trazar la fuente en
   * panel de auditoría/legal sin alarmar al operario.
   */
  source: 'natural-event-feed';
  refId: string;
}

export interface CalmRecommendation {
  title: string;
  body: string;
  severity: RecommendationSeverity;
  citation: RecommendationCitation;
  actions: RecommendationAction[];
  /** false SIEMPRE para fuentes externas — política directiva 4. */
  blockOperation: false;
  /**
   * Opt-in: detalle técnico (incluye nombre del organismo) que puede
   * mostrarse en un expandable / footer si el usuario lo solicita. NUNCA
   * se inserta en `body`.
   */
  expandableDetail?: string;
}

// Palabras prohibidas en title/body/actions (chequeable por test).
const FORBIDDEN_WORDS = [
  'NASA',
  'USGS',
  'Earth Observatory',
  'EONET',
  'EVACUAR',
  'INMEDIATAMENTE',
  'EMERGENCIA CRÍTICA',
  'EMERGENCIA CRITICA',
  'NASA CONFIRMA',
  'USGS DETECTA',
];

function assertCalm(text: string): void {
  const upper = text.toUpperCase();
  for (const w of FORBIDDEN_WORDS) {
    if (upper.includes(w.toUpperCase())) {
      throw new Error(
        `[recommendationBuilder] forbidden phrase "${w}" leaked into calm copy`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// EONET → recomendación
// ---------------------------------------------------------------------------

const EONET_CATEGORY_TO_SEVERITY: Record<string, RecommendationSeverity> = {
  wildfires: 'caution',
  severeStorms: 'caution',
  volcanoes: 'high',
  seaLakeIce: 'info',
  floods: 'caution',
  manmade: 'info',
  landslides: 'caution',
  drought: 'info',
};

function severityFromEonet(event: EonetEvent): RecommendationSeverity {
  const ids = event.categories.map((c) => c.id);
  let best: RecommendationSeverity = 'info';
  for (const id of ids) {
    const s = EONET_CATEGORY_TO_SEVERITY[id];
    if (s === 'high') return 'high';
    if (s === 'caution') best = 'caution';
  }
  return best;
}

function buildEonetRecommendation(event: EonetEvent): CalmRecommendation {
  const severity = severityFromEonet(event);
  const title = 'Considerar evento natural en zona';
  const body =
    'Se detectó actividad natural en proximidad del proyecto. ' +
    'Se sugiere revisar protocolos de seguridad y consultar el ' +
    'pronóstico actualizado antes de iniciar tareas en exterior.';

  const actions: RecommendationAction[] = [
    { kind: 'review_protocols', label: 'Revisar protocolos' },
    { kind: 'consult_weather', label: 'Pronóstico actualizado' },
  ];
  if (severity === 'high') {
    actions.push({
      kind: 'activate_prevention_plan',
      label: 'Activar plan de prevención',
    });
  }

  const rec: CalmRecommendation = {
    title,
    body,
    severity,
    citation: { source: 'natural-event-feed', refId: event.id },
    actions,
    blockOperation: false,
    // expandableDetail puede mencionar la fuente — es opt-in, no body.
    expandableDetail: `External feed reference: EONET event ${event.id}`,
  };

  assertCalm(rec.title);
  assertCalm(rec.body);
  for (const a of rec.actions) assertCalm(a.label);
  return rec;
}

// ---------------------------------------------------------------------------
// USGS → recomendación
// ---------------------------------------------------------------------------

function severityFromMagnitude(mag: number | null | undefined): RecommendationSeverity {
  if (mag == null) return 'info';
  if (mag >= 6.5) return 'high';
  if (mag >= 4.5) return 'caution';
  return 'info';
}

function buildUsgsRecommendation(event: UsgsEarthquake): CalmRecommendation {
  const severity = severityFromMagnitude(event.properties.mag);
  const title = 'Considerar movimiento sísmico reciente en zona';
  const body =
    'Se detectó actividad sísmica reciente en proximidad del proyecto. ' +
    'Se sugiere revisar protocolos de seguridad y verificar rutas de ' +
    'evacuación antes de continuar con tareas en altura o espacios confinados.';

  const actions: RecommendationAction[] = [
    { kind: 'review_protocols', label: 'Revisar protocolos' },
    { kind: 'check_evacuation_routes', label: 'Verificar rutas de evacuación' },
  ];
  if (severity === 'high') {
    actions.push({
      kind: 'activate_prevention_plan',
      label: 'Activar plan de prevención',
    });
  } else if (severity === 'caution') {
    actions.push({
      kind: 'monitor_continuously',
      label: 'Monitoreo continuo',
    });
  }

  const rec: CalmRecommendation = {
    title,
    body,
    severity,
    citation: { source: 'natural-event-feed', refId: event.id },
    actions,
    blockOperation: false,
    expandableDetail: `External feed reference: USGS earthquake feed ${event.id}`,
  };

  assertCalm(rec.title);
  assertCalm(rec.body);
  for (const a of rec.actions) assertCalm(a.label);
  return rec;
}

// ---------------------------------------------------------------------------
// Public API — discriminated by shape
// ---------------------------------------------------------------------------

export function buildCalmRecommendation(
  event: EonetEvent | UsgsEarthquake,
): CalmRecommendation {
  if (isUsgsEarthquake(event)) {
    return buildUsgsRecommendation(event);
  }
  return buildEonetRecommendation(event as EonetEvent);
}

function isUsgsEarthquake(e: unknown): e is UsgsEarthquake {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { type?: unknown }).type === 'Feature' &&
    typeof (e as { geometry?: unknown }).geometry === 'object'
  );
}
