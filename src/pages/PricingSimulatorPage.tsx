// Praeventio Guard — Pricing Simulator page (Bloque D Rama 4).
//
// Thin wrapper (ReturnToWorkPage pattern): header + <PricingSimulatorPanel />
// over the pure-compute pricing-simulator HTTP surface. Wires the previously
// orphaned client hook src/hooks/usePricingSimulator.ts into a user page.

import { useTranslation } from 'react-i18next';
import { Calculator, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PricingSimulatorPanel } from '../components/pricingSimulator/PricingSimulatorPanel';

export function PricingSimulatorPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="pricing-simulator-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Calculator className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('pricingSimulator.page.title', 'Simulador de Facturación')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('pricingSimulator.page.selectProject', 'Selecciona un proyecto para estimar tu factura mensual.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="pricing-simulator-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center border border-sky-500/20">
          <Calculator className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('pricingSimulator.page.title', 'Simulador de Facturación')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('pricingSimulator.page.subtitle', 'Estima tu factura mensual según trabajadores, proyectos y plan.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="pricing-simulator-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <PricingSimulatorPanel projectId={selectedProject.id} />
    </div>
  );
}

export default PricingSimulatorPage;
