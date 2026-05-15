// Praeventio Guard — Wire UI: <IncidentEvidenceBundleCard />
//
// Wire UI para Fase F.3 — paquete de evidencia por incidente. El motor
// `incidentEvidenceBundle.ts` produce un manifest con completenessScore
// (0..100) + gaps + recommendations. Este componente lo visualiza para
// que el prevencionista vea de un vistazo qué falta antes de presentar
// el expediente a fiscalización/mutualidad.

import { useTranslation } from 'react-i18next';
import {
  Folder,
  Camera,
  Users,
  ShieldAlert,
  BookOpen,
  AlertOctagon,
  CheckCircle2,
  Download,
  ClipboardList,
} from 'lucide-react';
import type {
  IncidentBundleManifest,
  CompletenessGap,
  IncidentSeverity,
} from '../../services/incidentBundle/incidentEvidenceBundle.js';

interface IncidentEvidenceBundleCardProps {
  manifest: IncidentBundleManifest;
  /** Callback al descargar JSON / PDF (caller construye el archivo). */
  onExport?: (manifest: IncidentBundleManifest) => void;
  /** Callback al abrir el detalle de un gap específico para corregirlo. */
  onResolveGap?: (gap: CompletenessGap, manifest: IncidentBundleManifest) => void;
}

const SEVERITY_CLASS: Record<IncidentSeverity, string> = {
  low: 'bg-stone-500/15 border-stone-500/40 text-stone-700 dark:text-stone-300',
  medium:
    'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300',
  high: 'bg-orange-500/20 border-orange-500/50 text-orange-700 dark:text-orange-300',
  critical:
    'bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300',
  sif: 'bg-rose-700/30 border-rose-700/60 text-rose-900 dark:text-rose-200',
};

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
  sif: 'SIF',
};

const GAP_LABEL: Record<CompletenessGap['kind'], string> = {
  no_evidence: 'Sin evidencia cargada',
  no_affected_workers_declared: 'Trabajadores afectados no declarados',
  no_root_cause_assigned: 'Causa raíz no asignada',
  no_normative_refs: 'Sin referencias normativas',
  control_failure_unspecified: 'Falla de control no especificada',
  missing_epp_vigency: 'EPP sin verificación de vigencia',
  missing_training_vigency: 'Capacitación sin verificación de vigencia',
  missing_audit_log: 'Sin registro de auditoría',
};

function scoreColor(score: number): {
  bar: string;
  text: string;
  label: string;
} {
  if (score >= 90)
    return { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', label: 'Expediente sólido' };
  if (score >= 70)
    return { bar: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-300', label: 'Aceptable, cerrar detalles' };
  if (score >= 40)
    return { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', label: 'Incompleto — riesgo' };
  return { bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', label: 'Crítico — no presentar' };
}

export function IncidentEvidenceBundleCard({
  manifest,
  onExport,
  onResolveGap,
}: IncidentEvidenceBundleCardProps) {
  const { t } = useTranslation();
  const score = scoreColor(manifest.completenessScore);

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      data-testid="incident-bundle-card"
      aria-label={t('incidentBundle.aria', 'Paquete de evidencia del incidente') as string}
    >
      <header className="flex items-start gap-2 mb-3">
        <Folder
          className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100 truncate">
            {t('incidentBundle.title', 'Expediente de incidente')} —{' '}
            {manifest.incident.id}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span
              data-testid="incident-bundle-severity"
              className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${SEVERITY_CLASS[manifest.incident.severity]}`}
            >
              {SEVERITY_LABEL[manifest.incident.severity]}
            </span>
            <span className="text-[11px] opacity-70">
              {manifest.incident.summary}
            </span>
          </div>
        </div>
        {onExport && (
          <button
            type="button"
            onClick={() => onExport(manifest)}
            data-testid="incident-bundle-export"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-600 text-white text-xs font-bold hover:brightness-110 shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {t('incidentBundle.export', 'Exportar')}
          </button>
        )}
      </header>

      {/* Completeness score bar */}
      <div className="mb-3" data-testid="incident-bundle-score">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400">
            {t('incidentBundle.completeness', 'Completitud')}
          </span>
          <span className={`text-lg font-black ${score.text}`}>
            {manifest.completenessScore}/100
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden">
          <div
            data-testid="incident-bundle-score-bar"
            style={{ width: `${manifest.completenessScore}%` }}
            className={`h-full ${score.bar} transition-all`}
          />
        </div>
        <p className={`text-[11px] font-bold mt-1 ${score.text}`}>{score.label}</p>
      </div>

      {/* Inventory tiles */}
      <div
        className="grid grid-cols-3 gap-1.5 mb-3"
        data-testid="incident-bundle-inventory"
      >
        <InventoryTile
          icon={Camera}
          label={t('incidentBundle.evidence', 'Evidencia') as string}
          count={manifest.evidence.length}
          testId="incident-bundle-tile-evidence"
        />
        <InventoryTile
          icon={Users}
          label={t('incidentBundle.workers', 'Afectados') as string}
          count={manifest.affectedWorkers.length}
          testId="incident-bundle-tile-workers"
        />
        <InventoryTile
          icon={ShieldAlert}
          label={t('incidentBundle.controls', 'Controles') as string}
          count={manifest.appliedControls.length}
          testId="incident-bundle-tile-controls"
        />
        <InventoryTile
          icon={BookOpen}
          label={t('incidentBundle.norms', 'Normativas') as string}
          count={manifest.normativeRefs.length}
          testId="incident-bundle-tile-norms"
        />
        <InventoryTile
          icon={ClipboardList}
          label={t('incidentBundle.audit', 'Auditoría') as string}
          count={manifest.auditLog.length}
          testId="incident-bundle-tile-audit"
        />
        <InventoryTile
          icon={CheckCircle2}
          label={t('incidentBundle.trainings', 'Capacit.') as string}
          count={manifest.requiredTrainings.length}
          testId="incident-bundle-tile-trainings"
        />
      </div>

      {/* Gaps */}
      {manifest.gaps.length === 0 ? (
        <p
          className="text-xs italic text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5"
          data-testid="incident-bundle-no-gaps"
        >
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t('incidentBundle.noGaps', 'Sin gaps detectados — expediente presentable')}
        </p>
      ) : (
        <>
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5">
            {t('incidentBundle.gapsLabel', 'Gaps por resolver')} ({manifest.gaps.length})
          </p>
          <ul className="space-y-1.5 mb-3" data-testid="incident-bundle-gaps">
            {manifest.gaps.map((g, idx) => (
              <li
                key={`${g.kind}-${idx}`}
                data-testid={`incident-bundle-gap-${g.kind}`}
                className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2"
              >
                <div className="flex items-start gap-2">
                  <AlertOctagon
                    className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-rose-700 dark:text-rose-300">
                      {GAP_LABEL[g.kind]}
                    </p>
                    <p className="text-[11px] text-rose-700/80 dark:text-rose-300/80">
                      {g.detail}
                    </p>
                    <p className="text-[10px] mt-0.5 opacity-70 font-mono">
                      {t('incidentBundle.weight', 'peso')}: −{g.weight}
                    </p>
                  </div>
                  {onResolveGap && (
                    <button
                      type="button"
                      onClick={() => onResolveGap(g, manifest)}
                      data-testid={`incident-bundle-gap-resolve-${g.kind}`}
                      className="px-2 py-1 rounded-md bg-rose-600 text-white text-[11px] font-bold hover:brightness-110 shrink-0"
                    >
                      {t('incidentBundle.resolve', 'Resolver')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Recommendations */}
      {manifest.recommendations.length > 0 && (
        <div
          className="rounded-md border border-teal-500/30 bg-teal-500/5 p-2.5"
          data-testid="incident-bundle-recommendations"
        >
          <p className="text-[10px] uppercase tracking-wide font-bold text-teal-700 dark:text-teal-300 mb-1">
            {t('incidentBundle.recommendationsLabel', 'Recomendaciones')}
          </p>
          <ul className="text-[11px] text-teal-800 dark:text-teal-200 leading-snug space-y-0.5">
            {manifest.recommendations.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Internal: inventory tile
// ────────────────────────────────────────────────────────────────────────

interface InventoryTileProps {
  icon: typeof Camera;
  label: string;
  count: number;
  testId: string;
}

function InventoryTile({ icon: Icon, label, count, testId }: InventoryTileProps) {
  const emptyClass =
    count === 0
      ? 'bg-rose-500/5 border-rose-500/30 text-rose-700 dark:text-rose-300'
      : 'bg-stone-500/5 border-stone-500/20 text-stone-700 dark:text-stone-200';
  return (
    <div
      data-testid={testId}
      data-count={count}
      className={`rounded-md border px-2 py-1.5 flex flex-col items-center text-center ${emptyClass}`}
    >
      <Icon className="w-3.5 h-3.5 mb-0.5" aria-hidden="true" />
      <p className="text-base font-black leading-none">{count}</p>
      <p className="text-[9px] uppercase tracking-wide font-bold mt-0.5">
        {label}
      </p>
    </div>
  );
}
