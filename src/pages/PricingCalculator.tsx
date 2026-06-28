// Praeventio Guard — Sprint K §171-179: Pricing Calculator.
//
// Calculadora interactiva consolidada que combina:
//   - §171 Plan recomendado (por # trabajadores + # proyectos + industria).
//   - §172 Costo mensual estimado CLP (consume `subscriptionPlan` + `tiers`).
//   - §175 + §178 Simulador ROI (consume `roiCalculator`).
//   - §176 Presupuesto EPP estimado (consume `eppIndustryCatalog`).
//   - §177 Botón "Generar Orden de Compra" — descarga JSON ahora (TODO PDF).
//
// La lógica está delegada a services determinísticos; este page es solo
// presentational. Cero side-effects fuera del download.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import {
  Calculator,
  Users,
  Briefcase,
  Building2,
  Sparkles,
  Wallet,
  TrendingUp,
  HardHat,
  Download,
  Info,
  ShoppingCart,
  BarChart3,
} from 'lucide-react';
import {
  TIERS,
  type Tier,
  type TierId,
  calculateMonthlyCost,
  suggestUpgrade,
  formatCurrency,
} from '../services/pricing/tiers';
import {
  TIER_TO_SUBSCRIPTION_PLAN,
  type SubscriptionPlan,
} from '../services/pricing/subscriptionPlan';
import {
  estimateMonthlyEppBudgetClp,
  SUPPORTED_INDUSTRY_OPTIONS,
} from '../services/pricing/eppIndustryCatalog';
import {
  computeRoi,
  type PreventionInvestment,
  type RoiReport,
} from '../services/financialAnalytics/roiCalculator';
import { generatePricingOcPdf } from '../utils/pricingOcPdf';
import { logger } from '../utils/logger';
import {
  compareRoiScenarios,
  type CompareScenariosInput,
  type CompareScenariosResponse,
} from '../hooks/useRoiScenario';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Recomienda un tier mínimo que cubra `workers` y `projects` sin overage.
 * Si ninguno cubre, devuelve el último (ilimitado / global-titanio).
 */
function recommendTier(workers: number, projects: number): Tier {
  const safeW = Math.max(0, workers);
  const safeP = Math.max(0, projects);
  const fit = TIERS.find(
    (t) => safeW <= t.trabajadoresMax && safeP <= t.proyectosMax,
  );
  return fit ?? TIERS[TIERS.length - 1];
}

/**
 * Calcula costo mensual de un tier dado para una carga (workers, projects).
 * Para tiers premium que excederían capacidad devuelve `null` (forzamos
 * upgrade en UI).
 */
function safeMonthlyCost(
  tierId: TierId,
  workers: number,
  projects: number,
): { totalClp: number } | null {
  try {
    const cost = calculateMonthlyCost(tierId, workers, projects);
    return { totalClp: cost.total };
  } catch {
    return null;
  }
}

/** Formatea un % que puede ser Infinity (inversión cero) o finito. */
function formatRoiPercent(v: number): string {
  return Number.isFinite(v) ? `${v}%` : '∞';
}

/** Formatea payback en meses, manejando Infinity (no recuperable). */
function formatPayback(v: number, monthsLabel: string, notRecoverable: string): string {
  return Number.isFinite(v) ? `${v} ${monthsLabel}` : notRecoverable;
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export const PricingCalculator: React.FC = () => {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  // Inputs
  const [workers, setWorkers] = useState<number>(120);
  const [projects, setProjects] = useState<number>(8);
  const [industryPrefix, setIndustryPrefix] = useState<string>('GP-CONS');
  const [currentTier, setCurrentTier] = useState<TierId>('plata');

  // ROI inputs
  const [baselineIncidents, setBaselineIncidents] = useState<number>(12);
  const [currentIncidents, setCurrentIncidents] = useState<number>(4);
  const [avgIncidentCost, setAvgIncidentCost] = useState<number>(2_500_000);
  const [scenarioComparison, setScenarioComparison] = useState<CompareScenariosResponse | null>(null);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      // Sin proyecto activo no hay con qué comparar — empty-state honesto.
      setScenarioComparison(null);
      return;
    }

    let cancelled = false;

    const reductionPct = baselineIncidents > 0
      ? Math.round(((baselineIncidents - currentIncidents) / baselineIncidents) * 100)
      : 0;

    const input: CompareScenariosInput = {
      baseline: {
        averageDirectCostPerIncidentClp: avgIncidentCost,
        baselineRatePerYear: baselineIncidents,
        workersCount: workers,
        indirectMultiplier: 4,
      },
      scenarios: [
        {
          id: 'current-program',
          name: 'Programa actual',
          description: 'Escenario basado en inputs actuales de la calculadora',
          investments: [
            { category: 'epp', amountClp: estimateMonthlyEppBudgetClp(industryPrefix, workers).totalClp * 12 },
            { category: 'training', amountClp: 500_000 },
            { category: 'audits', amountClp: 300_000 },
          ],
          assumptions: {
            expectedIncidentReductionPct: reductionPct,
            expectedComplianceImprovementPct: Math.min(reductionPct + 10, 100),
            paybackMonthsEstimate: 12,
            confidenceLevel: 'medium',
          },
        },
      ],
    };

    compareRoiScenarios(projectId, input)
      .then((res) => {
        if (!cancelled) setScenarioComparison(res);
      })
      .catch((err: unknown) => {
        // No fabricamos datos si el servidor falla: limpiamos el resultado
        // (cae al empty-state) y dejamos rastro en consola para diagnóstico.
        if (!cancelled) setScenarioComparison(null);
        logger.warn('roiScenario.compare.client_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id, workers, industryPrefix, baselineIncidents, currentIncidents, avgIncidentCost]);

  // ─── Outputs (derived) ───────────────────────────────────────────────
  const recommendedTier = useMemo(
    () => recommendTier(workers, projects),
    [workers, projects],
  );
  const recommendedPlan: SubscriptionPlan =
    TIER_TO_SUBSCRIPTION_PLAN[recommendedTier.id];

  const monthlyCostByTier = useMemo(() => {
    return TIERS.map((tier) => ({
      tier,
      cost: safeMonthlyCost(tier.id, workers, projects),
    }));
  }, [workers, projects]);

  const currentTierCost = useMemo(
    () => safeMonthlyCost(currentTier, workers, projects),
    [currentTier, workers, projects],
  );

  const upgradeHint = useMemo(
    () => suggestUpgrade(currentTier, workers, projects),
    [currentTier, workers, projects],
  );

  // ROI
  const roi: RoiReport = useMemo(() => {
    const investments: PreventionInvestment[] = [
      { category: 'epp', amountClp: 0 }, // se inyecta abajo
      { category: 'training', amountClp: 500_000 },
      { category: 'audits', amountClp: 300_000 },
    ];
    // EPP investment proxy: presupuesto EPP mensual × 12.
    const eppBudget = estimateMonthlyEppBudgetClp(industryPrefix, workers);
    investments[0] = { category: 'epp', amountClp: eppBudget.totalClp * 12 };
    return computeRoi(investments, {
      baselineRatePerYear: baselineIncidents,
      currentRatePerYear: currentIncidents,
      averageDirectCostPerIncidentClp: avgIncidentCost,
    });
  }, [workers, industryPrefix, baselineIncidents, currentIncidents, avgIncidentCost]);

  // EPP budget
  const eppBudget = useMemo(
    () => estimateMonthlyEppBudgetClp(industryPrefix, workers),
    [industryPrefix, workers],
  );

  // ─── Actions ─────────────────────────────────────────────────────────
  const onGeneratePurchaseOrder = () => {
    // H21 cerrado (Fase A.3, 2026-05-21): emisión PDF formal con
    // generatePricingOcPdf — reusa patrón visual ds67Certificate +
    // jsPDF + jspdf-autotable. El JSON queda disponible vía
    // onDownloadOcJson para integraciones programáticas (/oc-sugerida).
    const monthlyCost = safeMonthlyCost(recommendedTier.id, workers, projects);
    const industryLabel =
      SUPPORTED_INDUSTRY_OPTIONS.find((o) => o.prefix === industryPrefix)?.label ??
      industryPrefix;
    const doc = generatePricingOcPdf({
      industryPrefix,
      industryLabel,
      workers,
      projects,
      recommendedTier,
      recommendedPlan,
      monthlyCostClp: monthlyCost?.totalClp ?? null,
      monthlyEppBudgetClp: eppBudget.totalClp,
      roiPercent: Number.isFinite(roi.roiPercent) ? roi.roiPercent : null,
      paybackMonths: Number.isFinite(roi.paybackMonths) ? roi.paybackMonths : null,
      baselineIncidentsPerYear: baselineIncidents,
      currentIncidentsPerYear: currentIncidents,
      avgIncidentCostClp: avgIncidentCost,
    });
    doc.save(`praeventio-oc-${Date.now()}.pdf`);
  };

  const onDownloadOcJson = () => {
    // Mantenemos JSON para integraciones programáticas (CRM/ERP) +
    // testing. La página /oc-sugerida consume este shape.
    const monthlyCost = safeMonthlyCost(recommendedTier.id, workers, projects);
    const payload = {
      version: 'pricing-calculator-oc@2',
      generatedAt: new Date().toISOString(),
      industryPrefix,
      workers,
      projects,
      recommendedTier: recommendedTier.id,
      recommendedPlan,
      monthlyCostClp: monthlyCost?.totalClp ?? null,
      monthlyEppBudgetClp: eppBudget.totalClp,
      annualEppBudgetClp: eppBudget.totalClp * 12,
      roiPercent: Number.isFinite(roi.roiPercent) ? roi.roiPercent : null,
      paybackMonths: Number.isFinite(roi.paybackMonths) ? roi.paybackMonths : null,
      baselineIncidentsPerYear: baselineIncidents,
      currentIncidentsPerYear: currentIncidents,
      avgIncidentCostClp: avgIncidentCost,
    };
    downloadJson(`praeventio-oc-${Date.now()}.json`, payload);
  };

  // ─── ROI scenario comparator (server-computed) ─────────────────────────
  // Solo renderizamos la tabla cuando el servidor devolvió un comparison
  // con outcomes reales. Una respuesta vacía/parcial cae al empty-state
  // (no fabricamos filas).
  const scenarioOutcomes = scenarioComparison?.comparison?.outcomes ?? [];
  const hasScenarioComparison = scenarioOutcomes.length > 0;
  const recommendedScenarioId =
    scenarioComparison?.comparison?.recommendedScenario?.scenarioId;
  const scenarioRationale = scenarioComparison?.comparison?.rationale ?? [];

  return (
    <div
      data-testid="pricing-calculator-page"
      className="p-6 space-y-6 max-w-7xl mx-auto"
    >
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <Calculator className="w-7 h-7 text-[#4db6ac]" />
          <h1 className="text-2xl font-black text-primary-token">
            {t('pricingCalc.header.title', 'Calculadora de Precios y ROI')}
          </h1>
        </div>
        <p className="text-sm text-muted-token">
          {t(
            'pricingCalc.header.subtitle',
            'Estima tu plan recomendado, costo mensual, retorno y presupuesto EPP en un solo lugar.',
          )}
        </p>
      </header>

      {/* INPUTS ─────────────────────────────────────────────────────── */}
      <section
        data-testid="pricing-calculator-inputs"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-elevated rounded-xl border border-default-token/50 p-5"
      >
        <label className="block">
          <span className="flex items-center gap-2 text-[11px] font-medium text-secondary-token mb-1">
            <Users className="w-3.5 h-3.5" />
            {t('pricingCalc.inputs.workers', 'Trabajadores')}
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={workers}
            onChange={(e) => setWorkers(Number(e.target.value) || 0)}
            data-testid="pc-workers"
            className="w-full bg-elevated border border-default-token rounded-lg px-2 py-1.5 text-sm text-primary-token focus:ring-1 focus:ring-[#4db6ac]"
          />
        </label>
        <label className="block">
          <span className="flex items-center gap-2 text-[11px] font-medium text-secondary-token mb-1">
            <Briefcase className="w-3.5 h-3.5" />
            {t('pricingCalc.inputs.projects', 'Proyectos activos')}
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={projects}
            onChange={(e) => setProjects(Number(e.target.value) || 0)}
            data-testid="pc-projects"
            className="w-full bg-elevated border border-default-token rounded-lg px-2 py-1.5 text-sm text-primary-token focus:ring-1 focus:ring-[#4db6ac]"
          />
        </label>
        <label className="block">
          <span className="flex items-center gap-2 text-[11px] font-medium text-secondary-token mb-1">
            <Building2 className="w-3.5 h-3.5" />
            {t('pricingCalc.inputs.industry', 'Industria')}
          </span>
          <select
            value={industryPrefix}
            onChange={(e) => setIndustryPrefix(e.target.value)}
            data-testid="pc-industry"
            className="w-full bg-elevated border border-default-token rounded-lg px-2 py-1.5 text-sm text-primary-token"
          >
            {SUPPORTED_INDUSTRY_OPTIONS.map((opt) => (
              <option key={opt.prefix} value={opt.prefix}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="flex items-center gap-2 text-[11px] font-medium text-secondary-token mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            {t('pricingCalc.inputs.currentTier', 'Tier actual')}
          </span>
          <select
            value={currentTier}
            onChange={(e) => setCurrentTier(e.target.value as TierId)}
            data-testid="pc-current-tier"
            className="w-full bg-elevated border border-default-token rounded-lg px-2 py-1.5 text-sm text-primary-token"
          >
            {TIERS.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.nombre}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* OUTPUTS ────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recommendation */}
        <div
          data-testid="pricing-calculator-recommendation"
          className="bg-elevated rounded-xl border border-[#4db6ac]/30 p-5 space-y-2"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold text-primary-token">
            <Sparkles className="w-4 h-4 text-[#4db6ac]" />
            {t('pricingCalc.recommendation.title', 'Plan recomendado')}
          </h2>
          <p className="text-3xl font-black text-[#4db6ac]">{recommendedTier.nombre}</p>
          <p className="text-xs text-muted-token">
            {t('pricingCalc.recommendation.coverage', 'Cubre hasta {{w}} trabajadores y {{p}} proyectos.', {
              w: Number.isFinite(recommendedTier.trabajadoresMax)
                ? recommendedTier.trabajadoresMax
                : '∞',
              p: Number.isFinite(recommendedTier.proyectosMax)
                ? recommendedTier.proyectosMax
                : '∞',
            })}
          </p>
          <p className="text-sm text-secondary-token">
            {t('pricingCalc.recommendation.plan', 'Suscripción')}:{' '}
            <span className="font-mono font-semibold">{recommendedPlan}</span>
          </p>
          <p className="text-base text-secondary-token">
            {formatCurrency(recommendedTier.clpRegular, 'CLP')} /
            <span className="text-xs text-slate-500"> {t('pricingCalc.recommendation.perMonth', 'mes')}</span>
          </p>
          {upgradeHint && (
            <p
              data-testid="pc-upgrade-hint"
              className="text-xs text-amber-600 dark:text-amber-300 mt-1"
            >
              {t('pricingCalc.recommendation.upgradeHint', 'Sugerimos upgrade a {{tier}} — más barato que pagar overage.', {
                tier: upgradeHint,
              })}
            </p>
          )}
        </div>

        {/* Current cost */}
        <div
          data-testid="pricing-calculator-current-cost"
          className="bg-elevated rounded-xl border border-default-token/50 p-5 space-y-2"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold text-primary-token">
            <Wallet className="w-4 h-4 text-[#4db6ac]" />
            {t('pricingCalc.current.title', 'Costo mensual estimado (tier actual)')}
          </h2>
          {currentTierCost ? (
            <p className="text-3xl font-black text-primary-token">
              {formatCurrency(currentTierCost.totalClp, 'CLP')}
            </p>
          ) : (
            <p className="text-sm text-rose-600 dark:text-rose-400 font-semibold">
              {t('pricingCalc.current.overCapacity', 'Tier actual excede capacidad — upgrade obligatorio.')}
            </p>
          )}
          <p className="text-xs text-muted-token">
            {t('pricingCalc.current.note', 'Incluye overage de trabajadores/proyectos si aplica.')}
          </p>
        </div>
      </section>

      {/* COMPARATIVA TIERS ──────────────────────────────────────────── */}
      <section
        data-testid="pricing-calculator-tier-table"
        className="bg-elevated rounded-xl border border-default-token/50 p-5"
      >
        <h2 className="flex items-center gap-2 text-sm font-bold text-primary-token mb-3">
          <Wallet className="w-4 h-4 text-[#4db6ac]" />
          {t('pricingCalc.compare.title', 'Costo mensual por tier')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-token">
              <tr className="border-b border-default-token">
                <th className="text-left py-2 pr-2">{t('pricingCalc.compare.tier', 'Tier')}</th>
                <th className="text-right py-2 pr-2">{t('pricingCalc.compare.workers', 'Tope trabajadores')}</th>
                <th className="text-right py-2 pr-2">{t('pricingCalc.compare.projects', 'Tope proyectos')}</th>
                <th className="text-right py-2 pr-2">{t('pricingCalc.compare.cost', 'Costo / mes')}</th>
              </tr>
            </thead>
            <tbody>
              {monthlyCostByTier.map(({ tier, cost }) => (
                <tr
                  key={tier.id}
                  data-testid={`pc-tier-row-${tier.id}`}
                  className={`border-b border-slate-100 dark:border-slate-800 ${
                    tier.id === recommendedTier.id
                      ? 'bg-[#4db6ac]/5 font-semibold'
                      : ''
                  }`}
                >
                  <td className="py-1.5 pr-2 text-primary-token">{tier.nombre}</td>
                  <td className="py-1.5 pr-2 text-right text-secondary-token">
                    {Number.isFinite(tier.trabajadoresMax) ? tier.trabajadoresMax : '∞'}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-secondary-token">
                    {Number.isFinite(tier.proyectosMax) ? tier.proyectosMax : '∞'}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-primary-token">
                    {cost
                      ? formatCurrency(cost.totalClp, 'CLP')
                      : t('pricingCalc.compare.overCapacity', '— excede')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ROI ─────────────────────────────────────────────────────────── */}
      <section
        data-testid="pricing-calculator-roi"
        className="bg-elevated rounded-xl border border-default-token/50 p-5 space-y-4"
      >
        <h2 className="flex items-center gap-2 text-sm font-bold text-primary-token">
          <TrendingUp className="w-4 h-4 text-[#4db6ac]" />
          {t('pricingCalc.roi.title', 'Simulador ROI — Incidentes evitados')}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[11px] font-medium text-secondary-token mb-1">
              {t('pricingCalc.roi.baseline', 'Incidentes / año (baseline)')}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={baselineIncidents}
              onChange={(e) => setBaselineIncidents(Number(e.target.value) || 0)}
              data-testid="pc-roi-baseline"
              className="w-full bg-elevated border border-default-token rounded-lg px-2 py-1.5 text-xs text-primary-token"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-secondary-token mb-1">
              {t('pricingCalc.roi.current', 'Incidentes / año (con programa)')}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={currentIncidents}
              onChange={(e) => setCurrentIncidents(Number(e.target.value) || 0)}
              data-testid="pc-roi-current"
              className="w-full bg-elevated border border-default-token rounded-lg px-2 py-1.5 text-xs text-primary-token"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-secondary-token mb-1">
              {t('pricingCalc.roi.avgCost', 'Costo promedio / incidente (CLP)')}
            </span>
            <input
              type="number"
              min={0}
              step={50_000}
              value={avgIncidentCost}
              onChange={(e) => setAvgIncidentCost(Number(e.target.value) || 0)}
              data-testid="pc-roi-cost"
              className="w-full bg-elevated border border-default-token rounded-lg px-2 py-1.5 text-xs text-primary-token"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-[11px] text-muted-token">
              {t('pricingCalc.roi.avoided', 'Incidentes evitados / año')}
            </p>
            <p data-testid="pc-roi-avoided" className="font-bold text-primary-token">
              {roi.incidentsAvoidedPerYear}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-token">
              {t('pricingCalc.roi.totalSavings', 'Ahorro total / año')}
            </p>
            <p className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(roi.totalSavingsClp, 'CLP')}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-token">{t('pricingCalc.roi.roi', 'ROI')}</p>
            <p data-testid="pc-roi-percent" className="font-bold text-primary-token">
              {Number.isFinite(roi.roiPercent) ? `${roi.roiPercent}%` : '∞'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-token">
              {t('pricingCalc.roi.payback', 'Payback')}
            </p>
            <p data-testid="pc-roi-payback" className="font-bold text-primary-token">
              {Number.isFinite(roi.paybackMonths)
                ? `${roi.paybackMonths} ${t('pricingCalc.roi.months', 'meses')}`
                : t('pricingCalc.roi.notRecoverable', 'No recuperable')}
            </p>
          </div>
        </div>

        {roi.notes.length > 0 && (
          <ul className="text-[11px] text-muted-token space-y-0.5 list-disc list-inside">
            {roi.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      {/* ROI SCENARIO COMPARATOR (server-computed) ──────────────────────
          Renderiza el resultado de compareRoiScenarios() — POST
          /api/sprint-k/:projectId/roi-scenario/compare. Los escenarios
          se derivan de los inputs reales de la calculadora (workers,
          incidentes baseline/actual, costo/incidente, EPP por industria),
          no de datos inventados. Sin proyecto activo → empty-state honesto. */}
      <section
        data-testid="pricing-calculator-scenario"
        className="bg-elevated rounded-xl border border-default-token/50 p-5 space-y-4"
      >
        <h2 className="flex items-center gap-2 text-sm font-bold text-primary-token">
          <BarChart3 className="w-4 h-4 text-[#4db6ac]" />
          {t('pricingCalc.scenario.title', 'Comparador de escenarios ROI')}
        </h2>

        {hasScenarioComparison ? (
          <>
            <p className="text-xs text-muted-token">
              {t(
                'pricingCalc.scenario.subtitle',
                'Escenario derivado de tus inputs (proyecto activo {{project}}), calculado en el servidor.',
                { project: selectedProject?.name ?? selectedProject?.id ?? '' },
              )}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-token">
                  <tr className="border-b border-default-token">
                    <th className="text-left py-2 pr-2">
                      {t('pricingCalc.scenario.colScenario', 'Escenario')}
                    </th>
                    <th className="text-right py-2 pr-2">
                      {t('pricingCalc.scenario.colInvestment', 'Inversión anual')}
                    </th>
                    <th className="text-right py-2 pr-2">
                      {t('pricingCalc.scenario.colSavings', 'Ahorro proyectado')}
                    </th>
                    <th className="text-right py-2 pr-2">
                      {t('pricingCalc.scenario.colRoi', 'ROI proyectado')}
                    </th>
                    <th className="text-right py-2 pr-2">
                      {t('pricingCalc.scenario.colPayback', 'Payback')}
                    </th>
                    <th className="text-right py-2 pr-2">
                      {t('pricingCalc.scenario.colScore', 'Score')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioOutcomes.map((o) => {
                    const isRecommended = o.scenarioId === recommendedScenarioId;
                    return (
                      <Fragment key={o.scenarioId}>
                      <tr
                        data-testid={`pc-scenario-row-${o.scenarioId}`}
                        className={
                          isRecommended ? 'bg-[#4db6ac]/5 font-semibold' : ''
                        }
                      >
                        <td className="py-1.5 pr-2 text-primary-token">
                          {o.scenarioName}
                          {isRecommended && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-[#4db6ac]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4db6ac]">
                              {t('pricingCalc.scenario.recommended', 'Recomendado')}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-secondary-token">
                          {formatCurrency(o.totalInvestmentClp, 'CLP')}
                        </td>
                        <td
                          data-testid={`pc-scenario-savings-${o.scenarioId}`}
                          className="py-1.5 pr-2 text-right text-emerald-600 dark:text-emerald-400"
                        >
                          {formatCurrency(o.projectedSavingsClp, 'CLP')}
                        </td>
                        <td
                          data-testid={`pc-scenario-roi-${o.scenarioId}`}
                          className="py-1.5 pr-2 text-right text-primary-token"
                        >
                          {formatRoiPercent(o.projectedRoiPercent)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-secondary-token">
                          {formatPayback(
                            o.paybackMonths,
                            t('pricingCalc.roi.months', 'meses'),
                            t('pricingCalc.roi.notRecoverable', 'No recuperable'),
                          )}
                        </td>
                        <td
                          data-testid={`pc-scenario-score-${o.scenarioId}`}
                          className="py-1.5 pr-2 text-right font-bold text-primary-token"
                        >
                          {o.recommendationScore}/100
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td
                          colSpan={6}
                          data-testid={`pc-scenario-sensitivity-${o.scenarioId}`}
                          className="pb-2 pr-2 text-[10px] text-slate-400 dark:text-slate-500"
                        >
                          {t(
                            'pricingCalc.scenario.sensitivity',
                            'Banda de sensibilidad ±20%: {{low}}% a {{high}}%',
                            {
                              low: formatRoiPercent(o.sensitivityBand.roiLowerBound).replace('%', ''),
                              high: formatRoiPercent(o.sensitivityBand.roiUpperBound).replace('%', ''),
                            },
                          )}
                        </td>
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {scenarioRationale.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-secondary-token">
                  {t('pricingCalc.scenario.rationaleTitle', 'Análisis comparativo')}
                </p>
                <ul
                  data-testid="pc-scenario-rationale"
                  className="text-[11px] text-muted-token space-y-0.5 list-disc list-inside"
                >
                  {scenarioRationale.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p
            data-testid="pc-scenario-empty"
            className="text-xs text-muted-token"
          >
            {t(
              'pricingCalc.scenario.empty',
              'Selecciona un proyecto activo para comparar escenarios ROI en el servidor.',
            )}
          </p>
        )}
      </section>

      {/* EPP BUDGET ──────────────────────────────────────────────────── */}
      <section
        data-testid="pricing-calculator-epp"
        className="bg-elevated rounded-xl border border-default-token/50 p-5 space-y-3"
      >
        <h2 className="flex items-center gap-2 text-sm font-bold text-primary-token">
          <HardHat className="w-4 h-4 text-[#4db6ac]" />
          {t('pricingCalc.epp.title', 'Presupuesto EPP estimado')}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[11px] text-muted-token">
              {t('pricingCalc.epp.monthly', 'Mensual ({{n}} trabajadores)', { n: workers })}
            </p>
            <p data-testid="pc-epp-monthly" className="font-bold text-primary-token">
              {formatCurrency(eppBudget.totalClp, 'CLP')}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-token">
              {t('pricingCalc.epp.annual', 'Anualizado')}
            </p>
            <p className="font-bold text-primary-token">
              {formatCurrency(eppBudget.totalClp * 12, 'CLP')}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-token">
              {t('pricingCalc.epp.perWorker', 'Por trabajador / mes')}
            </p>
            <p className="font-bold text-primary-token">
              {formatCurrency(eppBudget.perWorkerClp, 'CLP')}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-muted-token flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {t(
            'pricingCalc.epp.disclaimer',
            'Catálogo y precios indicativos por DS 594. Para cotización real consulta proveedor.',
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/oc-sugerida"
            data-testid="pc-link-oc"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#4db6ac] hover:underline"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            {t('pricingCalc.epp.viewOc', 'Ver OC sugerida con detalle por ítem')}
          </Link>
        </div>
      </section>

      {/* ACTIONS ─────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={onGeneratePurchaseOrder}
          data-testid="pc-generate-oc"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#4db6ac] hover:bg-[#3aa399] text-white text-sm font-semibold rounded-lg min-h-11"
        >
          <Download className="w-4 h-4" />
          {t('pricingCalc.actions.generateOc', 'Generar Orden de Compra (.pdf)')}
        </button>
        <button
          type="button"
          onClick={onDownloadOcJson}
          data-testid="pc-download-oc-json"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-secondary-token text-sm font-medium rounded-lg min-h-11 border border-default-token"
        >
          <Download className="w-4 h-4" />
          {t('pricingCalc.actions.downloadJson', 'Descargar JSON (integraciones)')}
        </button>
        <span className="text-[11px] text-muted-token self-center">
          {t(
            'pricingCalc.actions.note',
            'El PDF es sugerido — para emisión formal de OC contactar a contacto@praeventio.net.',
          )}
        </span>
      </section>
    </div>
  );
};

export default PricingCalculator;
