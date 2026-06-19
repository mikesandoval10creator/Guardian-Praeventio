// Praeventio Guard — Critical Roles page.
//
// Mounts CriticalRoleCoverageCard with real worker data from Firestore.
// Shows coverage for all critical roles in the project's industry.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UserCog, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { CriticalRoleCoverageCard } from '../components/criticalRoles/CriticalRoleCoverageCard';
import {
  getRolesForIndustry,
  type WorkerProfile,
  type Industry,
} from '../services/criticalRoles/criticalRolesMap';
import type { Worker } from '../types';

function workerToProfile(w: Worker): WorkerProfile {
  return {
    uid: w.id,
    fullName: w.name,
    isActive: w.status === 'active',
    activeTrainings: w.certifications ?? [],
    activeDocuments: w.requiredEPP ?? [],
    trainingsInProgress: [],
  };
}

export function CriticalRolesPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const { data: workers, loading } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : '',
  );

  const industry = (selectedProject?.industry ?? 'construction') as Industry;
  const roles = useMemo(() => getRolesForIndustry(industry), [industry]);
  const profiles = useMemo(() => workers.map(workerToProfile), [workers]);

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="critical-roles-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <UserCog className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('criticalRoles.page.title', 'Roles Críticos')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('criticalRoles.page.selectProject', 'Selecciona un proyecto para evaluar la cobertura de roles críticos.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="critical-roles-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <UserCog className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('criticalRoles.page.title', 'Roles Críticos')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('criticalRoles.page.subtitle', 'Cobertura de roles críticos por industria — bus factor y plan de capacitación.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="critical-roles-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token" data-testid="critical-roles-loading">
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {!loading && roles.length === 0 && (
        <div className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token">
          {t('criticalRoles.page.noRoles', 'No hay roles críticos definidos para esta industria.')}
        </div>
      )}

      {!loading && roles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {roles.map((role) => (
            <CriticalRoleCoverageCard
              key={role.code}
              role={role}
              workers={profiles}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default CriticalRolesPage;
