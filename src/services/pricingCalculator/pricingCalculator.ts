// Praeventio Guard — Sprint K: Pricing calculadora + Simulador + Presupuesto + ROI + OC sugerida.
//
// Cierra: Documento usuario "§171-179"
//
// Calculadora interna que cuantifica para el cliente:
//   - Costo estimado por tier vs uso real (workers + projects)
//   - Simulador de upgrade/downgrade
//   - Overages: cuánto cuesta pasarse del plan
//   - ROI preventivo: costo evitado vs inversión
//   - Presupuesto sugerido en EPP, capacitación, mantención
//   - Orden de compra sugerida basada en demanda real
//
// Determinístico. Sin precios hardcodeados secretos — todo viene de
// `tiers.ts` que ya existe en producción.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface TierPlan {
  id: string;
  monthlyPriceClp: number;
  workerLimit: number;
  projectLimit: number;
  /** Costo por worker adicional (overage). */
  overagePerWorkerClp: number;
  /** Costo por proyecto adicional. */
  overagePerProjectClp: number;
  /** Feature flags incluidas. */
  features: string[];
}

export interface CurrentUsage {
  activeWorkers: number;
  activeProjects: number;
}

// ────────────────────────────────────────────────────────────────────────
// Cost calculator (§172)
// ────────────────────────────────────────────────────────────────────────

export interface TierCostEstimate {
  tierId: string;
  basePriceClp: number;
  workerOverageClp: number;
  projectOverageClp: number;
  totalMonthlyClp: number;
  /** True si usage queda dentro del plan sin overage. */
  fitsInPlan: boolean;
  /** Workers/projects que generan overage. */
  workersOver: number;
  projectsOver: number;
}

export function estimateTierCost(plan: TierPlan, usage: CurrentUsage): TierCostEstimate {
  const workersOver = Math.max(0, usage.activeWorkers - plan.workerLimit);
  const projectsOver = Math.max(0, usage.activeProjects - plan.projectLimit);
  const workerOverageClp = workersOver * plan.overagePerWorkerClp;
  const projectOverageClp = projectsOver * plan.overagePerProjectClp;
  return {
    tierId: plan.id,
    basePriceClp: plan.monthlyPriceClp,
    workerOverageClp,
    projectOverageClp,
    totalMonthlyClp: plan.monthlyPriceClp + workerOverageClp + projectOverageClp,
    fitsInPlan: workersOver === 0 && projectsOver === 0,
    workersOver,
    projectsOver,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tier recommendation (§173 simulador)
// ────────────────────────────────────────────────────────────────────────

export interface TierComparison {
  estimates: TierCostEstimate[];
  /** Tier más barato que SÍ cubre el uso. */
  cheapestFitting?: TierCostEstimate;
  /** Tier más barato sin overage. */
  recommended?: TierCostEstimate;
}

export function compareTiers(plans: TierPlan[], usage: CurrentUsage): TierComparison {
  const estimates = plans.map((p) => estimateTierCost(p, usage)).sort((a, b) => a.totalMonthlyClp - b.totalMonthlyClp);
  const cheapestFitting = estimates.find((e) => e.fitsInPlan);
  const recommended = cheapestFitting ?? estimates[0];
  return { estimates, cheapestFitting, recommended };
}

// ────────────────────────────────────────────────────────────────────────
// ROI calculator (§176-179)
// ────────────────────────────────────────────────────────────────────────

export interface ROIInputs {
  /** Costo medio estimado de UN incidente prevenido (CLP). */
  costPerPreventedIncident: number;
  /** Incidentes prevenidos en el período. */
  preventedIncidents: number;
  /** Costo medio de una multa SUSESO/DT/SEC evitada. */
  costPerAvoidedFine: number;
  finesAvoided: number;
  /** Costo administrativo ahorrado (horas × valor/hora). */
  adminHoursSaved: number;
  adminHourlyRateClp: number;
  /** Costo del plan. */
  monthlyPlanClp: number;
  /** Costos adicionales (EPP, capacitación, etc.). */
  additionalSafetyInvestmentClp: number;
}

export interface ROIReport {
  benefitsClp: number;
  costsClp: number;
  /** Ratio Benefit/Cost. */
  benefitCostRatio: number;
  /** Payback en meses (puede ser Infinity si benefits=0). */
  paybackMonths: number;
  /** Estado humano. */
  level: 'underwater' | 'breakeven' | 'positive' | 'excellent';
  message: string;
}

export function computeROI(inputs: ROIInputs): ROIReport {
  const benefitsClp =
    inputs.preventedIncidents * inputs.costPerPreventedIncident +
    inputs.finesAvoided * inputs.costPerAvoidedFine +
    inputs.adminHoursSaved * inputs.adminHourlyRateClp;
  const costsClp = inputs.monthlyPlanClp + inputs.additionalSafetyInvestmentClp;
  const ratio = costsClp === 0 ? Infinity : benefitsClp / costsClp;
  const paybackMonths = benefitsClp === 0 ? Infinity : costsClp / (benefitsClp / 12);

  let level: ROIReport['level'];
  if (ratio < 1) level = 'underwater';
  else if (ratio < 1.5) level = 'breakeven';
  else if (ratio < 3) level = 'positive';
  else level = 'excellent';

  const message =
    level === 'underwater'
      ? `Inversión negativa actual. Beneficios ${benefitsClp} CLP < costos ${costsClp} CLP.`
      : `Cada $1 invertido devuelve $${ratio.toFixed(2)}. Payback ${paybackMonths === Infinity ? '∞' : paybackMonths.toFixed(1)} meses.`;

  return {
    benefitsClp,
    costsClp,
    benefitCostRatio: Math.round(ratio * 100) / 100,
    paybackMonths: Math.round(paybackMonths * 10) / 10,
    level,
    message,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Purchase order suggestion (§178 OC sugerida)
// ────────────────────────────────────────────────────────────────────────

export interface ConsumableUsage {
  itemId: string;
  itemName: string;
  /** Stock actual. */
  currentStock: number;
  /** Consumo promedio mensual. */
  monthlyConsumption: number;
  /** Stock mínimo de seguridad. */
  safetyStock: number;
  /** Lead time del proveedor (días). */
  leadTimeDays: number;
  unitPriceClp: number;
}

export interface PurchaseSuggestion {
  itemId: string;
  itemName: string;
  /** Días hasta que stock alcanza safety. */
  daysUntilSafety: number;
  /** True si urgente: stock <= safety o lead time < daysUntilSafety. */
  isUrgent: boolean;
  suggestedOrderQty: number;
  suggestedOrderCostClp: number;
}

export function suggestPurchaseOrders(consumables: ConsumableUsage[]): PurchaseSuggestion[] {
  return consumables
    .map((c) => {
      const dailyConsumption = c.monthlyConsumption / 30;
      const stockAboveSafety = c.currentStock - c.safetyStock;
      const daysUntilSafety = dailyConsumption > 0 ? Math.floor(stockAboveSafety / dailyConsumption) : Infinity;
      const isUrgent =
        c.currentStock <= c.safetyStock ||
        (dailyConsumption > 0 && daysUntilSafety <= c.leadTimeDays);
      // Pedido = 2 meses de consumo (estimación canónica)
      const suggestedOrderQty = Math.ceil(c.monthlyConsumption * 2);
      const suggestedOrderCostClp = suggestedOrderQty * c.unitPriceClp;
      return {
        itemId: c.itemId,
        itemName: c.itemName,
        daysUntilSafety: daysUntilSafety === Infinity ? 999 : daysUntilSafety,
        isUrgent,
        suggestedOrderQty,
        suggestedOrderCostClp,
      };
    })
    .sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent) || a.daysUntilSafety - b.daysUntilSafety);
}
