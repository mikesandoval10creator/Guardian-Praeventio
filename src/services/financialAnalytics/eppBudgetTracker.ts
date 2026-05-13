// Praeventio Guard — Sprint 51 §176: EPP Budget Tracker.
//
// Cierra: Documento usuario "2da tanda recomendaciones §176".
//
// Calcula presupuesto EPP esperado por período (basado en composición de
// roles y vida útil del equipo) vs gasto real. Alerta cuando hay
// sobrepaso o cuando hay items con reemplazo vencido.
//
// Determinístico, sin LLM ni I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type EppKind =
  | 'helmet'
  | 'gloves'
  | 'boots'
  | 'harness'
  | 'mask'
  | 'glasses'
  | 'vest'
  | 'other';

export interface EppItem {
  id: string;
  kind: EppKind;
  unitCostClp: number;
  /** Vida útil esperada en meses (cuándo debería reemplazarse). */
  expectedLifeMonths: number;
}

export interface EppItemUsage {
  itemId: string;
  /** Fecha en la que se entregó / instaló el ítem (ISO). */
  issuedAt: string;
}

export interface BudgetPeriodInput {
  /** Inicio del período (ISO date). */
  periodFrom: string;
  /** Fin del período (ISO date). */
  periodTo: string;
  /** Cantidad total de trabajadores en el período. */
  workersCount: number;
  /** EPP requerido por rol. Key=rol, value=lista de EPP requeridos. */
  eppRequiredByRole: Record<string, EppItem[]>;
  /** Distribución de trabajadores por rol (counts). */
  workersByRole?: Record<string, number>;
  /** Items actualmente en uso, para detectar reemplazo vencido. */
  itemsInUse?: EppItemUsage[];
  /** Catálogo de items para resolver itemId → expectedLifeMonths. */
  itemCatalog?: EppItem[];
  /** Gasto real efectuado en el período. */
  actualSpentClp: number;
}

export interface BudgetReport {
  /** Gasto esperado para mantener todos los trabajadores con EPP vigente. */
  expectedSpendClp: number;
  actualSpentClp: number;
  /** actual - expected. Positivo = sobregasto. */
  varianceClp: number;
  /** variance / expected * 100. */
  variancePct: number;
  verdict:
    | 'under_budget'
    | 'on_budget'
    | 'over_budget'
    | 'critical_overspend';
  /** Items cuya vida útil ya expiró y deberían reemplazarse. */
  itemsOverdueReplacement: number;
  notes: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  if (to.getTime() <= from.getTime()) return 0;

  // Diferencia en meses calendario + fracción del mes parcial.
  const fullMonths =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  // Ajusta por días del mes parcial.
  const dayDelta = to.getUTCDate() - from.getUTCDate();
  // Largo del mes de `to` (para normalizar la fracción).
  const monthLen = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const fractional = dayDelta / monthLen;
  const result = fullMonths + fractional;
  return Math.max(0, result);
}

function computeExpectedSpend(input: BudgetPeriodInput): number {
  const periodMonths = monthsBetween(input.periodFrom, input.periodTo);
  if (periodMonths === 0) return 0;

  // Si hay distribución por rol, calcula por rol.
  const distribution = input.workersByRole;
  let total = 0;

  if (distribution) {
    for (const [role, count] of Object.entries(distribution)) {
      const required = input.eppRequiredByRole[role] ?? [];
      for (const item of required) {
        if (item.expectedLifeMonths <= 0) continue;
        const replacementsPerPeriod = periodMonths / item.expectedLifeMonths;
        total += count * item.unitCostClp * replacementsPerPeriod;
      }
    }
  } else {
    // Fallback: aplica el primer rol disponible a todos los trabajadores.
    const firstRole = Object.keys(input.eppRequiredByRole)[0];
    const required = firstRole
      ? (input.eppRequiredByRole[firstRole] ?? [])
      : [];
    for (const item of required) {
      if (item.expectedLifeMonths <= 0) continue;
      const replacementsPerPeriod = periodMonths / item.expectedLifeMonths;
      total += input.workersCount * item.unitCostClp * replacementsPerPeriod;
    }
  }

  return Math.round(total);
}

function countOverdueItems(input: BudgetPeriodInput): number {
  const usage = input.itemsInUse;
  const catalog = input.itemCatalog;
  if (!usage || !catalog) return 0;

  const lookup = new Map<string, EppItem>();
  for (const item of catalog) lookup.set(item.id, item);

  const periodEnd = new Date(input.periodTo);
  let overdue = 0;

  for (const usageEntry of usage) {
    const item = lookup.get(usageEntry.itemId);
    if (!item) continue;
    const issued = new Date(usageEntry.issuedAt);
    if (Number.isNaN(issued.getTime())) continue;
    const ageMonths = monthsBetween(usageEntry.issuedAt, input.periodTo);
    if (
      issued.getTime() <= periodEnd.getTime() &&
      ageMonths > item.expectedLifeMonths
    ) {
      overdue += 1;
    }
  }

  return overdue;
}

function classifyVerdict(variancePct: number): BudgetReport['verdict'] {
  if (variancePct < -5) return 'under_budget';
  if (variancePct <= 5) return 'on_budget';
  if (variancePct <= 20) return 'over_budget';
  return 'critical_overspend';
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

export function trackEppBudget(input: BudgetPeriodInput): BudgetReport {
  const notes: string[] = [];

  if (input.workersCount <= 0) {
    notes.push('workersCount<=0 → expectedSpendClp=0.');
  }

  const expectedSpendClp =
    input.workersCount <= 0 ? 0 : computeExpectedSpend(input);
  const varianceClp = input.actualSpentClp - expectedSpendClp;
  const variancePct =
    expectedSpendClp === 0
      ? input.actualSpentClp > 0
        ? 100
        : 0
      : (varianceClp / expectedSpendClp) * 100;

  const itemsOverdueReplacement = countOverdueItems(input);
  if (itemsOverdueReplacement > 0) {
    notes.push(
      `${itemsOverdueReplacement} ítem(s) con reemplazo vencido — riesgo legal.`,
    );
  }

  const verdict = classifyVerdict(variancePct);
  if (verdict === 'critical_overspend') {
    notes.push('Sobregasto crítico >20% — revisar adjudicaciones recientes.');
  }

  return {
    expectedSpendClp,
    actualSpentClp: input.actualSpentClp,
    varianceClp,
    variancePct: Math.round(variancePct * 10) / 10,
    verdict,
    itemsOverdueReplacement,
    notes,
  };
}
