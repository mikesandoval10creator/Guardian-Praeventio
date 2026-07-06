// Praeventio Guard — Retaliation Protection page (Bloque D Rama 1).
//
// Thin wrapper (WasteInventoryPage pattern): header +
// <RetaliationProtectionPanel /> over the pure-compute retaliation HTTP
// surface (Ley Karin 21.643 anti-retaliation).

import { useTranslation } from 'react-i18next';
import { ShieldAlert, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { RetaliationProtectionPanel } from '../components/retaliationProtection/RetaliationProtectionPanel';

export function RetaliationProtectionPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="retaliation-protection-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('retaliationProtection.page.title', 'Protección contra Represalias')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('retaliationProtection.page.selectProject', 'Selecciona un proyecto para analizar señales de represalia.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="retaliation-protection-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
          <ShieldAlert className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('retaliationProtection.page.title', 'Protección contra Represalias')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('retaliationProtection.page.subtitle', 'Ley Karin 21.643 — detección de señales post-denuncia y acciones protectoras.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="retaliation-protection-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <RetaliationProtectionPanel projectId={selectedProject.id} />
    </div>
  );
}

export default RetaliationProtectionPage;
