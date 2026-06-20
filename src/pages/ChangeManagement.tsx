// Praeventio Guard — Management of Change (MOC) page.
//
// Decisión fundador F5(changeMgmt): página dedicada que monta el trío
// adapter-backed (persistencia real en Firestore vía `/api/sprint-k`):
//
//   - <ChangeDeclarationForm />  → declareMoc()  (admin declara el cambio)
//   - <MOCStatusPanel />         → useMocList() + closeMoc() (overview admin:
//                                  cobertura de acknowledgment + cierre con
//                                  guardrail 100%)
//   - <AcknowledgmentBanner />   → usePendingMocAcks() + acknowledgeMoc()
//                                  (el trabajador afectado confirma lectura
//                                  con firma biométrica)
//
// El flujo completo: declarar cambio → estado MOC con % de cobertura →
// banner de acknowledgment para los trabajadores afectados.
//
// Distinto del page legacy `OperationalChanges.tsx` (ruta
// `/operational-changes`), que usa el client store + el router pure-compute
// `changeMgmt.ts`. Esta página usa la superficie ADAPTER-BACKED
// (`operationalChange.ts` montada en `/api/sprint-k/:projectId/moc/*`), que
// persiste declaraciones/acks y los devuelve con summaries calculados
// server-side — el dato real del proyecto.
//
// Vida-safety: leer/confirmar tu propio cambio operacional NO es tier-gated
// (CLAUDE.md #11). El dato viene del proyecto seleccionado vía ProjectContext.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCompare, Inbox, ListChecks, PlusCircle } from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { ChangeDeclarationForm } from '../components/changeMgmt/ChangeDeclarationForm';
import { MOCStatusPanel } from '../components/changeMgmt/MOCStatusPanel';
import { AcknowledgmentBanner } from '../components/changeMgmt/AcknowledgmentBanner';
import { usePendingMocAcks } from '../hooks/useOperationalChange';
import type { OperationalChange } from '../services/changeMgmt/operationalChangeService';
import { logger } from '../utils/logger';

type Tab = 'declare' | 'overview';

export function ChangeManagement() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  const [tab, setTab] = useState<Tab>('overview');
  const [feedback, setFeedback] = useState<string | null>(null);
  // Bumps to force <MOCStatusPanel /> + pending-acks to refetch after a
  // declaration / acknowledgment.
  const [reloadKey, setReloadKey] = useState(0);

  // Pending MOCs where the signed-in worker is affected and has NOT yet
  // acknowledged — real data from GET /api/sprint-k/:projectId/moc/pending-acks.
  const pendingAcks = usePendingMocAcks(projectId);

  const handleDeclared = useCallback(
    (mocId: string) => {
      setFeedback(
        t('change_management.feedback.declared', {
          defaultValue: 'Cambio declarado ({{id}}). Esperando confirmación de los trabajadores afectados.',
          id: mocId.slice(0, 12),
        }),
      );
      setReloadKey((k) => k + 1);
      pendingAcks.refetch();
      setTab('overview');
    },
    [t, pendingAcks],
  );

  const handleAcknowledged = useCallback(
    (change: OperationalChange) => {
      logger.info('moc_acknowledged', { mocId: change.id });
      setReloadKey((k) => k + 1);
      pendingAcks.refetch();
    },
    [pendingAcks],
  );

  const handleClosed = useCallback(
    (mocId: string) => {
      setFeedback(
        t('change_management.feedback.closed', {
          defaultValue: 'MOC cerrado ({{id}}) — marcado como implementado.',
          id: mocId.slice(0, 12),
        }),
      );
      setReloadKey((k) => k + 1);
    },
    [t],
  );

  const handleError = useCallback((message: string) => {
    setFeedback(message);
  }, []);

  const pending = pendingAcks.data?.pending ?? [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1" data-testid="change-management.header">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <GitCompare className="w-6 h-6 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            {t('change_management.title', 'Control de cambios (MOC)')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
            {t(
              'change_management.subtitle',
              'Declará cambios operacionales, seguí la cobertura de confirmación de lectura y confirmá los que te afectan. Muchos accidentes ocurren por cambios mal comunicados — ISO 45001 §8.1.3.',
            )}
          </p>
        </header>

        {!projectId ? (
          <div
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400"
            data-testid="change-management.empty.noProject"
          >
            {t('change_management.empty.select_project', 'Seleccioná un proyecto para gestionar sus cambios operacionales.')}
          </div>
        ) : (
          <>
            {/* Worker-facing: banners de cada MOC pendiente de TU confirmación.
                Dato real de pending-acks (server filtra por affectedWorkerUids
                === caller y sin ack previo). */}
            {pending.length > 0 && (
              <section
                className="space-y-3"
                aria-label={t('change_management.pending.label', 'Cambios pendientes de tu confirmación')}
                data-testid="change-management.pendingAcks"
              >
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  {t('change_management.pending.heading', {
                    defaultValue: 'Pendientes de tu confirmación ({{n}})',
                    n: pending.length,
                  })}
                </h2>
                {pending.map((change) => (
                  <AcknowledgmentBanner
                    key={change.id}
                    projectId={projectId}
                    change={change}
                    onAcknowledged={handleAcknowledged}
                    onError={handleError}
                  />
                ))}
              </section>
            )}

            {feedback && (
              <p
                className="rounded-xl border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200 text-xs px-3 py-2"
                role="status"
                data-testid="change-management.feedback"
              >
                {feedback}
              </p>
            )}

            <nav
              className="flex gap-2 border-b border-slate-200 dark:border-slate-800"
              aria-label={t('change_management.tabs.label', 'Vistas de control de cambios')}
            >
              <button
                type="button"
                onClick={() => setTab('overview')}
                className={`px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5 border-b-2 -mb-px ${
                  tab === 'overview'
                    ? 'border-teal-600 text-teal-700 dark:text-teal-300'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
                data-testid="change-management.tab.overview"
                aria-current={tab === 'overview' ? 'page' : undefined}
              >
                <ListChecks className="w-4 h-4" aria-hidden="true" />
                {t('change_management.tabs.overview', 'Cobertura')}
              </button>
              <button
                type="button"
                onClick={() => setTab('declare')}
                className={`px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5 border-b-2 -mb-px ${
                  tab === 'declare'
                    ? 'border-teal-600 text-teal-700 dark:text-teal-300'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
                data-testid="change-management.tab.declare"
                aria-current={tab === 'declare' ? 'page' : undefined}
              >
                <PlusCircle className="w-4 h-4" aria-hidden="true" />
                {t('change_management.tabs.declare', 'Declarar cambio')}
              </button>
            </nav>

            {tab === 'declare' ? (
              <ChangeDeclarationForm
                projectId={projectId}
                onDeclared={handleDeclared}
                onError={(message) => handleError(message)}
              />
            ) : (
              <MOCStatusPanel
                key={reloadKey}
                projectId={projectId}
                onClosed={handleClosed}
                onError={handleError}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ChangeManagement;
