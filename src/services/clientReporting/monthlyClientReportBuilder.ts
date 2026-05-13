// Praeventio Guard — Sprint 51 §117: Reporte mensual cliente (auto-generado
// para mandante).
//
// Diferente del `monthlyClientReport.ts` previo (§119-120 — KPIs + alertas
// reputacionales agregadas). Este builder produce un documento estructurado
// listo para entrega al cliente mandante:
//   - cover page con período + executive summary
//   - secciones (métricas, achievements, concerns, acciones correctivas,
//     capacitaciones, inspecciones, spend breakdown)
//   - scoreCard con compliance, trend y vs_benchmark
//   - callouts coloreados (rojo crítico si SIF, amarillo si compliance < 70)
//
// Reusa `composeRoleSummary('client_mandante', ...)` del Sprint 49 para el
// executive summary natural. 100% determinístico.

import {
  composeRoleSummary,
  type ProjectSnapshot,
  type SummaryLanguage,
} from '../multiRoleSummary/roleSummaryComposer.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface MonthlyReportMetrics {
  trir: number;
  ltifr: number;
  /** Serious Injury or Fatality incidents in the period. */
  sif: number;
  totalIncidents: number;
  manHoursWorked: number;
}

export interface MonthlyReportCorrectiveActions {
  closed: number;
  open: number;
  averageClosureDays: number;
}

export interface MonthlyReportSpendBreakdownClp {
  epp: number;
  training: number;
  audits: number;
  engineering: number;
}

export interface MonthlyReportInput {
  projectId: string;
  projectName?: string;
  periodFrom: string; // ISO
  periodTo: string; // ISO
  metrics: MonthlyReportMetrics;
  achievements: string[];
  concerns: string[];
  correctiveActions: MonthlyReportCorrectiveActions;
  trainingsCompleted: number;
  inspectionsCompleted: number;
  /** 0-100. */
  complianceScore: number;
  spendBreakdownClp: MonthlyReportSpendBreakdownClp;
  /** Previous period (for trend % change). Optional. */
  previousPeriod?: {
    metrics: Partial<MonthlyReportMetrics>;
    complianceScore?: number;
  };
  /** Industry benchmark for comparison. Optional. */
  benchmark?: {
    trir?: number;
    ltifr?: number;
    complianceScore?: number;
  };
}

export type ReportSectionKind =
  | 'metrics'
  | 'achievements'
  | 'concerns'
  | 'corrective_actions'
  | 'trainings'
  | 'inspections'
  | 'spend';

export interface ReportSection {
  kind: ReportSectionKind;
  title: string;
  /** Either bullet items or a key-value table. */
  rows: Array<{ label: string; value: string; trend?: 'up' | 'down' | 'flat' }>;
}

export type CalloutSeverity = 'critical' | 'warning' | 'info' | 'positive';
export interface Callout {
  severity: CalloutSeverity;
  message: string;
}

export interface MonthlyClientReport {
  projectId: string;
  coverPage: {
    period: { from: string; to: string };
    projectName: string;
    executiveSummary: string;
  };
  sections: ReportSection[];
  scoreCard: {
    complianceScore: number;
    /** Tendency vs previous period. */
    trend: 'up' | 'down' | 'flat' | 'n_a';
    /** "+12%", "-3%", "=" or "n/a". */
    trendBadge: string;
    /** % delta vs benchmark, e.g. "+5% vs benchmark", or null if no benchmark. */
    vs_benchmark: string | null;
  };
  callouts: Callout[];
  /** Diagnostics for audit. */
  audit: {
    builtAt: string;
    sectionsCount: number;
    calloutsCount: number;
  };
}

export interface BuildOptions {
  language?: SummaryLanguage;
  /** Override built-at timestamp for deterministic tests. */
  now?: () => string;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function pctChange(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === null) return null;
  if (previous === 0) {
    if (current === 0) return 0;
    return null; // undefined % — avoid Infinity
  }
  return Math.round(((current - previous) / previous) * 100);
}

function trendFromDelta(
  delta: number | null,
  lowerIsBetter: boolean,
): 'up' | 'down' | 'flat' | 'n_a' {
  if (delta === null) return 'n_a';
  if (delta === 0) return 'flat';
  const positive = delta > 0;
  if (lowerIsBetter) return positive ? 'down' : 'up'; // higher = worse → trend "down"
  return positive ? 'up' : 'down';
}

function badge(delta: number | null): string {
  if (delta === null) return 'n/a';
  if (delta === 0) return '=';
  return delta > 0 ? `↑ +${delta}%` : `↓ ${delta}%`;
}

function fmtClp(n: number): string {
  // Chilean format: thousands separator '.', no decimals.
  return `$${Math.round(n).toLocaleString('es-CL')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Builder
// ────────────────────────────────────────────────────────────────────────

export function buildMonthlyClientReport(
  input: MonthlyReportInput,
  options: BuildOptions = {},
): MonthlyClientReport {
  const lang = options.language ?? 'es-CL';
  const projectName = input.projectName ?? input.projectId;

  // ── Executive summary via Sprint 49 multiRoleSummary composer.
  const snapshot: ProjectSnapshot = {
    projectId: input.projectId,
    projectName,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    metrics: {
      incidentsCount: input.metrics.totalIncidents,
      sifIncidentsCount: input.metrics.sif,
      trir: input.metrics.trir,
      ltifr: input.metrics.ltifr,
      complianceScore: input.complianceScore,
      inspectionsCompleted: input.inspectionsCompleted,
      correctiveActionsOpen: input.correctiveActions.open,
      correctiveActionsClosed: input.correctiveActions.closed,
    },
    highlights: [
      ...input.achievements.map((text) => ({
        kind: 'achievement' as const,
        text,
        relevantTo: ['client_mandante' as const],
      })),
      ...input.concerns.map((text) => ({
        kind: 'concern' as const,
        text,
        relevantTo: ['client_mandante' as const],
      })),
    ],
  };
  const roleSummary = composeRoleSummary(snapshot, 'client_mandante', lang);
  const execSummary = [
    roleSummary.headlineMetric
      ? `${roleSummary.headlineMetric.label}: ${roleSummary.headlineMetric.value}.`
      : null,
    ...roleSummary.bullets.slice(0, 3),
  ]
    .filter(Boolean)
    .join(' ');

  // ── Trends & scoreCard.
  const prevMetrics = input.previousPeriod?.metrics ?? {};
  const complianceDelta = pctChange(
    input.complianceScore,
    input.previousPeriod?.complianceScore,
  );
  const complianceTrend = trendFromDelta(complianceDelta, false);

  const trirDelta = pctChange(input.metrics.trir, prevMetrics.trir);
  const ltifrDelta = pctChange(input.metrics.ltifr, prevMetrics.ltifr);
  const totalIncDelta = pctChange(input.metrics.totalIncidents, prevMetrics.totalIncidents);

  let vsBenchmark: string | null = null;
  if (input.benchmark?.complianceScore !== undefined) {
    const delta = input.complianceScore - input.benchmark.complianceScore;
    vsBenchmark =
      delta === 0
        ? '= vs benchmark'
        : delta > 0
        ? `+${delta} pts vs benchmark`
        : `${delta} pts vs benchmark`;
  }

  // ── Sections.
  const sections: ReportSection[] = [];

  sections.push({
    kind: 'metrics',
    title: 'Indicadores clave',
    rows: [
      {
        label: 'TRIR',
        value: input.metrics.trir.toFixed(2),
        trend: trendFromDelta(trirDelta, true) === 'n_a' ? undefined : (trendFromDelta(trirDelta, true) as 'up' | 'down' | 'flat'),
      },
      {
        label: 'LTIFR',
        value: input.metrics.ltifr.toFixed(2),
        trend: trendFromDelta(ltifrDelta, true) === 'n_a' ? undefined : (trendFromDelta(ltifrDelta, true) as 'up' | 'down' | 'flat'),
      },
      { label: 'Incidentes SIF', value: String(input.metrics.sif) },
      {
        label: 'Incidentes totales',
        value: String(input.metrics.totalIncidents),
        trend: trendFromDelta(totalIncDelta, true) === 'n_a' ? undefined : (trendFromDelta(totalIncDelta, true) as 'up' | 'down' | 'flat'),
      },
      {
        label: 'Horas-hombre trabajadas',
        value: input.metrics.manHoursWorked.toLocaleString('es-CL'),
      },
    ],
  });

  if (input.achievements.length > 0) {
    sections.push({
      kind: 'achievements',
      title: 'Logros del período',
      rows: input.achievements.map((a, i) => ({ label: `#${i + 1}`, value: a })),
    });
  }

  if (input.concerns.length > 0) {
    sections.push({
      kind: 'concerns',
      title: 'Aspectos a vigilar',
      rows: input.concerns.map((c, i) => ({ label: `#${i + 1}`, value: c })),
    });
  }

  const totalActions = input.correctiveActions.closed + input.correctiveActions.open;
  const closureRate =
    totalActions > 0
      ? Math.round((input.correctiveActions.closed / totalActions) * 100)
      : 100;
  sections.push({
    kind: 'corrective_actions',
    title: 'Acciones correctivas',
    rows: [
      { label: 'Cerradas', value: String(input.correctiveActions.closed) },
      { label: 'Abiertas', value: String(input.correctiveActions.open) },
      { label: 'Tasa de cierre', value: `${closureRate}%` },
      {
        label: 'Tiempo promedio de cierre',
        value: `${input.correctiveActions.averageClosureDays.toFixed(1)} días`,
      },
    ],
  });

  sections.push({
    kind: 'trainings',
    title: 'Capacitaciones',
    rows: [{ label: 'Completadas', value: String(input.trainingsCompleted) }],
  });

  sections.push({
    kind: 'inspections',
    title: 'Inspecciones',
    rows: [{ label: 'Completadas', value: String(input.inspectionsCompleted) }],
  });

  const spendTotal =
    input.spendBreakdownClp.epp +
    input.spendBreakdownClp.training +
    input.spendBreakdownClp.audits +
    input.spendBreakdownClp.engineering;
  sections.push({
    kind: 'spend',
    title: 'Inversión en seguridad (CLP)',
    rows: [
      { label: 'EPP', value: fmtClp(input.spendBreakdownClp.epp) },
      { label: 'Capacitación', value: fmtClp(input.spendBreakdownClp.training) },
      { label: 'Auditorías', value: fmtClp(input.spendBreakdownClp.audits) },
      { label: 'Ingeniería', value: fmtClp(input.spendBreakdownClp.engineering) },
      { label: 'Total', value: fmtClp(spendTotal) },
    ],
  });

  // ── Callouts.
  const callouts: Callout[] = [];
  if (input.metrics.sif > 0) {
    callouts.push({
      severity: 'critical',
      message: `Se registraron ${input.metrics.sif} incidente(s) SIF — revisión ejecutiva obligatoria.`,
    });
  }
  if (input.complianceScore < 70) {
    callouts.push({
      severity: 'warning',
      message: `Score de cumplimiento (${input.complianceScore}/100) bajo el umbral mínimo recomendado (70).`,
    });
  }
  if (input.complianceScore >= 90 && input.metrics.sif === 0) {
    callouts.push({
      severity: 'positive',
      message: `Score de cumplimiento sobresaliente (${input.complianceScore}/100) sin incidentes SIF.`,
    });
  }
  if (totalActions > 0 && closureRate < 70) {
    callouts.push({
      severity: 'warning',
      message: `Tasa de cierre de acciones (${closureRate}%) bajo objetivo (70%).`,
    });
  }
  if (callouts.length === 0) {
    callouts.push({
      severity: 'info',
      message: 'Período sin hallazgos críticos. Continuar con plan vigente.',
    });
  }

  const builtAt = options.now ? options.now() : new Date().toISOString();

  return {
    projectId: input.projectId,
    coverPage: {
      period: { from: input.periodFrom, to: input.periodTo },
      projectName,
      executiveSummary: execSummary,
    },
    sections,
    scoreCard: {
      complianceScore: input.complianceScore,
      trend: complianceTrend,
      trendBadge: badge(complianceDelta),
      vs_benchmark: vsBenchmark,
    },
    callouts,
    audit: {
      builtAt,
      sectionsCount: sections.length,
      calloutsCount: callouts.length,
    },
  };
}
