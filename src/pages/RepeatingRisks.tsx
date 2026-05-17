// Praeventio Guard — Fase F.13 page wrapper.
//
// Radar de Riesgos Repetidos: lista los patrones repetidos que el
// servicio `buildRepeatingRiskRadar` detecta sobre los incidentes
// recientes del proyecto seleccionado (ventana fija 90 días). Mismo
// patrón que `CorrectiveActions.tsx`:
//   1. `useRepeatingRisks(projectId)` trae el `RadarReport` desde
//      `/api/sprint-k/:projectId/repeating-risks`.
//   2. La página orquesta empty / loading / error / offline chip.
//   3. El render visual se delega a `<RepeatingRiskRadarCard>` que ya
//      existía y conocía el shape del reporte.
//
// 100% determinístico — el servicio NO usa ML. La página solo asiste,
// nunca bloquea (directiva del plan: NUNCA bloquear maquinaria, solo
// recomendar).

import { useTranslation } from 'react-i18next';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useRepeatingRisks } from '../hooks/useSprintK';
import { RepeatingRiskRadarCard } from '../components/riskRadar/RepeatingRiskRadarCard';

export function RepeatingRisks() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = useRepeatingRisks(projectId);

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="repeating-risks-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <AlertTriangle
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('riskRadar.page.title', 'Radar de Riesgos Repetidos')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'riskRadar.page.selectProject',
              'Selecciona un proyecto para ver los patrones repetidos detectados.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const report = data?.report ?? null;
  const patternCount = report?.totalPatterns ?? 0;

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="repeating-risks-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t(
              'riskRadar.page.title',
              'Radar de Riesgos Repetidos · Últimos 90 días',
            )}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'riskRadar.page.subtitle',
              'Patrones detectados sobre incidentes recientes. Sólo asiste — nunca bloquea operación. {{count}} patrón(es) detectado(s).',
              { count: patternCount },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="repeating-risks-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="repeating-risks-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="repeating-risks-error"
          role="alert"
        >
          {t(
            'riskRadar.page.error',
            'No se pudo cargar el radar: {{msg}}',
            { msg: error.message },
          )}
        </div>
      )}

      {!loading && !error && report && patternCount === 0 && (
        <div
          className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-6 text-center"
          data-testid="repeating-risks-empty-state"
        >
          <p className="text-sm font-bold text-teal-700 dark:text-teal-400">
            {t(
              'riskRadar.page.noPatterns',
              'Sin patrones repetidos detectados — ¡buen trabajo!',
            )}
          </p>
          <p className="mt-1 text-xs text-secondary-token">
            {t(
              'riskRadar.page.noPatternsSubtitle',
              'Ventana analizada: {{days}} días · {{incidents}} incidente(s) revisado(s).',
              {
                days: report.windowDays,
                incidents: report.consideredIncidents,
              },
            )}
          </p>
        </div>
      )}

      {!loading && !error && report && patternCount > 0 && (
        <RepeatingRiskRadarCard report={report} maxItems={10} />
      )}
    </div>
  );
}

export default RepeatingRisks;
