// Praeventio Guard — Sprint K §171-179: EPP catalog per industry.
//
// Tabla determinística de EPP recomendado por sector (prefijo industria),
// con unitario CLP y vida útil aproximada en meses.
//
// Fuentes referenciales (no exclusivas):
//   - DS 594 Art. 53 (EPP mínimo)
//   - Catálogo Mutual de Seguridad / ACHS (precios proveedor 2024-2025)
//   - DS 132 (minería), DS 76 (construcción), DS 78 (agricultura)
//
// Esta tabla es indicativa y conservadora — sirve para sugerir presupuesto
// y orden de compra. NO reemplaza cotización real con proveedores.
//
// Determinístico, sin LLM ni I/O.

export interface EppCatalogItem {
  /** EPP kind canonical (alineado con EppKind de eppBudgetTracker). */
  kind:
    | 'helmet'
    | 'gloves'
    | 'boots'
    | 'harness'
    | 'mask'
    | 'glasses'
    | 'vest'
    | 'other';
  label: string;
  /** Costo unitario referencial CLP. */
  unitCostClp: number;
  /** Vida útil esperada en meses. */
  expectedLifeMonths: number;
  /** Cantidad recomendada por trabajador (típicamente 1, a veces 2). */
  perWorker: number;
}

const HELMET = (cost: number, life = 18): EppCatalogItem => ({
  kind: 'helmet',
  label: 'Casco',
  unitCostClp: cost,
  expectedLifeMonths: life,
  perWorker: 1,
});
const GLOVES = (cost: number, life = 3, perWorker = 2): EppCatalogItem => ({
  kind: 'gloves',
  label: 'Guantes',
  unitCostClp: cost,
  expectedLifeMonths: life,
  perWorker,
});
const BOOTS = (cost: number, life = 12): EppCatalogItem => ({
  kind: 'boots',
  label: 'Botas de seguridad',
  unitCostClp: cost,
  expectedLifeMonths: life,
  perWorker: 1,
});
const VEST = (cost: number, life = 12): EppCatalogItem => ({
  kind: 'vest',
  label: 'Chaleco reflectante',
  unitCostClp: cost,
  expectedLifeMonths: life,
  perWorker: 1,
});
const GLASSES = (cost: number, life = 12): EppCatalogItem => ({
  kind: 'glasses',
  label: 'Lentes de seguridad',
  unitCostClp: cost,
  expectedLifeMonths: life,
  perWorker: 1,
});
const MASK = (cost: number, life = 1, perWorker = 1): EppCatalogItem => ({
  kind: 'mask',
  label: 'Mascarilla / respirador',
  unitCostClp: cost,
  expectedLifeMonths: life,
  perWorker,
});
const HARNESS = (cost: number, life = 24): EppCatalogItem => ({
  kind: 'harness',
  label: 'Arnés de seguridad',
  unitCostClp: cost,
  expectedLifeMonths: life,
  perWorker: 1,
});

// ────────────────────────────────────────────────────────────────────────
// Catálogo por industria (prefijo INDUSTRY_SECTORS / EPP_BY_SECTOR)
// ────────────────────────────────────────────────────────────────────────

export const EPP_INDUSTRY_CATALOG: Record<string, EppCatalogItem[]> = {
  'GP-MIN': [
    HELMET(25000, 18),
    GLOVES(8000, 3),
    BOOTS(55000, 12),
    MASK(35000, 1, 4), // respirador gases — alto recambio
    GLASSES(12000, 12),
    {
      kind: 'other',
      label: 'Protector auditivo',
      unitCostClp: 6000,
      expectedLifeMonths: 6,
      perWorker: 1,
    },
  ],
  'GP-CONS': [
    HELMET(18000, 18),
    GLOVES(6000, 3),
    BOOTS(45000, 12),
    HARNESS(85000, 24),
    GLASSES(10000, 12),
    VEST(15000, 12),
  ],
  'GP-AGR': [
    HELMET(12000, 18),
    GLOVES(5000, 3),
    BOOTS(38000, 12),
    MASK(15000, 1, 6), // respirador agroquímicos
    GLASSES(8000, 12),
    {
      kind: 'other',
      label: 'Traje impermeable',
      unitCostClp: 28000,
      expectedLifeMonths: 12,
      perWorker: 1,
    },
  ],
  'GP-TRANS': [
    HELMET(15000, 18),
    GLOVES(5000, 4),
    BOOTS(40000, 12),
    VEST(12000, 12),
    {
      kind: 'other',
      label: 'Protector auditivo',
      unitCostClp: 6000,
      expectedLifeMonths: 6,
      perWorker: 1,
    },
  ],
  'GP-SAL': [
    GLOVES(2500, 0.25, 24), // látex un solo uso, 24/mes
    MASK(800, 0.25, 24), // mascarilla quirúrgica diaria
    {
      kind: 'mask',
      label: 'Respirador N95',
      unitCostClp: 4500,
      expectedLifeMonths: 1,
      perWorker: 4,
    },
    GLASSES(8000, 12),
    {
      kind: 'other',
      label: 'Bata desechable',
      unitCostClp: 3500,
      expectedLifeMonths: 1,
      perWorker: 8,
    },
  ],
  'GP-MANU': [
    HELMET(15000, 18),
    GLOVES(5500, 3),
    BOOTS(42000, 12),
    GLASSES(9000, 12),
    {
      kind: 'other',
      label: 'Protector auditivo',
      unitCostClp: 6000,
      expectedLifeMonths: 6,
      perWorker: 1,
    },
    VEST(13000, 12),
  ],
  'GP-ELEC': [
    {
      kind: 'helmet',
      label: 'Casco dieléctrico',
      unitCostClp: 38000,
      expectedLifeMonths: 18,
      perWorker: 1,
    },
    {
      kind: 'gloves',
      label: 'Guantes aislantes',
      unitCostClp: 65000,
      expectedLifeMonths: 12,
      perWorker: 2,
    },
    {
      kind: 'boots',
      label: 'Botas dieléctricas',
      unitCostClp: 75000,
      expectedLifeMonths: 12,
      perWorker: 1,
    },
    GLASSES(15000, 12),
    {
      kind: 'other',
      label: 'Traje arco eléctrico',
      unitCostClp: 220000,
      expectedLifeMonths: 36,
      perWorker: 1,
    },
  ],
  'GP-ENERG': [
    HELMET(20000, 18),
    GLOVES(8000, 3),
    BOOTS(50000, 12),
    MASK(20000, 1, 4),
    {
      kind: 'other',
      label: 'Traje protección química',
      unitCostClp: 65000,
      expectedLifeMonths: 24,
      perWorker: 1,
    },
  ],
  'GP-COM': [
    BOOTS(28000, 12),
    GLOVES(4000, 6),
    VEST(10000, 12),
  ],
  'GP-ALOJA': [
    GLOVES(3500, 1),
    MASK(800, 0.25, 24),
    {
      kind: 'other',
      label: 'Calzado antideslizante',
      unitCostClp: 32000,
      expectedLifeMonths: 12,
      perWorker: 1,
    },
    {
      kind: 'vest',
      label: 'Delantal',
      unitCostClp: 8000,
      expectedLifeMonths: 12,
      perWorker: 1,
    },
  ],
  'GP-ADM-SEG': [
    VEST(12000, 12),
    BOOTS(38000, 12),
    GLOVES(5000, 6),
    {
      kind: 'other',
      label: 'Linterna recargable',
      unitCostClp: 22000,
      expectedLifeMonths: 36,
      perWorker: 1,
    },
  ],
};

// EPP default cuando la industria no está mapeada.
export const EPP_DEFAULT_CATALOG: EppCatalogItem[] = [
  HELMET(15000, 18),
  GLOVES(5000, 4),
  BOOTS(38000, 12),
  GLASSES(9000, 12),
];

/**
 * Devuelve el catálogo EPP recomendado para una industria. Cae al default
 * si el prefijo no está en la tabla.
 */
export function getEppCatalogForIndustry(industryPrefix: string | undefined | null): EppCatalogItem[] {
  if (!industryPrefix) return EPP_DEFAULT_CATALOG;
  return EPP_INDUSTRY_CATALOG[industryPrefix] ?? EPP_DEFAULT_CATALOG;
}

/**
 * Calcula el presupuesto mensual EPP en CLP para una industria dada y un
 * head-count de trabajadores. El cálculo asume reposición proporcional
 * a la vida útil (1/expectedLifeMonths por mes).
 */
export function estimateMonthlyEppBudgetClp(
  industryPrefix: string | undefined | null,
  workerCount: number,
): { totalClp: number; perWorkerClp: number; itemsCount: number } {
  if (workerCount <= 0) {
    return { totalClp: 0, perWorkerClp: 0, itemsCount: 0 };
  }
  const catalog = getEppCatalogForIndustry(industryPrefix);
  const perWorkerMonthly = catalog.reduce((acc, item) => {
    if (item.expectedLifeMonths <= 0) return acc;
    // Costo mensual prorrateado por item: unit × qtyPerWorker / vidaUtil(m).
    return acc + (item.unitCostClp * item.perWorker) / item.expectedLifeMonths;
  }, 0);
  const totalClp = Math.round(perWorkerMonthly * workerCount);
  return {
    totalClp,
    perWorkerClp: Math.round(perWorkerMonthly),
    itemsCount: catalog.length,
  };
}

/**
 * Catálogo de industrias soportadas en el calculador (prefijo + label).
 */
export interface IndustryOption {
  prefix: string;
  label: string;
}

export const SUPPORTED_INDUSTRY_OPTIONS: IndustryOption[] = [
  { prefix: 'GP-MIN', label: 'Minería' },
  { prefix: 'GP-CONS', label: 'Construcción' },
  { prefix: 'GP-AGR', label: 'Agricultura' },
  { prefix: 'GP-TRANS', label: 'Transporte' },
  { prefix: 'GP-SAL', label: 'Salud' },
  { prefix: 'GP-MANU', label: 'Manufactura' },
  { prefix: 'GP-ELEC', label: 'Eléctrico' },
  { prefix: 'GP-ENERG', label: 'Energía / Químico' },
  { prefix: 'GP-COM', label: 'Comercio' },
  { prefix: 'GP-ALOJA', label: 'Alojamiento / Hospitalidad' },
  { prefix: 'GP-ADM-SEG', label: 'Seguridad / Vigilancia' },
];
