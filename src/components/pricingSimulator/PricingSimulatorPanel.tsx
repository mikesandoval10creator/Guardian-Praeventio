// Praeventio Guard — Bloque D Rama 4: <PricingSimulatorPanel />
//
// Self-contained monthly-bill estimator over the pure-compute endpoint
// POST /api/sprint-k/:projectId/pricing/estimate-bill
// (src/server/routes/pricingSimulator.ts, Sprint 45 §171-173), consumed via
// the previously-orphaned client hook src/hooks/usePricingSimulator.ts.
//
// Minimal v1 form: workers + projects + tier → estimated monthly bill
// (base + overage + total). Deterministic engine, no PII, no side-effects.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, AlertTriangle } from 'lucide-react';
import { estimateBillFor } from '../../hooks/usePricingSimulator';
import type { BillEstimate, Tier } from '../../services/pricingSimulator/pricingSimulator';
import { humanErrorMessage } from '../../lib/humanError';


interface PricingSimulatorPanelProps {
  projectId: string;
}

// Closed vocabulary — mirrors the Tier union in the pricing engine.
const TIER_OPTIONS: Array<{ value: Tier; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
];

// CLP formatter (es-CL): $1.234.567 — no decimals for currency.
const CLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

export function PricingSimulatorPanel({ projectId }: PricingSimulatorPanelProps) {
  const { t } = useTranslation();
  const [workers, setWorkers] = useState<number>(25);
  const [projects, setProjects] = useState<number>(3);
  const [tier, setTier] = useState<Tier>('starter');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<BillEstimate | null>(null);

  const canSubmit = workers >= 0 && projects >= 0 && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await estimateBillFor(projectId, {
        tier,
        usage: {
          workers,
          projects,
          // AI calls / storage are out of scope for this minimal simulator —
          // send zeros so the engine bills only base + worker/project overage.
          aiCallsPerMonth: 0,
          storageGb: 0,
        },
      });
      setEstimate(res.estimate);
    } catch (err) {
      setEstimate(null);
      setError(humanErrorMessage(err instanceof Error ? err.message : 'unknown_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="pricing-simulator-panel"
      aria-label={t('pricingSimulator.panel.aria', 'Simulador de factura mensual') as string}
    >
      <header className="flex items-center gap-2">
        <Calculator className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('pricingSimulator.panel.title', 'Simulador de factura')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'pricingSimulator.panel.disclaimer',
          'Estimación determinística de tu factura mensual según trabajadores, proyectos y plan. Referencial.',
        )}
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('pricingSimulator.panel.workers', 'N.º trabajadores')}
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={workers}
            onChange={(e) => setWorkers(Math.max(0, Number(e.target.value) || 0))}
            data-testid="pricing-simulator-workers"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('pricingSimulator.panel.workers', 'N.º trabajadores') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('pricingSimulator.panel.projects', 'N.º proyectos')}
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={projects}
            onChange={(e) => setProjects(Math.max(0, Number(e.target.value) || 0))}
            data-testid="pricing-simulator-projects"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('pricingSimulator.panel.projects', 'N.º proyectos') as string}
          />
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('pricingSimulator.panel.tier', 'Plan')}
          </span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            data-testid="pricing-simulator-tier"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="pricing-simulator-submit"
          className="col-span-2 rounded-xl bg-sky-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 disabled:opacity-50"
        >
          {loading
            ? t('common.loading', 'Cargando…')
            : t('pricingSimulator.panel.submit', 'Estimar factura')}
        </button>
      </form>

      {error && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="pricing-simulator-error"
          role="alert"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('pricingSimulator.panel.error', 'No se pudo estimar la factura.')} ({humanErrorMessage(error)})</span>
        </div>
      )}

      {estimate && (
        <div
          className="bg-surface-elevated rounded p-3 space-y-2"
          data-testid="pricing-simulator-result"
        >
          <p className="text-sm font-black text-primary-token">
            {t('pricingSimulator.panel.total', 'Total estimado / mes')}: {CLP.format(estimate.totalClp)}
          </p>
          <dl className="grid grid-cols-2 gap-1 text-[11px] text-secondary-token">
            <dt>{t('pricingSimulator.panel.base', 'Base del plan')}</dt>
            <dd className="text-right text-primary-token">{CLP.format(estimate.baseClp)}</dd>
            <dt>{t('pricingSimulator.panel.overage', 'Excedentes')}</dt>
            <dd className="text-right text-primary-token">{CLP.format(estimate.totalOverageClp)}</dd>
          </dl>
          <p
            className={`text-[11px] font-bold ${
              estimate.fitsWithoutOverage
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {estimate.fitsWithoutOverage
              ? t('pricingSimulator.panel.fits', 'Tu uso cabe en el plan sin excedentes.')
              : t('pricingSimulator.panel.exceeds', 'Tu uso excede el plan — considera un plan mayor.')}
          </p>
        </div>
      )}
    </section>
  );
}

export default PricingSimulatorPanel;
