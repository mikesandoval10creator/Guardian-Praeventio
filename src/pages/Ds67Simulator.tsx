// Praeventio Guard — Épica B1 (capa 2): Simulador de cotización adicional
// DS 67 desde la siniestralidad real del proyecto.
//
// "Con esta tendencia tu cotización adicional sube X% = $Y/año" — el
// argumento de venta nº1: incidentes → siniestralidad → plata. También el
// argumento de retención inverso: cero siniestralidad = REBAJA (la
// cotización puede bajar hasta 0%).
//
// La vista solo presenta: el cálculo legal vive en el engine puro
// `src/services/compliance/ds67Simulator.ts` (DS 67/1999, BCN
// idNorma=159800) y se ejecuta server-side vía
// `POST /api/compliance/:projectId/ds67/simulator/simulate`.
//
// Procedencia de datos (directiva Phase 5 — nunca fabricar datos legales):
//   - Días perdidos: pre-llenados desde los incidentes REGISTRADOS del
//     proyecto (suma de `lostDays` por período anual), SIEMPRE etiquetados
//     ("Desde incidentes registrados (N)") y editables; al editar pasan a
//     "Ingreso manual".
//   - Dotación promedio, planilla anual e invalideces/muertes: SIEMPRE
//     ingreso manual — el esquema de incidentes no trae dotación ni grados
//     de invalidez (esos los resuelve el organismo administrador).

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  Database,
  PencilLine,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import {
  useDs67Prefill,
  requestDs67Simulation,
  type Ds67SimulateResponse,
  type Ds67SimulatePayload,
} from '../hooks/useDs67Simulator';
import {
  formatClp,
  type Ds67InvalidityBand,
} from '../services/compliance/ds67Simulator';
import { humanErrorMessage } from '../lib/humanError';


// ── es-CL labels for the legal invalidity bands (DS 67 art. 2 j)) ────────

const INVALIDITY_BAND_LABELS: Array<{ band: Ds67InvalidityBand; label: string }> = [
  { band: 'invalidez_15_25', label: 'Invalidez 15% a 25%' },
  { band: 'invalidez_27_5_37_5', label: 'Invalidez 27,5% a 37,5%' },
  { band: 'invalidez_40_65', label: 'Invalidez 40% a 65%' },
  { band: 'invalidez_70_plus', label: 'Invalidez 70% o más' },
  { band: 'gran_invalidez', label: 'Gran invalidez' },
  { band: 'muerte', label: 'Muertes' },
];

interface PeriodFormState {
  label: string;
  registeredLostDays: number;
  registeredIncidentCount: number;
  averageWorkers: string;
  lostDays: string;
  /** true once the user touches the field — provenance flips to manual. */
  lostDaysEdited: boolean;
  invalidity: Record<Ds67InvalidityBand, string>;
}

function emptyInvalidity(): Record<Ds67InvalidityBand, string> {
  return {
    invalidez_15_25: '',
    invalidez_27_5_37_5: '',
    invalidez_40_65: '',
    invalidez_70_plus: '',
    gran_invalidez: '',
    muerte: '',
  };
}

function fmtPct(value: number): string {
  return `${String(value).replace('.', ',')}%`;
}

function fmtDeltaPp(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${String(value).replace('.', ',')} pp`;
}

export function Ds67Simulator() {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;
  const prefill = useDs67Prefill(projectId);

  const [periods, setPeriods] = useState<PeriodFormState[]>([]);
  const [payroll, setPayroll] = useState('');
  const [currentPct, setCurrentPct] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [response, setResponse] = useState<Ds67SimulateResponse | null>(null);

  useEffect(() => {
    if (!prefill.data) return;
    setPeriods(
      prefill.data.periods.map((p) => ({
        label: p.label,
        registeredLostDays: p.registeredLostDays,
        registeredIncidentCount: p.registeredIncidentCount,
        averageWorkers: '',
        lostDays: String(p.registeredLostDays),
        lostDaysEdited: false,
        invalidity: emptyInvalidity(),
      })),
    );
    setResponse(null);
  }, [prefill.data]);

  const updatePeriod = (index: number, patch: Partial<PeriodFormState>) => {
    setPeriods((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const canSubmit = useMemo(
    () => periods.length >= 2 && periods.every((p) => Number(p.averageWorkers) > 0),
    [periods],
  );

  const handleSubmit = async () => {
    if (!projectId) return;
    setFormError(null);
    if (!canSubmit) {
      setFormError('Ingresa la dotación promedio (mayor a 0) de cada período anual.');
      return;
    }
    const payload: Ds67SimulatePayload = {
      periods: periods.map((p) => {
        const invalidityEvents: Partial<Record<Ds67InvalidityBand, number>> = {};
        for (const { band } of INVALIDITY_BAND_LABELS) {
          const n = Number(p.invalidity[band]);
          if (Number.isInteger(n) && n > 0) invalidityEvents[band] = n;
        }
        return {
          label: p.label,
          averageWorkers: Number(p.averageWorkers),
          // Untouched → omit so the SERVER fills it from registered
          // incidents and stamps the provenance authoritatively.
          ...(p.lostDaysEdited ? { lostDays: Math.max(0, Math.round(Number(p.lostDays) || 0)) } : {}),
          ...(Object.keys(invalidityEvents).length > 0 ? { invalidityEvents } : {}),
        };
      }),
      ...(payroll.trim() !== '' ? { annualPayrollClp: Number(payroll) } : {}),
      ...(currentPct.trim() !== ''
        ? { currentAdditionalCotizacionPct: Number(currentPct) }
        : {}),
    };
    setSubmitting(true);
    try {
      const r = await requestDs67Simulation(projectId, payload);
      setResponse(r);
    } catch (err) {
      setFormError(
        humanErrorMessage(err instanceof Error && err.message
          ? `No se pudo simular: ${err.message}`
          : 'No se pudo simular. Intenta nuevamente.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedProject) {
    return (
      <div data-testid="ds67-sim-empty" className="p-6 text-center text-muted-token">
        <Scale className="mx-auto mb-3 h-10 w-10 opacity-40" />
        <p>Selecciona un proyecto para simular la cotización adicional DS 67.</p>
      </div>
    );
  }

  if (prefill.loading) {
    return (
      <div data-testid="ds67-sim-loading" className="p-6 text-center text-muted-token">
        <p>Cargando siniestralidad registrada del proyecto…</p>
      </div>
    );
  }

  const result = response?.result ?? null;
  const isRebaja = result !== null && result.deltaPct !== null && result.deltaPct < 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Calculator className="h-6 w-6 text-teal-500" />
          Simulador de cotización adicional — DS 67
        </h1>
        <p className="mt-1 text-sm text-muted-token">
          Proyecta la cotización adicional diferenciada (Ley 16.744, arts. 15 y 16) a partir
          de la siniestralidad real de {selectedProject.name}: días perdidos por período
          anual (1 de julio al 30 de junio), invalideces y muertes.
        </p>
      </header>

      {prefill.error ? (
        <div
          data-testid="ds67-sim-prefill-error"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          No se pudo leer la siniestralidad registrada ({prefill.error.message}). Puedes
          continuar con ingreso manual.
        </div>
      ) : null}

      {/* ── Períodos anuales ─────────────────────────────────────────── */}
      <section className="space-y-4">
        {(periods.length > 0
          ? periods
          : // Prefill unavailable (offline / error): 3 manual períodos.
            Array.from({ length: 3 }, (_, i) => ({
              label: `Período anual ${i + 1}`,
              registeredLostDays: 0,
              registeredIncidentCount: 0,
              averageWorkers: '',
              lostDays: '',
              lostDaysEdited: true,
              invalidity: emptyInvalidity(),
            }))
        ).map((p, i) => (
          <div
            key={p.label}
            data-testid={`ds67-sim-period-${i}`}
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{p.label}</h2>
              <span
                data-testid={`ds67-sim-source-${i}`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  p.lostDaysEdited
                    ? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
                    : 'bg-teal-500/10 text-teal-700 dark:text-teal-400'
                }`}
              >
                {p.lostDaysEdited ? (
                  <>
                    <PencilLine className="h-3 w-3" /> Ingreso manual
                  </>
                ) : (
                  <>
                    <Database className="h-3 w-3" /> Desde incidentes registrados (
                    {p.registeredIncidentCount} incidentes)
                  </>
                )}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-secondary-token">
                  Dotación promedio (trabajadores)
                </span>
                <input
                  data-testid={`ds67-sim-workers-${i}`}
                  type="number"
                  min="1"
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
                  value={p.averageWorkers}
                  onChange={(e) => updatePeriod(i, { averageWorkers: e.target.value })}
                  placeholder="Ej: 120"
                />
              </label>
              <label className="block text-sm">
                <span className="text-secondary-token">
                  Días perdidos (subsidio por AT/EP)
                </span>
                <input
                  data-testid={`ds67-sim-lostdays-${i}`}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
                  value={p.lostDays}
                  onChange={(e) =>
                    updatePeriod(i, { lostDays: e.target.value, lostDaysEdited: true })
                  }
                />
              </label>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-secondary-token">
                Invalideces y muertes del período (según resolución del organismo
                administrador — ingreso manual)
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {INVALIDITY_BAND_LABELS.map(({ band, label }) => (
                  <label key={band} className="block">
                    <span className="text-xs text-muted-token">{label}</span>
                    <input
                      data-testid={`ds67-sim-inv-${i}-${band}`}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600"
                      value={p.invalidity[band]}
                      onChange={(e) =>
                        updatePeriod(i, {
                          invalidity: { ...p.invalidity, [band]: e.target.value },
                        })
                      }
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
            </details>
          </div>
        ))}
      </section>

      {/* ── Parámetros económicos ────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-secondary-token">
            Planilla anual imponible (CLP)
          </span>
          <input
            data-testid="ds67-sim-payroll"
            type="number"
            min="0"
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
            value={payroll}
            onChange={(e) => setPayroll(e.target.value)}
            placeholder="Ej: 600000000"
          />
        </label>
        <label className="block text-sm">
          <span className="text-secondary-token">
            Cotización adicional actual (%)
          </span>
          <input
            data-testid="ds67-sim-current"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600"
            value={currentPct}
            onChange={(e) => setCurrentPct(e.target.value)}
            placeholder="Ej: 0,34"
          />
        </label>
      </section>

      {formError ? (
        <div
          data-testid="ds67-sim-error"
          className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400"
        >
          <AlertCircle className="h-4 w-4 shrink-0" /> {humanErrorMessage(formError)}
        </div>
      ) : null}

      <button
        data-testid="ds67-sim-submit"
        type="button"
        disabled={submitting}
        onClick={() => void handleSubmit()}
        className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {submitting ? 'Simulando…' : 'Simular cotización adicional'}
      </button>

      {/* ── Resultado ────────────────────────────────────────────────── */}
      {result ? (
        <section
          data-testid="ds67-sim-result"
          className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
        >
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-token">Tasa promedio incapacidades temporales</p>
              <p data-testid="ds67-sim-result-tit" className="text-lg font-semibold">
                {result.averageTemporaryRate}
              </p>
            </div>
            <div>
              <p className="text-muted-token">Tasa invalideces y muertes</p>
              <p data-testid="ds67-sim-result-tim" className="text-lg font-semibold">
                {result.invalidityDeathRate}
              </p>
            </div>
            <div>
              <p className="text-muted-token">Tasa de siniestralidad total</p>
              <p data-testid="ds67-sim-result-total" className="text-lg font-semibold">
                {result.totalRate}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="text-sm text-muted-token">Cotización adicional resultante</p>
              <p data-testid="ds67-sim-result-pct" className="text-3xl font-bold">
                {fmtPct(result.additionalCotizacionPct)}
              </p>
            </div>
            {result.deltaPct !== null ? (
              <span
                data-testid="ds67-sim-result-delta"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${
                  isRebaja
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : result.deltaPct > 0
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                      : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {isRebaja ? (
                  <TrendingDown className="h-4 w-4" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )}
                {fmtDeltaPp(result.deltaPct)}{' '}
                {isRebaja ? '(rebaja)' : result.deltaPct > 0 ? '(recargo)' : '(sin cambio)'}
              </span>
            ) : null}
          </div>

          {result.annualCostClp !== null ? (
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-token">Costo anual proyectado</p>
                <p data-testid="ds67-sim-result-cost" className="text-lg font-semibold">
                  {formatClp(result.annualCostClp)}
                </p>
              </div>
              {result.currentAnnualCostClp !== null ? (
                <div>
                  <p className="text-muted-token">Costo anual actual</p>
                  <p className="text-lg font-semibold">
                    {formatClp(result.currentAnnualCostClp)}
                  </p>
                </div>
              ) : null}
              {result.annualCostDeltaClp !== null ? (
                <div>
                  <p className="text-muted-token">Diferencia por año</p>
                  <p
                    data-testid="ds67-sim-result-delta-cost"
                    className={`text-lg font-semibold ${
                      result.annualCostDeltaClp < 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : result.annualCostDeltaClp > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : ''
                    }`}
                  >
                    {formatClp(result.annualCostDeltaClp)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1 border-t border-zinc-200 pt-3 text-xs text-muted-token dark:border-zinc-700">
            <p data-testid="ds67-sim-citation">
              Base legal: tabla del artículo 5° —{' '}
              <a
                href="https://www.bcn.cl/leychile/navegar?idNorma=159800"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {result.legalCitation}
              </a>
              . Vigencia de exenciones, rebajas y recargos: desde el 1 de enero siguiente al
              proceso de evaluación (art. 13).
            </p>
            <p data-testid="ds67-sim-disclaimer">
              Simulación referencial. La evaluación oficial de siniestralidad efectiva la
              realiza el organismo administrador (mutualidad o ISL) cada dos años conforme
              al DS 67; esta proyección no constituye resolución ni califica invalideces.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default Ds67Simulator;
