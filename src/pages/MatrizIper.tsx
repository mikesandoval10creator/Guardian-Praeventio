// Praeventio Guard — Matriz IPER 5x5 self-assessment tool + project landscape.
//
// Two complementary surfaces:
//  1. IperMatrixCard — self-assessment: the user picks probability × severity
//     (+ optional control effectiveness) and the REAL pure engine
//     `calculateIper` returns the risk level + raw score + residual +
//     recommendation. Pure client compute over the user's input.
//  2. RiskMatrix5x5 — executive landscape: every REAL saved `iper_assessments`
//     of the active project plotted on the 5×5 scatter (probability × impact),
//     fed by `useIperMatrix` (GET /api/sprint-k/:projectId/iper-assessments/
//     matrix). Honest empty-state when no assessments are saved — never a
//     fabricated point.
//
// DIRECTIVE: this is GUIDANCE, never an operational block — it estimates risk;
// the supervisor/team decides.

import { useTranslation } from 'react-i18next';
import { Grid3x3 } from 'lucide-react';
import { IperMatrixCard } from '../components/protocols/IperMatrixCard';
import { RiskMatrix5x5Lazy } from '../components/riskMatrix/RiskMatrix5x5Lazy';
import { useIperMatrix } from '../hooks/useSafetyMetrics';
import { useProject } from '../contexts/ProjectContext';

export function MatrizIper() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;
  const { nodes, loading, error } = useIperMatrix(projectId);

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

      <IperMatrixCard />

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
