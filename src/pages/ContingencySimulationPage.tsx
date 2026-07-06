// Praeventio Guard — Contingency Simulation page (Bloque D Rama 2).
//
// Thin wrapper (ReturnToWorkPage pattern): header + <ContingencySimulationPanel />
// over the pure-compute contingency HTTP surface
// (src/server/routes/contingencySimulation.ts via src/hooks/useContingencySimulation.ts).

import { useTranslation } from 'react-i18next';
import { Siren, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { ContingencySimulationPanel } from '../components/contingencySimulation/ContingencySimulationPanel';

export function ContingencySimulationPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="contingency-simulation-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Siren className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('contingencySimulation.page.title', 'Simulación de Contingencias')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('contingencySimulation.page.selectProject', 'Selecciona un proyecto para generar escenarios de contingencia.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="contingency-simulation-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center border border-orange-500/20">
          <Siren className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('contingencySimulation.page.title', 'Simulación de Contingencias')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('contingencySimulation.page.subtitle', 'Escenarios tabletop para ensayar la respuesta a emergencias sin riesgo real.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="contingency-simulation-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <ContingencySimulationPanel projectId={selectedProject.id} />
    </div>
  );
}

export default ContingencySimulationPage;
