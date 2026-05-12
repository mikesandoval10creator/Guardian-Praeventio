// Praeventio Guard — Wire UI #39: <ReportTemplatePreview />
//
// Preview de un reporte renderizado antes de publicar / distribuir.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Send, Check, AlertCircle } from 'lucide-react';
import {
  renderReport,
  type ReportTemplate,
  type ReportData,
} from '../../services/reportsAutomation/reportsAutomation.js';

interface ReportTemplatePreviewProps {
  template: ReportTemplate;
  data: ReportData;
  reportId: string;
  periodLabel: string;
  publishedAt?: string;
  distributedTo?: string[];
  onPublish?: () => void;
}

const AUDIENCE_BADGE = {
  internal: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  client: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  regulatory: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  public: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
};

export function ReportTemplatePreview({
  template,
  data,
  reportId,
  periodLabel,
  publishedAt = new Date().toISOString(),
  distributedTo = [],
  onPublish,
}: ReportTemplatePreviewProps) {
  const { t } = useTranslation();
  const rendered = useMemo(
    () =>
      renderReport({
        template,
        data,
        reportId,
        periodLabel,
        publishedAt,
        distributedTo,
      }),
    [template, data, reportId, periodLabel, publishedAt, distributedTo],
  );

  if ('error' in rendered) {
    return (
      <section
        className="rounded-2xl border-2 border-rose-500/40 bg-rose-500/5 p-4"
        data-testid="report-preview-error"
      >
        <header className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-rose-600" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase text-rose-700 dark:text-rose-300">
            {t('report.error', 'Reporte no se puede generar')}
          </h2>
        </header>
        <p className="text-xs text-rose-700 dark:text-rose-300">{rendered.error}</p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="report-preview"
      aria-label={t('report.aria', 'Vista previa reporte') as string}
    >
      <header className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {periodLabel}
        </h2>
        <span
          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${AUDIENCE_BADGE[rendered.audience]}`}
        >
          {rendered.audience}
        </span>
      </header>

      <p className="text-[10px] text-secondary-token uppercase">
        {t('report.template', 'Plantilla')}: <strong>{template.id}</strong> ·{' '}
        {t('report.period', 'Periodo')}: <strong>{template.period}</strong>
      </p>

      <ol className="space-y-3">
        {rendered.renderedSections.map((s) => (
          <li
            key={s.key}
            data-testid={`report-section-${s.key}`}
            className="rounded-lg bg-surface-elevated p-3"
          >
            <h3 className="text-xs font-bold text-primary-token uppercase mb-1">
              {s.title}
            </h3>
            <p className="text-xs text-secondary-token whitespace-pre-line leading-snug">
              {s.content || (
                <em className="opacity-60">{t('report.empty', '(sin contenido)')}</em>
              )}
            </p>
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between pt-2 border-t border-default-token">
        <p className="text-[10px] text-secondary-token">
          {t('report.distributedTo', 'Distribución:')} {distributedTo.length}{' '}
          {t('report.recipients', 'destinatarios')}
        </p>
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            data-testid="report-publish"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600"
          >
            <Send className="w-3 h-3" aria-hidden="true" />
            {t('report.publish', 'Publicar + distribuir')}
          </button>
        )}
      </div>
    </section>
  );
}
