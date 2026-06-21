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
import { Activity, Clock, AlertCircle, Users, Target, TrendingDown } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { SafetyMetricsDashboard } from '../components/safetyMetrics/SafetyMetricsDashboard';
import { SafetyTrendChartLazy } from '../components/safetyMetrics/SafetyTrendChartLazy';
import { OperationalPressureGauge } from '../components/orgMetrics/OperationalPressureGauge';
import { SpiDashboard } from '../components/safetyPerformance/SpiDashboard';
import {
  useSafetyMetricsReport,
  captureSafetyExposure,
  useOperationalPressure,
  captureWorkforcePeriod,
  useSafetyMetricsTrend,
} from '../hooks/useSafetyMetrics';
import {
  BENCHMARK_TRIR,
  BENCHMARK_LTIFR,
} from '../services/safetyMetrics/osha';
import { useSpiReport, captureSafetyPlan } from '../hooks/useSpiReport';

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

  // Operational pressure (workforce strain) — separate capture + engine read.
  const {
    data: pressureData,
    loading: pressureLoading,
    error: pressureError,
    refetch: refetchPressure,
  } = useOperationalPressure(projectId, period);
  const [absDaysInput, setAbsDaysInput] = useState('');
  const [overtimeInput, setOvertimeInput] = useState('');
  const [headcountInput, setHeadcountInput] = useState('');
  const [wfSaving, setWfSaving] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);

  const hasExposure = useMemo(
    () => (data?.exposure.totalHoursWorked ?? 0) > 0,
    [data],
  );

  // ── Multi-period trend (12-month rolling TRIR/LTIFR/DART/SIFR) ──────────
  const {
    data: trend,
    loading: trendLoading,
    error: trendError,
  } = useSafetyMetricsTrend(projectId, period, 12);

  // Only plot months with REAL captured man-hours — a 0-rate from an
  // uncaptured month is "no data", not a genuine zero-incident rate.
  const trendPoints = useMemo(
    () => (trend?.points ?? []).filter((p) => p.hasExposure),
    [trend],
  );

  const hasWorkforce = pressureData?.captured === true && pressureData.signals !== null;

  const handleCaptureWorkforce = async () => {
    if (!projectId) return;
    const absenteeismDays = Number(absDaysInput);
    const overtimeHours = Number(overtimeInput);
    const headcount = Number(headcountInput);
    if (
      !Number.isFinite(absenteeismDays) ||
      absenteeismDays < 0 ||
      !Number.isFinite(overtimeHours) ||
      overtimeHours < 0 ||
      !Number.isFinite(headcount) ||
      headcount <= 0
    ) {
      setWfError('Ingresa días de ausencia, horas extra (≥0) y dotación (mayor a 0).');
      return;
    }
    setWfError(null);
    setWfSaving(true);
    try {
      await captureWorkforcePeriod(projectId, {
        period,
        absenteeismDays: Math.round(absenteeismDays),
        overtimeHours: Math.round(overtimeHours),
        headcount: Math.round(headcount),
      });
      setAbsDaysInput('');
      setOvertimeInput('');
      setHeadcountInput('');
      refetchPressure();
    } catch (err) {
      setWfError(
        err instanceof Error && err.message
          ? `No se pudo guardar: ${err.message}`
          : 'No se pudo guardar los datos de dotación. Intenta nuevamente.',
      );
    } finally {
      setWfSaving(false);
    }
  };

  // ── SPI (plan-vs-executed) ────────────────────────────────────────────
  const { data: spi, loading: spiLoading, error: spiError, refetch: spiRefetch } =
    useSpiReport(projectId, period);

  const [planInspections, setPlanInspections] = useState('');
  const [planTalks, setPlanTalks] = useState('');
  const [planTrainings, setPlanTrainings] = useState('');
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const handleCapturePlan = async () => {
    if (!projectId) return;
    const inspections = Number(planInspections);
    const talks = Number(planTalks);
    const trainings = Number(planTrainings);
    if (
      ![inspections, talks, trainings].every(
        (n) => Number.isFinite(n) && n >= 0,
      )
    ) {
      setPlanError('Ingresa conteos planificados válidos (0 o más).');
      return;
    }
    setPlanError(null);
    setPlanSaving(true);
    try {
      await captureSafetyPlan(projectId, {
        period,
        plannedInspections: Math.round(inspections),
        plannedDailyTalks: Math.round(talks),
        plannedTrainings: Math.round(trainings),
      });
      setPlanInspections('');
      setPlanTalks('');
      setPlanTrainings('');
      spiRefetch();
    } catch (err) {
      setPlanError(
        err instanceof Error && err.message
          ? `No se pudo guardar: ${err.message}`
          : 'No se pudo guardar el plan del período. Intenta nuevamente.',
      );
    } finally {
      setPlanSaving(false);
    }
  };

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

      {/* ── Trend over time (rolling 12-month TRIR/LTIFR/DART/SIFR) ───── */}
      <section
        data-testid="safety-trend-section"
        className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-700"
      >
        <header>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <TrendingDown className="h-5 w-5 text-teal-500" />
            Tendencia de los últimos 12 meses
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Evolución de TRIR / LTIFR construida desde los incidentes registrados y las
            horas-hombre capturadas de cada mes. Solo se grafican los meses con horas-hombre
            capturadas (un mes sin captura no es una tasa cero, es ausencia de dato).
          </p>
        </header>

        {trendLoading && (
          <div data-testid="safety-trend-loading" className="p-4 text-center text-sm text-zinc-500">
            Cargando tendencia del período…
          </div>
        )}

        {trendError && !trendLoading && (
          <div
            data-testid="safety-trend-load-error"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            No se pudo cargar la tendencia ({trendError.message}).
          </div>
        )}

        {!trendLoading && !trendError && trendPoints.length >= 2 && (
          <SafetyTrendChartLazy
            data={trendPoints}
            metricsShown={{ trir: true, ltifr: true }}
            industryBenchmark={{
              trir: BENCHMARK_TRIR.construction_cl,
              ltifr: BENCHMARK_LTIFR.construction_cl,
            }}
          />
        )}

        {!trendLoading && !trendError && trendPoints.length < 2 && (
          <div
            data-testid="safety-trend-empty"
            className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600"
          >
            Aún no hay suficientes meses con horas-hombre capturadas para dibujar una tendencia.
            Captura las horas-hombre de al menos dos meses para ver la evolución de TRIR/LTIFR.
          </div>
        )}
      </section>

      {/* ── Operational pressure (workforce strain) ──────────────────── */}
      <section
        data-testid="operational-pressure-section"
        className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-700"
      >
        <header>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5 text-teal-500" />
            Presión operacional del período
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Índice de presión sobre la dotación (ausentismo + horas extra) calculado
            desde los datos capturados del período. No reemplaza la decisión humana:
            es una señal de gestión para anticipar fatiga y sobrecarga.
          </p>
        </header>

        {/* Workforce capture form */}
        <div
          data-testid="workforce-capture-form"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
        >
          {!hasWorkforce && (
            <p
              data-testid="workforce-capture-cta"
              className="mb-2 text-sm text-amber-700 dark:text-amber-400"
            >
              Captura los datos de dotación del período para calcular la presión operacional.
            </p>
          )}
          {hasWorkforce && pressureData?.workforce && (
            <p className="mb-2 text-sm text-zinc-500">
              Registrado: {pressureData.workforce.absenteeismDays} día(s) de ausencia,{' '}
              {pressureData.workforce.overtimeHours.toLocaleString('es-CL')} h extra,{' '}
              {pressureData.workforce.headcount} trabajador(es) — puedes actualizarlos.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Días de ausencia (período)</span>
              <input
                data-testid="workforce-absenteeism-input"
                type="number"
                min="0"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600 sm:w-40"
                value={absDaysInput}
                onChange={(e) => setAbsDaysInput(e.target.value)}
                placeholder="Ej: 24"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Horas extra (período)</span>
              <input
                data-testid="workforce-overtime-input"
                type="number"
                min="0"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600 sm:w-40"
                value={overtimeInput}
                onChange={(e) => setOvertimeInput(e.target.value)}
                placeholder="Ej: 320"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Dotación (trabajadores)</span>
              <input
                data-testid="workforce-headcount-input"
                type="number"
                min="1"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600 sm:w-40"
                value={headcountInput}
                onChange={(e) => setHeadcountInput(e.target.value)}
                placeholder="Ej: 50"
              />
            </label>
            <button
              data-testid="workforce-submit"
              type="button"
              disabled={wfSaving}
              onClick={() => void handleCaptureWorkforce()}
              className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {wfSaving ? 'Guardando…' : 'Guardar dotación'}
            </button>
          </div>
          {wfError && (
            <div
              data-testid="workforce-save-error"
              className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0" /> {wfError}
            </div>
          )}
        </div>

        {pressureLoading && (
          <div data-testid="operational-pressure-loading" className="p-4 text-center text-sm text-zinc-500">
            Cargando presión operacional…
          </div>
        )}

        {pressureError && !pressureLoading && (
          <div
            data-testid="operational-pressure-load-error"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            No se pudo cargar la presión operacional ({pressureError.message}).
          </div>
        )}

        {hasWorkforce && !pressureLoading && pressureData?.signals && (
          <OperationalPressureGauge signals={pressureData.signals} />
        )}

        {!hasWorkforce && !pressureLoading && !pressureError && (
          <div
            data-testid="operational-pressure-empty"
            className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600"
          >
            Sin datos de dotación capturados para {period}: la presión operacional no se
            puede calcular todavía.
          </div>
        )}
      </section>

      {/* ── SPI: plan-vs-executed (Safety Performance Index) ─────────────── */}
      <section className="space-y-4" data-testid="spi-section">
        <header>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Target className="h-5 w-5 text-teal-500" />
            Índice de Desempeño en Seguridad (SPI)
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Combina indicadores leading (planificado vs. ejecutado, real) y lagging
            (TRIR/LTIFR) en un solo score de gerencia para {period}.
          </p>
        </header>

        {/* Planned-counts capture form (the leading-indicator denominators). */}
        <div
          data-testid="spi-plan-form"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
        >
          <h3 className="text-sm font-medium">Plan del período (conteos planificados)</h3>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Captura cuántas inspecciones, charlas diarias y capacitaciones se planificaron
            para el mes — son el denominador del cumplimiento (ejecutado ÷ planificado).
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Inspecciones planificadas</span>
              <input
                data-testid="spi-plan-inspections"
                type="number"
                min="0"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
                value={planInspections}
                onChange={(e) => setPlanInspections(e.target.value)}
                placeholder="Ej: 8"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Charlas diarias planificadas</span>
              <input
                data-testid="spi-plan-talks"
                type="number"
                min="0"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
                value={planTalks}
                onChange={(e) => setPlanTalks(e.target.value)}
                placeholder="Ej: 22"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Capacitaciones planificadas</span>
              <input
                data-testid="spi-plan-trainings"
                type="number"
                min="0"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
                value={planTrainings}
                onChange={(e) => setPlanTrainings(e.target.value)}
                placeholder="Ej: 4"
              />
            </label>
          </div>
          <button
            data-testid="spi-plan-submit"
            type="button"
            disabled={planSaving}
            onClick={() => void handleCapturePlan()}
            className="mt-3 rounded-lg bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {planSaving ? 'Guardando…' : 'Guardar plan del período'}
          </button>
          {planError && (
            <div
              data-testid="spi-plan-error"
              className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0" /> {planError}
            </div>
          )}
        </div>

        {spiLoading && (
          <div data-testid="spi-loading" className="p-4 text-center text-sm text-zinc-500">
            Cargando SPI del período…
          </div>
        )}

        {spiError && !spiLoading && (
          <div
            data-testid="spi-load-error"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            No se pudo cargar el SPI ({spiError.message}).
          </div>
        )}

        {spi && !spiLoading && (
          <SpiDashboard
            leading={spi.leading}
            lagging={spi.lagging}
            planVsExecuted={{
              inspections: spi.ratios.inspections,
              dailyTalks: spi.ratios.dailyTalks,
              trainings: spi.ratios.trainings,
              honesty: {
                plannedInspectionsRate: spi.honesty.plannedInspectionsRate,
                dailyTalksDeliveryRate: spi.honesty.dailyTalksDeliveryRate,
                trainingCurrencyRate: spi.honesty.trainingCurrencyRate,
                laggingEmpty: spi.honesty.laggingEmpty,
              },
            }}
          />
        )}
      </section>
    </div>
  );
}

export default SafetyMetrics;
