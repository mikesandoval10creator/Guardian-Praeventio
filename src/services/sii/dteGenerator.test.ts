// Praeventio Guard — dteGenerator unit tests.
//
// Covers the Sprint 34 biometric-DTE generator. Praeventio NO push a SII;
// these tests assert the LOCAL generation surface only.

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateDte } from './dteGenerator';
import { SiiAdapterError } from './siiAdapter';

const baseOpts = {
  receptorRut: '76.123.456-7',
  receptorRazonSocial: 'Empresa Cliente SpA',
  fecha: '2026-05-05',
  folio: 1234,
};

describe('generateDte', () => {
  it('tipo 33 con 2 items → XML válido + IVA 19% calculado correctamente', () => {
    const result = generateDte({
      ...baseOpts,
      type: 33,
      items: [
        { description: 'Asesoría prevención', quantity: 1, unitPrice: 10000 },
        { description: 'Capacitación NCh', quantity: 2, unitPrice: 5000 },
      ],
    });
    // Net = 10000 + 10000 = 20000 → IVA = ceil(20000 * 0.19) = 3800 → total 23800
    expect(result.summary.netAmount).toBe(20000);
    expect(result.summary.iva).toBe(3800);
    expect(result.summary.total).toBe(23800);
    expect(result.summary.itemCount).toBe(2);
    expect(result.dteId).toMatch(/^T33F1234-/);
    expect(result.xml).toContain('<TipoDTE>33</TipoDTE>');
    expect(result.xml).toContain('<Folio>1234</Folio>');
    expect(result.xml).toContain('<MntNeto>20000</MntNeto>');
    expect(result.xml).toContain('<IVA>3800</IVA>');
    expect(result.xml).toContain('<MntTotal>23800</MntTotal>');
    expect(result.xml).toContain('xmlns="http://www.sii.cl/SiiDte"');
    // Hash matches manual SHA-256 over the XML.
    const expectedHash = crypto.createHash('sha256').update(result.xml, 'utf8').digest('hex');
    expect(result.hash).toBe(expectedHash);
  });

  it('hash determinístico — misma entrada → mismo hash', () => {
    const a = generateDte({
      ...baseOpts,
      type: 33,
      items: [{ description: 'Item A', quantity: 1, unitPrice: 1000 }],
    });
    const b = generateDte({
      ...baseOpts,
      type: 33,
      items: [{ description: 'Item A', quantity: 1, unitPrice: 1000 }],
    });
    expect(a.hash).toBe(b.hash);
    expect(a.xml).toBe(b.xml);
    expect(a.dteId).toBe(b.dteId);
  });

  it('tipo 39 (boleta) — generación funcional con mismo schema', () => {
    const result = generateDte({
      ...baseOpts,
      type: 39,
      folio: 99,
      items: [{ description: 'Boleta servicio', quantity: 1, unitPrice: 5000 }],
    });
    expect(result.xml).toContain('<TipoDTE>39</TipoDTE>');
    expect(result.summary.type).toBe(39);
    expect(result.summary.total).toBe(5950); // 5000 + ceil(950) = 5950
  });

  it('receptor RUT inválido → throws SiiAdapterError', () => {
    expect(() =>
      generateDte({
        ...baseOpts,
        type: 33,
        receptorRut: 'NOT-A-RUT',
        items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
      }),
    ).toThrow(SiiAdapterError);
  });

  it('items vacíos → throws', () => {
    expect(() =>
      generateDte({ ...baseOpts, type: 33, items: [] }),
    ).toThrow(/At least one line item/);
  });

  it('tipo no soportado → throws', () => {
    expect(() =>
      generateDte({
        ...baseOpts,
        // @ts-expect-error — explicitly testing invalid type at runtime
        type: 56,
        items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
      }),
    ).toThrow(/Unsupported DTE type/);
  });

  it('folio inválido → throws', () => {
    expect(() =>
      generateDte({
        ...baseOpts,
        type: 33,
        folio: 0,
        items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
      }),
    ).toThrow(/Folio must be/);
  });

  it('fecha mal formada → throws', () => {
    expect(() =>
      generateDte({
        ...baseOpts,
        type: 33,
        fecha: '05/05/2026',
        items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
      }),
    ).toThrow(/Invalid fecha/);
  });
});
