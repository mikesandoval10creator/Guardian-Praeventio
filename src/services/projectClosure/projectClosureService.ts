// Praeventio Guard — Sprint K: Cierre Proyecto + Lecciones Transferibles + Decisiones Críticas.
//
// Cierra: Documento usuario "§131-138"
//
// Cuando un proyecto cierra, NO desaparece toda su data — extrae:
//   - Lecciones transferibles a futuros proyectos
//   - Decisiones críticas que marcaron resultado
//   - Métricas finales para comparar
//   - Resumen multi-rol (gerencia / cliente / operación / SUSESO)
//
// Determinístico, sin LLM. Acompaña a `siteBookService` + `lessonsLibrary`.

import type { Lesson } from '../lessonsLearned/lessonsLibrary.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface CriticalDecision {
  id: string;
  /** ISO-8601 cuando se tomó. */
  decidedAt: string;
  /** Texto descriptivo del contexto. */
  context: string;
  /** Texto de la decisión. */
  decision: string;
  /** UID de quien la tomó. */
  decidedByUid: string;
  /** Outcome retroactivo (después de cerrar el proyecto). */
  outcome: 'positive' | 'neutral' | 'negative';
  /** Lección extraída (texto). */
  extractedLessonId?: string;
}

export interface ProjectClosureSnapshot {
  projectId: string;
  /** ISO-8601 del cierre. */
  closedAt: string;
  /** UID del responsable que firma el cierre. */
  closedByUid: string;

  // Métricas finales
  totalIncidents: number;
  criticalIncidents: number;
  preventedIncidentsEstimated: number;
  totalActionsCompleted: number;
  totalSitebookEntries: number;
  totalTrainingHours: number;
  averageComplianceScore: number;

  // Decisiones críticas
  criticalDecisions: CriticalDecision[];

  // Lecciones transferibles
  transferableLessons: Lesson[];

  // Observaciones para futuros proyectos
  retentionRecommendations: string[];
  improvementOpportunities: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Transferable lesson extraction
// ────────────────────────────────────────────────────────────────────────

export interface LessonExtractionInput {
  criticalDecisions: CriticalDecision[];
  /** Para cada decisión positiva, podemos generar lección. */
  projectId: string;
  industry: string;
}

export function extractTransferableLessons(
  input: LessonExtractionInput,
): Omit<Lesson, 'id'>[] {
  const lessons: Omit<Lesson, 'id'>[] = [];
  for (const dec of input.criticalDecisions) {
    if (dec.outcome !== 'positive') continue;
    lessons.push({
      summary: `Decisión efectiva: ${dec.context.slice(0, 80)}`,
      preventiveAction: dec.decision,
      riskCategories: [],
      tags: ['decision_critica', input.industry],
      scope: 'industry',
      industry: input.industry,
      publishedAt: new Date().toISOString(),
      adoptionCount: 0,
    });
  }
  return lessons;
}

// ────────────────────────────────────────────────────────────────────────
// Multi-role summary
// ────────────────────────────────────────────────────────────────────────

export type SummaryAudience = 'management' | 'client' | 'operations' | 'regulatory';

export interface ClosureSummary {
  audience: SummaryAudience;
  /** Métricas a exponer. */
  highlights: Array<{ label: string; value: string }>;
  /** Mensaje narrativo. */
  narrative: string;
}

export function buildSummary(
  audience: SummaryAudience,
  snapshot: ProjectClosureSnapshot,
): ClosureSummary {
  switch (audience) {
    case 'management':
      return {
        audience,
        highlights: [
          { label: 'Compliance score promedio', value: `${snapshot.averageComplianceScore}/100` },
          {
            label: 'Incidentes / Críticos',
            value: `${snapshot.totalIncidents} / ${snapshot.criticalIncidents}`,
          },
          {
            label: 'Acciones cerradas',
            value: String(snapshot.totalActionsCompleted),
          },
          {
            label: 'Incidentes prevenidos estimados',
            value: String(snapshot.preventedIncidentsEstimated),
          },
        ],
        narrative: `Proyecto ${snapshot.projectId} cerrado con score ${snapshot.averageComplianceScore}/100. ${snapshot.criticalIncidents} eventos críticos. ${snapshot.transferableLessons.length} lecciones extraídas para futuros proyectos.`,
      };
    case 'client':
      return {
        audience,
        highlights: [
          { label: 'Score cumplimiento', value: `${snapshot.averageComplianceScore}/100` },
          { label: 'Capacitaciones totales', value: `${snapshot.totalTrainingHours} horas` },
          { label: 'Acciones cerradas', value: String(snapshot.totalActionsCompleted) },
        ],
        narrative: `Cierre proyecto ${snapshot.projectId}. Todos los compromisos contractuales de SST resueltos. Trazabilidad completa disponible en libro de obra (${snapshot.totalSitebookEntries} entradas).`,
      };
    case 'operations':
      return {
        audience,
        highlights: [
          { label: 'Entradas libro de obra', value: String(snapshot.totalSitebookEntries) },
          { label: 'Acciones cerradas', value: String(snapshot.totalActionsCompleted) },
          { label: 'Decisiones críticas', value: String(snapshot.criticalDecisions.length) },
        ],
        narrative: `${snapshot.improvementOpportunities.length} oportunidades documentadas para futuros proyectos similares.`,
      };
    case 'regulatory':
      return {
        audience,
        highlights: [
          { label: 'Total incidentes registrados', value: String(snapshot.totalIncidents) },
          { label: 'Incidentes críticos', value: String(snapshot.criticalIncidents) },
          {
            label: 'Cumplimiento promedio',
            value: `${snapshot.averageComplianceScore}/100`,
          },
        ],
        narrative: `Cierre formal proyecto ${snapshot.projectId}. Registros disponibles para auditoría regulatoria — libro obra digital + adjuntos retenidos según Ley 16.744.`,
      };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export interface ClosureReadinessCheck {
  canClose: boolean;
  blockers: string[];
  warnings: string[];
}

export interface ClosureContext {
  pendingOpenIncidents: number;
  pendingOpenActions: number;
  pendingOpenPermits: number;
  hasFinalReport: boolean;
  unconfirmedSpofs: number;
}

export function validateClosureReadiness(ctx: ClosureContext): ClosureReadinessCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (ctx.pendingOpenIncidents > 0) {
    blockers.push(`${ctx.pendingOpenIncidents} incidente(s) abierto(s). Cerrar antes de finalizar proyecto.`);
  }
  if (ctx.pendingOpenActions > 0) {
    blockers.push(`${ctx.pendingOpenActions} acción(es) correctiva(s) abierta(s).`);
  }
  if (ctx.pendingOpenPermits > 0) {
    blockers.push(`${ctx.pendingOpenPermits} permiso(s) de trabajo aún activo(s).`);
  }
  if (!ctx.hasFinalReport) {
    warnings.push('No se ha generado el informe final del proyecto.');
  }
  if (ctx.unconfirmedSpofs > 0) {
    warnings.push(`${ctx.unconfirmedSpofs} SPOF(s) sin mitigación documentada.`);
  }

  return {
    canClose: blockers.length === 0,
    blockers,
    warnings,
  };
}
