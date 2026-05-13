// Praeventio Guard — Sprint 53: Portfolio Lessons Transfer Engine.
//
// Cierra: Documento usuario "§120-132" (2da tanda) — Transferencia de
// lecciones a nivel de portfolio (no de tarea).
//
// Complementario a:
//   - `lessonsLearned/lessonsLibrary` → match lección ↔ tarea individual.
//   - `projectClosure/projectClosureService` → extrae lecciones de UN
//     proyecto que cierra.
//
// Este motor opera **across the portfolio**: dado un proyecto NUEVO (o uno
// en curso) y la biblioteca histórica de lecciones de TODOS los proyectos
// previos, recomienda qué lecciones aplicar y con qué prioridad.
//
// Determinístico, sin LLM. Acompaña al closure engine.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type LessonCategory =
  | 'incident'
  | 'near_miss'
  | 'good_practice'
  | 'efficiency'
  | 'compliance'
  | 'culture';

export type ProjectSize = 'small' | 'medium' | 'large' | 'enterprise';

export type LessonSeverity = 'low' | 'medium' | 'high' | 'critical' | 'sif';

export interface LessonRecord {
  id: string;
  sourceProjectId: string;
  title: string;
  category: LessonCategory;
  applicableIndustries: string[];
  applicableSizes: ProjectSize[];
  /** Tipos de proyecto donde aplica. */
  applicableProjectKinds?: string[];
  /** Cuándo se capturó. */
  capturedAt: string;
  /** Tags para matching. */
  tags: string[];
  /** Severity del evento original. */
  originalSeverity?: LessonSeverity;
  /** Impacto estimado si se transfiere (ahorro CLP o riesgo evitado). */
  estimatedTransferValueClp?: number;
}

export interface TargetProjectContext {
  projectId: string;
  industry: string;
  size: ProjectSize;
  projectKind?: string;
  /** Tags del proyecto target, para overlap con tags de la lección. */
  tags?: string[];
  /** 0-1 — proporción de riesgos comunes con source. */
  currentRisksSimilarity: number;
}

export interface LessonTransferRecommendation {
  lesson: LessonRecord;
  matchScore: number;
  applicabilityReasons: string[];
  recommendedActions: string[];
  /** Si el caller debe priorizar esta transferencia. */
  highPriority: boolean;
}

export interface PortfolioSummary {
  totalLessons: number;
  byCategory: Record<string, number>;
  byIndustry: Record<string, number>;
  /** Lecciones con al menos un industry/size declarado (transferibles). */
  transferableCount: number;
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

function clampSimilarity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function isHighOrAbove(sev?: LessonSeverity): boolean {
  return sev === 'high' || sev === 'critical' || sev === 'sif';
}

function severityBonus(sev?: LessonSeverity): number {
  if (sev === 'sif' || sev === 'critical') return 10;
  if (sev === 'high') return 5;
  return 0;
}

function tagOverlapBonus(lessonTags: string[], targetTags?: string[]): {
  bonus: number;
  matched: string[];
} {
  if (!targetTags || targetTags.length === 0 || lessonTags.length === 0) {
    return { bonus: 0, matched: [] };
  }
  const targetSet = new Set(targetTags.map((t) => t.toLowerCase()));
  const matched: string[] = [];
  for (const t of lessonTags) {
    if (targetSet.has(t.toLowerCase())) matched.push(t);
  }
  if (matched.length === 0) return { bonus: 0, matched: [] };
  // 5 pts por tag hasta +20.
  return { bonus: Math.min(matched.length * 5, 20), matched };
}

function buildRecommendedActions(lesson: LessonRecord): string[] {
  const out: string[] = [];
  switch (lesson.category) {
    case 'incident':
      out.push(`Revisar control crítico asociado al incidente original (${lesson.sourceProjectId})`);
      out.push('Replicar matriz de barreras (Bowtie) o equivalente en el nuevo contexto');
      break;
    case 'near_miss':
      out.push('Documentar near-miss equivalente en el proyecto target y mitigar antes de iniciar tarea similar');
      break;
    case 'good_practice':
      out.push('Estandarizar la práctica en el proyecto target — incorporar a procedimiento operacional');
      break;
    case 'efficiency':
      out.push('Aplicar optimización al planning del proyecto target — medir ahorro estimado');
      break;
    case 'compliance':
      out.push('Verificar cumplimiento normativo equivalente — ajustar checklist regulatorio');
      break;
    case 'culture':
      out.push('Difundir aprendizaje en charla diaria / programa cultural del proyecto target');
      break;
  }
  if (isHighOrAbove(lesson.originalSeverity)) {
    out.push('Severity histórica alta — escalar a líder SSO antes de iniciar trabajo asociado');
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Scoring
// ────────────────────────────────────────────────────────────────────────
//
// - Industry match: +40
// - Size match: +20
// - ProjectKind match: +10
// - currentRisksSimilarity * 30
// - Severity bonus (sif/critical: +10, high: +5)
// - Tag overlap: hasta +20

function scoreLesson(
  lesson: LessonRecord,
  ctx: TargetProjectContext,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const industryMatch =
    lesson.applicableIndustries.length === 0 ||
    lesson.applicableIndustries.includes(ctx.industry);
  if (industryMatch && lesson.applicableIndustries.includes(ctx.industry)) {
    score += 40;
    reasons.push(`Industria coincide (${ctx.industry})`);
  }

  if (lesson.applicableSizes.includes(ctx.size)) {
    score += 20;
    reasons.push(`Tamaño aplicable (${ctx.size})`);
  }

  if (
    ctx.projectKind &&
    lesson.applicableProjectKinds &&
    lesson.applicableProjectKinds.includes(ctx.projectKind)
  ) {
    score += 10;
    reasons.push(`Tipo de proyecto coincide (${ctx.projectKind})`);
  }

  const sim = clampSimilarity(ctx.currentRisksSimilarity);
  const simPts = sim * 30;
  if (simPts > 0) {
    score += simPts;
    reasons.push(`Similitud de riesgos ${(sim * 100).toFixed(0)}% (+${simPts.toFixed(1)})`);
  }

  const sevBonus = severityBonus(lesson.originalSeverity);
  if (sevBonus > 0) {
    score += sevBonus;
    reasons.push(`Severity histórica ${lesson.originalSeverity} (+${sevBonus})`);
  }

  const tagInfo = tagOverlapBonus(lesson.tags, ctx.tags);
  if (tagInfo.bonus > 0) {
    score += tagInfo.bonus;
    reasons.push(`Tags en común: ${tagInfo.matched.join(', ')} (+${tagInfo.bonus})`);
  }

  return { score, reasons };
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

export interface RecommendLessonsOptions {
  maxResults?: number;
  minMatchScore?: number;
}

/**
 * Recomienda lecciones del portfolio aplicables a un proyecto target.
 *
 * - Filtra cualquier lección cuyo `sourceProjectId === target.projectId`
 *   (un proyecto no se enseña a sí mismo).
 * - Ordena por score DESC, luego por severity (sif/critical > high > resto)
 *   para determinismo en empates.
 */
export function recommendLessons(
  lessons: LessonRecord[],
  targetContext: TargetProjectContext,
  options?: RecommendLessonsOptions,
): LessonTransferRecommendation[] {
  const maxResults = options?.maxResults ?? 10;
  const minMatchScore = options?.minMatchScore ?? 0;

  const recos: LessonTransferRecommendation[] = [];

  for (const lesson of lessons) {
    if (lesson.sourceProjectId === targetContext.projectId) continue;
    const { score, reasons } = scoreLesson(lesson, targetContext);
    if (score < minMatchScore) continue;
    if (reasons.length === 0) continue;

    const highPriority =
      score >= 75 &&
      (lesson.category === 'incident' || isHighOrAbove(lesson.originalSeverity));

    recos.push({
      lesson,
      matchScore: Math.round(score * 100) / 100,
      applicabilityReasons: reasons,
      recommendedActions: buildRecommendedActions(lesson),
      highPriority,
    });
  }

  recos.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    const sevRank = (s?: LessonSeverity): number => {
      if (s === 'sif') return 5;
      if (s === 'critical') return 4;
      if (s === 'high') return 3;
      if (s === 'medium') return 2;
      if (s === 'low') return 1;
      return 0;
    };
    return sevRank(b.lesson.originalSeverity) - sevRank(a.lesson.originalSeverity);
  });

  return recos.slice(0, maxResults);
}

/**
 * Resume el corpus de lecciones del portfolio.
 *
 * `transferableCount` = lecciones con al menos una `applicableIndustries`
 * o `applicableSizes` declarada (i.e., realmente reutilizables).
 */
export function summarizePortfolioLearning(lessons: LessonRecord[]): PortfolioSummary {
  const byCategory: Record<string, number> = {};
  const byIndustry: Record<string, number> = {};
  let transferableCount = 0;

  for (const l of lessons) {
    byCategory[l.category] = (byCategory[l.category] ?? 0) + 1;
    for (const ind of l.applicableIndustries) {
      byIndustry[ind] = (byIndustry[ind] ?? 0) + 1;
    }
    if (l.applicableIndustries.length > 0 || l.applicableSizes.length > 0) {
      transferableCount++;
    }
  }

  return {
    totalLessons: lessons.length,
    byCategory,
    byIndustry,
    transferableCount,
  };
}
