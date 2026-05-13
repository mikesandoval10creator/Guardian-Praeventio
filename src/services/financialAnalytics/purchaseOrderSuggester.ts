// Praeventio Guard — Sprint 51 §177: Purchase Order Suggester.
//
// Cierra: Documento usuario "2da tanda recomendaciones §177".
//
// Sugiere órdenes de compra de EPP/insumos basadas en:
//   - Stock actual vs umbral de reorden
//   - Consumo proyectado mensual
//   - Catálogo de proveedores (con costo unitario)
//   - Lead time del proveedor (afecta urgencia + semana de entrega)
//
// Determinístico, sin LLM ni I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface InventoryItem {
  kind: string;
  currentStock: number;
  reorderThreshold: number;
  /** Consumo esperado por mes (unidades). */
  expectedConsumptionPerMonth: number;
  preferredSupplierId?: string;
}

export interface SupplierCatalogEntry {
  supplierId: string;
  kind: string;
  unitCostClp: number;
}

export type Urgency = 'routine' | 'urgent' | 'emergency';

export interface PurchaseOrderLine {
  kind: string;
  quantity: number;
  estimatedUnitCostClp: number;
  supplierId: string;
  urgency: Urgency;
}

export interface PurchaseOrderDraft {
  lines: PurchaseOrderLine[];
  totalClp: number;
  /** Semana en la que se espera tener todo el pedido entregado. */
  deliveryWeekHint: number;
  notes: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

/** Stock objetivo: cubrir ~2 meses de consumo. */
const TARGET_COVERAGE_MONTHS = 2;

function classifyUrgency(item: InventoryItem): Urgency {
  if (item.currentStock <= 0) return 'emergency';
  const ratio =
    item.reorderThreshold > 0 ? item.currentStock / item.reorderThreshold : 1;
  if (ratio < 0.5) return 'urgent';
  return 'routine';
}

function pickSupplier(
  item: InventoryItem,
  catalog: SupplierCatalogEntry[],
): SupplierCatalogEntry | null {
  const candidates = catalog.filter((c) => c.kind === item.kind);
  if (candidates.length === 0) return null;

  if (item.preferredSupplierId) {
    const preferred = candidates.find(
      (c) => c.supplierId === item.preferredSupplierId,
    );
    if (preferred) return preferred;
  }

  // Sin preferido → más barato.
  return candidates.reduce((best, current) =>
    current.unitCostClp < best.unitCostClp ? current : best,
  );
}

function leadTimeToWeeks(leadDays: number): number {
  if (leadDays <= 0) return 1;
  return Math.ceil(leadDays / 7);
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

export function suggestPurchaseOrder(
  inventory: InventoryItem[],
  supplierCatalog: SupplierCatalogEntry[],
  leadTimeDaysBySupplier: Record<string, number>,
): PurchaseOrderDraft {
  const lines: PurchaseOrderLine[] = [];
  const notes: string[] = [];
  let maxLeadWeeks = 1;

  for (const item of inventory) {
    // Solo recomienda si está en o por debajo del umbral.
    if (item.currentStock > item.reorderThreshold) continue;

    const supplier = pickSupplier(item, supplierCatalog);
    if (!supplier) {
      notes.push(
        `Sin proveedor en catálogo para "${item.kind}" — revisar manualmente.`,
      );
      continue;
    }

    // Cantidad: cubrir el déficit hasta llegar a 2 meses de consumo.
    const targetStock = Math.max(
      item.reorderThreshold,
      Math.ceil(item.expectedConsumptionPerMonth * TARGET_COVERAGE_MONTHS),
    );
    const quantity = Math.max(
      0,
      Math.ceil(targetStock - item.currentStock),
    );
    if (quantity <= 0) continue;

    const urgency = classifyUrgency(item);
    lines.push({
      kind: item.kind,
      quantity,
      estimatedUnitCostClp: supplier.unitCostClp,
      supplierId: supplier.supplierId,
      urgency,
    });

    const leadDays = leadTimeDaysBySupplier[supplier.supplierId] ?? 14;
    const weeks = leadTimeToWeeks(leadDays);
    if (weeks > maxLeadWeeks) maxLeadWeeks = weeks;
  }

  const totalClp = lines.reduce(
    (acc, line) => acc + line.quantity * line.estimatedUnitCostClp,
    0,
  );

  const hasEmergency = lines.some((l) => l.urgency === 'emergency');
  if (hasEmergency) {
    notes.push(
      'Hay ítems en stock 0 (emergency) — escalar a compra inmediata.',
    );
  }

  return {
    lines,
    totalClp,
    deliveryWeekHint: hasEmergency ? 1 : maxLeadWeeks,
    notes,
  };
}
