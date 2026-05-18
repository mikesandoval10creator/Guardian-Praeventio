// Praeventio Guard — Fase F.21 page wrapper.
//
// Panel de Riesgo por Turno (pre-turno). El supervisor abre esta vista
// ANTES de iniciar el turno y el sistema le dice "hoy tu turno arranca
// con riesgo X por estas razones" — clima del día + fatiga del equipo
// + tareas críticas planificadas + personal nuevo + mantención + 7d
// incidents + brigada lista.
//
// El composer (`composeShiftRiskPanel`) ya devuelve score 0-100 +
// nivel verde/ámbar/rojo + factores trazables + top-3 recomendaciones.
// Esta página solo orquesta proyecto + hook + estados de borde y
// renderiza el reporte agrupado por sección (clima, personal, tareas,
// equipos, incidentes, score global).

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sun,
  WifiOff,
  AlertOctagon,
  ShieldAlert,
  Wrench,
  UserPlus,
  Activity,
  Calendar,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePreShiftRisk } from '../hooks/usePreShiftRisk';
import type { ShiftRiskReport } from '../services/shiftRiskPanel/preShiftRiskComposer';

/**
 * Map composer level to Tailwind palette tokens. Green/amber/red are the
 * three colors the composer emits — we render them with consistent
 * background + border + text classes so a supervisor's eye locks onto
 * the score in <500ms.
 */
function levelClasses(level: ShiftRiskReport['level']): {
  bg: string;
  border: string;
  text: string;
  label: string;
} {
  if (level === 'red') {
    return {
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/30',
      text: 'text-rose-600 dark:text-rose-400',
      label: 'ALTO',
    };
  }
  if (level === 'amber') {
    return {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      text: 'text-amber-600 dark:text-amber-400',
      label: 'MEDIO',
    };
  }
  return {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    label: 'BAJO',
  };
}

/**
 * Format today's date (locale-aware) for the header. We don't pass a
 * specific date to the hook; the server defaults to today.
 */
function formatToday(t: ReturnType<typeof useTranslation>['t']): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
  } catch {
    return t('common.today', 'hoy');
  }
}

export function PreShiftRisk() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = usePreShiftRisk(projectId);
  const panel = data?.panel ?? null;

  // Group factors by id-prefix so the page can render dedicated
  // sections (clima / personal / tareas / equipos / incidentes /
  // brigada) instead of one flat list. The composer's factor ids are
  // stable strings — we partition on them.
  const groups = useMemo(() => {
    if (!panel) {
      return {
        weather: [],
        fatigue: [],
        newWorkers: [],
        criticalTasks: [],
        equipment: [],
        incidents: [],
        brigade: [],
        shift: [],
      };
    }
    const weatherIds = new Set([
      'lightning',
      'rain',
      'wind',
      'uv-extreme',
      'heat',
      'cold',
      'low-visibility',
    ]);
    return {
      weather: panel.factors.filter((f) => weatherIds.has(f.id)),
      fatigue: panel.factors.filter((f) => f.id === 'fatigue'),
      newWorkers: panel.factors.filter((f) => f.id === 'new-workers'),
      criticalTasks: panel.factors.filter((f) => f.id === 'critical-tasks'),
      equipment: panel.factors.filter((f) => f.id === 'equipment-overdue'),
      incidents: panel.factors.filter((f) => f.id === 'recent-incidents'),
      brigade: panel.factors.filter((f) => f.id === 'brigade-not-ready'),
      shift: panel.factors.filter((f) => f.id === 'shift-base'),
    };
  }, [panel]);

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="pre-shift-risk-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Sun
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('preShiftRisk.page.title', 'Panel Pre-Turno')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'preShiftRisk.page.selectProject',
              'Selecciona un proyecto para ver el panel de riesgo del turno.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const colors = panel ? levelClasses(panel.level) : null;

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="pre-shift-risk-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <Sun className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('preShiftRisk.page.title', 'Panel Pre-Turno')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'preShiftRisk.page.subtitle',
              '{{date}} · {{count}} factores detectados',
              {
                date: formatToday(t),
                count: panel?.factors.length ?? 0,
              },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="pre-shift-risk-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="pre-shift-risk-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="pre-shift-risk-error"
          role="alert"
        >
          {t(
            'preShiftRisk.page.error',
            'No se pudo cargar el panel: {{msg}}',
            { msg: error.message },
          )}
        </div>
      )}

      {!loading && !error && panel && colors && (
        <>
          {/* Global score card — the supervisor's first read */}
          <section
            className={`rounded-2xl border ${colors.border} ${colors.bg} p-6 flex items-center justify-between gap-6`}
            data-testid="pre-shift-risk-score"
            aria-label={t(
              'preShiftRisk.score.aria',
              'Score global de riesgo del turno',
            )}
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
                {t('preShiftRisk.score.label', 'Riesgo del turno')}
              </p>
              <div className={`mt-1 text-5xl font-black ${colors.text}`}>
                {panel.riskScore}
                <span className="text-2xl text-secondary-token">/100</span>
              </div>
              <p className={`mt-1 text-sm font-bold ${colors.text}`}>
                {t(`preShiftRisk.level.${panel.level}`, colors.label)}
              </p>
            </div>
            {panel.recommendDelayShiftStart && (
              <div
                className="flex items-center gap-2 text-rose-600 dark:text-rose-400"
                data-testid="pre-shift-risk-delay-recommendation"
              >
                <AlertOctagon className="w-6 h-6" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wide">
                  {t(
                    'preShiftRisk.recommendDelay',
                    'Se recomienda postergar el inicio del turno',
                  )}
                </span>
              </div>
            )}
          </section>

          {/* Top recommendations — concrete next actions */}
          {panel.topRecommendations.length > 0 && (
            <section
              className="rounded-2xl border border-default-token bg-surface p-4"
              data-testid="pre-shift-risk-recommendations"
            >
              <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-token mb-2">
                {t(
                  'preShiftRisk.recommendations.title',
                  'Top recomendaciones',
                )}
              </h2>
              <ol className="space-y-2 list-decimal list-inside text-sm text-primary-token">
                {panel.topRecommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </section>
          )}

          {/* Weather section */}
          <Section
            testId="pre-shift-risk-weather"
            icon={<Sun className="w-4 h-4" aria-hidden="true" />}
            title={t('preShiftRisk.section.weather', 'Clima del turno')}
            empty={t(
              'preShiftRisk.section.weather.empty',
              'Sin alertas climáticas relevantes.',
            )}
            factors={groups.weather}
          />

          {/* Fatigue + new workers section */}
          <Section
            testId="pre-shift-risk-personnel"
            icon={<UserPlus className="w-4 h-4" aria-hidden="true" />}
            title={t('preShiftRisk.section.personnel', 'Personal del turno')}
            empty={t(
              'preShiftRisk.section.personnel.empty',
              'Equipo en condiciones normales (sin alertas de fatiga o novatos).',
            )}
            factors={[...groups.fatigue, ...groups.newWorkers]}
          />

          {/* Critical tasks section */}
          <Section
            testId="pre-shift-risk-tasks"
            icon={<ShieldAlert className="w-4 h-4" aria-hidden="true" />}
            title={t(
              'preShiftRisk.section.tasks',
              'Tareas críticas planificadas',
            )}
            empty={t(
              'preShiftRisk.section.tasks.empty',
              'Sin tareas críticas planificadas para hoy.',
            )}
            factors={groups.criticalTasks}
          />

          {/* Equipment maintenance section */}
          <Section
            testId="pre-shift-risk-equipment"
            icon={<Wrench className="w-4 h-4" aria-hidden="true" />}
            title={t(
              'preShiftRisk.section.equipment',
              'Mantención de equipos',
            )}
            empty={t(
              'preShiftRisk.section.equipment.empty',
              'Equipos con mantención al día.',
            )}
            factors={groups.equipment}
          />

          {/* Recent incidents section */}
          <Section
            testId="pre-shift-risk-incidents"
            icon={<Activity className="w-4 h-4" aria-hidden="true" />}
            title={t(
              'preShiftRisk.section.incidents',
              'Incidentes últimos 7 días',
            )}
            empty={t(
              'preShiftRisk.section.incidents.empty',
              'Sin incidentes en los últimos 7 días.',
            )}
            factors={groups.incidents}
          />

          {/* Brigade + shift base */}
          {(groups.brigade.length > 0 || groups.shift.length > 0) && (
            <Section
              testId="pre-shift-risk-context"
              icon={<Calendar className="w-4 h-4" aria-hidden="true" />}
              title={t(
                'preShiftRisk.section.context',
                'Contexto del turno',
              )}
              empty=""
              factors={[...groups.shift, ...groups.brigade]}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Generic factor section. Renders the section header + each factor as
 * a row showing label + weight pill + recommendation. Falls back to the
 * `empty` copy when there are no factors in the group.
 */
function Section(props: {
  testId: string;
  icon: ReactNode;
  title: string;
  empty: string;
  factors: ShiftRiskReport['factors'];
}) {
  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4"
      data-testid={props.testId}
    >
      <header className="flex items-center gap-2 mb-2 text-secondary-token">
        {props.icon}
        <h2 className="text-xs font-bold uppercase tracking-widest">
          {props.title}
        </h2>
      </header>
      {props.factors.length === 0 ? (
        <p className="text-xs text-secondary-token">{props.empty}</p>
      ) : (
        <ul className="space-y-2">
          {props.factors.map((f) => (
            <li
              key={f.id}
              className="flex flex-col gap-1 rounded-lg border border-default-token bg-background-token/50 p-3"
              data-testid={`pre-shift-risk-factor-${f.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-primary-token">
                  {f.label}
                </span>
                <span className="shrink-0 inline-flex items-center rounded-md bg-zinc-500/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-secondary-token">
                  +{f.weight}
                </span>
              </div>
              {f.recommendation && (
                <p className="text-xs text-secondary-token">
                  {f.recommendation}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default PreShiftRisk;
