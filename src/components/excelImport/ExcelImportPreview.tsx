// Praeventio Guard — Wire UI #36: <ExcelImportPreview />
//
// Preview de import Excel con validación + issues + filas listas para
// commit. El usuario aprueba antes de persistir.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileSpreadsheet, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import {
  processImport,
  SCHEMAS,
  type ImportRow,
  type ImportEntityKind,
} from '../../services/excelImport/excelImporter.js';

interface ExcelImportPreviewProps {
  rows: ImportRow[];
  kind: ImportEntityKind;
  onCommit?: (cleanRows: ImportRow[]) => void;
  onCancel?: () => void;
}

export function ExcelImportPreview({
  rows,
  kind,
  onCommit,
  onCancel,
}: ExcelImportPreviewProps) {
  const { t } = useTranslation();
  const schema = SCHEMAS[kind];
  const report = useMemo(() => processImport(schema, rows), [schema, rows]);

  const canCommit = report.validRows > 0 && (onCommit !== undefined);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="excel-import-preview"
      aria-label={t('xls.aria', 'Preview de importación Excel') as string}
    >
      <header className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('xls.title', 'Importación Excel')} — {kind}
        </h2>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg p-2 bg-emerald-500/10" data-testid="xls-valid-count">
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
            {report.validRows}
          </p>
          <p className="text-[10px] uppercase opacity-70">{t('xls.valid', 'Válidas')}</p>
        </div>
        <div className="rounded-lg p-2 bg-amber-500/15" data-testid="xls-dup-count">
          <p className="text-2xl font-black text-amber-700 dark:text-amber-300 tabular-nums">
            {report.duplicates}
          </p>
          <p className="text-[10px] uppercase opacity-70">{t('xls.dup', 'Duplicadas')}</p>
        </div>
        <div className="rounded-lg p-2 bg-rose-500/15" data-testid="xls-issue-count">
          <p className="text-2xl font-black text-rose-700 dark:text-rose-300 tabular-nums">
            {report.issues.length}
          </p>
          <p className="text-[10px] uppercase opacity-70">{t('xls.issues', 'Issues')}</p>
        </div>
      </div>

      {report.issues.length > 0 && (
        <div data-testid="xls-issues-list">
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('xls.issuesTitle', 'Problemas detectados')}
          </h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {report.issues.slice(0, 20).map((issue, i) => {
              const Icon =
                issue.issue === 'missing_required'
                  ? AlertCircle
                  : issue.issue === 'duplicate'
                    ? AlertTriangle
                    : AlertCircle;
              return (
                <li
                  key={i}
                  className="flex items-start gap-1 text-[11px] text-rose-700 dark:text-rose-300"
                >
                  <Icon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>Fila {issue.rowNumber}</strong>: {issue.message}
                  </span>
                </li>
              );
            })}
            {report.issues.length > 20 && (
              <li className="text-[10px] text-secondary-token italic">
                +{report.issues.length - 20} más...
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-default-token">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            data-testid="xls-cancel"
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-default-token"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
        )}
        {canCommit && (
          <button
            type="button"
            onClick={() => onCommit?.(report.cleanRows)}
            data-testid="xls-commit"
            disabled={report.validRows === 0}
            className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-50"
          >
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            {t('xls.commit', 'Importar')} {report.validRows}{' '}
            {t('xls.rowsLabel', 'filas')}
          </button>
        )}
      </div>
    </section>
  );
}
