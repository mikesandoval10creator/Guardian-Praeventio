// Praeventio Guard — Sprint 39 Fase J.5: Sugeridor de Tema de Charla.
//
// Cierra: Documento usuario "Recomendaciones nuevas §60"
//
// Cada mañana, sugerir el tema de la charla de seguridad según
// señales contextuales:
//   - Incidentes recientes (priorizar tipo)
//   - Riesgos activos del proyecto
//   - Condiciones climáticas (UV alto, viento)
//   - Tareas programadas hoy
//   - Hallazgos frecuentes
//   - Capacitaciones pendientes
//
// Determinístico (no LLM). Devuelve top 3 sugerencias con score y
// rationale citando los disparadores.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface SafetyTalkSuggestion {
  topicId: string;
  title: string;
  rationale: string[];
  /** Score que ranking usa para ordenar (mayor = más prioritaria). */
  score: number;
  /** Duración sugerida en minutos. */
  durationMinutes: number;
}

export interface ContextSignals {
  /** Incidentes últimos 7d con su tipo. */
  recentIncidents: Array<{ kind: string; severity: 'low' | 'medium' | 'high' | 'critical' }>;
  /** Riesgos activos del proyecto. */
  activeRisks: string[];
  /** Tareas programadas hoy. */
  todaysTaskCategories: string[];
  /** Hallazgos abiertos por categoría (más frecuente = mayor score). */
  openFindingsByCategory: Record<string, number>;
  /** Condiciones climáticas. */
  weather?: {
    uvIndex?: number;
    temperatureC?: number;
    windSpeedKmh?: number;
    rainProbabilityPercent?: number;
  };
  /** Trabajadores nuevos esta semana. */
  newWorkersCount: number;
}

// ────────────────────────────────────────────────────────────────────────
// Topic catalog (canónico — extensible)
// ────────────────────────────────────────────────────────────────────────

interface TopicTemplate {
  topicId: string;
  title: string;
  durationMinutes: number;
  /** Si algún signal matches, suma el score asignado. */
  triggers: Array<{
    matcher: (s: ContextSignals) => boolean;
    score: number;
    rationale: string;
  }>;
}

const CATALOG: TopicTemplate[] = [
  {
    topicId: 'altura',
    title: 'Trabajo en altura: arnés, línea de vida y rescate',
    durationMinutes: 10,
    triggers: [
      {
        matcher: (s) => s.activeRisks.some((r) => /altura/i.test(r)),
        score: 50,
        rationale: 'Riesgo de altura activo en el proyecto',
      },
      {
        matcher: (s) => s.todaysTaskCategories.some((t) => /altura/i.test(t)),
        score: 70,
        rationale: 'Tareas en altura programadas hoy',
      },
      {
        matcher: (s) =>
          s.recentIncidents.some((i) => /altura|caida/i.test(i.kind)),
        score: 60,
        rationale: 'Incidente reciente relacionado con altura',
      },
    ],
  },
  {
    topicId: 'uv',
    title: 'Radiación UV: protección solar ocupacional',
    durationMinutes: 5,
    triggers: [
      {
        matcher: (s) => (s.weather?.uvIndex ?? 0) >= 7,
        score: 60,
        rationale: 'UV alto previsto para hoy (≥7)',
      },
    ],
  },
  {
    topicId: 'viento',
    title: 'Trabajo con viento fuerte: izajes y altura',
    durationMinutes: 5,
    triggers: [
      {
        matcher: (s) => (s.weather?.windSpeedKmh ?? 0) >= 40,
        score: 55,
        rationale: 'Viento ≥40 km/h: revisar izajes y altura',
      },
    ],
  },
  {
    topicId: 'electricidad',
    title: 'Trabajo eléctrico: LOTO y EPP dieléctrico',
    durationMinutes: 10,
    triggers: [
      {
        matcher: (s) => s.activeRisks.some((r) => /electric|tension/i.test(r)),
        score: 50,
        rationale: 'Riesgo eléctrico activo',
      },
      {
        matcher: (s) =>
          s.todaysTaskCategories.some((t) => /electric|loto/i.test(t)),
        score: 65,
        rationale: 'Tarea eléctrica/LOTO programada hoy',
      },
    ],
  },
  {
    topicId: 'epp',
    title: 'Uso correcto de EPP y revisión visual',
    durationMinutes: 5,
    triggers: [
      {
        matcher: (s) => (s.openFindingsByCategory['epp'] ?? 0) >= 3,
        score: 40,
        rationale: 'Hallazgos abiertos por EPP en proyecto',
      },
    ],
  },
  {
    topicId: 'orden_aseo',
    title: 'Orden y aseo: 5S aplicado a la jornada',
    durationMinutes: 5,
    triggers: [
      {
        matcher: (s) =>
          (s.openFindingsByCategory['orden_aseo'] ?? 0) +
            (s.openFindingsByCategory['housekeeping'] ?? 0) >=
          3,
        score: 35,
        rationale: 'Hallazgos repetidos de orden y aseo',
      },
    ],
  },
  {
    topicId: 'induccion_nuevos',
    title: 'Bienvenida y refresco de inducción para nuevos',
    durationMinutes: 8,
    triggers: [
      {
        matcher: (s) => s.newWorkersCount >= 1,
        score: 30,
        rationale: 'Hay trabajadores nuevos esta semana',
      },
    ],
  },
  {
    topicId: 'fatiga',
    title: 'Reconocer signos de fatiga y pausas activas',
    durationMinutes: 5,
    triggers: [
      {
        matcher: (s) =>
          s.recentIncidents.some((i) =>
            /fatiga|microsueno|microsueño/i.test(i.kind),
          ),
        score: 45,
        rationale: 'Near-miss reciente vinculado a fatiga',
      },
    ],
  },
  {
    topicId: 'cargas',
    title: 'Manejo manual de cargas: técnica y límites',
    durationMinutes: 5,
    triggers: [
      {
        matcher: (s) => s.activeRisks.some((r) => /carga|ergonom/i.test(r)),
        score: 30,
        rationale: 'Riesgo ergonómico / manejo de cargas activo',
      },
    ],
  },
  {
    topicId: 'confinado',
    title: 'Espacios confinados: gases, vigía y rescate',
    durationMinutes: 12,
    triggers: [
      {
        matcher: (s) => s.activeRisks.some((r) => /confinado/i.test(r)),
        score: 55,
        rationale: 'Riesgo confinado activo',
      },
      {
        matcher: (s) =>
          s.todaysTaskCategories.some((t) => /confinado/i.test(t)),
        score: 75,
        rationale: 'Trabajo en confinado programado hoy',
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

export function suggestTalks(
  signals: ContextSignals,
  topN: number = 3,
): SafetyTalkSuggestion[] {
  const suggestions: SafetyTalkSuggestion[] = [];
  for (const topic of CATALOG) {
    let score = 0;
    const rationale: string[] = [];
    for (const trigger of topic.triggers) {
      if (trigger.matcher(signals)) {
        score += trigger.score;
        rationale.push(trigger.rationale);
      }
    }
    if (score > 0) {
      suggestions.push({
        topicId: topic.topicId,
        title: topic.title,
        rationale,
        score,
        durationMinutes: topic.durationMinutes,
      });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, topN);
}
