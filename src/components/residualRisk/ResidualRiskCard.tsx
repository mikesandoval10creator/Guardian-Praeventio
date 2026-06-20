// Praeventio Guard — Wire UI #50: <ResidualRiskCard />
//
// Muestra el riesgo residual de un assessment: score inicial,
// reducción por controles, score residual, y si requiere aceptación
// formal.
//
// Modos:
//   - "assessment" (default): recalcula el riesgo residual desde el
//     assessment + controles via `computeResidualRisk` (engine puro,
//     mutation-tested). Usado por la lista de evaluaciones que aún no
//     tienen un registro persistido.
//   - "stored" (prop `stored`): renderiza el registro YA persistido en el
//     servidor (`StoredResidualRisk`) — peligro, justificación, scores
//     guardados y el estado REAL de aceptación formal (firmado por / fecha,
//     o pendiente). Es la card que usa la página ResidualRisk para no
//     duplicar números recalculados vs. los guardados.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertOctagon,
  ArrowDownRight,
  ShieldCheck,
  Stamp,
} from 'lucide-react';
import {
  computeResidualRisk,
  type RiskAssessment,
  type AppliedControl,
  type RiskLevel,
} from '../../services/residualRisk/residualRiskEngine.js';
import type { StoredResidualRisk } from '../../hooks/useResidualRisk';

interface ResidualRiskCardProps {
  assessment: RiskAssessment;
  controls: AppliedControl[];
  onRequestAcceptance?: (riskId: string) => void;
  /**
   * Persisted residual-risk record. When provided, the card renders the
   * STORED values (hazard, justification, saved scores, real acceptance
   * status) instead of the recomputed assessment numbers. This is what the
   * ResidualRisk page passes so a single card shows the server's source of
   * truth — never a second, recomputed card next to it.
   */
  stored?: StoredResidualRisk;
}

const LEVEL_TONE: Record<RiskLevel, { color: string; bg: string; badge: string }> = {
  low: {
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  medium: {
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  high: {
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  },
  extreme: {
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
};

export function ResidualRiskCard({
  assessment,
  controls,
  onRequestAcceptance,
  stored,
}: ResidualRiskCardProps) {
  const { t } = useTranslation();
  const report = useMemo(
    () => computeResidualRisk(assessment, controls),
    [assessment, controls],
  );

  // Prefer stored (server source-of-truth) values when present, falling back
  // to the recomputed report otherwise. Keeps the assessment-only mode
  // (used by the dedicated component test) byte-for-byte unchanged.
  const initialScore = stored?.initialScore ?? report.initialScore;
  const residualScore = stored?.residualScore ?? report.residualScore;
  const controlReduction = stored?.controlReduction ?? report.controlReduction;
  const initialLevel = stored?.initialLevel ?? report.initialLevel;
  const residualLevel = stored?.residualLevel ?? report.residualLevel;
  const nextReviewInDays = stored?.nextReviewInDays ?? report.nextReviewInDays;
  const requiresFormalAcceptance =
    stored?.requiresFormalAcceptance ?? report.requiresFormalAcceptance;
  const accepted = stored?.acceptance.status === 'accepted';

  const residualTone = LEVEL_TONE[residualLevel];
  const initialTone = LEVEL_TONE[initialLevel];

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${residualTone.bg}`}
      data-testid={`residual-risk-card-${assessment.riskId}`}
      aria-label={t('residualRisk.aria', 'Riesgo residual') as string}
    >
      <header className="flex items-center gap-2">
        {stored ? (
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${residualTone.bg} ${residualTone.color}`}
          >
            <AlertOctagon className="w-4 h-4" aria-hidden="true" />
          </div>
        ) : (
          <Activity className={`w-4 h-4 ${residualTone.color}`} aria-hidden="true" />
        )}
        <div className="flex-1 min-w-0">
          {stored && (
            <h3 className="text-sm font-black text-primary-token truncate">
              {stored.hazard}
            </h3>
          )}
          <h2 className="text-[11px] sm:text-sm font-black text-primary-token uppercase tracking-wide truncate">
            {assessment.category}
            {stored && (
              <>
                {' · '}
                <span className="uppercase tracking-wide">
                  {assessment.riskKind}
                </span>
              </>
            )}
          </h2>
        </div>
        <span
          className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${residualTone.badge}`}
          data-testid={`residual-level-${assessment.riskId}`}
        >
          {residualLevel.toUpperCase()}
        </span>
      </header>

      {stored && stored.currentControls.length > 0 && (
        <div className="text-[11px] text-secondary-token">
          <span className="font-bold">
            {t('residualRisk.controlsCount', 'Controles aplicados')}:
          </span>{' '}
          {stored.currentControls.length}
          {' · '}
          {t('residualRisk.reduction', 'Reducción')}: −{controlReduction}
        </div>
      )}

      {stored ? (
        <div className="flex items-center gap-3 text-center">
          <div className="flex-1 bg-surface rounded-lg p-2">
            <p className="text-[9px] uppercase text-secondary-token">
              {t('residualRisk.inherent', 'Inherente')}
            </p>
            <p className={`text-lg font-black ${initialTone.color}`}>
              {initialScore}
            </p>
            <p className="text-[9px] uppercase">{initialLevel}</p>
          </div>
          <ArrowDownRight
            className="w-5 h-5 text-secondary-token shrink-0"
            aria-hidden="true"
            data-testid={`residual-delta-${assessment.riskId}`}
          />
          <div className="flex-1 bg-surface rounded-lg p-2">
            <p className="text-[9px] uppercase text-secondary-token">
              {t('residualRisk.residual', 'Residual')}
            </p>
            <p className={`text-lg font-black ${residualTone.color}`}>
              {residualScore}
            </p>
            <p className="text-[9px] uppercase">{residualLevel}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-surface rounded p-2">
            <p className="text-[10px] uppercase text-secondary-token mb-1">
              {t('residualRisk.initial', 'Inicial')}
            </p>
            <p className={`text-xl font-black ${initialTone.color}`}>{initialScore}</p>
            <p className="text-[9px] uppercase">{initialLevel}</p>
          </div>
          <div className="bg-surface rounded p-2">
            <p className="text-[10px] uppercase text-secondary-token mb-1">
              {t('residualRisk.reduction', 'Reducción')}
            </p>
            <p className="text-xl font-black text-sky-500">−{controlReduction}</p>
            <p className="text-[9px] uppercase">
              {controls.length} {t('residualRisk.controls', 'controles')}
            </p>
          </div>
          <div className="bg-surface rounded p-2">
            <p className="text-[10px] uppercase text-secondary-token mb-1">
              {t('residualRisk.residual', 'Residual')}
            </p>
            <p className={`text-xl font-black ${residualTone.color}`}>{residualScore}</p>
            <p className="text-[9px] uppercase">{residualLevel}</p>
          </div>
        </div>
      )}

      {stored && (
        <div className="text-[11px] text-secondary-token">
          <p className="font-bold">
            {t('residualRisk.justification', 'Justificación')}:
          </p>
          <p className="italic">{stored.justification}</p>
        </div>
      )}

      <div className="flex justify-between text-[10px] text-secondary-token">
        <span>
          {t('residualRisk.kind', 'Tipo')}:{' '}
          <span className="font-bold uppercase">{assessment.riskKind}</span>
        </span>
        <span>
          {t('residualRisk.nextReview', 'Próxima revisión')}:{' '}
          <span className="font-bold tabular-nums">{nextReviewInDays}d</span>
        </span>
      </div>

      {/*
        Acceptance strip.
        - stored + accepted → "aceptado por …" stamp (residual-accepted-*).
        - stored + pending + requiere aceptación → amber pending strip with the
          "Aceptar formalmente" button (residual-pending-* / residual-accept-btn-*).
        - assessment-only mode → the original "requiere aceptación" banner
          (residual-acceptance-* / residual-acceptance-btn-*), unchanged.
      */}
      {stored ? (
        accepted ? (
          <div
            className="flex items-center gap-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 p-2 rounded text-[11px]"
            data-testid={`residual-accepted-${stored.id}`}
          >
            <ShieldCheck className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>
              {t(
                'residualRisk.acceptedBy',
                'Aceptado formalmente por {{uid}} el {{date}}',
                {
                  uid: stored.acceptance.signedByUid ?? '—',
                  date: stored.acceptance.signedAt?.slice(0, 10) ?? '—',
                },
              )}
            </span>
          </div>
        ) : (
          requiresFormalAcceptance && (
            <div
              className="flex items-center gap-2 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded text-[11px]"
              data-testid={`residual-pending-${stored.id}`}
            >
              <Stamp className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="flex-1">
                {t(
                  'residualRisk.acceptancePending',
                  'Pendiente de aceptación formal por gerencia',
                )}
              </span>
              {onRequestAcceptance && (
                <button
                  type="button"
                  onClick={() => onRequestAcceptance(assessment.riskId)}
                  data-testid={`residual-accept-btn-${stored.id}`}
                  className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold hover:bg-amber-600"
                >
                  {t('residualRisk.acceptFormally', 'Aceptar formalmente')}
                </button>
              )}
            </div>
          )
        )
      ) : (
        requiresFormalAcceptance && (
          <div
            className="flex items-center gap-2 bg-amber-500/10 p-2 rounded text-[11px] text-amber-700 dark:text-amber-300"
            data-testid={`residual-acceptance-${assessment.riskId}`}
          >
            <Stamp className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              {t(
                'residualRisk.acceptanceRequired',
                'Riesgo residual alto: requiere aceptación formal documentada',
              )}
            </span>
            {onRequestAcceptance && (
              <button
                type="button"
                onClick={() => onRequestAcceptance(assessment.riskId)}
                data-testid={`residual-acceptance-btn-${assessment.riskId}`}
                className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold hover:bg-amber-600"
              >
                {t('residualRisk.requestSignature', 'Solicitar firma')}
              </button>
            )}
          </div>
        )
      )}
    </section>
  );
}
