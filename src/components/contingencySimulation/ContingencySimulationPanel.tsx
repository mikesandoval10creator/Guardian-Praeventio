// Praeventio Guard — Bloque D Rama 2: <ContingencySimulationPanel />
//
// Self-contained tabletop-scenario builder form over the pure-compute
// endpoint POST /api/sprint-k/:projectId/contingency/build-scenario
// (src/server/routes/contingencySimulation.ts), consumed via the
// previously-orphaned client hook src/hooks/useContingencySimulation.ts.
//
// Minimal v1 form: kind + severity → generated scenario (trigger events,
// decision points, success criteria). evaluate-tabletop / list / count
// stay hook-only until their UI slice lands.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Siren, AlertTriangle } from 'lucide-react';
import { buildContingencyScenario } from '../../hooks/useContingencySimulation';
import type {
  ContingencyScenario,
  ScenarioKind,
  ScenarioSeverity,
} from '../../services/contingencySimulation/contingencyScenarioBuilder';

interface ContingencySimulationPanelProps {
  projectId: string;
}

// Closed vocabulary — mirrors ScenarioKind in the scenario builder engine.
const KIND_OPTIONS: Array<{ value: ScenarioKind; label: string }> = [
  { value: 'fire', label: 'Incendio' },
  { value: 'earthquake', label: 'Sismo / terremoto' },
  { value: 'flood', label: 'Inundación' },
  { value: 'chemical_spill', label: 'Derrame químico' },
  { value: 'power_outage', label: 'Corte de energía' },
  { value: 'cyber_attack', label: 'Ciberataque' },
  { value: 'mass_casualty', label: 'Accidente con múltiples víctimas' },
  { value: 'evacuation_blocked', label: 'Vía de evacuación bloqueada' },
  { value: 'leader_unavailable', label: 'Líder de emergencia no disponible' },
  { value: 'supplier_failure', label: 'Falla de proveedor crítico' },
];

const SEVERITY_OPTIONS: Array<{ value: ScenarioSeverity; label: string }> = [
  { value: 'minor', label: 'Menor' },
  { value: 'moderate', label: 'Moderada' },
  { value: 'major', label: 'Mayor' },
  { value: 'catastrophic', label: 'Catastrófica' },
];

export function ContingencySimulationPanel({ projectId }: ContingencySimulationPanelProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ScenarioKind>('fire');
  const [severity, setSeverity] = useState<ScenarioSeverity>('moderate');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ContingencyScenario | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await buildContingencyScenario(projectId, { kind, severity });
      setScenario(res.scenario);
    } catch (err) {
      setScenario(null);
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="contingency-simulation-panel"
      aria-label={t('contingencySimulation.panel.aria', 'Generador de escenarios de contingencia') as string}
    >
      <header className="flex items-center gap-2">
        <Siren className="w-4 h-4 text-orange-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('contingencySimulation.panel.title', 'Generar escenario tabletop')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'contingencySimulation.panel.description',
          'Elige tipo y severidad — el motor arma el escenario con eventos y puntos de decisión para ensayar sin riesgo real.',
        )}
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('contingencySimulation.panel.kind', 'Tipo de escenario')}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ScenarioKind)}
            data-testid="contingency-simulation-kind"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('contingencySimulation.panel.severity', 'Severidad')}
          </span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ScenarioSeverity)}
            data-testid="contingency-simulation-severity"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={loading}
          data-testid="contingency-simulation-submit"
          className="col-span-2 rounded-xl bg-orange-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 disabled:opacity-50"
        >
          {loading
            ? t('common.loading', 'Cargando…')
            : t('contingencySimulation.panel.submit', 'Generar escenario')}
        </button>
      </form>

      {error && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="contingency-simulation-error"
          role="alert"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('contingencySimulation.panel.error', 'No se pudo generar el escenario.')} ({error})</span>
        </div>
      )}

      {scenario && (
        <div
          className="bg-surface-elevated rounded p-3 space-y-2"
          data-testid="contingency-simulation-result"
        >
          <p className="text-sm font-black text-primary-token">{scenario.title}</p>
          <p className="text-[11px] text-secondary-token">
            {t('contingencySimulation.panel.duration', 'Duración estimada')}: {scenario.estimatedDurationMin} min ·{' '}
            {t('contingencySimulation.panel.staffPresent', 'Personal presente')}: {scenario.initialConditions.staffPresent}
          </p>
          {scenario.triggerEvents.length > 0 && (
            <div>
              <p className="text-[10px] uppercase font-bold text-secondary-token">
                {t('contingencySimulation.panel.triggerEvents', 'Eventos del ejercicio')}
              </p>
              <ul className="text-[11px] text-secondary-token list-disc pl-4">
                {scenario.triggerEvents.map((ev) => (
                  <li key={`${ev.minute}-${ev.event}`}>t+{ev.minute} min — {ev.event}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-secondary-token">
            {t('contingencySimulation.panel.decisionPoints', 'Puntos de decisión')}: {scenario.decisionPoints.length}
          </p>
          {scenario.successCriteria.length > 0 && (
            <div>
              <p className="text-[10px] uppercase font-bold text-secondary-token">
                {t('contingencySimulation.panel.successCriteria', 'Criterios de éxito')}
              </p>
              <ul className="text-[11px] text-secondary-token list-disc pl-4">
                {scenario.successCriteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
