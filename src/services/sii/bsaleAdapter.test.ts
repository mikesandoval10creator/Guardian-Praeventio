// Praeventio Guard — Bsale adapter tests (Sprint 23 Bucket GG).
//
// Coverage:
//   • fromEnv() returns null when env vars are missing.
//   • fromEnv() builds an instance when BSALE_ACCESS_TOKEN + BSALE_OFFICE_ID
//     are present.
//   • createDte() POSTs the right URL with the `access_token` header and a
//     well-formed Bsale payload.
//   • Successful Bsale response (folio + urlPdf) maps to ok=true.
//   • 4xx Bsale response maps to ok=false with errorMessage (does NOT throw).
//   • cancelDte() requires a non-empty reason.
//   • cancelDte() POSTs to `documents/{folio}/cancel.json`.
//   • getDte() maps a Bsale GET response.
//   • emitDte() (the SiiAdapter contract) wraps createDte() and throws on
//     Bsale-side rejections.
//
// Tests use a hand-rolled fetch double rather than vi.mock so we can assert
// on the exact URL/headers/body each call sends.

import { afterEach, describe, expect, it } from 'vitest';
import {
  BsaleAdapter,
  buildBsalePayload,
  mapBsaleResponse,
  type BsaleConfig,
  type DteCreateInput,
} from './bsaleAdapter';
import { SiiAdapterError } from './siiAdapter';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeFetchDouble(handlers: Array<{
  status?: number;
  body: unknown;
}>): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    const status = handler.status ?? 200;
    const text =
      typeof handler.body === 'string' ? handler.body : JSON.stringify(handler.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseConfig: BsaleConfig = {
  accessToken: 'test-token-xyz',
  officeId: 1,
  baseUrl: 'https://api.bsale.test/v1',
};

const sampleInput: DteCreateInput = {
  type: 'factura_electronica',
  customer: {
    rut: '76.543.210-K',
    razonSocial: 'Cliente Demo SpA',
    giro: 'Servicios',
    direccion: 'Av Siempre Viva 742',
    comuna: 'Providencia',
    ciudad: 'Santiago',
    email: 'cliente@example.cl',
  },
  items: [
    { description: 'Tier Plata', quantity: 1, unitPriceClp: 42850, taxable: true },
  ],
  paymentMethod: 'webpay',
};

describe('BsaleAdapter.fromEnv', () => {
  const originalToken = process.env.BSALE_ACCESS_TOKEN;
  const originalOffice = process.env.BSALE_OFFICE_ID;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.BSALE_ACCESS_TOKEN;
    else process.env.BSALE_ACCESS_TOKEN = originalToken;
    if (originalOffice === undefined) delete process.env.BSALE_OFFICE_ID;
    else process.env.BSALE_OFFICE_ID = originalOffice;
  });

  it('returns null when BSALE_ACCESS_TOKEN is missing', () => {
    delete process.env.BSALE_ACCESS_TOKEN;
    process.env.BSALE_OFFICE_ID = '1';
    expect(BsaleAdapter.fromEnv()).toBeNull();
  });

  it('returns null when BSALE_OFFICE_ID is missing', () => {
    process.env.BSALE_ACCESS_TOKEN = 'abc';
    delete process.env.BSALE_OFFICE_ID;
    expect(BsaleAdapter.fromEnv()).toBeNull();
  });

  it('builds an instance when both vars are present', () => {
    process.env.BSALE_ACCESS_TOKEN = 'real-token';
    process.env.BSALE_OFFICE_ID = '7';
    const adapter = BsaleAdapter.fromEnv();
    expect(adapter).toBeInstanceOf(BsaleAdapter);
    expect(adapter?.isAvailable).toBe(true);
    expect(adapter?.name).toBe('bsale');
    expect(adapter?.provider).toBe('bsale');
  });
});

describe('buildBsalePayload (pure mapper)', () => {
  it('maps a factura_electronica to documentTypeId 33 with correct details', () => {
    const payload = buildBsalePayload(sampleInput, 5, new Date('2026-05-04T12:00:00Z'));
    expect(payload.documentTypeId).toBe(33);
    expect(payload.officeId).toBe(5);
    expect(payload.declareSii).toBe(1);
    const details = (payload as any).details as Array<Record<string, unknown>>;
    expect(details).toHaveLength(1);
    expect(details[0].netUnitValue).toBe(42850);
    expect(details[0].quantity).toBe(1);
    expect(details[0].comment).toBe('Tier Plata');
    expect(details[0].taxId).toBe('[1]'); // afecto IVA
  });

  it('flags exempt items with taxId "[]"', () => {
    const payload = buildBsalePayload(
      {
        ...sampleInput,
        items: [
          { description: 'Capacitación', quantity: 1, unitPriceClp: 25000, taxable: false },
        ],
      },
      1,
    );
    const details = (payload as any).details;
    expect(details[0].taxId).toBe('[]');
  });

  it('throws on empty items list', () => {
    expect(() =>
      buildBsalePayload({ ...sampleInput, items: [] }, 1),
    ).toThrow(SiiAdapterError);
  });

  it('rejects non-positive quantity', () => {
    expect(() =>
      buildBsalePayload(
        {
          ...sampleInput,
          items: [{ description: 'X', quantity: 0, unitPriceClp: 1000, taxable: true }],
        },
        1,
      ),
    ).toThrow(/Invalid quantity/);
  });

  it('includes references for nota_credito', () => {
    const payload = buildBsalePayload(
      {
        ...sampleInput,
        type: 'nota_credito',
        references: [{ type: '33', folio: '1234', date: '2026-05-01' }],
      },
      1,
    );
    expect(payload.documentTypeId).toBe(61);
    expect((payload as any).references).toEqual([
      { documentType: '33', folio: '1234', date: '2026-05-01' },
    ]);
  });
});

describe('BsaleAdapter.createDte', () => {
  it('POSTs to documents.json with access_token header and Bsale payload', async () => {
    const { fetchImpl, calls } = makeFetchDouble([
      {
        body: {
          id: 999,
          number: 1234,
          urlPdf: 'https://api.bsale.test/pdf/1234.pdf',
          totalAmount: 50992,
          taxAmount: 8142,
        },
      },
    ]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.createDte(sampleInput);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.bsale.test/v1/documents.json');
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['access_token']).toBe('test-token-xyz');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.documentTypeId).toBe(33);
    expect(body.officeId).toBe(1);

    expect(result.ok).toBe(true);
    expect(result.folio).toBe(1234);
    expect(result.trackingId).toBe('999');
    expect(result.pdfUrl).toBe('https://api.bsale.test/pdf/1234.pdf');
    expect(result.totalClp).toBe(50992);
    expect(result.ivaClp).toBe(8142);
  });

  it('returns ok=false with errorMessage on a 4xx response', async () => {
    const { fetchImpl } = makeFetchDouble([
      { status: 400, body: { error: 'rut invalido' } },
    ]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.createDte(sampleInput);
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('rut invalido');
  });

  it('returns ok=false with errorMessage when payload lacks a folio', async () => {
    const { fetchImpl } = makeFetchDouble([{ body: { id: 1 } }]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.createDte(sampleInput);
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/folio/);
  });
});

describe('BsaleAdapter.cancelDte', () => {
  it('rejects empty reason without making a network call', async () => {
    const { fetchImpl, calls } = makeFetchDouble([{ body: {} }]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.cancelDte(1234, '');
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/reason is required/);
    expect(calls).toHaveLength(0);
  });

  it('rejects non-positive folio', async () => {
    const { fetchImpl, calls } = makeFetchDouble([{ body: {} }]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.cancelDte(0, 'cliente solicitó');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('POSTs to documents/{folio}/cancel.json on success', async () => {
    const { fetchImpl, calls } = makeFetchDouble([{ body: { id: 5678 } }]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.cancelDte(1234, 'duplicado');
    expect(calls[0].url).toBe('https://api.bsale.test/v1/documents/1234/cancel.json');
    expect(calls[0].init?.method).toBe('POST');
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.reason).toBe('duplicado');
    expect(result.ok).toBe(true);
    expect(result.trackingId).toBe('5678');
  });
});

describe('BsaleAdapter.getDte', () => {
  it('GETs documents/{trackingId}.json and maps the response', async () => {
    const { fetchImpl, calls } = makeFetchDouble([
      {
        body: {
          id: 999,
          number: 1234,
          urlPdf: 'https://api.bsale.test/pdf/1234.pdf',
        },
      },
    ]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.getDte('999');
    expect(calls[0].url).toBe('https://api.bsale.test/v1/documents/999.json');
    expect(calls[0].init?.method).toBe('GET');
    expect(result.ok).toBe(true);
    expect(result.folio).toBe(1234);
  });

  it('returns ok=false on missing trackingId', async () => {
    const { fetchImpl, calls } = makeFetchDouble([{ body: {} }]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const result = await adapter.getDte('');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('BsaleAdapter.emitDte (SiiAdapter contract)', () => {
  it('wraps createDte and returns a DteResponse', async () => {
    const { fetchImpl } = makeFetchDouble([
      {
        body: {
          id: 100,
          number: 5000,
          urlPdf: 'https://api.bsale.test/pdf/5000.pdf',
        },
      },
    ]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    const response = await adapter.emitDte({
      header: {
        type: 33,
        emisorRut: '78231119-0',
        emisorRazonSocial: 'Praeventio Guard SpA',
        emisorGiro: 'Servicios de prevención',
        receptorRut: '76.543.210-K',
        receptorRazonSocial: 'Cliente Demo SpA',
        fechaEmision: '2026-05-04',
      },
      lineItems: [{ description: 'Tier Plata', quantity: 1, unitPrice: 42850 }],
      paymentInfo: { method: 'webpay', reference: 'INV-001' },
    });
    expect(response.folio).toBe(5000);
    expect(response.status).toBe('accepted');
    expect(response.pdfUrl).toBe('https://api.bsale.test/pdf/5000.pdf');
    expect(response.trackId).toBe('100');
  });

  it('throws SiiAdapterError when Bsale rejects', async () => {
    const { fetchImpl } = makeFetchDouble([
      { status: 422, body: { error: 'CAF agotado' } },
    ]);
    const adapter = new BsaleAdapter({ ...baseConfig, fetchImpl });
    await expect(
      adapter.emitDte({
        header: {
          type: 33,
          emisorRut: '78231119-0',
          emisorRazonSocial: 'Praeventio Guard SpA',
          emisorGiro: 'Servicios',
          receptorRut: '76.543.210-K',
          receptorRazonSocial: 'X',
          fechaEmision: '2026-05-04',
        },
        lineItems: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
      }),
    ).rejects.toBeInstanceOf(SiiAdapterError);
  });
});

describe('mapBsaleResponse', () => {
  it('returns ok=false on null input', () => {
    expect(mapBsaleResponse(null).ok).toBe(false);
  });

  it('falls back to provided totals when payload omits them', () => {
    const result = mapBsaleResponse({ id: 1, number: 999 }, 11990, 1915);
    expect(result.totalClp).toBe(11990);
    expect(result.ivaClp).toBe(1915);
  });

  it('extracts urlPublicView as xmlUrl fallback', () => {
    const result = mapBsaleResponse({
      id: 1,
      number: 999,
      urlPublicView: 'https://api.bsale.test/public/999',
    });
    expect(result.xmlUrl).toBe('https://api.bsale.test/public/999');
  });
});
