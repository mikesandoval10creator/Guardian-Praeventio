import { describe, it, expect } from 'vitest';
import {
  suggestPurchaseOrder,
  type InventoryItem,
  type SupplierCatalogEntry,
} from './purchaseOrderSuggester.js';

const catalog: SupplierCatalogEntry[] = [
  { supplierId: 'sup-a', kind: 'helmet', unitCostClp: 12_000 },
  { supplierId: 'sup-b', kind: 'helmet', unitCostClp: 10_000 },
  { supplierId: 'sup-c', kind: 'gloves', unitCostClp: 3_000 },
];

const leadTimes = { 'sup-a': 7, 'sup-b': 14, 'sup-c': 3 };

describe('suggestPurchaseOrder (§177)', () => {
  it('genera línea cuando stock <= reorderThreshold', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 5,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].kind).toBe('helmet');
    expect(draft.lines[0].quantity).toBeGreaterThan(0);
  });

  it('omite items con stock > reorderThreshold', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 50,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines).toHaveLength(0);
    expect(draft.totalClp).toBe(0);
  });

  it('elige proveedor más barato si no hay preferido', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 5,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines[0].supplierId).toBe('sup-b');
    expect(draft.lines[0].estimatedUnitCostClp).toBe(10_000);
  });

  it('respeta preferredSupplierId aunque sea más caro', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 5,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
        preferredSupplierId: 'sup-a',
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines[0].supplierId).toBe('sup-a');
  });

  it('clasifica urgency=emergency con stock 0', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 0,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines[0].urgency).toBe('emergency');
    expect(draft.deliveryWeekHint).toBe(1);
    expect(draft.notes.some((n) => n.includes('emergency'))).toBe(true);
  });

  it('clasifica urgency=urgent con stock < 50% threshold', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 3,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines[0].urgency).toBe('urgent');
  });

  it('clasifica urgency=routine con stock cerca del threshold', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 9,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines[0].urgency).toBe('routine');
  });

  it('cantidad sugerida cubre ~2 meses de consumo', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 5,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    // target = max(10, 16) = 16, qty = 16 - 5 = 11
    expect(draft.lines[0].quantity).toBe(11);
  });

  it('totalClp suma quantity × unitCost', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 5,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
      {
        kind: 'gloves',
        currentStock: 2,
        reorderThreshold: 20,
        expectedConsumptionPerMonth: 30,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    const expected = draft.lines.reduce(
      (acc, l) => acc + l.quantity * l.estimatedUnitCostClp,
      0,
    );
    expect(draft.totalClp).toBe(expected);
  });

  it('agrega nota cuando kind no está en catálogo', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'unknown_widget',
        currentStock: 0,
        reorderThreshold: 5,
        expectedConsumptionPerMonth: 1,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.lines).toHaveLength(0);
    expect(draft.notes.some((n) => n.includes('Sin proveedor'))).toBe(true);
  });

  it('deliveryWeekHint refleja max lead time excepto en emergency', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 5,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
        preferredSupplierId: 'sup-b', // 14 días → 2 semanas
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, leadTimes);
    expect(draft.deliveryWeekHint).toBe(2);
  });

  it('lead time desconocido cae a 14 días default', () => {
    const inventory: InventoryItem[] = [
      {
        kind: 'helmet',
        currentStock: 5,
        reorderThreshold: 10,
        expectedConsumptionPerMonth: 8,
      },
    ];
    const draft = suggestPurchaseOrder(inventory, catalog, {});
    // 14 días → 2 semanas
    expect(draft.deliveryWeekHint).toBe(2);
  });
});
