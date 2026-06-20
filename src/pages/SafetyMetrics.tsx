// Praeventio Guard — Bucket D: Safety Metrics page (TRIR/LTIFR REAL).
//
// Makes the formerly-orphan <SafetyMetricsDashboard/> real. It reads the
// project's REGISTERED incidents for the selected period (classified into
// IncidentCounts server-side — no fabricated data) plus the captured
// man-hours worked, and renders the OSHA/ICMM dashboard.
//
// HONEST empty-state: when no man-hours are captured for the period,
// TRIR/LTIFR are undefined (a rate needs exposure hours). We do NOT invent
// hours or show fake rates — we show the capture form with a clear call to
// action ("Captura las horas-hombre del período para calcular TRIR/LTIFR").

import { useMemo, useState } from 'react';
import { Activity, Clock, AlertCircle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { SafetyMetricsDashboard } from '../components/safetyMetrics/SafetyMetricsDashboard';
import {
  useSafetyMetricsReport,
  captureSafetyExposure,
} from '../hooks/useSafetyMetrics';

/** Current month as 'YYYY-MM' for the default period. */
function currentPeriod(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

export function SafetyMetrics() {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  const [period, setPeriod] = useState<string>(currentPeriod());
  const { data, loading, error, refetch } = useSafetyMetricsReport(projectId, period);

  const [hoursInput, setHoursInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasExposure = useMemo(
    () => (data?.exposure.totalHoursWorked ?? 0) > 0,
    [data],
  );

  const handleCapture = async () => {
    if (!projectId) return;
    const hours = Number(hoursInput);
    if (!Number.isFinite(hours) || hours <= 0) {
      setSaveError('Ingresa las horas-hombre del período (mayor a 0).');
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      await captureSafetyExposure(projectId, {
        period,
        totalHoursWorked: Math.round(hours),
      });
      setHoursInput('');
      refetch();
    } catch (err) {
      setSaveError(
        err instanceof Error && err.message
          ? `No se pudo guardar: ${err.message}`
          : 'No se pudo guardar las horas-hombre. Intenta nuevamente.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!selectedProject) {
    return (
      <div data-testid="safety-metrics-page-empty" className="p-6 text-center text-zinc-500">
        <Activity className="mx-auto mb-3 h-10 w-10 opacity-40" />
        <p>Selecciona un proyecto para ver las métricas SST (TRIR/LTIFR).</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" data-testid="safety-metrics-page">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Activity className="h-6 w-6 text-teal-500" />
          Métricas SST — TRIR / LTIFR
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Tasas estándar internacional (OSHA / ICMM) calculadas desde los incidentes
          registrados de {selectedProject.name} y las horas-hombre trabajadas del período.
        </p>
      </header>

      {/* ── Period selector ──────────────────────────────────────────── */}
      <section className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Período (mes)</span>
          <input
            data-testid="safety-metrics-period-input"
            type="month"
            className="mt-1 block rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
      </section>

      {/* ── Man-hours capture form ───────────────────────────────────── */}
      <section
        data-testid="safety-metrics-exposure-form"
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
      >
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-teal-500" />
          Horas-hombre del período
        </h2>
        {!hasExposure && (
          <p
            data-testid="safety-metrics-exposure-cta"
            className="mt-1 text-sm text-amber-700 dark:text-amber-400"
          >
            Captura las horas-hombre del período para calcular TRIR/LTIFR.
          </p>
        )}
        {hasExposure && (
          <p className="mt-1 text-sm text-zinc-500">
            Horas registradas:{' '}
            <span className="font-semibold tabular-nums">
              {(data?.exposure.totalHoursWorked ?? 0).toLocaleString('es-CL')}
            </span>{' '}
            — puedes actualizarlas.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Total horas trabajadas (suma de todos los trabajadores)
            </span>
            <input
              data-testid="safety-metrics-hours-input"
              type="number"
              min="0"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600 sm:w-64"
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              placeholder="Ej: 200000"
            />
          </label>
          <button
            data-testid="safety-metrics-hours-submit"
            type="button"
            disabled={saving}
            onClick={() => void handleCapture()}
            className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar horas-hombre'}
          </button>
        </div>
        {saveError && (
          <div
            data-testid="safety-metrics-save-error"
            className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0" /> {saveError}
          </div>
        )}
      </section>

      {/* ── Report / dashboard ───────────────────────────────────────── */}
      {loading && (
        <div data-testid="safety-metrics-loading" className="p-6 text-center text-zinc-500">
          Cargando métricas del período…
        </div>
      )}

      {error && !loading && (
        <div
          data-testid="safety-metrics-load-error"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          No se pudieron cargar las métricas ({error.message}).
        </div>
      )}

      {data && !loading && hasExposure && (
        <SafetyMetricsDashboard
          counts={data.counts}
          exposure={data.exposure}
          periodLabel={period}
        />
      )}

      {data && !loading && !hasExposure && (
        <div
          data-testid="safety-metrics-no-exposure"
          className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600"
        >
          Sin horas-hombre capturadas para {period}: TRIR/LTIFR no se pueden calcular todavía.
          Registramos {data.counts.totalRecordable} incidente(s) recordable(s) en el período.
        </div>
      )}
    </div>
  );
}

export default SafetyMetrics;
