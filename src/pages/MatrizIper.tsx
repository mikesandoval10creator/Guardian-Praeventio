// Praeventio Guard — Matriz IPER 5x5 self-assessment tool + project landscape.
//
// Three complementary surfaces:
//  1. IperMatrixCard — self-assessment: the user picks probability × severity
//     (+ optional control effectiveness) and the REAL pure engine
//     `calculateIper` returns the risk level + raw score + residual +
//     recommendation. Pure client compute over the user's input.
//  2. "Guardar evaluación" (B.4) — persists the CURRENT card values through
//     `recordIperAssessment` (setDoc iper_assessments/{id} + audit_logs row,
//     both inside the service) and refetches the landscape. Same payload
//     shape as the IPERCAnalysis peer (src/components/risks/IPERCAnalysis.tsx).
//  3. RiskMatrix5x5 — executive landscape: every REAL saved `iper_assessments`
//     of the active project plotted on the 5×5 scatter (probability × impact),
//     fed by `useIperMatrix` (GET /api/sprint-k/:projectId/iper-assessments/
//     matrix). Honest empty-state when no assessments are saved — never a
//     fabricated point.
//
// DIRECTIVE: this is GUIDANCE, never an operational block — it estimates risk;
// the supervisor/team decides.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3, Loader2, Save } from 'lucide-react';
import { IperMatrixCard } from '../components/protocols/IperMatrixCard';
import { RiskMatrix5x5Lazy } from '../components/riskMatrix/RiskMatrix5x5Lazy';
import { useIperMatrix } from '../hooks/useSafetyMetrics';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { calculateIper, type IperInput, type IperResult } from '../services/protocols/iper';
import { recordIperAssessment } from '../services/safety/iperAssessments';
import { logger } from '../utils/logger';
import { humanErrorMessage } from '../lib/humanError';


const INITIAL_INPUT: IperInput = { probability: 3, severity: 3 };

export function MatrizIper() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const projectId = selectedProject?.id ?? null;
  const { nodes, loading, error, refetch } = useIperMatrix(projectId);

  // B.4 — mirror of the card's live input/result (via its onChange) so
  // "Guardar evaluación" persists EXACTLY what the user is seeing. Seeded
  // with the card's own defaults (3×3, no residual).
  const [current, setCurrent] = useState<{ input: IperInput; result: IperResult }>(() => ({
    input: INITIAL_INPUT,
    result: calculateIper(INITIAL_INPUT),
  }));
  const handleCardChange = useCallback((input: IperInput, result: IperResult) => {
    setCurrent({ input, result });
  }, []);

  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  // durationMin feeds the audit trail (→ stats.safeHours), same as the peer.
  const [openedAtMs] = useState<number>(() => Date.now());

  const canSave = Boolean(projectId && user && description.trim().length > 0) && !saving;

  const handleSaveAssessment = async () => {
    if (!projectId || !user || description.trim().length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const durationMin = Math.max(1, Math.ceil((Date.now() - openedAtMs) / 60_000));
      const { probability, severity, controlEffectiveness } = current.input;
      await recordIperAssessment({
        description: description.trim(),
        projectId,
        // Firestore rejects nested `undefined` — omit the optional key instead.
        inputs: {
          probability,
          severity,
          ...(controlEffectiveness ? { controlEffectiveness } : {}),
        },
        level: current.result.level,
        rawScore: current.result.rawScore,
        recommendation: current.result.recommendation,
        // No AI in this quick flow — control suggestions live in IPERCAnalysis.
        suggestedControls: [],
        computedAt: new Date().toISOString(),
        authorUid: user.uid,
        durationMin,
      });
      setSavedOk(true);
      setDescription('');
      refetch();
    } catch (err) {
      logger.error('MatrizIper: recordIperAssessment failed', { err });
      setSaveError(
        t(
          'iper.save.error',
          'No se pudo guardar la evaluación. Revisa tu conexión e intenta nuevamente.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="matriz-iper-page"
      className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6"
    >
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-violet-500/10 border border-violet-500/20 shrink-0">
          <Grid3x3 className="w-6 h-6 text-violet-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-primary-token leading-tight">
            {t('iper.page.title', 'Matriz IPER 5x5')}
          </h1>
          <p className="text-xs sm:text-sm text-secondary-token font-medium mt-1">
            {t(
              'iper.page.subtitle',
              'Estima el nivel de riesgo (probabilidad × severidad) y el residual al aplicar controles. Es una guía — la decisión es del equipo.',
            )}
          </p>
        </div>
      </header>

      <IperMatrixCard onChange={handleCardChange} />

      <section
        data-testid="iper-save"
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('iper.save.descriptionLabel', 'Descripción del peligro / tarea evaluada')}
          </span>
          <input
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSavedOk(false);
            }}
            placeholder={
              t(
                'iper.save.descriptionPlaceholder',
                'Ej: trabajo en altura sobre 1,8 m en andamio móvil',
              ) as string
            }
            data-testid="iper-save-description"
            className="text-sm rounded border border-default-token bg-surface px-3 py-2"
          />
        </label>

        {!projectId && (
          <p data-testid="iper-save.no-project" className="text-xs text-secondary-token">
            {t('iper.save.noProject', 'Selecciona un proyecto para poder guardar la evaluación.')}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveAssessment}
            disabled={!canSave}
            data-testid="iper-save-button"
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="w-4 h-4" aria-hidden="true" />
            )}
            {t('iper.save.button', 'Guardar evaluación')}
          </button>
          {savedOk && (
            <span
              data-testid="iper-save-success"
              className="text-xs font-medium text-emerald-600"
            >
              {t('iper.save.success', 'Evaluación guardada — ya aparece en el panorama.')}
            </span>
          )}
        </div>

        {saveError && (
          <p data-testid="iper-save-error" className="text-xs text-rose-600">
            {humanErrorMessage(saveError)}
          </p>
        )}
      </section>

      <section data-testid="iper-landscape" className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-tight text-secondary-token">
          {t('iper.landscape.title', 'Panorama de riesgos del proyecto')}
        </h2>

        {!projectId ? (
          <p
            data-testid="iper-landscape.no-project"
            className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-secondary-token"
          >
            {t(
              'iper.landscape.noProject',
              'Selecciona un proyecto para ver el panorama de riesgos evaluados.',
            )}
          </p>
        ) : loading ? (
          <div
            data-testid="iper-landscape.loading"
            className="flex h-40 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-secondary-token"
          >
            {t('iper.landscape.loading', 'Cargando evaluaciones IPER…')}
          </div>
        ) : error ? (
          <p
            data-testid="iper-landscape.error"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
          >
            {t(
              'iper.landscape.error',
              'No se pudo cargar el panorama de riesgos. Intenta nuevamente.',
            )}
          </p>
        ) : nodes.length === 0 ? (
          <p
            data-testid="iper-landscape.empty"
            className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-secondary-token"
          >
            {t(
              'iper.landscape.empty',
              'Aún no hay evaluaciones IPER guardadas en este proyecto. Cuando registres una, aparecerá aquí en la matriz 5×5.',
            )}
          </p>
        ) : (
          <RiskMatrix5x5Lazy nodes={nodes} />
        )}
      </section>
    </div>
  );
}

export default MatrizIper;
