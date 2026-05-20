// Praeventio Guard — Tests for pricingOcPdfRenderer (Bloque 8.4 D5).
//
// Foco: aritmética de totales (puro y verificable sin parsear PDF).
// El renderer en sí lo testeamos solo verificando que produce Buffer no
// vacío con cabecera %PDF — no parseamos el binary porque pdfkit estable
// no garantiza diffs idénticos cross-version.

import { describe, it, expect } from 'vitest';
import {
  computeOcTotals,
  renderPricingOcPdf,
  type PricingOcItem,
} from './pricingOcPdfRenderer';

describe('computeOcTotals', () => {
  it('subtotal vacío produce 0', () => {
    const totals = computeOcTotals([]);
    expect(totals.subtotalClp).toBe(0);
    expect(totals.taxClp).toBe(0);
    expect(totals.totalClp).toBe(0);
  });

  it('1 item: subtotal + IVA 19% + total', () => {
    const items: PricingOcItem[] = [
      { kind: 'helmet', label: 'Casco', qty: 10, unitCostClp: 10000 },
    ];
    const totals = computeOcTotals(items);
    expect(totals.subtotalClp).toBe(100_000);
    expect(totals.taxClp).toBe(19_000);
    expect(totals.totalClp).toBe(119_000);
  });

  it('múltiples items', () => {
    const items: PricingOcItem[] = [
      { kind: 'helmet', label: 'Casco', qty: 10, unitCostClp: 10_000 },
      { kind: 'gloves', label: 'Guantes', qty: 20, unitCostClp: 5_000 },
      { kind: 'boots', label: 'Botas', qty: 10, unitCostClp: 35_000 },
    ];
    const totals = computeOcTotals(items);
    expect(totals.subtotalClp).toBe(100_000 + 100_000 + 350_000); // 550_000
    expect(totals.taxClp).toBe(104_500); // round(550_000 * 0.19)
    expect(totals.totalClp).toBe(654_500);
  });

  it('inStockQty descuenta correctamente', () => {
    const items: PricingOcItem[] = [
      { kind: 'helmet', label: 'Casco', qty: 10, unitCostClp: 10_000, inStockQty: 4 },
    ];
    const totals = computeOcTotals(items);
    // qty efectiva = 10 - 4 = 6
    expect(totals.subtotalClp).toBe(60_000);
    expect(totals.taxClp).toBe(11_400);
    expect(totals.totalClp).toBe(71_400);
  });

  it('inStockQty >= qty produce 0', () => {
    const items: PricingOcItem[] = [
      { kind: 'helmet', label: 'Casco', qty: 5, unitCostClp: 10_000, inStockQty: 10 },
    ];
    const totals = computeOcTotals(items);
    expect(totals.subtotalClp).toBe(0);
    expect(totals.totalClp).toBe(0);
  });

  it('IVA round-to-peso correcto (no float drift)', () => {
    // 12345 * 0.19 = 2345.55 → round = 2346
    const items: PricingOcItem[] = [
      { kind: 'gloves', label: 'X', qty: 1, unitCostClp: 12_345 },
    ];
    const totals = computeOcTotals(items);
    expect(totals.subtotalClp).toBe(12_345);
    expect(totals.taxClp).toBe(2_346);
    expect(totals.totalClp).toBe(14_691);
  });

  it('determinístico: misma input → misma output', () => {
    const items: PricingOcItem[] = [
      { kind: 'a', label: 'A', qty: 7, unitCostClp: 9_999 },
      { kind: 'b', label: 'B', qty: 3, unitCostClp: 5_555 },
    ];
    const a = computeOcTotals(items);
    const b = computeOcTotals(items);
    expect(a).toEqual(b);
  });
});

describe('renderPricingOcPdf', () => {
  it('produce un Buffer no vacío con cabecera %PDF', async () => {
    const buf = await renderPricingOcPdf({
      context: {
        clientRazonSocial: 'Constructora Andina SpA',
        clientRut: '76.123.456-7',
        clientAddress: 'Av. Andes 1234, Santiago',
        industryLabel: 'Construcción',
        recommendedTier: 'Comité',
        workersCount: 25,
        projectsCount: 2,
      },
      items: [
        { kind: 'helmet', label: 'Casco con barbiquejo', qty: 25, unitCostClp: 9_500 },
        { kind: 'gloves', label: 'Guantes nitrilo', qty: 50, unitCostClp: 4_200 },
        { kind: 'boots', label: 'Bota seguridad', qty: 25, unitCostClp: 38_000 },
      ],
      folio: 'OC-2026-001',
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    // %PDF magic
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('renderiza sin folio (opcional)', async () => {
    const buf = await renderPricingOcPdf({
      context: {
        clientRazonSocial: 'X SpA',
        clientRut: '11.111.111-1',
      },
      items: [{ kind: 'mask', label: 'Mascarilla', qty: 100, unitCostClp: 800 }],
    });
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('renderiza con items vacíos (caso edge)', async () => {
    const buf = await renderPricingOcPdf({
      context: { clientRazonSocial: 'Empty SpA', clientRut: '22.222.222-2' },
      items: [],
    });
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('inStockQty se refleja en label del item', async () => {
    // Smoke: el render no falla con inStockQty (la lógica visual la
    // verificamos manualmente en PR review; aquí solo confirmamos que el
    // método no lanza).
    const buf = await renderPricingOcPdf({
      context: { clientRazonSocial: 'Test', clientRut: '33.333.333-3' },
      items: [
        { kind: 'helmet', label: 'Casco', qty: 10, unitCostClp: 9_000, inStockQty: 3 },
      ],
    });
    expect(buf.length).toBeGreaterThan(0);
  });
});
