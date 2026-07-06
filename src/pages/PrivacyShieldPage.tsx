// Praeventio Guard — Privacy Shield page (Bloque D Rama 1).
//
// Thin wrapper (WasteInventoryPage pattern): header + <PrivacyShieldPanel />
// over the pure-compute privacy-shield HTTP surface (Ley 19.628 + GDPR).

import { useTranslation } from 'react-i18next';
import { Lock, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PrivacyShieldPanel } from '../components/privacyShield/PrivacyShieldPanel';

export function PrivacyShieldPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="privacy-shield-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Lock className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('privacyShield.page.title', 'Escudo de Privacidad')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('privacyShield.page.selectProject', 'Selecciona un proyecto para clasificar campos de datos personales.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="privacy-shield-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <Lock className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('privacyShield.page.title', 'Escudo de Privacidad')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('privacyShield.page.subtitle', 'Ley 19.628 + GDPR — clasificación de datos personales, brechas y retención.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="privacy-shield-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <PrivacyShieldPanel projectId={selectedProject.id} />
    </div>
  );
}

export default PrivacyShieldPage;
