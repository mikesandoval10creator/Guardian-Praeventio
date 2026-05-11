// Praeventio Guard — Sprint 39 Fase L.3: Investigación sin Culpa + Cadena de Tiempo.
//
// Cierra: Documento usuario "§311-319" — Top usuario #5 + #6
//
// Extiende el clasificador de causa raíz con cuatro capacidades:
//
//   1. analyzePunitiveLanguage: detecta lenguaje acusatorio ("culpa del
//      trabajador", "negligencia", "error humano sin contexto") y sugiere
//      reformulación sistémica (§312).
//
//   2. InvestigationGuide: banco de preguntas para entrevistas sin sesgo
//      (§313-314). Las preguntas se enfocan en el sistema, no la persona.
//
//   3. WitnessTestimony con versionado: cada declaración puede variar
//      en el tiempo; el sistema preserva las versiones (§315-316).
//
//   4. IncidentTimeline: hitos ordenados (pre / durante / post incidente)
//      + decisiones previas que pudieron influir (§317-319).
//
// Determinístico, sin LLM. El motor existente `rootCauseClassifier` queda
// intacto — esto agrega funcionalidad encima.

// ────────────────────────────────────────────────────────────────────────
// 1. Punitive language detection (§312)
// ────────────────────────────────────────────────────────────────────────

export interface PunitiveLanguageReport {
  /** Frases detectadas que culpan al individuo. */
  flaggedPhrases: string[];
  /** Sugerencias de reformulación sistémica. */
  suggestions: string[];
  /** True si el texto necesita ser reescrito antes de cerrar la investigación. */
  needsRewrite: boolean;
}

const PUNITIVE_PATTERNS: Array<{ regex: RegExp; suggestion: string }> = [
  {
    regex: /\bculpa\s+del?\s+trabajador?\b/i,
    suggestion: 'Reemplaza por "factores que llevaron al trabajador a..." (causa sistémica).',
  },
  {
    regex: /\bnegligencia\b/i,
    suggestion: 'En vez de "negligencia", describe: ¿qué procedimiento faltó? ¿qué control no estaba?',
  },
  {
    regex: /\berror\s+humano\b/i,
    suggestion: 'El "error humano" suele ser síntoma. Analiza diseño del sistema, presión de tiempo, training.',
  },
  {
    regex: /\bdesobedecer?\b|\bdesobedeció\b/i,
    suggestion: 'Pregunta primero: ¿el procedimiento era ejecutable? ¿estaba al alcance? ¿lo conocía?',
  },
  {
    regex: /\bimprudencia\b|\bimprudente\b/i,
    suggestion: '¿Por qué era posible el comportamiento? ¿qué barrera de ingeniería faltó?',
  },
  {
    regex: /\b(no\s+respetó|no\s+siguió)\s+(las?\s+)?normas?\b/i,
    suggestion: 'Verifica si las normas se conocen, son ejecutables y están al alcance del trabajador.',
  },
  {
    regex: /\bfalta\s+de\s+cuidado\b/i,
    suggestion: 'Las acciones individuales no previenen reincidencia. Busca la causa sistémica.',
  },
];

export function analyzePunitiveLanguage(text: string): PunitiveLanguageReport {
  const flaggedPhrases: string[] = [];
  const suggestions: string[] = [];
  for (const { regex, suggestion } of PUNITIVE_PATTERNS) {
    const m = text.match(regex);
    if (m) {
      flaggedPhrases.push(m[0]);
      if (!suggestions.includes(suggestion)) suggestions.push(suggestion);
    }
  }
  return {
    flaggedPhrases,
    suggestions,
    needsRewrite: flaggedPhrases.length > 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 2. Investigation guide (§313)
// ────────────────────────────────────────────────────────────────────────

export type InvestigationDimension =
  | 'procedure'
  | 'training'
  | 'supervision'
  | 'resources'
  | 'equipment'
  | 'environment'
  | 'organization'
  | 'communication';

export interface InvestigationQuestion {
  dimension: InvestigationDimension;
  question: string;
  /** Por qué esta pregunta importa — psicología organizacional. */
  rationale: string;
}

const QUESTION_BANK: InvestigationQuestion[] = [
  {
    dimension: 'procedure',
    question: '¿El procedimiento aplicable existía, estaba vigente y era ejecutable en esas condiciones?',
    rationale: 'Si el procedimiento era irreal o estaba desactualizado, el problema está en su diseño, no en quien lo aplicó.',
  },
  {
    dimension: 'procedure',
    question: '¿El trabajador conocía el procedimiento al momento del evento?',
    rationale: 'Conocer no es lo mismo que tener acceso. Hay que verificar acceso real, no firma de capacitación.',
  },
  {
    dimension: 'training',
    question: '¿La capacitación recibida cubría específicamente esta tarea/contexto?',
    rationale: 'Capacitación genérica no prepara para tareas específicas — es un riesgo común en accidentes.',
  },
  {
    dimension: 'supervision',
    question: '¿Había supervisión disponible y accesible al momento del evento?',
    rationale: 'La presencia formal del supervisor no equivale a su disponibilidad operativa real.',
  },
  {
    dimension: 'resources',
    question: '¿El trabajador tenía los recursos físicos, EPP y tiempo necesarios para hacer el trabajo correctamente?',
    rationale: 'Cuando faltan recursos, el sistema obliga al trabajador a improvisar — eso es presión sistémica.',
  },
  {
    dimension: 'equipment',
    question: '¿El equipo estaba en condiciones de uso y se había mantenido conforme al programa?',
    rationale: 'Mantención atrasada o equipo deteriorado introduce fallas que la persona no causa.',
  },
  {
    dimension: 'environment',
    question: '¿Las condiciones ambientales (clima, iluminación, ruido) afectaron la tarea?',
    rationale: 'Algunos eventos solo ocurren bajo combinaciones ambientales — documentarlas previene reincidencia.',
  },
  {
    dimension: 'organization',
    question: '¿Hubo presión por cumplir plazos / metas que llevó a tomar atajos?',
    rationale: 'Cultura "production over safety" empuja a normalizar el desvío. Pregunta sin asumir respuesta.',
  },
  {
    dimension: 'communication',
    question: '¿Había información crítica que el trabajador no recibió a tiempo?',
    rationale: 'Comunicación incompleta (turno entrante, cambios operacionales) es causa frecuente.',
  },
  {
    dimension: 'communication',
    question: '¿El trabajador se sintió libre de detener la tarea ante una condición insegura?',
    rationale: 'Si la cultura penaliza detener, los trabajadores no usan ese mecanismo, por mucho que esté documentado.',
  },
];

export function getInvestigationQuestions(
  dimension?: InvestigationDimension,
): InvestigationQuestion[] {
  if (!dimension) return [...QUESTION_BANK];
  return QUESTION_BANK.filter((q) => q.dimension === dimension);
}

/** Una secuencia mínima de preguntas: una por dimensión. */
export function getStarterQuestionnaire(): InvestigationQuestion[] {
  const seen = new Set<InvestigationDimension>();
  const out: InvestigationQuestion[] = [];
  for (const q of QUESTION_BANK) {
    if (!seen.has(q.dimension)) {
      out.push(q);
      seen.add(q.dimension);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// 3. Witness testimony with versioning (§315-316)
// ────────────────────────────────────────────────────────────────────────

export interface WitnessTestimonyVersion {
  versionNumber: number;
  capturedAt: string;
  text: string;
  /** Si el testigo dio consentimiento informado para esta versión. */
  consentGiven: boolean;
  /** Notas del investigador sobre por qué se actualizó. */
  revisionReason?: string;
}

export interface WitnessTestimony {
  /** UID del testigo. */
  witnessUid: string;
  /** Rol del testigo respecto al incidente. */
  relationToIncident: 'present' | 'first_responder' | 'supervisor' | 'crewmate' | 'other';
  /** Versiones cronológicas. Última = vigente. */
  versions: WitnessTestimonyVersion[];
}

export function appendTestimonyVersion(
  testimony: WitnessTestimony,
  newVersion: Omit<WitnessTestimonyVersion, 'versionNumber'>,
): WitnessTestimony {
  const versionNumber = testimony.versions.length + 1;
  return {
    ...testimony,
    versions: [...testimony.versions, { ...newVersion, versionNumber }],
  };
}

export interface TestimonyDiff {
  fromVersion: number;
  toVersion: number;
  /** ¿La declaración nueva contradice/diverge de la anterior? */
  hasSignificantChange: boolean;
  /** % de coincidencia léxica básica. */
  similarityPercent: number;
}

/**
 * Compara dos versiones de un testimonio. Similitud calculada con
 * Jaccard sobre palabras (no es perfecto pero funciona como señal).
 * Si similitud < 60% se considera cambio significativo.
 */
export function diffTestimonyVersions(
  v1: WitnessTestimonyVersion,
  v2: WitnessTestimonyVersion,
): TestimonyDiff {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const a = tokenize(v1.text);
  const b = tokenize(v2.text);
  const intersection = new Set([...a].filter((w) => b.has(w))).size;
  const union = new Set([...a, ...b]).size;
  const similarityPercent = union === 0 ? 0 : Math.round((intersection / union) * 100);
  return {
    fromVersion: v1.versionNumber,
    toVersion: v2.versionNumber,
    hasSignificantChange: similarityPercent < 60,
    similarityPercent,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 4. Incident timeline (§317-319)
// ────────────────────────────────────────────────────────────────────────

export type TimelineMomentKind =
  | 'pre_incident_decision' // ej: postergó mantención
  | 'precondition_change'   // ej: cambio cuadrilla, omitió charla
  | 'incident_trigger'      // ej: liberación energía, fallo equipo
  | 'response'              // ej: activación SOS, evacuación
  | 'post_incident_action'; // ej: bloqueo zona, derivación mutual

export interface TimelineMoment {
  /** ISO-8601 del momento. */
  at: string;
  kind: TimelineMomentKind;
  description: string;
  /** UIDs involucrados (opcional). */
  involvedUids?: string[];
  /** Decisión asociada (si aplica, para §319). */
  priorDecision?: { decisionMakerUid: string; rationale: string };
}

export interface IncidentTimeline {
  incidentId: string;
  moments: TimelineMoment[];
}

export function appendTimelineMoment(
  timeline: IncidentTimeline,
  moment: TimelineMoment,
): IncidentTimeline {
  const merged = [...timeline.moments, moment].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  return { ...timeline, moments: merged };
}

export interface TimelineGap {
  fromMoment: TimelineMoment;
  toMoment: TimelineMoment;
  gapMinutes: number;
  /** Si el gap es sospechosamente largo en una fase crítica. */
  isUnusual: boolean;
}

/**
 * Detecta "huecos" entre momentos consecutivos. Útil para investigación
 * — si entre `incident_trigger` y `response` pasan más de 5 minutos,
 * vale la pena revisar por qué.
 */
export function findTimelineGaps(timeline: IncidentTimeline): TimelineGap[] {
  const sorted = [...timeline.moments].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  const gaps: TimelineGap[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const gapMinutes = Math.round((Date.parse(to.at) - Date.parse(from.at)) / 60_000);
    const isUnusual =
      from.kind === 'incident_trigger' && to.kind === 'response' && gapMinutes > 5;
    gaps.push({ fromMoment: from, toMoment: to, gapMinutes, isUnusual });
  }
  return gaps;
}

/**
 * Extrae solo las decisiones previas al evento — el set §319.
 */
export function getPriorDecisions(timeline: IncidentTimeline): TimelineMoment[] {
  return timeline.moments
    .filter(
      (m) => m.kind === 'pre_incident_decision' || m.kind === 'precondition_change',
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
