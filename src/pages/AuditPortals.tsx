// Praeventio Guard — Portales de auditor externo (page `/audit-portals`).
//
// B17 (Fase 5): esta página ahora renderiza el manager CANÓNICO server-wired
// `PortalManager`, que crea/lista/revoca portales vía los endpoints
// `/api/audit-portal/*` (`useExternalAuditPortal`). Esos endpoints HASHEAN el
// access token (`accessTokenHash`), lo escriben en `tenants/{tid}/audit_portals`
// (la ruta que el endpoint público verifica) y están gateados por rol admin
// (ver #695).
//
// Reemplaza la implementación previa basada en `auditPortalStore`, que creaba
// portales client-side guardando el token EN CLARO en
// `projects/{pid}/audit_portals` — una ruta que `findPortalByPublicToken`
// NUNCA encuentra (busca por `accessTokenHash` y rechaza paths que no sean
// `tenants/…`). Es decir, esos portales eran inutilizables por el auditor.
// Supersesión documentada: se monta el `PortalManager` que estaba huérfano y
// se retira la pieza rota — sin perder funcionalidad real (la rota no servía).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { PortalManager } from '../components/auditPortal/PortalManager';

export function AuditPortals() {
  const { t } = useTranslation();
  const { projects } = useProject();
  const availableProjectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="bg-teal-100 dark:bg-teal-900/20 p-2.5 rounded-2xl shrink-0">
          <ShieldCheck className="w-6 h-6 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">
            {t('audit_portals.title', 'Portales de Auditor Externo')}
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
            {t(
              'audit_portals.subtitle',
              'Acceso de solo lectura, scoped por proyecto/módulo, para auditores externos (SUSESO, mutualidad, ISO, mandante).',
            )}
          </p>
        </div>
      </header>

      <PortalManager availableProjectIds={availableProjectIds} />
    </div>
  );
}
