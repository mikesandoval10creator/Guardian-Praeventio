// Praeventio Guard — Wire UI: <BbsProfileCard />
//
// Wire UI para `bbsObservationEngine.buildProfile()`. Visualiza el
// perfil BBS (Behavior-Based Safety) del tenant en una ventana de
// observación: % safe global, breakdown por categoría, categorías
// con foco de intervención (<70% safe), y top áreas de riesgo.
//
// Anti-blame por design: NUNCA muestra workerUid; solo áreas + procesos.

import { useTranslation } from 'react-i18next';
import {
  Eye,
  ShieldCheck,
  AlertTriangle,
  TrendingDown,
  HardHat,
  Move,
  Wrench,
  ClipboardCheck,
  Sparkles,
  Activity,
  MessageSquare,
} from 'lucide-react';
import type {
  BbsProfile,
  ObservationCategory,
  CategoryStats,
} from '../../services/behaviorObservation/bbsObservationEngine.js';

interface BbsProfileCardProps {
  profile: BbsProfile;
  /** Callback al click en una categoría con foco — caller abre filtros. */
  onCategoryClick?: (category: ObservationCategory) => void;
  /** Callback al click en un área de riesgo. */
  onAreaClick?: (areaId: string) => void;
}

const CATEGORY_LABEL: Record<ObservationCategory, string> = {
  epp: 'EPP',
  positioning: 'Posición',
  tools_equipment: 'Herramientas',
  procedures: 'Procedimientos',
  housekeeping: 'Orden y aseo',
  ergonomics: 'Ergonomía',
  communication: 'Comunicación',
};

const CATEGORY_ICON: Record<ObservationCategory, typeof HardHat> = {
  epp: HardHat,
  positioning: Move,
  tools_equipment: Wrench,
  procedures: ClipboardCheck,
  housekeeping: Sparkles,
  ergonomics: Activity,
  communication: MessageSquare,
};

function safeColor(pct: number): { bar: string; text: string; ring: string } {
  if (pct >= 90)
    return {
      bar: 'bg-emerald-500',
      text: 'text-emerald-700 dark:text-emerald-300',
      ring: 'border-emerald-500/40 bg-emerald-500/5',
    };
  if (pct >= 70)
    return {
      bar: 'bg-teal-500',
      text: 'text-teal-700 dark:text-teal-300',
      ring: 'border-teal-500/40 bg-teal-500/5',
    };
  if (pct >= 50)
    return {
      bar: 'bg-amber-500',
      text: 'text-amber-700 dark:text-amber-300',
      ring: 'border-amber-500/40 bg-amber-500/5',
    };
  return {
    bar: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-300',
    ring: 'border-rose-500/40 bg-rose-500/5',
  };
}

export function BbsProfileCard({
  profile,
  onCategoryClick,
  onAreaClick,
}: BbsProfileCardProps) {
  const { t } = useTranslation();
  const overall = safeColor(profile.safePercentage);
  const focusSet = new Set(profile.focusCategories);

  const categoryEntries = (Object.entries(profile.byCategory) as Array<
    [ObservationCategory, CategoryStats]
  >).filter(([, stats]) => stats.total > 0);

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      data-testid="bbs-profile-card"
      aria-label={t('bbs.aria', 'Perfil de Behavior-Based Safety') as string}
    >
      <header className="flex items-start gap-2 mb-3">
        <Eye
          className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
            {t('bbs.title', 'Perfil BBS')}
          </h2>
          <p className="text-[11px] opacity-70 mt-0.5">
            {profile.windowStart.slice(0, 10)} → {profile.windowEnd.slice(0, 10)}
            {' · '}
            {profile.totalObservations} {t('bbs.observations', 'observaciones')}
          </p>
        </div>
        <div
          data-testid="bbs-overall"
          className={`text-right ${overall.text}`}
        >
          <p className="text-2xl font-black leading-none">
            {profile.safePercentage}%
          </p>
          <p className="text-[10px] uppercase tracking-wide font-bold opacity-80">
            <ShieldCheck className="w-3 h-3 inline -mt-0.5 mr-0.5" aria-hidden="true" />
            {t('bbs.safeLabel', 'Seguras')}
          </p>
        </div>
      </header>

      {/* Overall bar */}
      <div className="w-full h-2 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden mb-4">
        <div
          data-testid="bbs-overall-bar"
          style={{ width: `${profile.safePercentage}%` }}
          className={`h-full transition-all ${overall.bar}`}
        />
      </div>

      {/* By category */}
      <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5">
        {t('bbs.byCategoryLabel', 'Por categoría')}
      </p>
      {categoryEntries.length === 0 ? (
        <p
          data-testid="bbs-no-categories"
          className="text-xs italic text-stone-500 py-2 text-center mb-3"
        >
          {t('bbs.noCategories', 'Sin observaciones en la ventana')}
        </p>
      ) : (
        <ul className="space-y-1.5 mb-3" data-testid="bbs-categories">
          {categoryEntries.map(([cat, stats]) => {
            const meta = safeColor(stats.safePercentage);
            const Icon = CATEGORY_ICON[cat];
            const isFocus = focusSet.has(cat);
            return (
              <li
                key={cat}
                data-testid={`bbs-category-${cat}`}
                data-focus={isFocus ? 'true' : 'false'}
              >
                <button
                  type="button"
                  onClick={onCategoryClick ? () => onCategoryClick(cat) : undefined}
                  disabled={!onCategoryClick}
                  className={`w-full rounded-md border px-2 py-1.5 text-left ${meta.ring} ${onCategoryClick ? 'hover:brightness-110' : 'cursor-default'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="text-xs font-bold flex-1">
                      {CATEGORY_LABEL[cat]}
                    </span>
                    {isFocus && (
                      <span
                        data-testid={`bbs-category-${cat}-focus-tag`}
                        className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide font-bold text-rose-700 dark:text-rose-300"
                      >
                        <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                        {t('bbs.focusTag', 'Foco')}
                      </span>
                    )}
                    <span className={`font-mono text-xs font-bold ${meta.text}`}>
                      {stats.safePercentage}%
                    </span>
                  </div>
                  <div className="w-full h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      data-testid={`bbs-category-${cat}-bar`}
                      style={{ width: `${stats.safePercentage}%` }}
                      className={`h-full ${meta.bar}`}
                    />
                  </div>
                  <p className="text-[10px] opacity-65 mt-0.5">
                    {stats.safe} seguras / {stats.atRisk} en riesgo
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Top risk areas */}
      {profile.topRiskAreas.length > 0 && (
        <div data-testid="bbs-top-risk-areas">
          <p className="text-[10px] uppercase tracking-wide font-bold text-rose-700 dark:text-rose-300 mb-1.5 flex items-center gap-1">
            <TrendingDown className="w-3 h-3" aria-hidden="true" />
            {t('bbs.topRiskLabel', 'Top áreas de riesgo')}
          </p>
          <ul className="space-y-1">
            {profile.topRiskAreas.map((area) => (
              <li key={area.areaId}>
                <button
                  type="button"
                  onClick={onAreaClick ? () => onAreaClick(area.areaId) : undefined}
                  disabled={!onAreaClick}
                  data-testid={`bbs-area-${area.areaId}`}
                  className="w-full text-left rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 hover:brightness-110 disabled:cursor-default disabled:hover:brightness-100"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold flex-1 truncate">{area.areaId}</span>
                    <span className="font-mono opacity-80">
                      {area.atRiskPct}% riesgo
                    </span>
                    <span className="text-[10px] opacity-60">({area.total} obs)</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
