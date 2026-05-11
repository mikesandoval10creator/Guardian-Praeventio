// Praeventio Guard — Sprint K: Biblioteca de Lecciones Aprendidas (F.12).
//
// Cierra: Documento usuario "F.12" + Plan Sprint K
//
// Cada incidente significativo deja una "lección" reutilizable. La lección
// vive como nodo `LESSON` con edges:
//   - LESSON derived_from INCIDENT
//   - LESSON applies_to RISK
//   - LESSON applies_to TASK
//
// Este motor:
//   - Extrae lecciones canónicas (texto + tags + scope)
//   - Permite búsqueda por palabras clave / tags
//   - Sugiere lecciones relevantes para un contexto dado
//   - Mide adopción: cuántas tareas similares aplicaron la lección
//
// Determinístico. La búsqueda es léxica simple (tokenización + tags).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type LessonScope = 'global' | 'industry' | 'project' | 'crew';

export interface Lesson {
  id: string;
  /** Resumen humano de 1-2 frases. */
  summary: string;
  /** Acción preventiva derivada. */
  preventiveAction: string;
  /** Categorías de riesgo a las que aplica. */
  riskCategories: string[];
  /** Tags libres para búsqueda. */
  tags: string[];
  /** Scope de aplicabilidad. */
  scope: LessonScope;
  /** Industria si scope='industry'. */
  industry?: string;
  /** UID del incidente origen. */
  derivedFromIncidentId?: string;
  /** ISO-8601. */
  publishedAt: string;
  /** Cuántas tareas la han adoptado (medición de impacto). */
  adoptionCount: number;
}

// ────────────────────────────────────────────────────────────────────────
// Search / suggest
// ────────────────────────────────────────────────────────────────────────

export interface LessonSearchQuery {
  /** Texto libre. */
  text?: string;
  /** Filtro por categoría de riesgo. */
  riskCategory?: string;
  /** Tag exacto. */
  tag?: string;
  /** Filtro de scope. */
  scope?: LessonScope;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export function searchLessons(library: Lesson[], q: LessonSearchQuery): Lesson[] {
  const queryTokens = q.text ? new Set(tokenize(q.text)) : null;
  return library.filter((l) => {
    if (q.riskCategory && !l.riskCategories.includes(q.riskCategory)) return false;
    if (q.tag && !l.tags.includes(q.tag)) return false;
    if (q.scope && l.scope !== q.scope) return false;
    if (queryTokens) {
      const corpus = [l.summary, l.preventiveAction, ...l.tags].join(' ');
      const corpusTokens = new Set(tokenize(corpus));
      const hit = [...queryTokens].some((t) => corpusTokens.has(t));
      if (!hit) return false;
    }
    return true;
  });
}

export interface TaskContext {
  taskId: string;
  riskCategories: string[];
  industry?: string;
  projectId?: string;
}

export interface LessonSuggestion extends Lesson {
  /** Match score con el contexto (0-100). */
  relevance: number;
  /** Razones del match. */
  matchReasons: string[];
}

/**
 * Sugiere lecciones relevantes para una tarea. Score:
 *   +40 por cada riskCategory que matchea
 *   +20 si scope='industry' y matchea
 *   +15 si scope='global' (siempre aplica)
 *   +10 por adoptionCount > 5
 */
export function suggestLessonsForTask(
  library: Lesson[],
  context: TaskContext,
  topN = 5,
): LessonSuggestion[] {
  const scored: LessonSuggestion[] = library.map((l) => {
    let relevance = 0;
    const matchReasons: string[] = [];

    const matchingCats = l.riskCategories.filter((c) => context.riskCategories.includes(c));
    if (matchingCats.length > 0) {
      relevance += matchingCats.length * 40;
      matchReasons.push(`Match categorías: ${matchingCats.join(', ')}`);
    }
    if (l.scope === 'industry' && l.industry === context.industry) {
      relevance += 20;
      matchReasons.push('Misma industria');
    }
    if (l.scope === 'global') {
      relevance += 15;
      matchReasons.push('Lección global aplicable');
    }
    if (l.adoptionCount >= 5) {
      relevance += 10;
      matchReasons.push(`Adopción alta (${l.adoptionCount})`);
    }
    return { ...l, relevance: Math.min(relevance, 100), matchReasons };
  });

  return scored
    .filter((s) => s.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, topN);
}

// ────────────────────────────────────────────────────────────────────────
// Adoption tracking
// ────────────────────────────────────────────────────────────────────────

export function recordAdoption(lesson: Lesson): Lesson {
  return { ...lesson, adoptionCount: lesson.adoptionCount + 1 };
}

export interface AdoptionReport {
  totalLessons: number;
  withAdoption: number;
  noAdoption: number;
  topAdopted: Lesson[];
}

export function buildAdoptionReport(library: Lesson[]): AdoptionReport {
  const sorted = [...library].sort((a, b) => b.adoptionCount - a.adoptionCount);
  return {
    totalLessons: library.length,
    withAdoption: library.filter((l) => l.adoptionCount > 0).length,
    noAdoption: library.filter((l) => l.adoptionCount === 0).length,
    topAdopted: sorted.slice(0, 10),
  };
}
