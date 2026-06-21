// Praeventio Guard — Contractor performance dashboard (per-contractor TRIR/LTIFR).
//
// Makes src/server/routes/contractors.ts `GET .../performance` real on screen:
// captures the man-hours worked per contractor for a period and renders each
// contractor's OSHA/ICMM rates computed SERVER-SIDE from REAL incidents + the
// captured exposure. The component consumes data from the server hook — it never
// fabricates rows or rates.
//
// HONEST empty-state: when no contractor man-hours are captured for the period,
// per-contractor TRIR/LTIFR cannot exist. We do NOT invent contractors or
// rates — we show the capture form with a clear call to action.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Clock, AlertCircle, BarChart3 } from 'lucide-react';
import {
  useContractorPerformance,
  captureContractorExposure,
} from '../../hooks/useContractorPerformance';

interface ContractorPerformanceDashboardProps {
  projectId: string | null;
}

/** Current month as 'YYYY-MM' for the default period. */
function currentPeriod(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

function fmt(n: number): string {
  return Math.round(n * 100) / 100 + '';
}

export function ContractorPerformanceDashboard({
  projectId,
}: ContractorPerformanceDashboardProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<string>(currentPeriod());
  const { data, loading, error, refetch } = useContractorPerformance(projectId, period);

  const [contractorId, setContractorId] = useState('');
  const [contractorName, setContractorName] = useState('');
  const [hoursInput, setHoursInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = data?.contractors ?? [];

  const handleCapture = async () => {
    if (!projectId) return;
    const cid = contractorId.trim();
    const cname = contractorName.trim();
    const hours = Number(hoursInput);
    if (!cid || !cname) {
      setSaveError(
        t(
          'contractorPerf.errMissingContractor',
          'Ingresa el ID y el nombre del contratista.',
        ) as string,
      );
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setSaveError(
        t(
          'contractorPerf.errMissingHours',
          'Ingresa las horas-hombre del contratista (mayor a 0).',
        ) as string,
      );
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      await captureContractorExposure(projectId, {
        contractorId: cid,
        contractorName: cname,
        period,
        totalHoursWorked: Math.round(hours),
      });
      setHoursInput('');
      refetch();
    } catch (err) {
      setSaveError(
        err instanceof Error && err.message
          ? `${t('contractorPerf.errSavePrefix', 'No se pudo guardar')}: ${err.message}`
          : (t(
              'contractorPerf.errSave',
              'No se pudieron guardar las horas-hombre. Intenta nuevamente.',
            ) as string),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) {
    return (
      <div
        data-testid="contractor-perf-no-project"
        className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600"
      >
        {t(
          'contractorPerf.noProject',
          'Selecciona un proyecto para ver el desempeño de contratistas (TRIR/LTIFR).',
        )}
      </div>
    );
  }

  return (
    <section
      data-testid="contractor-perf-dashboard"
      className="space-y-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900/50"
    >
      <header className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-teal-500" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
            {t('contractorPerf.title', 'Desempeño de contratistas — TRIR / LTIFR')}
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {t(
              'contractorPerf.subtitle',
              'Tasas OSHA/ICMM por contratista, desde incidentes registrados y horas-hombre del período',
            )}
          </p>
        </div>
      </header>

      {/* ── Period selector ──────────────────────────────────────────── */}
      <label className="block text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">
          {t('contractorPerf.period', 'Período (mes)')}
        </span>
        <input
          data-testid="contractor-perf-period-input"
          type="month"
          className="mt-1 block rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
      </label>

      {/* ── Capture form ─────────────────────────────────────────────── */}
      <div
        data-testid="contractor-perf-capture-form"
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
      >
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-teal-500" aria-hidden="true" />
          {t('contractorPerf.captureTitle', 'Horas-hombre por contratista')}
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              {t('contractorPerf.contractorId', 'ID contratista (RUT o código)')}
            </span>
            <input
              data-testid="contractor-perf-id-input"
              type="text"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
              placeholder="76.123.456-7"
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              {t('contractorPerf.contractorName', 'Nombre contratista')}
            </span>
            <input
              data-testid="contractor-perf-name-input"
              type="text"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
              value={contractorName}
              onChange={(e) => setContractorName(e.target.value)}
              placeholder="Constructora Andes SpA"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-zinc-600 dark:text-zinc-400">
              {t(
                'contractorPerf.hours',
                'Total horas trabajadas del contratista (suma de sus trabajadores)',
              )}
            </span>
            <input
              data-testid="contractor-perf-hours-input"
              type="number"
              min="0"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600 sm:w-64"
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              placeholder="120000"
            />
          </label>
        </div>
        <button
          data-testid="contractor-perf-submit"
          type="button"
          disabled={saving}
          onClick={() => void handleCapture()}
          className="mt-3 rounded-lg bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving
            ? t('contractorPerf.saving', 'Guardando…')
            : t('contractorPerf.save', 'Guardar horas-hombre')}
        </button>
        {saveError && (
          <div
            data-testid="contractor-perf-save-error"
            className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {saveError}
          </div>
        )}
      </div>

      {/* ── Report ───────────────────────────────────────────────────── */}
      {loading && (
        <div data-testid="contractor-perf-loading" className="p-6 text-center text-zinc-500">
          {t('contractorPerf.loading', 'Cargando desempeño del período…')}
        </div>
      )}

      {error && !loading && (
        <div
          data-testid="contractor-perf-load-error"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          {t('contractorPerf.loadError', 'No se pudo cargar el desempeño')} ({error.message}).
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div
          data-testid="contractor-perf-empty"
          className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600"
        >
          <Building2 className="mx-auto mb-2 h-6 w-6 opacity-40" aria-hidden="true" />
          {t(
            'contractorPerf.empty',
            'Sin horas-hombre de contratistas capturadas para este período: TRIR/LTIFR por contratista no se pueden calcular todavía.',
          )}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto" data-testid="contractor-perf-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="px-3 py-2">{t('contractorPerf.colContractor', 'Contratista')}</th>
                <th className="px-3 py-2 text-right">{t('contractorPerf.colHours', 'Horas')}</th>
                <th className="px-3 py-2 text-right">
                  {t('contractorPerf.colRecordable', 'Recordables')}
                </th>
                <th className="px-3 py-2 text-right">TRIR</th>
                <th className="px-3 py-2 text-right">LTIFR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {rows.map((c) => (
                <tr key={c.contractorId} data-testid={`contractor-perf-row-${c.contractorId}`}>
                  <td className="px-3 py-2 font-semibold text-zinc-800 dark:text-zinc-100">
                    {c.contractorName}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.totalHoursWorked.toLocaleString('es-CL')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.counts.totalRecordable}</td>
                  <td
                    className="px-3 py-2 text-right font-bold tabular-nums"
                    data-testid={`contractor-perf-trir-${c.contractorId}`}
                  >
                    {fmt(c.report.trir)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {fmt(c.report.ltifr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default ContractorPerformanceDashboard;
