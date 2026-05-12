// Praeventio Guard — Sprint K: Reports Automation + Templates + Distribución.
//
// Cierra: Documento usuario "§267-270"
//
// Genera reportes periódicos (mensual / trimestral / anual) automatizados:
//   - Templates por audiencia (interno / cliente / regulatorio)
//   - Snapshot de KPIs al momento
//   - Distribución a destinatarios
//   - Versiones publicadas inmutables
//
// Determinístico, sin LLM. El templating es interpolación simple
// (no usa motor de plantillas externo).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ReportPeriod = 'monthly' | 'quarterly' | 'annual';
export type ReportAudience = 'internal' | 'client' | 'regulatory' | 'public';

export interface ReportTemplate {
  id: string;
  audience: ReportAudience;
  period: ReportPeriod;
  /** Secciones requeridas. */
  sections: Array<{ key: string; title: string; required: boolean }>;
}

export interface ReportData {
  /** Map de section key → contenido. */
  contents: Record<string, string>;
}

export interface PublishedReport {
  id: string;
  templateId: string;
  audience: ReportAudience;
  period: ReportPeriod;
  /** ISO-8601 cuando se publicó. */
  publishedAt: string;
  /** Período cubierto (ej: "2026-Q1"). */
  periodLabel: string;
  /** Secciones renderizadas. */
  renderedSections: Array<{ key: string; title: string; content: string }>;
  /** Hash SHA-256 del contenido para integridad. */
  contentHash?: string;
  /** Destinatarios. */
  distributedTo: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Template validation
// ────────────────────────────────────────────────────────────────────────

export interface TemplateValidationResult {
  templateId: string;
  isValid: boolean;
  missingSections: string[];
}

export function validateReportData(
  template: ReportTemplate,
  data: ReportData,
): TemplateValidationResult {
  const missingSections = template.sections
    .filter((s) => s.required && !data.contents[s.key])
    .map((s) => s.key);
  return {
    templateId: template.id,
    isValid: missingSections.length === 0,
    missingSections,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Report rendering
// ────────────────────────────────────────────────────────────────────────

export interface RenderInputs {
  template: ReportTemplate;
  data: ReportData;
  periodLabel: string;
  reportId: string;
  publishedAt: string;
  distributedTo: string[];
}

export function renderReport(inputs: RenderInputs): PublishedReport | { error: string } {
  const validation = validateReportData(inputs.template, inputs.data);
  if (!validation.isValid) {
    return { error: `Faltan secciones obligatorias: ${validation.missingSections.join(', ')}` };
  }

  const renderedSections = inputs.template.sections.map((s) => ({
    key: s.key,
    title: s.title,
    content: inputs.data.contents[s.key] ?? '',
  }));

  return {
    id: inputs.reportId,
    templateId: inputs.template.id,
    audience: inputs.template.audience,
    period: inputs.template.period,
    publishedAt: inputs.publishedAt,
    periodLabel: inputs.periodLabel,
    renderedSections,
    distributedTo: inputs.distributedTo,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Schedule cron-friendly
// ────────────────────────────────────────────────────────────────────────

export interface DueReportInput {
  templateId: string;
  period: ReportPeriod;
  /** ISO-8601 del último reporte publicado para esta plantilla. */
  lastPublishedAt?: string;
}

export interface DueReportDecision {
  templateId: string;
  isDue: boolean;
  /** Días desde el último. */
  daysSinceLast: number;
  /** Próxima fecha de generación. */
  nextDueAt: string;
}

const PERIOD_DAYS: Record<ReportPeriod, number> = {
  monthly: 30,
  quarterly: 91,
  annual: 365,
};

export function checkReportDue(
  input: DueReportInput,
  nowIso: string = new Date().toISOString(),
): DueReportDecision {
  const periodMs = PERIOD_DAYS[input.period] * 86_400_000;
  const nowMs = Date.parse(nowIso);
  const lastMs = input.lastPublishedAt ? Date.parse(input.lastPublishedAt) : 0;
  const daysSinceLast = lastMs > 0 ? Math.floor((nowMs - lastMs) / 86_400_000) : Infinity;
  const isDue = !input.lastPublishedAt || daysSinceLast >= PERIOD_DAYS[input.period];
  const nextDueAt = new Date((lastMs > 0 ? lastMs : nowMs) + periodMs).toISOString();
  return {
    templateId: input.templateId,
    isDue,
    daysSinceLast: daysSinceLast === Infinity ? 999999 : daysSinceLast,
    nextDueAt,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Templates canonical
// ────────────────────────────────────────────────────────────────────────

export const CANONICAL_TEMPLATES: ReportTemplate[] = [
  {
    id: 'monthly-client',
    audience: 'client',
    period: 'monthly',
    sections: [
      { key: 'executive_summary', title: 'Resumen ejecutivo', required: true },
      { key: 'kpis', title: 'KPIs', required: true },
      { key: 'incidents', title: 'Incidentes del período', required: true },
      { key: 'actions', title: 'Acciones', required: true },
      { key: 'sla', title: 'SLA compromiso', required: true },
      { key: 'next_period', title: 'Próximo período', required: false },
    ],
  },
  {
    id: 'quarterly-internal',
    audience: 'internal',
    period: 'quarterly',
    sections: [
      { key: 'overview', title: 'Overview', required: true },
      { key: 'leading_indicators', title: 'Indicadores Leading', required: true },
      { key: 'lagging_indicators', title: 'Indicadores Lagging', required: true },
      { key: 'lessons_learned', title: 'Lecciones aprendidas', required: false },
      { key: 'budget', title: 'Presupuesto', required: false },
    ],
  },
  {
    id: 'annual-regulatory',
    audience: 'regulatory',
    period: 'annual',
    sections: [
      { key: 'compliance_summary', title: 'Cumplimiento normativo', required: true },
      { key: 'trir_ltifr', title: 'TRIR / LTIFR anual', required: true },
      { key: 'workforce', title: 'Información de personal', required: true },
      { key: 'investments', title: 'Inversiones en SST', required: true },
      { key: 'audits', title: 'Auditorías recibidas', required: true },
    ],
  },
];
