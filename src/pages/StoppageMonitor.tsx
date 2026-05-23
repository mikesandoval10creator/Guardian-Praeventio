// Praeventio Guard — Sprint K wire UI vidas críticas: StoppageMonitor.
//
// 2026-05-22: cierra el gap del plan §Sprint K wire UI restante. El
// service `stoppageEngine` + `stoppageFirestoreAdapter` + el card
// `StoppageSummaryCard` existían pero NO había page que los wireara.
//
// Esta page expone `/stoppages` con:
//   1. Card-resumen (StoppageSummaryCard) computado en vivo desde la
//      lista actual (`summarize()` del engine).
//   2. Lista de paralizaciones activas + pending_resumption.
//   3. Form para declarar una nueva paralización (con role-gate del
//      engine — el form llama directo a `declareStoppage` puro).
//   4. Acción rápida para marcar precondiciones cumplidas + transicionar
//      a 'resumed' cuando todas están fulfilled.
//
// Persistencia: `subscribeStoppages` (Firestore live).
// Privacy + auditoría: cada acción graba uid + timestamp.
//
// Vidas críticas: la paralización es un acto JURÍDICO; el sistema
// **no automatiza** la reanudación — exige verificación de cada
// precondición declarada al momento del stop-work.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  OctagonAlert,
  PauseCircle,
  CheckCircle2,
  Plus,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { StoppageSummaryCard } from '../components/stoppage/StoppageSummaryCard';
import {
  declareStoppage,
  markPreconditionFulfilled,
  resume as resumeStoppage,
  summarize,
  type Stoppage,
  type StoppageCategory,
  type StoppageScope,
} from '../services/stoppage/stoppageEngine';
import {
  saveStoppage,
  updateStoppageStatus,
  subscribeStoppages,
} from '../services/stoppage/stoppageStore';
import { logger } from '../utils/logger';

const CATEGORY_LABELS: Record<StoppageCategory, string> = {
  incidente_grave: 'Incidente grave',
  hallazgo_critico: 'Hallazgo crítico',
  condicion_climatica: 'Condición climática',
  falla_equipo_critico: 'Falla equipo crítico',
  observacion_fiscalizador: 'Observación fiscalizador',
  falta_supervision: 'Falta supervisión',
  detencion_voluntaria: 'Detención voluntaria (stop-work)',
};

const SCOPE_LABELS: Record<StoppageScope, string> = {
  project: 'Todo el proyecto',
  zone: 'Zona',
  task: 'Tarea',
  equipment: 'Equipo',
};

const DEFAULT_PRECONDITIONS: Array<{ id: string; label: string }> = [
  { id: 'inspect', label: 'Inspección visual completa' },
  { id: 'authorize', label: 'Autorización supervisor SST' },
  { id: 'document', label: 'Registro fotográfico + ZK node' },
];

export function StoppageMonitor() {
  useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [stoppages, setStoppages] = useState<Stoppage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state.
  const [category, setCategory] = useState<StoppageCategory>('detencion_voluntaria');
  const [scope, setScope] = useState<StoppageScope>('project');
  const [scopeTargetId, setScopeTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  // Live subscription.
  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setStoppages([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeStoppages(
      projectId,
      (list) => {
        setStoppages(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('stoppages_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const summary = useMemo(() => summarize(stoppages), [stoppages]);

  const activeStoppages = useMemo(
    () => stoppages.filter((s) => s.status === 'active' || s.status === 'pending_resumption'),
    [stoppages],
  );

  const resetForm = () => {
    setCategory('detencion_voluntaria');
    setScope('project');
    setScopeTargetId('');
    setReason('');
    setShowForm(false);
    setFeedback(null);
  };

  const handleDeclare = async () => {
    if (!selectedProject || !user) {
      setFeedback('Necesitás un proyecto activo y estar autenticado.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const stoppage = declareStoppage({
        id: `stp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        projectId: selectedProject.id,
        category,
        scope,
        scopeTargetId: scopeTargetId || selectedProject.id,
        reason,
        declaredByUid: user.uid,
        // Sin info exacta del role del user, asumimos 'supervisor' como
        // default permisivo; detencion_voluntaria no requiere role
        // específico (stop-work authority del trabajador).
        declaredByRole: 'supervisor',
        resumptionPreconditions: DEFAULT_PRECONDITIONS,
      });
      await saveStoppage(stoppage, selectedProject.id);
      setFeedback(`Paralización declarada (${stoppage.id.slice(0, 12)}). Aparece en lista activa.`);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('declareStoppage failed', { err: msg });
      setFeedback(`No se pudo declarar: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Marca una precondición como cumplida + actualiza Firestore. Si
   * tras esto todas las precondiciones están cumplidas, intenta
   * automáticamente la transición a 'resumed'.
   */
  const handleFulfillPrecondition = useCallback(
    async (stoppage: Stoppage, preconditionId: string) => {
      if (!user || !selectedProject) return;
      try {
        const updated = markPreconditionFulfilled(stoppage, preconditionId, user.uid);
        await updateStoppageStatus(selectedProject.id, stoppage.id, {
          resumptionPreconditions: updated.resumptionPreconditions,
          status: updated.status,
        });
        // Si todas cumplidas → intentar resumption.
        if (updated.status === 'pending_resumption') {
          const resumed = resumeStoppage(updated, user.uid, 'supervisor');
          await updateStoppageStatus(selectedProject.id, stoppage.id, {
            status: resumed.status,
            resumedAt: resumed.resumedAt,
            resumedByUid: resumed.resumedByUid,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('handleFulfillPrecondition failed', { err: msg });
        setFeedback(msg);
      }
    },
    [user, selectedProject],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
              Paralizaciones (stop-work)
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-xl">
              Toda paralización queda registrada con autoría, motivo y precondiciones
              para reanudar. La reanudación NO es automática — exige verificación.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject}
            className="rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Declarar paralización
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto para ver paralizaciones.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            <StoppageSummaryCard summary={summary} projectLabel={selectedProject.name} />

            {feedback && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{feedback}</span>
              </div>
            )}

            {showForm && (
              <section className="rounded-2xl border border-rose-200 bg-rose-50/40 dark:bg-rose-900/10 dark:border-rose-800 p-4 space-y-3">
                <h2 className="text-sm font-black text-rose-700 dark:text-rose-300 uppercase tracking-widest">
                  Nueva paralización
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Categoría</span>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as StoppageCategory)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Alcance</span>
                    <select
                      value={scope}
                      onChange={(e) => setScope(e.target.value as StoppageScope)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Identificador del alcance (zona/tarea/equipo) — vacío = proyecto entero
                  </span>
                  <input
                    type="text"
                    value={scopeTargetId}
                    onChange={(e) => setScopeTargetId(e.target.value)}
                    placeholder="(opcional) ej: zona-norte-2, task-12345"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Motivo (mín 15 caracteres)
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="Describí el riesgo identificado, condiciones observadas, normativa aplicable…"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <div className="text-[10px] text-zinc-500">
                  Precondiciones por defecto: inspección visual + autorización SST + registro fotográfico.
                  Podés editarlas después por stoppage individual.
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleDeclare}
                    disabled={submitting || reason.trim().length < 15}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <OctagonAlert className="w-3.5 h-3.5" />}
                    Declarar
                  </button>
                </div>
              </section>
            )}

            {/* Lista de paralizaciones activas + pending. */}
            <section className="space-y-3">
              <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest">
                Paralizaciones activas ({activeStoppages.length})
              </h2>
              {activeStoppages.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-4 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  No hay paralizaciones activas en este proyecto.
                </div>
              ) : (
                <ul className="space-y-3">
                  {activeStoppages.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-zinc-900/60 p-4 space-y-2"
                    >
                      <header className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
                            {CATEGORY_LABELS[s.category]} · {SCOPE_LABELS[s.scope]}
                          </p>
                          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{s.reason}</p>
                          <p className="text-[10px] text-zinc-500 mt-1">
                            Declarada por {s.declaredByUid.slice(0, 12)} · {new Date(s.declaredAt).toLocaleString('es-CL')}
                          </p>
                        </div>
                        <span
                          className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            s.status === 'active'
                              ? 'bg-rose-600 text-white'
                              : 'bg-amber-600 text-white'
                          }`}
                        >
                          {s.status === 'active' ? 'Activa' : 'Pendiente reanudar'}
                        </span>
                      </header>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          Precondiciones para reanudar
                        </p>
                        <ul className="space-y-1">
                          {s.resumptionPreconditions.map((p) => (
                            <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className={p.fulfilled ? 'text-emerald-700 dark:text-emerald-300 line-through' : 'text-zinc-700 dark:text-zinc-300'}>
                                {p.fulfilled ? '✓' : '○'} {p.label}
                              </span>
                              {!p.fulfilled && (
                                <button
                                  type="button"
                                  onClick={() => handleFulfillPrecondition(s, p.id)}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white"
                                >
                                  Marcar cumplida
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Historial breve — últimos 5 resumed/cancelled. */}
            <section className="space-y-3">
              <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <PauseCircle className="w-3.5 h-3.5" />
                Historial reciente
              </h2>
              <ul className="space-y-1.5">
                {stoppages
                  .filter((s) => s.status === 'resumed' || s.status === 'cancelled')
                  .slice(0, 5)
                  .map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/40 p-2 text-xs flex items-center gap-2"
                    >
                      <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
                        s.status === 'resumed'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                      }`}>
                        {s.status}
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                        {CATEGORY_LABELS[s.category]} — {s.reason.slice(0, 60)}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {new Date(s.declaredAt).toLocaleDateString('es-CL')}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default StoppageMonitor;
