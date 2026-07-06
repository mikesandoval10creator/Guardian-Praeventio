// Praeventio Guard — Skill Gap page (Bloque D Rama 2).
//
// Thin wrapper (ReturnToWorkPage pattern): header + <SkillGapPanel />
// over the pure-compute skill-gap HTTP surface
// (src/server/routes/skillGap.ts via src/hooks/useSkillGap.ts).

import { useTranslation } from 'react-i18next';
import { GraduationCap, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { SkillGapPanel } from '../components/skillGap/SkillGapPanel';

export function SkillGapPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="skill-gap-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <GraduationCap className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('skillGap.page.title', 'Brechas de Competencias')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('skillGap.page.selectProject', 'Selecciona un proyecto para analizar brechas de competencias.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="skill-gap-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <GraduationCap className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('skillGap.page.title', 'Brechas de Competencias')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('skillGap.page.subtitle', 'Análisis de brechas, plan de entrenamiento y polivalencia de cuadrilla.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="skill-gap-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <SkillGapPanel projectId={selectedProject.id} />
    </div>
  );
}

export default SkillGapPage;
