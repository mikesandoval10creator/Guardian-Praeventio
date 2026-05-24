// Praeventio Guard — Sprint K §106-108 — Wizard de importación Excel.
//
// 3 pasos:
//   1) Upload  — selector de kind + drop zone + lectura local del archivo
//   2) Review  — tabla de errores + filas válidas listas para confirmar
//   3) Commit  — POST /api/import/commit y resumen
//
// Toda la red usa el bearer Firebase Auth token (mismo pattern que
// SafetyCoach.tsx). El archivo viaja como base64 dentro del JSON body
// para mantener `Idempotency-Key` y el body-parser ya configurado.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../contexts/ProjectContext';
import { auth } from '../services/firebase';

type ImportKind = 'workers' | 'epp' | 'trainings' | 'incidents' | 'projects' | 'risks';

interface ImportError {
  rowNumber: number;
  column: string;
  code: string;
  message: string;
}

interface ImportSummary {
  kind: ImportKind;
  totalRows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  duplicatesInBatch: number;
  duplicatesInExisting: number;
  sheetName: string | null;
  detectedSheets: string[];
  errors: ImportError[];
  sample: Array<Record<string, unknown>>;
  validRecords: Array<Record<string, unknown>>;
}

interface CommitResult {
  success: boolean;
  writtenCount: number;
  failedRowNumbers: number[];
}

type Step = 'upload' | 'review' | 'done';

const KIND_OPTIONS: ImportKind[] = [
  'workers',
  'epp',
  'trainings',
  'incidents',
  'projects',
  'risks',
];

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('reader_failed'));
        return;
      }
      const idx = result.indexOf(',');
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('reader_failed'));
    reader.readAsDataURL(file);
  });
}

export function ImportData() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const [step, setStep] = useState<Step>('upload');
  const [kind, setKind] = useState<ImportKind>('workers');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('upload');
    setFile(null);
    setSummary(null);
    setCommitResult(null);
    setError(null);
  };

  const onPickFile = (f: File | null) => {
    setError(null);
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0] ?? null;
    onPickFile(f);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const submitValidate = async () => {
    if (!file) {
      setError(t('import.errors.no_file', 'Selecciona un archivo Excel.'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t('import.errors.too_large', 'El archivo supera el límite de 5MB.'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const { apiAuthHeader } = await import('../lib/apiAuth');
      const authHeader = await apiAuthHeader();
      const res = await fetch('/api/import/excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({
          kind,
          base64,
          options: {
            projectId: selectedProject?.id,
            checkExisting: Boolean(selectedProject?.id),
          },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ImportSummary;
      setSummary(data);
      setStep('review');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submitCommit = async () => {
    if (!summary || summary.valid === 0) {
      setError(t('import.errors.nothing_to_commit', 'No hay filas válidas para importar.'));
      return;
    }
    if (!selectedProject?.id) {
      setError(t('import.errors.no_project', 'Selecciona un proyecto antes de confirmar.'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const { apiAuthHeader } = await import('../lib/apiAuth');
      const authHeader = await apiAuthHeader();
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({
          kind: summary.kind,
          projectId: selectedProject.id,
          records: summary.validRecords,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CommitResult;
      setCommitResult(data);
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const stepHeader = useMemo(
    () => (
      <div className="mb-6 flex items-center justify-center gap-2">
        {(['upload', 'review', 'done'] as Step[]).map((s, idx) => {
          const isActive = step === s;
          const isDone =
            (step === 'review' && s === 'upload') ||
            (step === 'done' && s !== 'done');
          return (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  isActive
                    ? 'bg-teal-500 text-white'
                    : isDone
                      ? 'bg-teal-200 text-teal-900'
                      : 'bg-slate-200 text-slate-600'
                }`}
                aria-current={isActive ? 'step' : undefined}
              >
                {idx + 1}
              </div>
              <span className={`text-sm ${isActive ? 'font-semibold' : 'text-slate-600'}`}>
                {t(`import.steps.${s}`, s)}
              </span>
              {idx < 2 && <span className="text-slate-300">—</span>}
            </div>
          );
        })}
      </div>
    ),
    [step, t],
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t('import.title', 'Importar datos desde Excel')}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t(
            'import.subtitle',
            'Sube tu planilla, revisa errores y confirma la importación.',
          )}
        </p>
      </header>

      {stepHeader}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {step === 'upload' && (
        <section aria-label={t('import.steps.upload', 'Subir')}>
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t('import.kind_label', 'Tipo de dato')}
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ImportKind)}
              className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {t(`import.kinds.${k}`, k)}
                </option>
              ))}
            </select>
          </div>

          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
            className="cursor-pointer rounded-md border-2 border-dashed border-teal-300 bg-teal-50 p-10 text-center hover:bg-teal-100"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-sm text-slate-700">
              {file
                ? t('import.dropzone.selected', '{{name}} ({{size}} KB)', {
                    name: file.name,
                    size: Math.round(file.size / 1024),
                  })
                : t(
                    'import.dropzone.placeholder',
                    'Arrastra tu archivo Excel aquí o haz click para seleccionar',
                  )}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('import.dropzone.hint', 'Máximo 5MB · .xlsx, .xls, .csv')}
            </p>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={submitValidate}
              disabled={loading || !file}
              className="rounded-md bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? t('import.actions.validating', 'Validando…')
                : t('import.actions.validate', 'Validar archivo')}
            </button>
          </div>
        </section>
      )}

      {step === 'review' && summary && (
        <section aria-label={t('import.steps.review', 'Revisar')}>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label={t('import.stats.total', 'Filas')} value={summary.totalRows} />
            <Stat
              label={t('import.stats.valid', 'Válidas')}
              value={summary.valid}
              tone="success"
            />
            <Stat
              label={t('import.stats.invalid', 'Con errores')}
              value={summary.invalid}
              tone="warning"
            />
            <Stat
              label={t('import.stats.duplicates', 'Duplicadas')}
              value={summary.duplicates}
              tone="warning"
            />
          </div>

          {summary.sheetName && (
            <p className="mb-3 text-xs text-slate-500">
              {t('import.review.sheet', 'Hoja procesada: {{sheet}}', {
                sheet: summary.sheetName,
              })}
            </p>
          )}

          {summary.errors.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                {t('import.review.errors_heading', 'Errores detectados')}
              </h3>
              <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">
                        {t('import.review.col_row', 'Fila')}
                      </th>
                      <th className="px-3 py-2">
                        {t('import.review.col_column', 'Columna')}
                      </th>
                      <th className="px-3 py-2">
                        {t('import.review.col_message', 'Mensaje')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.errors.slice(0, 200).map((err, i) => (
                      <tr key={`${err.rowNumber}-${err.column}-${i}`} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{err.rowNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs">{err.column}</td>
                        <td className="px-3 py-2">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {summary.sample.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                {t('import.review.sample_heading', 'Muestra de filas válidas')}
              </h3>
              <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                {JSON.stringify(summary.sample, null, 2)}
              </pre>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {t('import.actions.back', 'Volver')}
            </button>
            <button
              type="button"
              onClick={submitCommit}
              disabled={loading || summary.valid === 0}
              className="rounded-md bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? t('import.actions.committing', 'Importando…')
                : t('import.actions.commit', 'Confirmar import ({{n}})', {
                    n: summary.valid,
                  })}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && commitResult && (
        <section aria-label={t('import.steps.done', 'Hecho')} className="text-center">
          <div
            className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
              commitResult.success ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            <span className="text-3xl font-bold">
              {commitResult.success ? '✓' : '!'}
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            {commitResult.success
              ? t('import.done.success_title', 'Importación completada')
              : t('import.done.partial_title', 'Importación parcial')}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {t('import.done.summary', '{{n}} registros importados.', {
              n: commitResult.writtenCount,
            })}
          </p>
          {commitResult.failedRowNumbers.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {t('import.done.failures', '{{n}} fallaron — revisa logs.', {
                n: commitResult.failedRowNumbers.length,
              })}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-md bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
          >
            {t('import.actions.new_import', 'Importar otro archivo')}
          </button>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-teal-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-slate-800';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default ImportData;
