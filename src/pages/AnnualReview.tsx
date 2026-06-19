// Praeventio Guard — Sprint K §291-295 page wrapper.
//
// Revisión Anual del SGI (ISO 45001 §9.3 + DS 76 / Ley 16.744 §66 bis).
// Cierra el ciclo PDCA a nivel anual: la dirección revisa políticas,
// objetivos preventivos, indicadores, hallazgos y firma una conclusión.
//
// Esta página:
//   1. Selector de año (default = año UTC actual).
//   2. Lee el snapshot del año vía `useCurrentAnnualReview`.
//   3. 4 secciones — Objetivos, Evidencias, Análisis, Conclusiones.
//   4. Permite agregar objetivos (replace completo), adjuntar evidencias
//      por objetivo, y cerrar la revisión con texto + firmante.
//   5. Empty state cuando el año aún no existe — invita a "Iniciar
//      revisión anual del SGI" creando el primer set de objetivos.
//
// El service `annualSgiReview` ya existe y NO se toca; esta capa solo
// orquesta mutaciones y rendering. La progress-bar reutiliza
// `computeObjectiveProgress` del service para mantener la lógica de
// progreso 100% determinística y testeada.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  WifiOff,
  Target,
  FileText,
  MessageSquare,
  CheckCircle2,
  Plus,
  Paperclip,
  Lock,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { randomId } from '../utils/randomId';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useCurrentAnnualReview,
  setAnnualReviewObjectives,
  attachAnnualReviewEvidence,
  concludeAnnualReview,
  type AnnualReviewSnapshot,
  type AnnualReviewEvidence,
} from '../hooks/useAnnualReview';
import {
  computeObjectiveProgress,
  type PreventiveObjective,
  type ObjectiveMetric,
} from '../services/annualReview/annualSgiReview';
import { AnnualReviewSummary } from '../components/annualReview/AnnualReviewSummary';
import { PreventiveObjectivesPanel } from '../components/annualReview/PreventiveObjectivesPanel';
import { logger } from '../utils/logger';

const CURRENT_YEAR_UTC = new Date().getUTCFullYear();
// Year selector range: current year ±2 (small window keeps the UI legible).
const YEAR_OPTIONS: number[] = [
  CURRENT_YEAR_UTC - 2,
  CURRENT_YEAR_UTC - 1,
  CURRENT_YEAR_UTC,
  CURRENT_YEAR_UTC + 1,
];

interface NewObjectiveDraft {
  title: string;
  metric: ObjectiveMetric;
  baseline: string;
  target: string;
  deadline: string;
}

const EMPTY_DRAFT: NewObjectiveDraft = {
  title: '',
  metric: 'count_reduction',
  baseline: '0',
  target: '0',
  deadline: `${CURRENT_YEAR_UTC}-12-31`,
};

interface NewEvidenceDraft {
  objectiveId: string;
  evidenceUrl: string;
  evidenceKind: 'document' | 'audit' | 'incident' | 'training' | 'other';
  caption: string;
}

// `t` is i18next's TFunction with a complex overload; we just need the
// (key, defaultValue) form, so accept `any` here to dodge the
// generic-overload mismatch while keeping the callsites readable.
function metricLabel(
  metric: ObjectiveMetric,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any,
): string {
  switch (metric) {
    case 'count_reduction':
      return t('annualReview.metric.count_reduction', 'Reducir cantidad') as string;
    case 'count_increase':
      return t('annualReview.metric.count_increase', 'Aumentar cantidad') as string;
    case 'percent_completion':
      return t('annualReview.metric.percent_completion', '% completado') as string;
    case 'percent_reduction':
      return t('annualReview.metric.percent_reduction', '% reducción') as string;
  }
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"
      data-testid="annual-review-progress-bar"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-violet-500 transition-[width] duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function AnnualReview() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [year, setYear] = useState<number>(CURRENT_YEAR_UTC);
  const reviewResp = useCurrentAnnualReview(projectId, { year });

  const [draft, setDraft] = useState<NewObjectiveDraft>(EMPTY_DRAFT);
  const [evidenceDraft, setEvidenceDraft] = useState<NewEvidenceDraft>({
    objectiveId: '',
    evidenceUrl: '',
    evidenceKind: 'document',
    caption: '',
  });
  const [conclusion, setConclusion] = useState<string>('');
  const [analysis, setAnalysis] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const snapshot: AnnualReviewSnapshot | null = reviewResp.data?.snapshot ?? null;
  const exists = reviewResp.data?.exists ?? false;
  const isConcluded = snapshot?.isConcluded ?? false;

  // Hydrate analysis/conclusion when the snapshot loads.
  useMemo(() => {
    if (snapshot) {
      setAnalysis((prev) => (prev === '' ? snapshot.analysis : prev));
      setConclusion((prev) =>
        prev === '' && snapshot.conclusion ? snapshot.conclusion : prev,
      );
    }
  }, [snapshot]);

  const progressByObjective = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeObjectiveProgress>>();
    if (!snapshot) return map;
    for (const obj of snapshot.objectives) {
      map.set(obj.id, computeObjectiveProgress(obj));
    }
    return map;
  }, [snapshot]);

  const evidencesByObjective = useMemo(() => {
    const map = new Map<string, AnnualReviewEvidence[]>();
    if (!snapshot) return map;
    for (const ev of snapshot.evidences) {
      const list = map.get(ev.objectiveId) ?? [];
      list.push(ev);
      map.set(ev.objectiveId, list);
    }
    return map;
  }, [snapshot]);

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="annual-review-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ClipboardCheck
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('annualReview.page.title', 'Revisión Anual del SGI')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'annualReview.page.selectProject',
              'Selecciona un proyecto para iniciar o revisar la revisión anual del SGI.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const handleAddObjective = async () => {
    if (!projectId) return;
    if (!draft.title.trim()) {
      setError(t('annualReview.error.titleRequired', 'El título es obligatorio.'));
      return;
    }
    const baselineN = Number(draft.baseline);
    const targetN = Number(draft.target);
    if (!Number.isFinite(baselineN) || !Number.isFinite(targetN)) {
      setError(t('annualReview.error.numericInputs', 'Baseline y target deben ser numéricos.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const newObj = {
        // CLAUDE.md #15: crypto id suffix (randomId → crypto.randomUUID) instead of Math.random.
        id: `obj_${Date.now()}_${randomId().replace(/-/g, '').slice(0, 6)}`,
        title: draft.title.trim(),
        description: '',
        metric: draft.metric,
        baseline: baselineN,
        target: targetN,
        currentValue: baselineN,
        deadline: draft.deadline,
        ownerUid: user?.uid ?? 'unassigned',
        status: 'planned' as const,
        linkedActionIds: [] as string[],
        evidenceUrls: [] as string[],
      };
      const existingObjs = (snapshot?.objectives ?? []).map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description,
        metric: o.metric,
        baseline: o.baseline,
        target: o.target,
        currentValue: o.currentValue,
        deadline: o.deadline,
        ownerUid: o.ownerUid,
        status: o.status,
        linkedActionIds: o.linkedActionIds,
        evidenceUrls: o.evidenceUrls,
      }));
      await setAnnualReviewObjectives(projectId, {
        year,
        objectives: [...existingObjs, newObj],
        analysis,
      });
      setDraft(EMPTY_DRAFT);
      reviewResp.refetch?.();
      logger.info('annualReview.objective.added', { year, id: newObj.id });
    } catch (err) {
      logger.error('annualReview.objective.failed', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAttachEvidence = async () => {
    if (!projectId) return;
    if (!evidenceDraft.objectiveId || !evidenceDraft.evidenceUrl.trim()) {
      setError(
        t(
          'annualReview.error.evidenceFields',
          'Selecciona un objetivo y proporciona la URL/ruta de la evidencia.',
        ),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await attachAnnualReviewEvidence(projectId, {
        year,
        objectiveId: evidenceDraft.objectiveId,
        evidenceUrl: evidenceDraft.evidenceUrl.trim(),
        evidenceKind: evidenceDraft.evidenceKind,
        caption: evidenceDraft.caption.trim() || undefined,
      });
      setEvidenceDraft({
        objectiveId: '',
        evidenceUrl: '',
        evidenceKind: 'document',
        caption: '',
      });
      reviewResp.refetch?.();
      logger.info('annualReview.evidence.attached', { year });
    } catch (err) {
      logger.error('annualReview.evidence.failed', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConclude = async () => {
    if (!projectId) return;
    if (conclusion.trim().length < 10) {
      setError(
        t(
          'annualReview.error.conclusionTooShort',
          'La conclusión debe tener al menos 10 caracteres.',
        ),
      );
      return;
    }
    if (!user) {
      setError(t('annualReview.error.noUser', 'Necesitas iniciar sesión para firmar.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await concludeAnnualReview(projectId, {
        year,
        conclusion: conclusion.trim(),
        signedOffByUid: user.uid,
        signedOffByName: user.displayName || user.email || 'Usuario',
      });
      reviewResp.refetch?.();
      logger.info('annualReview.concluded', { year });
    } catch (err) {
      logger.error('annualReview.conclude.failed', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleInitReview = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      // Initialize the year doc with an empty objective set so the
      // snapshot transitions from non-existent → exists. Subsequent
      // calls to handleAddObjective will append.
      await setAnnualReviewObjectives(projectId, {
        year,
        objectives: [],
        analysis: '',
      });
      reviewResp.refetch?.();
      logger.info('annualReview.initialized', { year });
    } catch (err) {
      logger.error('annualReview.init.failed', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="annual-review-page"
    >
      <header className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <ClipboardCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('annualReview.page.title', 'Revisión Anual del SGI')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'annualReview.page.subtitle',
              'ISO 45001 §9.3 + DS 76 — ciclo PDCA anual: objetivos preventivos, evidencias y conclusiones firmadas.',
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-secondary-token">
          <span>{t('annualReview.year', 'Año')}</span>
          <select
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setAnalysis('');
              setConclusion('');
            }}
            data-testid="annual-review-year-selector"
            className="px-3 py-1 rounded-lg border border-default-token bg-surface text-primary-token text-sm"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="annual-review-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        {isConcluded && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400"
            data-testid="annual-review-concluded-chip"
          >
            <Lock className="w-3 h-3" aria-hidden="true" />
            {t('annualReview.concludedChip', 'Cerrada')}
          </span>
        )}
      </header>

      {reviewResp.loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="annual-review-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {reviewResp.error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="annual-review-error"
          role="alert"
        >
          {t(
            'annualReview.page.error',
            'No se pudo cargar la revisión anual: {{msg}}',
          ).replace('{{msg}}', reviewResp.error.message)}
        </div>
      )}

      {error && !reviewResp.error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400"
          data-testid="annual-review-action-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {!reviewResp.loading && !reviewResp.error && !exists && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="annual-review-init-empty"
        >
          <ClipboardCheck
            className="w-10 h-10 mx-auto mb-3 text-violet-500"
            aria-hidden="true"
          />
          <h2 className="text-base font-black text-primary-token uppercase tracking-tight">
            {t(
              'annualReview.empty.heading',
              'Inicia la revisión anual del SGI',
            )}
          </h2>
          <p className="mt-2 text-sm text-secondary-token max-w-md mx-auto">
            {t(
              'annualReview.empty.body',
              'Aún no hay objetivos preventivos definidos para {{year}}. Inicia la revisión para registrar metas medibles, evidencias y conclusiones firmadas.',
            ).replace('{{year}}', String(year))}
          </p>
          <button
            type="button"
            onClick={handleInitReview}
            disabled={busy}
            data-testid="annual-review-init-btn"
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-bold uppercase tracking-wide hover:bg-violet-600 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t('annualReview.empty.cta', 'Iniciar revisión {{year}}').replace(
              '{{year}}',
              String(year),
            )}
          </button>
        </div>
      )}

      {!reviewResp.loading && !reviewResp.error && exists && snapshot && (
        <>
          <AnnualReviewSummary
            objectives={snapshot.objectives}
            fiscalYear={year}
          />

          <PreventiveObjectivesPanel objectives={snapshot.objectives} />

          {/* ───────────── Section 1: Objetivos ───────────── */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-5 space-y-3"
            data-testid="annual-review-section-objectives"
          >
            <header className="flex items-center gap-2">
              <Target className="w-4 h-4 text-violet-500" aria-hidden="true" />
              <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
                {t('annualReview.section.objectives', 'Objetivos preventivos')}
              </h2>
              <span className="ml-auto text-xs text-secondary-token">
                {snapshot.objectives.length}
              </span>
            </header>
            {snapshot.objectives.length === 0 ? (
              <p className="text-sm text-secondary-token italic">
                {t(
                  'annualReview.objectives.empty',
                  'Aún no hay objetivos. Agrega al menos uno para iniciar el seguimiento.',
                )}
              </p>
            ) : (
              <ul className="space-y-3">
                {snapshot.objectives.map((obj: PreventiveObjective) => {
                  const progress = progressByObjective.get(obj.id);
                  return (
                    <li
                      key={obj.id}
                      className="rounded-xl border border-default-token p-3 space-y-2"
                      data-testid={`annual-review-objective-${obj.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-primary-token">
                            {obj.title}
                          </p>
                          <p className="text-[11px] text-secondary-token">
                            {metricLabel(obj.metric, t)} ·{' '}
                            {t('annualReview.objective.baseline', 'Baseline')}{' '}
                            {obj.baseline} →{' '}
                            {t('annualReview.objective.target', 'Target')}{' '}
                            {obj.target} ·{' '}
                            {t('annualReview.objective.current', 'Actual')}{' '}
                            {obj.currentValue}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-violet-500">
                          {progress?.progressPercent ?? 0}%
                        </span>
                      </div>
                      <ProgressBar percent={progress?.progressPercent ?? 0} />
                      <p className="text-[10px] uppercase tracking-widest text-secondary-token">
                        {progress?.suggestedStatus ?? obj.status}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {!isConcluded && (
              <div className="mt-2 pt-3 border-t border-default-token space-y-2">
                <p className="text-[11px] uppercase tracking-widest text-secondary-token font-bold">
                  {t('annualReview.objective.add', 'Agregar objetivo')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder={t(
                      'annualReview.objective.titlePh',
                      'Título (ej: Reducir incidentes en 20%)',
                    )}
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    data-testid="annual-review-objective-title-input"
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm"
                  />
                  <select
                    value={draft.metric}
                    onChange={(e) =>
                      setDraft({ ...draft, metric: e.target.value as ObjectiveMetric })
                    }
                    data-testid="annual-review-objective-metric-select"
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm"
                  >
                    <option value="count_reduction">{metricLabel('count_reduction', t)}</option>
                    <option value="count_increase">{metricLabel('count_increase', t)}</option>
                    <option value="percent_completion">
                      {metricLabel('percent_completion', t)}
                    </option>
                    <option value="percent_reduction">
                      {metricLabel('percent_reduction', t)}
                    </option>
                  </select>
                  <input
                    type="number"
                    placeholder={t('annualReview.objective.baseline', 'Baseline')}
                    value={draft.baseline}
                    onChange={(e) => setDraft({ ...draft, baseline: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm"
                  />
                  <input
                    type="number"
                    placeholder={t('annualReview.objective.target', 'Target')}
                    value={draft.target}
                    onChange={(e) => setDraft({ ...draft, target: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm"
                  />
                  <input
                    type="date"
                    value={draft.deadline}
                    onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm sm:col-span-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddObjective}
                  disabled={busy}
                  data-testid="annual-review-add-objective-btn"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500 text-white text-xs font-bold uppercase tracking-wide hover:bg-violet-600 disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" aria-hidden="true" />
                  {t('annualReview.objective.addBtn', 'Agregar')}
                </button>
              </div>
            )}
          </section>

          {/* ───────────── Section 2: Evidencias ───────────── */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-5 space-y-3"
            data-testid="annual-review-section-evidence"
          >
            <header className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-500" aria-hidden="true" />
              <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
                {t('annualReview.section.evidence', 'Evidencias')}
              </h2>
              <span className="ml-auto text-xs text-secondary-token">
                {snapshot.evidences.length}
              </span>
            </header>
            {snapshot.evidences.length === 0 ? (
              <p className="text-sm text-secondary-token italic">
                {t(
                  'annualReview.evidence.empty',
                  'Sin evidencias adjuntas todavía. Vincula documentos, auditorías, incidentes o capacitaciones a cada objetivo.',
                )}
              </p>
            ) : (
              <ul className="space-y-2">
                {snapshot.objectives.map((obj) => {
                  const list = evidencesByObjective.get(obj.id) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <li
                      key={obj.id}
                      className="rounded-lg border border-default-token p-2"
                      data-testid={`annual-review-evidence-group-${obj.id}`}
                    >
                      <p className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
                        {obj.title}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {list.map((ev, idx) => (
                          <li
                            key={`${ev.objectiveId}-${ev.evidenceUrl}-${idx}`}
                            className="text-xs text-primary-token flex items-center gap-2"
                          >
                            <Paperclip
                              className="w-3 h-3 text-violet-500 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="font-mono break-all">
                              {ev.evidenceUrl}
                            </span>
                            <span className="text-[10px] uppercase tracking-widest text-secondary-token">
                              {ev.evidenceKind}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
            {!isConcluded && snapshot.objectives.length > 0 && (
              <div className="mt-2 pt-3 border-t border-default-token space-y-2">
                <p className="text-[11px] uppercase tracking-widest text-secondary-token font-bold">
                  {t('annualReview.evidence.attach', 'Adjuntar evidencia')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={evidenceDraft.objectiveId}
                    onChange={(e) =>
                      setEvidenceDraft({ ...evidenceDraft, objectiveId: e.target.value })
                    }
                    data-testid="annual-review-evidence-objective-select"
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm"
                  >
                    <option value="">
                      {t('annualReview.evidence.selectObjective', 'Selecciona objetivo…')}
                    </option>
                    {snapshot.objectives.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                  </select>
                  <select
                    value={evidenceDraft.evidenceKind}
                    onChange={(e) =>
                      setEvidenceDraft({
                        ...evidenceDraft,
                        evidenceKind: e.target
                          .value as NewEvidenceDraft['evidenceKind'],
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm"
                  >
                    <option value="document">
                      {t('annualReview.evidence.kind.document', 'Documento')}
                    </option>
                    <option value="audit">
                      {t('annualReview.evidence.kind.audit', 'Auditoría')}
                    </option>
                    <option value="incident">
                      {t('annualReview.evidence.kind.incident', 'Incidente')}
                    </option>
                    <option value="training">
                      {t('annualReview.evidence.kind.training', 'Capacitación')}
                    </option>
                    <option value="other">
                      {t('annualReview.evidence.kind.other', 'Otro')}
                    </option>
                  </select>
                  <input
                    type="text"
                    placeholder={t(
                      'annualReview.evidence.urlPh',
                      'URL o ruta (/documents/abc.pdf, https://…)',
                    )}
                    value={evidenceDraft.evidenceUrl}
                    onChange={(e) =>
                      setEvidenceDraft({ ...evidenceDraft, evidenceUrl: e.target.value })
                    }
                    data-testid="annual-review-evidence-url-input"
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm sm:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder={t('annualReview.evidence.captionPh', 'Descripción (opcional)')}
                    value={evidenceDraft.caption}
                    onChange={(e) =>
                      setEvidenceDraft({ ...evidenceDraft, caption: e.target.value })
                    }
                    className="px-3 py-2 rounded-lg border border-default-token bg-surface text-sm sm:col-span-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAttachEvidence}
                  disabled={busy}
                  data-testid="annual-review-attach-evidence-btn"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500 text-white text-xs font-bold uppercase tracking-wide hover:bg-violet-600 disabled:opacity-50"
                >
                  <Paperclip className="w-3 h-3" aria-hidden="true" />
                  {t('annualReview.evidence.attachBtn', 'Adjuntar')}
                </button>
              </div>
            )}
          </section>

          {/* ───────────── Section 3: Análisis ───────────── */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-5 space-y-3"
            data-testid="annual-review-section-analysis"
          >
            <header className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-violet-500" aria-hidden="true" />
              <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
                {t('annualReview.section.analysis', 'Análisis y hallazgos')}
              </h2>
            </header>
            <textarea
              value={analysis}
              onChange={(e) => setAnalysis(e.target.value)}
              disabled={isConcluded}
              rows={6}
              placeholder={t(
                'annualReview.analysis.ph',
                'Resume hallazgos, desempeño del SGI, lecciones aprendidas, recomendaciones para el año siguiente…',
              )}
              data-testid="annual-review-analysis-textarea"
              className="w-full px-3 py-2 rounded-lg border border-default-token bg-surface text-sm text-primary-token disabled:opacity-60 resize-vertical"
            />
            {!isConcluded && analysis !== (snapshot.analysis ?? '') && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                {t(
                  'annualReview.analysis.unsaved',
                  'Cambios sin guardar — se persistirán al agregar/eliminar objetivos o al concluir la revisión.',
                )}
              </p>
            )}
          </section>

          {/* ───────────── Section 4: Conclusiones ───────────── */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-5 space-y-3"
            data-testid="annual-review-section-conclusion"
          >
            <header className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-violet-500" aria-hidden="true" />
              <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
                {t('annualReview.section.conclusion', 'Conclusiones y firma')}
              </h2>
            </header>
            {isConcluded ? (
              <div
                className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1"
                data-testid="annual-review-concluded-card"
              >
                <p className="text-xs uppercase tracking-widest text-emerald-600 dark:text-emerald-400 font-bold">
                  {t('annualReview.concluded.heading', 'Revisión cerrada')}
                </p>
                <p className="text-sm text-primary-token whitespace-pre-wrap">
                  {snapshot.conclusion}
                </p>
                <p className="text-[11px] text-secondary-token">
                  {t('annualReview.concluded.signedBy', 'Firmada por')}{' '}
                  <span className="font-bold">{snapshot.signedOffByName}</span>
                  {snapshot.concludedAt && (
                    <>
                      {' '}
                      ·{' '}
                      {new Date(snapshot.concludedAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <>
                <textarea
                  value={conclusion}
                  onChange={(e) => setConclusion(e.target.value)}
                  rows={4}
                  placeholder={t(
                    'annualReview.conclusion.ph',
                    'Resume el cierre del año: cumplimiento, hallazgos críticos, compromisos para {{year}}.',
                  ).replace('{{year}}', String(year + 1))}
                  data-testid="annual-review-conclusion-textarea"
                  className="w-full px-3 py-2 rounded-lg border border-default-token bg-surface text-sm text-primary-token resize-vertical"
                />
                <button
                  type="button"
                  onClick={handleConclude}
                  disabled={busy || conclusion.trim().length < 10}
                  data-testid="annual-review-conclude-btn"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-bold uppercase tracking-wide hover:bg-violet-600 disabled:opacity-50"
                >
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  {t('annualReview.conclusion.btn', 'Concluir revisión')}
                </button>
                <p className="text-[10px] text-secondary-token">
                  {t(
                    'annualReview.conclusion.warning',
                    'Al concluir, el año queda bloqueado: no se podrán agregar objetivos ni evidencias.',
                  )}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default AnnualReview;
