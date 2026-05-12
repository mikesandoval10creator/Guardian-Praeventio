// Praeventio Guard — Sprint K: Reporte Mensual Cliente + Alertas Reputacionales.
//
// Cierra: Documento usuario "§119-120"
//
// Cada mes, generar reporte ejecutivo para el cliente mandante con:
//   - Indicadores clave (incidentes, acciones, compliance, capacitación)
//   - Alertas reputacionales si hubo SIF precursor o evento crítico
//   - Tendencias respecto al mes anterior
//   - Lista de SLA cumplidos / no cumplidos
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface MonthlyInputs {
  projectId: string;
  periodLabel: string; // ej: "2026-04"
  totalIncidents: number;
  criticalIncidents: number;
  totalActions: number;
  closedActions: number;
  trainingHoursCompleted: number;
  workersActive: number;
  complianceScore: number; // 0-100
  /** SIF precursors registrados en el período. */
  sifPrecursors: number;
  /** SLAs comprometidos al cliente. */
  slaCommitments: Array<{ name: string; target: number; achieved: number }>;
  // Periodo previo
  prevPeriod?: {
    totalIncidents: number;
    complianceScore: number;
    closedActions: number;
  };
}

export interface MonthlyClientReport {
  projectId: string;
  periodLabel: string;
  kpis: Array<{ name: string; value: string; trend?: 'up' | 'down' | 'flat' }>;
  reputationalAlerts: Array<{ severity: 'info' | 'warn' | 'urgent'; message: string }>;
  slaCompliance: Array<{ name: string; achieved: number; target: number; status: 'met' | 'at_risk' | 'missed' }>;
  /** Mensaje ejecutivo de 2-3 líneas. */
  executiveSummary: string;
}

// ────────────────────────────────────────────────────────────────────────
// Builder
// ────────────────────────────────────────────────────────────────────────

function trendOf(current: number, previous: number, lowerIsBetter: boolean): 'up' | 'down' | 'flat' {
  if (current === previous) return 'flat';
  const isUp = current > previous;
  if (lowerIsBetter) return isUp ? 'down' : 'up'; // contraintuitivo: para incidentes, mayor=peor → trend negativo
  return isUp ? 'up' : 'down';
}

export function buildMonthlyClientReport(inputs: MonthlyInputs): MonthlyClientReport {
  const closurePercent =
    inputs.totalActions > 0
      ? Math.round((inputs.closedActions / inputs.totalActions) * 100)
      : 100;
  const trainingPerWorker =
    inputs.workersActive > 0
      ? Math.round((inputs.trainingHoursCompleted / inputs.workersActive) * 10) / 10
      : 0;

  const kpis: MonthlyClientReport['kpis'] = [
    {
      name: 'Compliance Score',
      value: `${inputs.complianceScore}/100`,
      trend: inputs.prevPeriod
        ? trendOf(inputs.complianceScore, inputs.prevPeriod.complianceScore, false)
        : undefined,
    },
    {
      name: 'Incidentes totales / Críticos',
      value: `${inputs.totalIncidents} / ${inputs.criticalIncidents}`,
      trend: inputs.prevPeriod
        ? trendOf(inputs.totalIncidents, inputs.prevPeriod.totalIncidents, true)
        : undefined,
    },
    {
      name: 'Acciones cerradas',
      value: `${inputs.closedActions} / ${inputs.totalActions} (${closurePercent}%)`,
      trend: inputs.prevPeriod
        ? trendOf(inputs.closedActions, inputs.prevPeriod.closedActions, false)
        : undefined,
    },
    {
      name: 'Capacitación promedio',
      value: `${trainingPerWorker}h / trabajador`,
    },
  ];

  const reputationalAlerts: MonthlyClientReport['reputationalAlerts'] = [];
  if (inputs.criticalIncidents > 0) {
    reputationalAlerts.push({
      severity: 'urgent',
      message: `${inputs.criticalIncidents} incidente(s) crítico(s) — riesgo reputacional alto.`,
    });
  }
  if (inputs.sifPrecursors > 0) {
    reputationalAlerts.push({
      severity: 'urgent',
      message: `${inputs.sifPrecursors} precursor(es) SIF detectado(s) — revisión ejecutiva obligatoria.`,
    });
  }
  if (closurePercent < 70 && inputs.totalActions > 5) {
    reputationalAlerts.push({
      severity: 'warn',
      message: `Solo ${closurePercent}% de acciones cerradas. Backlog acumulado.`,
    });
  }

  const slaCompliance: MonthlyClientReport['slaCompliance'] = inputs.slaCommitments.map((s) => {
    let status: 'met' | 'at_risk' | 'missed';
    if (s.achieved >= s.target) status = 'met';
    else if (s.achieved >= s.target * 0.85) status = 'at_risk';
    else status = 'missed';
    return { name: s.name, achieved: s.achieved, target: s.target, status };
  });

  const slaMet = slaCompliance.filter((s) => s.status === 'met').length;
  const executiveSummary = `Mes ${inputs.periodLabel}: ${inputs.totalIncidents} incidentes (${inputs.criticalIncidents} críticos), ${closurePercent}% acciones cerradas, score ${inputs.complianceScore}/100. ${slaMet}/${slaCompliance.length} SLA cumplidos.`;

  return {
    projectId: inputs.projectId,
    periodLabel: inputs.periodLabel,
    kpis,
    reputationalAlerts,
    slaCompliance,
    executiveSummary,
  };
}
