// Praeventio Guard — Bloque 3.15 — <CostSimulator />
//
// Simulador interactivo que compara el costo proyectado de un escenario
// SIN prevención (multa + paralización + admin rehacer documentos) vs uno
// CON prevención (ahorro estimado por vencimientos detectados a tiempo +
// documentos generados internamente + paradas evitadas + near-miss).
//
// Inputs principales:
//   • cantidad de trabajadores
//   • industria (advisory, no afecta math)
//   • % de EPP cubierto
//   • horas de capacitación / año / trabajador
//
// Inputs detallados (collapsible) para los engines `estimateNonComplianceCost`
// y `estimatePreventionROI` — defaults razonables basados en Ley 16.744 +
// SUSESO/DT publications.
//
// Output:
//   • Tabla comparativa SIN vs CON prevención.
//   • Badge de ROI (teal positivo / coral negativo / amber breakeven /
//     emerald excellent).
//   • Botón "Guardar escenario" (opt-in cuando el cálculo es válido).
//
// El componente acepta:
//   - projectId    (string) — para las llamadas HTTP
//   - onSaved?     (callback opcional cuando se guarda con éxito)
//   - defaultInput? (override inicial; útil para tests / replicar scenario)
//
// Reglas Directiva #2: NUNCA bloquea operación. Sólo informa.

import { randomId } from '../../utils/randomId';
import { useCallback, useMemo, useState } from 'react';
import {
  Calculator,
  Save,
  Loader2,
  AlertOctagon,
  Shield,
  TrendingUp,
  TrendingDown,
  Settings2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  simulatePreventionCost,
  savePreventionScenario,
  type SimulateInput,
  type CostSimulation,
  type Industry,
  type StoredCostScenario,
  type RoiLevel,
} from '../../hooks/usePreventionCost';
import type { IncompletionKind } from '../../services/costCalculator/preventionCostCalculator';

// ── Static option lists ─────────────────────────────────────────────────

const INDUSTRY_OPTIONS: ReadonlyArray<{ value: Industry; label: string }> = [
  { value: 'mining', label: 'Minería' },
  { value: 'construction', label: 'Construcción' },
  { value: 'agriculture', label: 'Agricultura' },
  { value: 'manufacturing', label: 'Manufactura' },
  { value: 'energy', label: 'Energía' },
  { value: 'transport', label: 'Transporte' },
  { value: 'services', label: 'Servicios' },
  { value: 'health', label: 'Salud' },
  { value: 'education', label: 'Educación' },
  { value: 'retail', label: 'Retail' },
  { value: 'other', label: 'Otro' },
];

const KIND_OPTIONS: ReadonlyArray<{ value: IncompletionKind; label: string }> = [
  { value: 'document_missing', label: 'Documento faltante' },
  { value: 'training_overdue', label: 'Capacitación vencida' },
  { value: 'epp_expired', label: 'EPP vencido' },
  { value: 'safety_breach', label: 'Infracción de seguridad' },
  { value: 'fatal_accident_risk', label: 'Riesgo de accidente fatal' },
];

// ── Defaults (razonables para una empresa mediana en Chile) ────────────

const DEFAULT_INPUT: SimulateInput = {
  workerCount: 50,
  industry: 'construction',
  eppCoveragePct: 100,
  trainingHoursPerYear: 16,
  preventionInvestmentClp: 6_000_000,
  nonCompliance: {
    kind: 'training_overdue',
    affectedWorkerCount: 50,
    estimatedStoppageDays: 3,
    dailyStoppageCostClp: 1_500_000,
    adminHoursToFix: 24,
    hasHistoryOfFines: false,
  },
  prevention: {
    expirationsCaughtEarly: 20,
    adminHoursSaved: 80,
    documentsGeneratedInternally: 15,
    potentialStoppagesAvoided: 2,
    nearMissesNotEscalated: 5,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

const formatClp = (n: number): string =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);

const formatRatioPct = (r: number): string => {
  if (!Number.isFinite(r)) return '∞';
  return `${(r * 100).toFixed(0)}%`;
};

const ROI_TONE: Record<RoiLevel, string> = {
  underwater:
    'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700',
  breakeven:
    'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700',
  positive:
    'bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700',
  excellent:
    'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-400 dark:border-emerald-600',
};

const ROI_LABEL: Record<RoiLevel, string> = {
  underwater: 'ROI negativo — la inversión no se recupera',
  breakeven: 'Cercano al equilibrio',
  positive: 'ROI positivo — la prevención paga',
  excellent: 'ROI excelente — alto retorno preventivo',
};

const ROI_HEADLINE: Record<RoiLevel, string> = {
  underwater: 'Revisar inversión',
  breakeven: 'En equilibrio',
  positive: 'Prevención rentable',
  excellent: 'Prevención muy rentable',
};

// ── Component props ────────────────────────────────────────────────────

export interface CostSimulatorProps {
  /** Project ID for the HTTP namespace `/api/sprint-k/:projectId/cost/*`. */
  projectId: string;
  /** Optional callback after a successful save. Caller can refetch list. */
  onSaved?: (scenario: StoredCostScenario) => void;
  /** Optional input override (useful for tests or replicating a scenario). */
  defaultInput?: Partial<SimulateInput>;
  /** Optional extra CSS classes for the outer section. */
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────

export function CostSimulator({
  projectId,
  onSaved,
  defaultInput,
  className = '',
}: CostSimulatorProps) {
  const [input, setInput] = useState<SimulateInput>(() => ({
    ...DEFAULT_INPUT,
    ...defaultInput,
    nonCompliance: {
      ...DEFAULT_INPUT.nonCompliance,
      ...(defaultInput?.nonCompliance ?? {}),
    },
    prevention: {
      ...DEFAULT_INPUT.prevention,
      ...(defaultInput?.prevention ?? {}),
    },
  }));

  const [simulation, setSimulation] = useState<CostSimulation | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDescription, setScenarioDescription] = useState('');

  // Keep the engine sub-input in sync with the top-level affectedWorkerCount.
  // This is a quality-of-life synchronization, NOT a hidden math step.
  const syncedInput = useMemo<SimulateInput>(
    () => ({
      ...input,
      nonCompliance: {
        ...input.nonCompliance,
        affectedWorkerCount: input.workerCount,
      },
    }),
    [input],
  );

  const handleSimulate = useCallback(async () => {
    setIsSimulating(true);
    setError(null);
    try {
      const { simulation: sim } = await simulatePreventionCost(
        projectId,
        syncedInput,
      );
      setSimulation(sim);
    } catch (err) {
      setSimulation(null);
      setError(err instanceof Error ? err.message : 'simulation_failed');
    } finally {
      setIsSimulating(false);
    }
  }, [projectId, syncedInput]);

  const handleSave = useCallback(async () => {
    if (!simulation) return;
    const name = scenarioName.trim() || `Escenario ${new Date().toLocaleString('es-CL')}`;
    setIsSaving(true);
    setError(null);
    try {
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `scenario-${Date.now()}-${randomId()}`;
      const result = await savePreventionScenario(
        projectId,
        {
          id,
          name,
          description: scenarioDescription.trim() || undefined,
          input: syncedInput,
        },
        id, // idempotency key = scenario id
      );
      if (onSaved) onSaved(result.scenario);
      setScenarioName('');
      setScenarioDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed');
    } finally {
      setIsSaving(false);
    }
  }, [projectId, simulation, syncedInput, scenarioName, scenarioDescription, onSaved]);

  // Generic numeric updater
  const updateNumber = useCallback(
    <K extends keyof SimulateInput>(key: K, raw: string) => {
      const n = raw === '' ? 0 : Number(raw);
      if (Number.isFinite(n) && n >= 0) {
        setInput((prev) => ({ ...prev, [key]: n }));
      }
    },
    [],
  );

  const updateNonComplianceNumber = useCallback(
    (key: keyof SimulateInput['nonCompliance'], raw: string) => {
      const n = raw === '' ? 0 : Number(raw);
      if (Number.isFinite(n) && n >= 0) {
        setInput((prev) => ({
          ...prev,
          nonCompliance: { ...prev.nonCompliance, [key]: n },
        }));
      }
    },
    [],
  );

  const updatePreventionNumber = useCallback(
    (key: keyof SimulateInput['prevention'], raw: string) => {
      const n = raw === '' ? 0 : Number(raw);
      if (Number.isFinite(n) && n >= 0) {
        setInput((prev) => ({
          ...prev,
          prevention: { ...prev.prevention, [key]: n },
        }));
      }
    },
    [],
  );

  return (
    <section
      className={`rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-5 ${className}`}
      data-testid="costSimulator"
      aria-label="Simulador de costo preventivo"
    >
      <header className="flex items-center gap-2">
        <Calculator
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2
          className="text-base font-bold text-slate-800 dark:text-slate-100"
          data-testid="costSimulator.title"
        >
          Simulador de costo preventivo
        </h2>
      </header>

      <p className="text-xs text-slate-600 dark:text-slate-400">
        Compara el costo proyectado de un incidente sin prevención vs el
        ahorro estimado con prevención activa. Las cifras son estimaciones
        (Ley 16.744, SUSESO/DT) y no reemplazan asesoría legal específica.
      </p>

      {/* ── Inputs principales ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="text-slate-700 dark:text-slate-300 font-semibold">
            Cantidad de trabajadores
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={input.workerCount}
            onChange={(e) => updateNumber('workerCount', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            data-testid="costSimulator.input.workerCount"
          />
        </label>

        <label className="block text-xs">
          <span className="text-slate-700 dark:text-slate-300 font-semibold">
            Industria
          </span>
          <select
            value={input.industry}
            onChange={(e) =>
              setInput((prev) => ({
                ...prev,
                industry: e.target.value as Industry,
              }))
            }
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            data-testid="costSimulator.input.industry"
          >
            {INDUSTRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="text-slate-700 dark:text-slate-300 font-semibold">
            % EPP cubierto por la empresa
          </span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={input.eppCoveragePct}
            onChange={(e) => updateNumber('eppCoveragePct', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            data-testid="costSimulator.input.eppCoveragePct"
          />
        </label>

        <label className="block text-xs">
          <span className="text-slate-700 dark:text-slate-300 font-semibold">
            Horas capacitación/trabajador/año
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={input.trainingHoursPerYear}
            onChange={(e) =>
              updateNumber('trainingHoursPerYear', e.target.value)
            }
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            data-testid="costSimulator.input.trainingHoursPerYear"
          />
        </label>

        <label className="block text-xs sm:col-span-2">
          <span className="text-slate-700 dark:text-slate-300 font-semibold">
            Inversión preventiva anual (CLP)
          </span>
          <input
            type="number"
            min={0}
            step={100000}
            value={input.preventionInvestmentClp}
            onChange={(e) =>
              updateNumber('preventionInvestmentClp', e.target.value)
            }
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            data-testid="costSimulator.input.preventionInvestmentClp"
          />
        </label>
      </div>

      {/* ── Parámetros avanzados (collapsible) ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/40 rounded-xl"
          aria-expanded={advancedOpen}
          data-testid="costSimulator.advanced.toggle"
        >
          <Settings2 className="w-4 h-4" aria-hidden="true" />
          Parámetros avanzados
          {advancedOpen ? (
            <ChevronUp className="w-4 h-4 ml-auto" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 ml-auto" aria-hidden="true" />
          )}
        </button>

        {advancedOpen && (
          <div
            className="px-4 pb-4 space-y-4"
            data-testid="costSimulator.advanced.panel"
          >
            <fieldset className="space-y-2">
              <legend className="text-[11px] uppercase font-bold text-rose-700 dark:text-rose-300">
                Escenario sin prevención
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Tipo de incumplimiento
                  </span>
                  <select
                    value={input.nonCompliance.kind}
                    onChange={(e) =>
                      setInput((prev) => ({
                        ...prev,
                        nonCompliance: {
                          ...prev.nonCompliance,
                          kind: e.target.value as IncompletionKind,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.kind"
                  >
                    {KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Días de paralización
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={input.nonCompliance.estimatedStoppageDays}
                    onChange={(e) =>
                      updateNonComplianceNumber(
                        'estimatedStoppageDays',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.stoppageDays"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Costo diario paralización (CLP)
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={100000}
                    value={input.nonCompliance.dailyStoppageCostClp}
                    onChange={(e) =>
                      updateNonComplianceNumber(
                        'dailyStoppageCostClp',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.dailyStoppageCost"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Horas admin para rehacer
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={input.nonCompliance.adminHoursToFix}
                    onChange={(e) =>
                      updateNonComplianceNumber(
                        'adminHoursToFix',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.adminHoursToFix"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={input.nonCompliance.hasHistoryOfFines}
                    onChange={(e) =>
                      setInput((prev) => ({
                        ...prev,
                        nonCompliance: {
                          ...prev.nonCompliance,
                          hasHistoryOfFines: e.target.checked,
                        },
                      }))
                    }
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    data-testid="costSimulator.advanced.hasHistoryOfFines"
                  />
                  <span className="text-slate-700 dark:text-slate-300">
                    Historial de fiscalización previa (×1.8 al rango de multa)
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-[11px] uppercase font-bold text-teal-700 dark:text-teal-300">
                Escenario con prevención
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Vencimientos detectados a tiempo
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={input.prevention.expirationsCaughtEarly}
                    onChange={(e) =>
                      updatePreventionNumber(
                        'expirationsCaughtEarly',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.expirationsCaughtEarly"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Horas admin ahorradas
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={input.prevention.adminHoursSaved}
                    onChange={(e) =>
                      updatePreventionNumber(
                        'adminHoursSaved',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.adminHoursSaved"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Documentos generados internamente
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={input.prevention.documentsGeneratedInternally}
                    onChange={(e) =>
                      updatePreventionNumber(
                        'documentsGeneratedInternally',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.docsInternal"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    Paradas evitadas
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={input.prevention.potentialStoppagesAvoided}
                    onChange={(e) =>
                      updatePreventionNumber(
                        'potentialStoppagesAvoided',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.stoppagesAvoided"
                  />
                </label>
                <label className="block text-xs sm:col-span-2">
                  <span className="text-slate-700 dark:text-slate-300">
                    Near-miss que no escalaron
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={input.prevention.nearMissesNotEscalated}
                    onChange={(e) =>
                      updatePreventionNumber(
                        'nearMissesNotEscalated',
                        e.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                    data-testid="costSimulator.advanced.nearMisses"
                  />
                </label>
              </div>
            </fieldset>
          </div>
        )}
      </div>

      {/* ── Simulate trigger ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSimulate}
          disabled={isSimulating}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 disabled:cursor-not-allowed text-white px-4 py-2 text-sm font-bold shadow-sm transition-colors"
          data-testid="costSimulator.simulate"
        >
          {isSimulating ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Calculator className="w-4 h-4" aria-hidden="true" />
          )}
          {isSimulating ? 'Simulando…' : 'Simular costos'}
        </button>
        {error && (
          <span
            className="text-xs text-rose-600 dark:text-rose-400 font-semibold"
            role="alert"
            data-testid="costSimulator.error"
          >
            {error}
          </span>
        )}
      </div>

      {/* ── Results ── */}
      {simulation && (
        <div className="space-y-4" data-testid="costSimulator.result">
          {/* ROI badge */}
          <div
            className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${ROI_TONE[simulation.roiLevel]}`}
            data-testid="costSimulator.result.roiBadge"
          >
            {simulation.roiLevel === 'underwater' ? (
              <TrendingDown
                className="w-6 h-6 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <TrendingUp className="w-6 h-6 shrink-0" aria-hidden="true" />
            )}
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-bold"
                data-testid="costSimulator.result.roiHeadline"
              >
                {ROI_HEADLINE[simulation.roiLevel]}
              </p>
              <p className="text-[11px] opacity-80">
                {ROI_LABEL[simulation.roiLevel]}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase opacity-70">ROI</p>
              <p
                className="text-2xl font-black tabular-nums leading-none"
                data-testid="costSimulator.result.roiRatio"
              >
                {formatRatioPct(simulation.roiRatio)}
              </p>
            </div>
          </div>

          {/* Comparative table */}
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"
            data-testid="costSimulator.result.table"
          >
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left px-3 py-2 text-[11px] uppercase font-bold text-slate-600 dark:text-slate-300">
                    Categoría
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] uppercase font-bold text-rose-700 dark:text-rose-300">
                    Sin prevención
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] uppercase font-bold text-teal-700 dark:text-teal-300">
                    Con prevención
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                <tr>
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
                  >
                    <AlertOctagon
                      className="w-3.5 h-3.5 text-rose-500"
                      aria-hidden="true"
                    />
                    Multa estimada
                  </th>
                  <td
                    className="text-right px-3 py-2 tabular-nums text-rose-700 dark:text-rose-300"
                    data-testid="costSimulator.result.row.fine.without"
                  >
                    {formatClp(simulation.withoutPrevention.estimatedFineClpMin)}
                    {' — '}
                    {formatClp(simulation.withoutPrevention.estimatedFineClpMax)}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-400">
                    —
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Paralización
                  </th>
                  <td
                    className="text-right px-3 py-2 tabular-nums text-rose-700 dark:text-rose-300"
                    data-testid="costSimulator.result.row.stoppage.without"
                  >
                    {formatClp(simulation.withoutPrevention.stoppageCostClp)}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-400">
                    —
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Costo administrativo
                  </th>
                  <td
                    className="text-right px-3 py-2 tabular-nums text-rose-700 dark:text-rose-300"
                    data-testid="costSimulator.result.row.admin.without"
                  >
                    {formatClp(simulation.withoutPrevention.adminCostClp)}
                  </td>
                  <td
                    className="text-right px-3 py-2 tabular-nums text-teal-700 dark:text-teal-300"
                    data-testid="costSimulator.result.row.admin.with"
                  >
                    {formatClp(simulation.withPrevention.adminHoursSavingsClp)}
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
                  >
                    <Shield
                      className="w-3.5 h-3.5 text-teal-500"
                      aria-hidden="true"
                    />
                    Documentos internos
                  </th>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-400">
                    —
                  </td>
                  <td
                    className="text-right px-3 py-2 tabular-nums text-teal-700 dark:text-teal-300"
                    data-testid="costSimulator.result.row.docs.with"
                  >
                    {formatClp(simulation.withPrevention.documentInsourceSavingsClp)}
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Paradas evitadas
                  </th>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-400">
                    —
                  </td>
                  <td
                    className="text-right px-3 py-2 tabular-nums text-teal-700 dark:text-teal-300"
                    data-testid="costSimulator.result.row.stoppages.with"
                  >
                    {formatClp(simulation.withPrevention.stoppageAvoidanceSavingsClp)}
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Incidentes evitados
                  </th>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-400">
                    —
                  </td>
                  <td
                    className="text-right px-3 py-2 tabular-nums text-teal-700 dark:text-teal-300"
                    data-testid="costSimulator.result.row.incidents.with"
                  >
                    {formatClp(simulation.withPrevention.incidentAvoidanceSavingsClp)}
                  </td>
                </tr>
                <tr className="bg-slate-50 dark:bg-slate-800/60">
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-black text-slate-800 dark:text-slate-100"
                  >
                    Total esperado
                  </th>
                  <td
                    className="text-right px-3 py-2 tabular-nums font-black text-rose-700 dark:text-rose-300"
                    data-testid="costSimulator.result.total.without"
                  >
                    {formatClp(simulation.expectedNonComplianceClp)}
                  </td>
                  <td
                    className="text-right px-3 py-2 tabular-nums font-black text-teal-700 dark:text-teal-300"
                    data-testid="costSimulator.result.total.with"
                  >
                    {formatClp(simulation.expectedSavingsClp)}
                  </td>
                </tr>
                <tr className="bg-emerald-50 dark:bg-emerald-950/30">
                  <th
                    scope="row"
                    className="text-left px-3 py-2 font-black text-emerald-800 dark:text-emerald-200"
                  >
                    Neto (ahorro − inversión)
                  </th>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-400">
                    —
                  </td>
                  <td
                    className="text-right px-3 py-2 tabular-nums font-black text-emerald-700 dark:text-emerald-300"
                    data-testid="costSimulator.result.net"
                  >
                    {formatClp(simulation.netBenefitClp)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Save scenario */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2">
            <label className="block text-xs">
              <span className="text-slate-700 dark:text-slate-300 font-semibold">
                Nombre del escenario
              </span>
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="Ej. Construcción 50 trabajadores Q2 2026"
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                data-testid="costSimulator.save.name"
              />
            </label>
            <label className="block text-xs">
              <span className="text-slate-700 dark:text-slate-300 font-semibold">
                Notas (opcional)
              </span>
              <textarea
                value={scenarioDescription}
                onChange={(e) => setScenarioDescription(e.target.value)}
                placeholder="Contexto adicional, supuestos…"
                maxLength={2000}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                data-testid="costSimulator.save.description"
              />
            </label>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 disabled:cursor-not-allowed text-white px-4 py-2 text-sm font-bold shadow-sm transition-colors"
              data-testid="costSimulator.save.button"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="w-4 h-4" aria-hidden="true" />
              )}
              {isSaving ? 'Guardando…' : 'Guardar escenario'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
