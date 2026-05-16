// Praeventio Guard — Sprint 49 §134-138: Resúmenes multi-rol + lecciones
// transferibles + decisiones críticas + multi-lenguaje.
//
// Dado un proyecto + audiencia (worker / supervisor / executive / cliente /
// mutualidad), produce un resumen ejecutivo personalizado en términos
// relevantes para ese rol.
//
// 100% determinístico. No invoca LLMs. El caller que quiera generar
// versión natural language pasa el output al traductor IA con citation
// policy (aiGuardrails Sprint 45).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SummaryAudience =
  | 'worker'
  | 'supervisor'
  | 'prevencionista'
  | 'executive'
  | 'client_mandante'
  | 'mutuality'
  | 'cphs'
  | 'auditor_external';

export type SummaryLanguage =
  | 'es-CL'
  | 'es-AR'
  | 'es-MX'
  | 'es-PE'
  | 'pt-BR'
  | 'en-US'
  | 'en-GB';

export interface ProjectSnapshot {
  projectId: string;
  projectName: string;
  /** Período cubierto (ISO from-to). */
  periodFrom: string;
  periodTo: string;
  /** Métricas duras (todas opcionales). */
  metrics?: {
    incidentsCount?: number;
    sifIncidentsCount?: number;
    trir?: number;
    ltifr?: number;
    workersActive?: number;
    workersWithCompleteEpp?: number;
    inspectionsCompleted?: number;
    correctiveActionsClosed?: number;
    correctiveActionsOpen?: number;
    complianceScore?: number; // 0-100
    averageReadinessScore?: number;
    daysSinceLastSif?: number;
  };
  /** Cambios significativos del período. */
  highlights?: Array<{
    kind: 'achievement' | 'concern' | 'milestone' | 'critical_decision';
    text: string;
    /** Para filtrar por audiencia: qué roles deberían ver esto. */
    relevantTo: SummaryAudience[];
  }>;
  /** Lecciones transferibles a otros proyectos (§132). */
  transferableLessons?: Array<{
    summary: string;
    /** Donde aplica esta lección. */
    applicableTo: 'similar_industry' | 'similar_size' | 'similar_risk_profile' | 'any';
  }>;
}

export interface RoleSummary {
  audience: SummaryAudience;
  language: SummaryLanguage;
  /** Título del summary en el idioma. */
  title: string;
  /** Headline numérico — qué número impacta más a esta audiencia. */
  headlineMetric?: { label: string; value: string };
  /** Bullets rankeados por relevancia para la audiencia. */
  bullets: string[];
  /** Próximo paso recomendado (1 line). */
  callToAction?: string;
  /** Cuántos bullets se omitieron (para audit). */
  bulletsSkipped: number;
}

// ────────────────────────────────────────────────────────────────────────
// Audience priority — qué métricas son más importantes para cada rol
// ────────────────────────────────────────────────────────────────────────

// Extracted `highlights[].kind` literal union — the conditional-type
// `ProjectSnapshot['highlights'] extends Array<infer T> ? ...` resolved
// to `never` under strictNullChecks because `highlights?` is optional
// (i.e. `Array<...> | undefined`, and `undefined extends Array<infer>`
// is false → fallback `never`). Using `NonNullable<...>[number]['kind']`
// strips the `| undefined` first so the resulting `K[]` is preserved.
type HighlightKind = NonNullable<ProjectSnapshot['highlights']>[number]['kind'];

interface AudiencePolicy {
  /** Orden de prioridad de métricas (más importante primero). */
  metricPriority: Array<keyof NonNullable<ProjectSnapshot['metrics']>>;
  /** Highlight kinds que esta audiencia ve. */
  visibleHighlightKinds: HighlightKind[];
  /** Tono general del summary. */
  tone: 'operational' | 'strategic' | 'compliance' | 'individual';
  /** Max bullets a incluir. */
  maxBullets: number;
}

const AUDIENCE_POLICY: Record<SummaryAudience, AudiencePolicy> = {
  worker: {
    metricPriority: ['daysSinceLastSif', 'workersWithCompleteEpp'],
    visibleHighlightKinds: ['achievement', 'milestone'],
    tone: 'individual',
    maxBullets: 3,
  },
  supervisor: {
    metricPriority: [
      'correctiveActionsOpen',
      'correctiveActionsClosed',
      'inspectionsCompleted',
      'averageReadinessScore',
      'incidentsCount',
    ],
    visibleHighlightKinds: ['achievement', 'concern', 'milestone'],
    tone: 'operational',
    maxBullets: 6,
  },
  prevencionista: {
    metricPriority: [
      'sifIncidentsCount',
      'trir',
      'ltifr',
      'incidentsCount',
      'correctiveActionsOpen',
      'complianceScore',
      'averageReadinessScore',
    ],
    visibleHighlightKinds: ['concern', 'achievement', 'milestone', 'critical_decision'],
    tone: 'operational',
    maxBullets: 8,
  },
  executive: {
    metricPriority: ['trir', 'ltifr', 'sifIncidentsCount', 'complianceScore'],
    visibleHighlightKinds: ['milestone', 'critical_decision', 'concern'],
    tone: 'strategic',
    maxBullets: 4,
  },
  client_mandante: {
    metricPriority: ['complianceScore', 'trir', 'sifIncidentsCount', 'inspectionsCompleted'],
    visibleHighlightKinds: ['milestone', 'achievement'],
    tone: 'compliance',
    maxBullets: 5,
  },
  mutuality: {
    metricPriority: ['sifIncidentsCount', 'incidentsCount', 'trir', 'ltifr'],
    visibleHighlightKinds: ['concern', 'critical_decision'],
    tone: 'compliance',
    maxBullets: 5,
  },
  cphs: {
    metricPriority: [
      'incidentsCount',
      'correctiveActionsOpen',
      'correctiveActionsClosed',
      'inspectionsCompleted',
    ],
    visibleHighlightKinds: ['concern', 'achievement', 'critical_decision'],
    tone: 'operational',
    maxBullets: 7,
  },
  auditor_external: {
    metricPriority: ['complianceScore', 'trir', 'ltifr', 'sifIncidentsCount', 'correctiveActionsOpen'],
    visibleHighlightKinds: ['critical_decision', 'concern', 'milestone'],
    tone: 'compliance',
    maxBullets: 8,
  },
};

// ────────────────────────────────────────────────────────────────────────
// i18n strings (literales por idioma — tabla acotada)
// ────────────────────────────────────────────────────────────────────────

interface I18nStrings {
  titleTemplate: string;
  metricLabels: Partial<Record<keyof NonNullable<ProjectSnapshot['metrics']>, string>>;
  callToActionByAudience: Partial<Record<SummaryAudience, string>>;
}

const I18N: Record<SummaryLanguage, I18nStrings> = {
  'es-CL': {
    titleTemplate: 'Resumen — {project} ({period})',
    metricLabels: {
      incidentsCount: 'Incidentes',
      sifIncidentsCount: 'Incidentes SIF',
      trir: 'TRIR',
      ltifr: 'LTIFR',
      workersActive: 'Trabajadores activos',
      workersWithCompleteEpp: 'EPP completo',
      inspectionsCompleted: 'Inspecciones completadas',
      correctiveActionsClosed: 'Acciones cerradas',
      correctiveActionsOpen: 'Acciones abiertas',
      complianceScore: 'Score de cumplimiento',
      averageReadinessScore: 'Preparación promedio',
      daysSinceLastSif: 'Días sin SIF',
    },
    callToActionByAudience: {
      worker: 'Revisa tus EPP y participa en la charla de hoy.',
      supervisor: 'Asigna las acciones abiertas a responsables claros.',
      prevencionista: 'Revisa la matriz 5x5 con foco en los riesgos extremos.',
      executive: 'Aprobar inversión en controles de ingeniería.',
      client_mandante: 'Recibir el reporte mensual completo el día 5.',
      mutuality: 'Enviar formularios DIAT pendientes esta semana.',
      cphs: 'Convocar próxima reunión con la agenda adjunta.',
      auditor_external: 'Preparar evidencia documental por sección.',
    },
  },
  'es-AR': {
    titleTemplate: 'Resumen — {project} ({period})',
    metricLabels: {
      incidentsCount: 'Incidentes',
      sifIncidentsCount: 'Incidentes SIF',
      trir: 'TRIR',
      ltifr: 'LTIFR',
      workersActive: 'Trabajadores activos',
      complianceScore: 'Score cumplimiento',
      daysSinceLastSif: 'Días sin SIF',
    },
    callToActionByAudience: {
      worker: 'Revisá tus EPP y participá en la charla de hoy.',
      supervisor: 'Asigná las acciones abiertas a responsables.',
    },
  },
  'es-MX': {
    titleTemplate: 'Resumen — {project} ({period})',
    metricLabels: {
      incidentsCount: 'Incidentes',
      sifIncidentsCount: 'Incidentes graves',
      trir: 'TRIR',
      ltifr: 'LTIFR',
      complianceScore: 'Score cumplimiento',
      daysSinceLastSif: 'Días sin incidente grave',
    },
    callToActionByAudience: {},
  },
  'es-PE': {
    titleTemplate: 'Resumen — {project} ({period})',
    metricLabels: {
      incidentsCount: 'Incidentes',
      sifIncidentsCount: 'Incidentes SIF',
      complianceScore: 'Score cumplimiento',
    },
    callToActionByAudience: {},
  },
  'pt-BR': {
    titleTemplate: 'Resumo — {project} ({period})',
    metricLabels: {
      incidentsCount: 'Incidentes',
      sifIncidentsCount: 'Incidentes graves',
      trir: 'TRIR',
      ltifr: 'LTIFR',
      complianceScore: 'Conformidade',
      daysSinceLastSif: 'Dias sem grave',
    },
    callToActionByAudience: {
      worker: 'Verifique seu EPI e participe da palestra de hoje.',
      supervisor: 'Atribua as ações abertas a responsáveis claros.',
    },
  },
  'en-US': {
    titleTemplate: 'Summary — {project} ({period})',
    metricLabels: {
      incidentsCount: 'Incidents',
      sifIncidentsCount: 'SIF incidents',
      trir: 'TRIR',
      ltifr: 'LTIFR',
      workersActive: 'Active workers',
      workersWithCompleteEpp: 'PPE complete',
      inspectionsCompleted: 'Inspections done',
      correctiveActionsClosed: 'Actions closed',
      correctiveActionsOpen: 'Actions open',
      complianceScore: 'Compliance score',
      averageReadinessScore: 'Avg readiness',
      daysSinceLastSif: 'Days since SIF',
    },
    callToActionByAudience: {
      worker: 'Check your PPE and join today\'s tailgate talk.',
      supervisor: 'Assign open actions to owners.',
      prevencionista: 'Review the 5x5 matrix focusing on extreme risks.',
      executive: 'Approve engineering controls investment.',
      auditor_external: 'Prepare documentary evidence by section.',
    },
  },
  'en-GB': {
    titleTemplate: 'Summary — {project} ({period})',
    metricLabels: {
      incidentsCount: 'Incidents',
      sifIncidentsCount: 'SIF incidents',
      trir: 'TRIR',
      ltifr: 'LTIFR',
      complianceScore: 'Compliance score',
    },
    callToActionByAudience: {},
  },
};

function getI18n(lang: SummaryLanguage): I18nStrings {
  return I18N[lang] ?? I18N['es-CL'];
}

// ────────────────────────────────────────────────────────────────────────
// Compose
// ────────────────────────────────────────────────────────────────────────

export function composeRoleSummary(
  snapshot: ProjectSnapshot,
  audience: SummaryAudience,
  language: SummaryLanguage = 'es-CL',
): RoleSummary {
  const policy = AUDIENCE_POLICY[audience];
  const i18n = getI18n(language);

  // Title
  const title = i18n.titleTemplate
    .replace('{project}', snapshot.projectName)
    .replace('{period}', `${snapshot.periodFrom.slice(0, 10)} → ${snapshot.periodTo.slice(0, 10)}`);

  // Headline metric: la primera del prioritized list que exista en metrics
  let headlineMetric: RoleSummary['headlineMetric'];
  const metrics = snapshot.metrics ?? {};
  for (const key of policy.metricPriority) {
    if (metrics[key] !== undefined && metrics[key] !== null) {
      const label = i18n.metricLabels[key] ?? key;
      headlineMetric = { label, value: String(metrics[key]) };
      break;
    }
  }

  // Bullets: metrics + highlights filtrados por audience
  const bullets: string[] = [];

  // Metrics relevantes
  for (const key of policy.metricPriority) {
    if (bullets.length >= policy.maxBullets) break;
    const value = metrics[key];
    if (value === undefined || value === null) continue;
    const label = i18n.metricLabels[key] ?? key;
    bullets.push(`${label}: ${value}`);
  }

  // Highlights filtrados
  const highlights = snapshot.highlights ?? [];
  const visibleHighlights = highlights.filter(
    (h) =>
      (policy.visibleHighlightKinds as string[]).includes(h.kind) &&
      h.relevantTo.includes(audience),
  );
  for (const h of visibleHighlights) {
    if (bullets.length >= policy.maxBullets) break;
    bullets.push(h.text);
  }

  const totalCandidates = policy.metricPriority.length + visibleHighlights.length;
  const bulletsSkipped = Math.max(0, totalCandidates - bullets.length);

  return {
    audience,
    language,
    title,
    headlineMetric,
    bullets,
    callToAction: i18n.callToActionByAudience[audience],
    bulletsSkipped,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Batch: produce summaries for all audiences in 1 pasada
// ────────────────────────────────────────────────────────────────────────

export function composeAllAudiences(
  snapshot: ProjectSnapshot,
  language: SummaryLanguage = 'es-CL',
): Record<SummaryAudience, RoleSummary> {
  const audiences: SummaryAudience[] = [
    'worker',
    'supervisor',
    'prevencionista',
    'executive',
    'client_mandante',
    'mutuality',
    'cphs',
    'auditor_external',
  ];
  const out = {} as Record<SummaryAudience, RoleSummary>;
  for (const a of audiences) {
    out[a] = composeRoleSummary(snapshot, a, language);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Lessons transferability filter
// ────────────────────────────────────────────────────────────────────────

export interface LessonApplicabilityContext {
  industry?: string;
  workforceSize?: 'small' | 'medium' | 'large';
  riskProfile?: 'low' | 'medium' | 'high' | 'extreme';
  /** Industry/size/profile del proyecto origen de la lección. */
  source?: { industry?: string; workforceSize?: 'small' | 'medium' | 'large'; riskProfile?: 'low' | 'medium' | 'high' | 'extreme' };
}

export function filterTransferableLessons(
  lessons: NonNullable<ProjectSnapshot['transferableLessons']>,
  ctx: LessonApplicabilityContext,
): NonNullable<ProjectSnapshot['transferableLessons']> {
  return lessons.filter((l) => {
    if (l.applicableTo === 'any') return true;
    if (l.applicableTo === 'similar_industry') {
      return ctx.industry && ctx.source?.industry && ctx.industry === ctx.source.industry;
    }
    if (l.applicableTo === 'similar_size') {
      return ctx.workforceSize && ctx.source?.workforceSize && ctx.workforceSize === ctx.source.workforceSize;
    }
    if (l.applicableTo === 'similar_risk_profile') {
      return ctx.riskProfile && ctx.source?.riskProfile && ctx.riskProfile === ctx.source.riskProfile;
    }
    return false;
  });
}
