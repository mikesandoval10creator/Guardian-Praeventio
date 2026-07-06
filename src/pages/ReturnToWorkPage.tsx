// Praeventio Guard — Return-to-Work page (Bloque D Rama 1).
//
// Thin wrapper (WasteInventoryPage pattern): header + <ReturnToWorkPanel />
// over the pure-compute return-to-work HTTP surface. ADR 0012: task-fit /
// derivation vocabulary only — no medical diagnosis.

import { useTranslation } from 'react-i18next';
import { ClipboardCheck, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { ReturnToWorkPanel } from '../components/returnToWork/ReturnToWorkPanel';

export function ReturnToWorkPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="return-to-work-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('returnToWork.page.title', 'Reintegro Laboral')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('returnToWork.page.selectProject', 'Selecciona un proyecto para evaluar aptitud de tarea y reintegro.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="return-to-work-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center border border-sky-500/20">
          <ClipboardCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('returnToWork.page.title', 'Reintegro Laboral')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('returnToWork.page.subtitle', 'Aptitud de tarea, derivación a mutualidad y reintegro progresivo — sin datos médicos (ADR 0012).')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="return-to-work-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <ReturnToWorkPanel projectId={selectedProject.id} />
    </div>
  );
}

export default ReturnToWorkPage;
