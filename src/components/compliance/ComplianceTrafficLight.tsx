// Praeventio Guard — Wire UI #2: <ComplianceTrafficLight />
//
// Reusable widget that renders the F.2 compliance traffic light for a project.
// Owns no state; consumer passes the result of `computeComplianceTrafficLight`
// from `src/services/compliance/trafficLightEngine.ts`.
//
// Used in: Dashboard header, ProjectDetail page header, and the Inbox card.
//
// Variants:
//   - `variant="compact"` → 1-row badge (header bar)
//   - `variant="full"`    → 8-category grid (drill-down)

import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';
import type {
  ComplianceTrafficLightView,
  CategoryStatusView,
  TrafficLightView,
} from '../../services/compliance/trafficLightCoverage.js';

interface ComplianceTrafficLightProps {
  // Structural subset so a raw engine `ComplianceTrafficLightResult` (all 8
  // categories sourced) is still accepted directly, while the coverage-aware
  // view (with `'unknown'` categories + nullable score) also fits.
  result: Pick<
    ComplianceTrafficLightView,
    'overall' | 'byCategory' | 'score' | 'computedAt'
  >;
  variant?: 'compact' | 'full';
  onCategoryClick?: (cat: CategoryStatusView) => void;
}

const LIGHT_CLASS: Record<TrafficLightView, string> = {
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  yellow: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  red: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
  unknown: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

const LIGHT_ICON: Record<TrafficLightView, typeof CheckCircle2> = {
  green: CheckCircle2,
  yellow: AlertTriangle,
  red: AlertCircle,
  unknown: HelpCircle,
};

const CATEGORY_LABEL_KEY: Record<CategoryStatusView['category'], string> = {
  legal: 'compliance.cat.legal',
  documentation: 'compliance.cat.documentation',
  training: 'compliance.cat.training',
  epp: 'compliance.cat.epp',
  emergencies: 'compliance.cat.emergencies',
  occupational_health: 'compliance.cat.occupational_health',
  maintenance: 'compliance.cat.maintenance',
  audits: 'compliance.cat.audits',
};

const CATEGORY_LABEL_FALLBACK: Record<CategoryStatusView['category'], string> = {
  legal: 'Legal',
  documentation: 'Documentación',
  training: 'Capacitación',
  epp: 'EPP',
  emergencies: 'Emergencias',
  occupational_health: 'Salud ocupacional',
  maintenance: 'Mantenimiento',
  audits: 'Auditorías',
};

export function ComplianceTrafficLight({
  result,
  variant = 'compact',
  onCategoryClick,
}: ComplianceTrafficLightProps) {
  const { t } = useTranslation();
  const OverallIcon = LIGHT_ICON[result.overall];

  const unknownCount = result.byCategory.filter((c) => c.light === 'unknown').length;
  const sourcedCount = result.byCategory.length - unknownCount;
  // Partial coverage ⇒ never show an "/100" score that implies we evaluated all
  // 8 categories. Show the coverage instead so the badge stays honest.
  const partial = unknownCount > 0 || result.score === null;

  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-semibold ${LIGHT_CLASS[result.overall]}`}
        data-testid="compliance-traffic-light-compact"
      >
        <OverallIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>
          {t('compliance.score', 'Cumplimiento')}:{' '}
          {partial
            ? t('compliance.coverage', '{{n}}/{{total}} cat.', {
                n: sourcedCount,
                total: result.byCategory.length,
              })
            : `${result.score}/100`}
        </span>
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="compliance-traffic-light-full"
      aria-label={t('compliance.aria.full', 'Semáforo de cumplimiento') as string}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('compliance.title', 'Semáforo Cumplimiento')}
        </h2>
        <div
          className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-xs font-semibold ${LIGHT_CLASS[result.overall]}`}
        >
          <OverallIcon className="w-4 h-4" aria-hidden="true" />
          {result.score === null ? t('compliance.noData', 'Sin datos') : `${result.score}/100`}
        </div>
      </header>

      <ul className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {result.byCategory.map((cat) => {
          const Icon = LIGHT_ICON[cat.light];
          const label = t(CATEGORY_LABEL_KEY[cat.category], CATEGORY_LABEL_FALLBACK[cat.category]);
          const summary = cat.light === 'unknown' ? t('compliance.noData', 'Sin datos') : cat.summary;
          // Un-sourced ("sin datos") tiles are not drill-down targets.
          const clickable = Boolean(onCategoryClick) && cat.light !== 'unknown';
          return (
            <li key={cat.category}>
              <button
                type="button"
                disabled={!clickable}
                onClick={clickable ? () => onCategoryClick?.(cat) : undefined}
                className={`w-full text-left rounded-lg border p-2 text-xs font-medium transition-colors ${LIGHT_CLASS[cat.light]} ${clickable ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}
                aria-label={`${label}: ${summary}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="font-semibold">{label}</span>
                </div>
                <p className="text-[10px] opacity-80 leading-tight line-clamp-2">{summary}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
