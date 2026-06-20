// Praeventio Guard — Bloque 3.15 — Página de Escenarios de Costo Preventivo.
//
// Cierra el loop de costos sobre la superficie persistida real
// (/api/sprint-k/:projectId/cost/*, server/routes/preventionCost.ts):
//
//   simular → guardar → leer → tarjeta
//
//   - <CostSimulator />     → POST /cost/simulate (math, sin persistencia) +
//                             POST /cost/save-scenario (persiste en Firestore
//                             tenants/{t}/projects/{p}/cost_scenarios/{id}).
//   - usePreventionScenarios → GET /cost/scenarios (top-200, desc createdAt)
//                             — el dato real del proyecto.
//   - <CostScenarioCard />  → presenta cada escenario guardado (ROI, neto,
//                             inversión, fecha).
//
// Al guardar con éxito el simulador, la página refetch-ea la lista para que
// la nueva tarjeta aparezca sin recargar — el loop completo.
//
// Empty-state honesto: si no hay proyecto seleccionado pide elegir uno; si
// el proyecto no tiene escenarios guardados, lo dice claramente (no inventa
// tarjetas).
//
// Anti-blame / Directiva #2: el simulador es puramente asesor — estimaciones
// (Ley 16.744, SUSESO/DT). No bloquea operación. El dato viene del proyecto
// activo vía ProjectContext.

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, Inbox, FolderOpen, Loader2, AlertTriangle } from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { CostSimulator } from '../components/cost/CostSimulator';
import { CostScenarioCard } from '../components/cost/CostScenarioCard';
import { usePreventionScenarios } from '../hooks/usePreventionCost';

export function CostScenarios() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  // Real persisted scenarios for the active project (GET /cost/scenarios).
  const scenariosState = usePreventionScenarios(projectId);
  const scenarios = scenariosState.data?.scenarios ?? [];

  // After a save succeeds inside the simulator, refetch the list so the new
  // scenario card appears — closes the simulate→save→read→card loop.
  const handleSaved = useCallback(() => {
    scenariosState.refetch();
  }, [scenariosState]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1" data-testid="cost-scenarios.header">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Calculator
              className="w-6 h-6 text-teal-600 dark:text-teal-400"
              aria-hidden="true"
            />
            {t('cost_scenarios.title', 'Escenarios de costo preventivo')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
            {t(
              'cost_scenarios.subtitle',
              'Compará el costo de un incidente sin prevención vs el ahorro estimado con prevención activa, y guardá escenarios para revisarlos con la gerencia. Cifras referenciales (Ley 16.744, SUSESO/DT) — no reemplazan asesoría legal.',
            )}
          </p>
        </header>

        {!projectId ? (
          <div
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400"
            data-testid="cost-scenarios.empty.noProject"
          >
            {t(
              'cost_scenarios.empty.select_project',
              'Seleccioná un proyecto para simular y guardar escenarios de costo.',
            )}
          </div>
        ) : (
          <>
            {/* ── Simulador: simular → guardar ── */}
            <CostSimulator projectId={projectId} onSaved={handleSaved} />

            {/* ── Escenarios guardados: leer → tarjeta ── */}
            <section
              className="space-y-3"
              aria-label={t(
                'cost_scenarios.saved.label',
                'Escenarios guardados del proyecto',
              )}
              data-testid="cost-scenarios.saved"
            >
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <FolderOpen
                  className="w-4 h-4 text-teal-600 dark:text-teal-400"
                  aria-hidden="true"
                />
                {t('cost_scenarios.saved.heading', {
                  defaultValue: 'Escenarios guardados ({{n}})',
                  n: scenarios.length,
                })}
              </h2>

              {scenariosState.loading ? (
                <div
                  className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2"
                  data-testid="cost-scenarios.saved.loading"
                >
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  {t('cost_scenarios.saved.loading', 'Cargando escenarios guardados…')}
                </div>
              ) : scenariosState.error ? (
                <div
                  className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2"
                  role="alert"
                  data-testid="cost-scenarios.saved.error"
                >
                  <AlertTriangle
                    className="w-4 h-4 mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  {t(
                    'cost_scenarios.saved.error',
                    'No se pudieron cargar los escenarios guardados. Intentá nuevamente.',
                  )}
                </div>
              ) : scenarios.length === 0 ? (
                <div
                  className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2"
                  data-testid="cost-scenarios.saved.empty"
                >
                  <Inbox className="w-6 h-6 opacity-40" aria-hidden="true" />
                  {t(
                    'cost_scenarios.saved.empty',
                    'Todavía no hay escenarios guardados para este proyecto. Simulá uno arriba y guardalo.',
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {scenarios.map((scenario) => (
                    <CostScenarioCard key={scenario.id} scenario={scenario} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default CostScenarios;
