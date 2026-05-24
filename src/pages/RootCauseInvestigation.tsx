// Praeventio Guard — Sprint K vidas críticas wire UI (2026-05-22).
//
// Page `/root-cause`. Service `rootCauseClassifier.ts` (buildAnalysis +
// computeStats taxonomía ILO/ANSI/Z10) + card `RootCauseClassifierCard`
// existían sin page consumidor. Aquí se wire.
//
// UX: el supervisor selecciona el incidente (por id manual o desde lista
// de inbox futura) → form de los 5 porqués + factores → guarda análisis
// → card refleja stats agregados del tenant.

import { useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Save, Loader2, AlertTriangle } from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { RootCauseClassifierCard } from '../components/rootCause/RootCauseClassifierCard';
import {
  buildAnalysis,
  type CauseFactor,
  type RootCauseAnalysis,
} from '../services/rootCause/rootCauseClassifier';
import {
  saveRootCauseAnalysis,
  subscribeRootCauseAnalyses,
} from '../services/rootCause/rootCauseStore';
import { logger } from '../utils/logger';

const FACTOR_LABELS: Record<CauseFactor, string> = {
  condicion_subestandar: 'Condición sub-estándar',
  acto_subestandar: 'Acto sub-estándar',
  falla_supervision: 'Falla supervisión',
  falla_procedimiento: 'Falla procedimiento',
  falla_mantenimiento: 'Falla mantenimiento',
  factor_ambiental: 'Factor ambiental',
  factor_organizacional: 'Factor organizacional',
  falla_capacitacion: 'Falla capacitación',
  falla_epp: 'Falla EPP',
  falla_diseno: 'Falla diseño',
};

const FACTOR_LIST: CauseFactor[] = Object.keys(FACTOR_LABELS) as CauseFactor[];

export function RootCauseInvestigation() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [history, setHistory] = useState<RootCauseAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);

  // Form state.
  const [showForm, setShowForm] = useState(false);
  const [incidentId, setIncidentId] = useState('');
  const [factors, setFactors] = useState<Set<CauseFactor>>(new Set());
  const [primaryFactor, setPrimaryFactor] = useState<CauseFactor>('condicion_subestandar');
  const [fiveWhys, setFiveWhys] = useState<string[]>(['', '', '', '', '']);
  const [suggestedActions, setSuggestedActions] = useState<string>('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setHistory([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeRootCauseAnalyses(
      projectId,
      (list) => {
        setHistory(list);
        // Auto-seleccionar el más reciente.
        if (list.length > 0 && !selectedAnalysisId) {
          setSelectedAnalysisId(list[0].incidentId);
        }
        setLoading(false);
      },
      (err) => {
        logger.warn('rc_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  const selectedAnalysis = useMemo(
    () => history.find((a) => a.incidentId === selectedAnalysisId) ?? null,
    [history, selectedAnalysisId],
  );

  const toggleFactor = (f: CauseFactor) => {
    setFactors((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const resetForm = () => {
    setIncidentId('');
    setFactors(new Set());
    setPrimaryFactor('condicion_subestandar');
    setFiveWhys(['', '', '', '', '']);
    setSuggestedActions('');
    setShowForm(false);
    setFeedback(null);
  };

  const handleSave = async () => {
    if (!user || !selectedProject) {
      setFeedback('Necesitás un proyecto activo y estar autenticado.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const validWhys = fiveWhys.filter((w) => w.trim().length >= 15);
      const actions = suggestedActions
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const analysis = buildAnalysis({
        incidentId: incidentId.trim() || `inc_${Date.now()}`,
        factors: Array.from(factors),
        primaryFactor,
        fiveWhys: validWhys,
        analyzedByUid: user.uid,
        suggestedActions: actions,
      });
      await saveRootCauseAnalysis(selectedProject.id, analysis);
      setFeedback(`Análisis guardado para incidente ${analysis.incidentId}.`);
      setSelectedAnalysisId(analysis.incidentId);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('rootCause save failed', { err: msg });
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <Layers className="w-6 h-6 text-indigo-500" /> Causa raíz (no-blame)
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              Taxonomía ILO/ANSI Z10 + 5 porqués. El análisis NO busca culpables —
              identifica condiciones del sistema que permitieron el incidente para
              corregirlas. El supervisor que cierra el análisis lo firma con su UID.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nuevo análisis
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto para registrar análisis.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {showForm && (
              <section className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/10 p-4 space-y-3">
                <h2 className="text-sm font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-widest">
                  Nuevo análisis
                </h2>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    ID del incidente (vacío = autogenerado)
                  </span>
                  <input
                    type="text"
                    value={incidentId}
                    onChange={(e) => setIncidentId(e.target.value)}
                    placeholder="ej: inc-2026-05-22-001"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>

                <div className="space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">Factores presentes</span>
                  <div className="grid grid-cols-2 gap-2">
                    {FACTOR_LIST.map((f) => (
                      <label key={f} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={factors.has(f)}
                          onChange={() => toggleFactor(f)}
                          className="rounded"
                        />
                        {FACTOR_LABELS[f]}
                      </label>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">Factor principal</span>
                  <select
                    value={primaryFactor}
                    onChange={(e) => setPrimaryFactor(e.target.value as CauseFactor)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  >
                    {FACTOR_LIST.map((f) => (
                      <option key={f} value={f}>{FACTOR_LABELS[f]}</option>
                    ))}
                  </select>
                </label>

                <div className="space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    5 porqués (mín 15 caracteres por línea, dejar vacías las no aplicables)
                  </span>
                  {fiveWhys.map((why, idx) => (
                    <input
                      key={idx}
                      type="text"
                      value={why}
                      onChange={(e) => {
                        const next = [...fiveWhys];
                        next[idx] = e.target.value;
                        setFiveWhys(next);
                      }}
                      placeholder={`Porqué ${idx + 1}…`}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    />
                  ))}
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Acciones correctivas sugeridas (una por línea, mín 1)
                  </span>
                  <textarea
                    value={suggestedActions}
                    onChange={(e) => setSuggestedActions(e.target.value)}
                    rows={3}
                    placeholder="Ej: Capacitar al equipo en uso de arnés cada 6 meses\nInstalar línea de vida permanente en zona X"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>

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
                    onClick={handleSave}
                    disabled={submitting || factors.size === 0}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Guardar
                  </button>
                </div>
              </section>
            )}

            {history.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                Aún no hay análisis de causa raíz en este proyecto.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
                {/* Lista de análisis. */}
                <aside className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-3 space-y-1 max-h-[600px] overflow-y-auto">
                  <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                    Historial ({history.length})
                  </h2>
                  <ul className="space-y-1">
                    {history.map((a) => (
                      <li key={a.incidentId}>
                        <button
                          type="button"
                          onClick={() => setSelectedAnalysisId(a.incidentId)}
                          className={`w-full text-left p-2 rounded-lg text-xs ${
                            a.incidentId === selectedAnalysisId
                              ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                              : 'hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          <p className="font-bold truncate">{a.incidentId}</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            {FACTOR_LABELS[a.primaryFactor]} · {new Date(a.analyzedAt).toLocaleDateString('es-CL')}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>

                {/* Card del análisis seleccionado + stats agregados. */}
                <div>
                  {selectedAnalysis ? (
                    <RootCauseClassifierCard
                      analysis={selectedAnalysis}
                      history={history}
                    />
                  ) : (
                    <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                      Seleccioná un análisis a la izquierda para ver el detalle.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default RootCauseInvestigation;
