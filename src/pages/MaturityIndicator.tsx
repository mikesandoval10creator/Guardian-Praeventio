// Praeventio Guard — Fase F.26 page wrapper.
//
// Indicador de Madurez Preventiva (1..5). El servicio
// `computeMaturityLevel` ya estaba implementado en
// `src/services/maturity/preventionMaturityIndex.ts` y el endpoint
// `/api/sprint-k/:projectId/maturity-index` se agregó en el mismo PR.
// Esta página orquesta proyecto + hook + render.
//
// Tono: marketing/upsell — el indicador es una palanca para justificar
// upgrades de tier de suscripción. Cuando un proyecto sube de "Reactivo"
// a "Predictivo" eso es contenido vendible (case study, social proof,
// dashboard ejecutivo).
//
// Modelo Bradley Curve (DuPont) + ISO 45001:
//   Level 1 — Reactivo: solo responde después del accidente
//   Level 2 — Cumplimiento: cumple normativas mínimas por obligación
//   Level 3 — Proactivo: identifica riesgos y planifica
//   Level 4 — Predictivo: usa datos + métricas leading indicators
//   Level 5 — Autónomo: cultura embebida, mejora continua
//
// (El servicio rotula el level 4 internamente como 'sistémico' por la
// taxonomía DuPont — esta página lo presenta como 'Predictivo' por
// alineación con la spec F.26 visible al cliente.)

import type { ReactElement } from 'react';
import { humanErrorMessage } from '../lib/humanError';
import { useTranslation } from 'react-i18next';
import { Award, WifiOff, Sparkles, TrendingUp } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePreventionMaturity } from '../hooks/useMaturityIndex';
import type {
  MaturityLevelNumber,
  MaturityCategory,
} from '../services/maturity/preventionMaturityIndex';
import { MaturityIndexCard } from '../components/maturity/MaturityIndexCard';
import { Iso45001Catalog } from '../components/regulatory/Iso45001Catalog';

// ─────────────────────────────────────────────────────────────────────
// Display tokens — level → name + color + tagline
// ─────────────────────────────────────────────────────────────────────

interface LevelDisplay {
  name: string;
  /** Tailwind text color class for headings/numbers. */
  textClass: string;
  /** Tailwind ring/border color class for the gauge. */
  ringClass: string;
  /** Tailwind background tint class for the gauge fill. */
  bgClass: string;
  tagline: string;
}

const LEVEL_DISPLAY: Record<MaturityLevelNumber, LevelDisplay> = {
  1: {
    name: 'Reactivo',
    textClass: 'text-rose-500',
    ringClass: 'ring-rose-500',
    bgClass: 'bg-rose-500/10',
    tagline: 'Responde después del accidente — hay espacio para crecer.',
  },
  2: {
    name: 'Cumplimiento',
    textClass: 'text-amber-500',
    ringClass: 'ring-amber-500',
    bgClass: 'bg-amber-500/10',
    tagline: 'Cumple normativas mínimas. Próximo paso: anticiparse.',
  },
  3: {
    name: 'Proactivo',
    textClass: 'text-teal-500',
    ringClass: 'ring-teal-500',
    bgClass: 'bg-teal-500/10',
    tagline: 'Identifica riesgos y planifica antes que ocurran.',
  },
  4: {
    name: 'Predictivo',
    textClass: 'text-violet-500',
    ringClass: 'ring-violet-500',
    bgClass: 'bg-violet-500/10',
    tagline: 'Usa datos y leading indicators para anticipar fallas.',
  },
  5: {
    name: 'Autónomo',
    textClass: 'text-[#FFD700]',
    ringClass: 'ring-[#FFD700]',
    bgClass: 'bg-[#FFD700]/10',
    tagline: 'Cultura embebida. Mejora continua autogestionada.',
  },
};

const CATEGORY_DISPLAY: Record<
  MaturityCategory,
  { name: string; benchmark: string }
> = {
  foundation: {
    name: 'Fundamentos',
    benchmark: 'Capacitación + IPER + reuniones CPHS',
  },
  measurement: {
    name: 'Medición',
    benchmark: 'Leading indicators + análisis causa raíz',
  },
  behavior: {
    name: 'Comportamiento',
    benchmark: 'BBS + canales de reporte sin temor',
  },
  leadership: {
    name: 'Liderazgo',
    benchmark: 'Safety walks ejecutivos + presencia',
  },
  integration: {
    name: 'Integración',
    benchmark: 'SST integrada a operaciones + lecciones cerradas',
  },
};

// ─────────────────────────────────────────────────────────────────────
// Gauge circular SVG — score 1..5
// ─────────────────────────────────────────────────────────────────────

function MaturityGauge({
  level,
  overallScore,
}: {
  level: MaturityLevelNumber;
  overallScore: number;
}): ReactElement {
  const display = LEVEL_DISPLAY[level];
  // overallScore es 0..1; lo convertimos a porcentaje de circunferencia.
  const pct = Math.max(0.05, Math.min(1, overallScore));
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const dash = pct * circumference;

  return (
    <div
      className={`relative w-44 h-44 rounded-full ${display.bgClass} flex items-center justify-center ring-2 ${display.ringClass}/40 shadow-mode-lg`}
      data-testid="maturity-gauge"
      data-level={level}
    >
      <svg
        className="absolute inset-0 -rotate-90"
        viewBox="0 0 160 160"
        aria-hidden="true"
      >
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="8"
        />
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={display.textClass}
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center justify-center">
        <span
          className={`text-5xl font-black tabular-nums ${display.textClass}`}
          aria-label={`Nivel ${level} de 5`}
        >
          {level}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token mt-0.5">
          de 5
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export function MaturityIndicator(): ReactElement {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = usePreventionMaturity(projectId);

  // ── No project selected ───────────────────────────────────────────
  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="maturity-page-no-project"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Award
            className="w-12 h-12 mx-auto mb-4 text-violet-500"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t(
              'maturity.page.title',
              'Índice de Madurez Preventiva',
            )}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'maturity.page.selectProject',
              'Selecciona un proyecto para calcular su nivel de madurez en prevención.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="maturity-page"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <Award className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('maturity.page.title', 'Índice de Madurez Preventiva')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'maturity.page.subtitle',
              'Modelo Bradley Curve + ISO 45001. Mide cuán madura es la cultura preventiva de tu faena.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="maturity-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {/* ── Loading ────────────────────────────────────────────────── */}
      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="maturity-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="maturity-error"
          role="alert"
        >
          {t(
            'maturity.page.error',
            'No se pudo calcular el índice de madurez: {{msg}}',
            { msg: humanErrorMessage(error) },
          )}
        </div>
      )}

      {/* ── Empty state (insufficient data) ─────────────────────────── */}
      {!loading && !error && data?.insufficientData && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="maturity-empty"
        >
          <Sparkles
            className="w-12 h-12 mx-auto mb-4 text-violet-500"
            aria-hidden="true"
          />
          <h2 className="text-base font-black text-primary-token uppercase tracking-tight">
            {t(
              'maturity.empty.title',
              'Aún no podemos calcular tu madurez',
            )}
          </h2>
          <p className="mt-2 text-sm text-secondary-token max-w-md mx-auto">
            {data.reason === 'project_too_new'
              ? t(
                  'maturity.empty.tooNew',
                  'Necesitamos al menos 3 meses de datos para calcular el índice de madurez. El reporte se genera automáticamente al completar ese histórico — sigue registrando actividad.',
                )
              : t(
                  'maturity.empty.notEnough',
                  'Necesitamos al menos 3 meses de datos para calcular madurez. Agrega capacitaciones, reuniones CPHS y acciones correctivas para activar el índice.',
                )}
          </p>
          {data.projectAgeDays !== null && data.projectAgeDays !== undefined && (
            <p className="mt-3 text-[11px] text-secondary-token">
              {t('maturity.empty.daysHint', 'Proyecto activo hace {{days}} días.', {
                days: data.projectAgeDays,
              })}
            </p>
          )}
        </div>
      )}

      {/* ── Report ─────────────────────────────────────────────────── */}
      {!loading && !error && data?.report && !data.insufficientData && (
        <ReportView
          report={data.report}
          recommendations={data.recommendations ?? []}
        />
      )}

      {/* ── Reference catalog: ISO 45001:2018 clauses (deterministic KB) ── */}
      <Iso45001Catalog />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ReportView — split for testability
// ─────────────────────────────────────────────────────────────────────

interface ReportViewProps {
  report: NonNullable<
    ReturnType<typeof usePreventionMaturity>['data']
  >['report'];
  recommendations: NonNullable<
    ReturnType<typeof usePreventionMaturity>['data']
  >['recommendations'];
}

function ReportView({ report, recommendations }: ReportViewProps): ReactElement {
  const { t } = useTranslation();
  if (!report) return <></>;
  const display = LEVEL_DISPLAY[report.level];
  const recs = recommendations ?? [];

  return (
    <>
      {/* Hero: gauge + level name + tagline + upsell */}
      <section
        className="rounded-2xl border border-default-token bg-surface p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6"
        data-testid="maturity-hero"
      >
        <MaturityGauge level={report.level} overallScore={report.overallScore} />
        <div className="flex-1 text-center sm:text-left">
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
            {t('maturity.hero.youAre', 'Tu nivel actual')}
          </p>
          <h2
            className={`text-3xl font-black tracking-tight ${display.textClass}`}
            data-testid="maturity-level-name"
          >
            {display.name}
          </h2>
          <p className="mt-1 text-sm text-secondary-token max-w-md">
            {display.tagline}
          </p>
          {report.nextLevelGap.targetLevel !== null && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-canvas border border-default-token">
              <TrendingUp className="w-3.5 h-3.5 text-violet-500" aria-hidden="true" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-primary-token">
                {t(
                  'maturity.hero.nextLevel',
                  'Próximo paso: nivel {{level}} — {{name}}',
                  {
                    level: report.nextLevelGap.targetLevel,
                    name: LEVEL_DISPLAY[report.nextLevelGap.targetLevel].name,
                  },
                )}
              </span>
            </div>
          )}
          {report.nextLevelGap.targetLevel === null && (
            <p className="mt-4 text-sm font-bold text-[#FFD700]">
              {t(
                'maturity.hero.maxLevel',
                'Has alcanzado el nivel máximo. Cultura preventiva autónoma — referente para tu industria.',
              )}
            </p>
          )}
        </div>
      </section>

      <MaturityIndexCard report={report} recommendations={recs} />

      {/* Dimensions grid */}
      <section data-testid="maturity-dimensions">
        <h3 className="text-xs font-black uppercase tracking-widest text-secondary-token mb-3 px-1">
          {t('maturity.dimensions.title', 'Dimensiones evaluadas')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(Object.keys(report.categoryScores) as MaturityCategory[]).map(
            (cat) => {
              const score = report.categoryScores[cat];
              const catDisplay = CATEGORY_DISPLAY[cat];
              const pct = Math.round(score * 100);
              const isWeakest = cat === report.weakestArea;
              return (
                <div
                  key={cat}
                  className={`rounded-2xl border bg-surface p-4 flex flex-col gap-2 ${
                    isWeakest
                      ? 'border-rose-500/30 bg-rose-500/5'
                      : 'border-default-token'
                  }`}
                  data-testid={`maturity-dimension-${cat}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-primary-token">
                      {catDisplay.name}
                    </span>
                    <span className="text-lg font-black tabular-nums text-primary-token">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-canvas overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        isWeakest ? 'bg-rose-500' : 'bg-teal-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-secondary-token">
                    {catDisplay.benchmark}
                  </p>
                  {isWeakest && (
                    <span className="self-start text-[9px] font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400">
                      {t(
                        'maturity.dimensions.weakest',
                        'Palanca prioritaria',
                      )}
                    </span>
                  )}
                </div>
              );
            },
          )}
        </div>
      </section>

      {/* Improvement plan */}
      {recs.length > 0 && (
        <section
          className="rounded-2xl border border-default-token bg-surface p-5"
          data-testid="maturity-improvement-plan"
        >
          <h3 className="text-xs font-black uppercase tracking-widest text-secondary-token mb-3">
            {t('maturity.plan.title', 'Plan de mejora — sube al próximo nivel')}
          </h3>
          <ol className="space-y-3">
            {recs.map((rec, i) => (
              <li
                key={`${rec.category}-${i}`}
                className="flex gap-3 items-start"
                data-testid={`maturity-recommendation-${i}`}
              >
                <span className="shrink-0 w-7 h-7 rounded-full bg-violet-500/10 text-violet-500 flex items-center justify-center text-xs font-black border border-violet-500/30">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-primary-token">{rec.action}</p>
                  <p className="text-[11px] text-secondary-token mt-0.5">
                    {t(
                      'maturity.plan.impact',
                      'Categoría: {{cat}} · Impacto estimado: +{{impact}}%',
                      {
                        cat: CATEGORY_DISPLAY[rec.category].name,
                        impact: Math.round(rec.expectedImpact * 100),
                      },
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

export default MaturityIndicator;
