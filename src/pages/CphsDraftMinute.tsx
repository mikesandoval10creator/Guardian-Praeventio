// Praeventio Guard — Fase F.7 page wrapper.
//
// Minuta CPHS automática: vista del borrador estructurado que el motor
// determinístico `buildMonthlyMinuteDraft` produce a partir de
// incidentes, acciones correctivas, capacitaciones, inspecciones y
// score semáforo del último mes calendario. El prevencionista revisa,
// edita en el componente CPHS principal y luego firma — F.7 cierra la
// "obligación mensual del comité paritario" (DS 54 art. 24 / Ley
// 16.744 art. 66).
//
// Esta página:
//   1. Llama `useCphsDraftMinute(projectId)` (Sprint K hook).
//   2. Renderiza el header + secciones del draft (encabezado, métricas,
//      acuerdos sugeridos, recomendaciones normativas).
//   3. Ofrece botón "Descargar como JSON" client-side (Blob), sin
//      pegarle a otro endpoint — el draft ya está en memoria.
//   4. Maneja loading / error / empty + offline chip + back link a /cphs.
//
// La directiva del usuario es explícita: NO push automático a SUSESO
// ni a ningún organismo. La app genera el documento; el CPHS lo firma
// y la empresa lo entrega. Este page es solo "borrador legible";
// la firma vive en el módulo CPHS principal.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  FileText,
  WifiOff,
  Download,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useCphsDraftMinute } from '../hooks/useSprintK';
import { logger } from '../utils/logger';

export function CphsDraftMinute() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = useCphsDraftMinute(projectId);

  /**
   * Client-side JSON download. We already have the full draft in memory
   * from the hook; pinging another endpoint just to serialize it would
   * be wasteful. Blob + ObjectURL + anchor click is the idiomatic
   * "save-as" pattern in the browser. Filename includes period for
   * traceability (the prevencionista filing it in their evidence
   * folder will want it dated).
   */
  const handleDownloadJson = () => {
    if (!data?.draft) return;
    try {
      const filename = `minuta-cphs-${selectedProject?.id ?? 'proyecto'}-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(data.draft, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Free the ObjectURL on next tick so the download has actually
      // started in all browsers (Safari is the picky one).
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      logger.info('cphs.draftMinute.downloaded', {
        projectId: selectedProject?.id,
      });
    } catch (err) {
      logger.error('cphs.draftMinute.download.failed', err);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="cphs-draft-minute-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <FileText
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('cphsDraft.page.title', 'Minuta CPHS automática')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'cphsDraft.page.selectProject',
              'Selecciona un proyecto para generar el borrador del último mes.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="cphs-draft-minute-page"
    >
      <header className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <FileText className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('cphsDraft.page.title', 'Minuta CPHS automática')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'cphsDraft.page.subtitle',
              'Borrador del último mes — revisable y editable antes de la firma del comité.',
            )}
          </p>
        </div>
        <Link
          to="/cphs"
          className="inline-flex items-center gap-1 text-xs font-semibold text-secondary-token hover:text-primary-token transition"
          data-testid="cphs-draft-minute-back"
        >
          <ArrowLeft className="w-3 h-3" aria-hidden="true" />
          {t('cphsDraft.page.back', 'Volver a CPHS')}
        </Link>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="cphs-draft-minute-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="cphs-draft-minute-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="cphs-draft-minute-error"
          role="alert"
        >
          {t(
            'cphsDraft.page.error',
            'No se pudo generar la minuta: {{msg}}',
            { msg: error.message },
          )}
        </div>
      )}

      {!loading && !error && data?.draft && (
        <DraftContent
          draft={data.draft}
          onDownloadJson={handleDownloadJson}
        />
      )}
    </div>
  );
}

/**
 * Pure presentational subcomponent — renders the structured draft.
 * Split out so the test can target sections without the loading/error
 * branches getting in the way.
 */
function DraftContent({
  draft,
  onDownloadJson,
}: {
  draft: NonNullable<ReturnType<typeof useCphsDraftMinute>['data']>['draft'];
  onDownloadJson: () => void;
}) {
  const { t } = useTranslation();
  const metrics = draft.metrics;
  const completeness = draft.completenessScore;
  const completenessLow = completeness < 60;

  return (
    <section className="space-y-4" data-testid="cphs-draft-minute-content">
      {/* Completeness banner — warn the prevencionista when key inputs
          are missing before they sign off. */}
      <div
        className={
          completenessLow
            ? 'rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3'
            : 'rounded-2xl border border-default-token bg-surface p-4 flex items-start gap-3'
        }
        data-testid="cphs-draft-minute-completeness"
      >
        {completenessLow && (
          <AlertTriangle
            className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-secondary-token">
            {t('cphsDraft.completeness.label', 'Completitud del input')}
          </p>
          <p className="text-sm font-mono mt-1 text-primary-token">
            {completeness}/100
          </p>
          {completenessLow && (
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              {t(
                'cphsDraft.completeness.warn',
                'Faltan datos relevantes. Revisa antes de firmar.',
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDownloadJson}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition text-xs font-semibold"
          data-testid="cphs-draft-minute-download"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {t('cphsDraft.download.json', 'Descargar como JSON')}
        </button>
      </div>

      {/* Metrics grid */}
      <div
        className="grid grid-cols-2 sm:grid-cols-5 gap-2"
        data-testid="cphs-draft-minute-metrics"
      >
        <MetricChip
          label={t('cphsDraft.metrics.incidents', 'Incidentes')}
          value={metrics.incidentsCount}
        />
        <MetricChip
          label={t('cphsDraft.metrics.critical', 'Críticos')}
          value={metrics.criticalIncidentsCount}
          tone={metrics.criticalIncidentsCount > 0 ? 'alert' : 'neutral'}
        />
        <MetricChip
          label={t('cphsDraft.metrics.openActions', 'Acciones abiertas')}
          value={metrics.openActionsCount}
        />
        <MetricChip
          label={t('cphsDraft.metrics.closedActions', 'Acciones cerradas')}
          value={metrics.closedActionsCount}
        />
        <MetricChip
          label={t('cphsDraft.metrics.participants', 'Participantes')}
          value={metrics.trainingParticipantsTotal}
        />
      </div>

      {/* Markdown render — preserves the prevencionista-readable shape
          that the service generates. We render in a monospace block
          rather than parse to HTML; the next iteration can swap a
          markdown renderer when the team validates the visual. */}
      <div
        className="rounded-2xl border border-default-token bg-surface p-4"
        data-testid="cphs-draft-minute-markdown"
      >
        <h2 className="text-sm font-bold uppercase tracking-widest text-secondary-token mb-3">
          {t('cphsDraft.markdown.title', 'Borrador (markdown)')}
        </h2>
        <pre className="whitespace-pre-wrap text-xs font-mono text-primary-token leading-relaxed">
          {draft.markdown}
        </pre>
      </div>

      {/* Suggested resolutions — bullet list, easy to scan. */}
      {draft.suggestedResolutions.length > 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-4"
          data-testid="cphs-draft-minute-resolutions"
        >
          <h2 className="text-sm font-bold uppercase tracking-widest text-secondary-token mb-3">
            {t('cphsDraft.resolutions.title', 'Acuerdos sugeridos')}
          </h2>
          <ol className="list-decimal list-inside space-y-1 text-sm text-primary-token">
            {draft.suggestedResolutions.map((r, idx) => (
              <li key={`${idx}-${r.text.slice(0, 32)}`}>
                {r.text}
                {r.responsibleHint && (
                  <span className="text-xs text-secondary-token italic ml-1">
                    ({r.responsibleHint})
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Section index — useful for QA / audit. */}
      {draft.sections.length > 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-4"
          data-testid="cphs-draft-minute-sections"
        >
          <h2 className="text-sm font-bold uppercase tracking-widest text-secondary-token mb-2">
            {t('cphsDraft.sections.title', 'Secciones incluidas')}
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {draft.sections.map((name) => (
              <li
                key={name}
                className="text-[11px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20"
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MetricChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'alert';
}) {
  const toneClass =
    tone === 'alert'
      ? 'border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400'
      : 'border-default-token bg-surface text-primary-token';
  return (
    <div className={`rounded-xl border ${toneClass} p-3`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
        {label}
      </p>
      <p className="text-xl font-black mt-1">{value}</p>
    </div>
  );
}

export default CphsDraftMinute;
