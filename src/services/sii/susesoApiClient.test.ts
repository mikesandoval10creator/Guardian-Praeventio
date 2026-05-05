// Praeventio Guard — SUSESO API client tests.
//
// Strategy: inject a mocked `fetch` that records the request and returns a
// canned `Response`. Asserts on URL, method, headers and body shape so any
// future drift in transport semantics is caught.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SusesoApiClient,
  SusesoApiError,
  type DiatPayload,
  type DiepPayload,
  type RoiPayload,
} from './susesoApiClient';

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetch(response: { status: number; body: unknown }): { calls: FetchCall[]; impl: typeof fetch } {
  const calls: FetchCall[] = [];
  const impl = ((url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const initHeaders = init?.headers ?? {};
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) headers[k] = v;
    } else {
      Object.assign(headers, initHeaders as Record<string, string>);
    }
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const ok = response.status >= 200 && response.status < 300;
    return Promise.resolve({
      ok,
      status: response.status,
      json: async () => response.body,
    } as Response);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const diatBase: DiatPayload = {
  employerRut: '76543210-K',
  employerName: 'Constructora Andes SpA',
  mutualName: 'ACHS',
  workerRut: '15123456-7',
  workerName: 'Pedro Núñez',
  workerJobTitle: 'Operador grúa',
  accidentDate: '2026-05-04',
  accidentTime: '10:35',
  accidentLocation: 'Faena Norte — chancado',
  accidentDescription: 'Caída a distinto nivel.',
  reportedAt: '2026-05-04',
};

const diepBase: DiepPayload = {
  employerRut: '76543210-K',
  employerName: 'Constructora Andes SpA',
  mutualName: 'ACHS',
  workerRut: '12345678-9',
  workerName: 'Juan Pérez',
  workerJobTitle: 'Operador chancado',
  diagnosis: 'Silicosis crónica simple',
  cieCode: 'J62.8',
  symptomsOnsetDate: '2024-09-10',
  exposedAgents: ['Sílice', 'Ruido'],
  reportedAt: '2026-05-04',
};

const roiBase: RoiPayload = {
  employerRut: '76543210-K',
  employerName: 'Constructora Andes SpA',
  mutualName: 'ACHS',
  year: 2025,
  totalIncidents: 3,
  totalLostDays: 45,
  accidentRate: 1.7,
  severityRate: 0.85,
  reportedAt: '2026-05-04',
};

describe('SusesoApiClient.fromEnv', () => {
  it('returns null when SUSESO_API_KEY is missing', () => {
    expect(SusesoApiClient.fromEnv({ SUSESO_EMPLOYER_RUT: '76543210-K' })).toBeNull();
  });

  it('returns null when SUSESO_EMPLOYER_RUT is missing', () => {
    expect(SusesoApiClient.fromEnv({ SUSESO_API_KEY: 'k' })).toBeNull();
  });

  it('builds a client when both env vars are present', () => {
    const c = SusesoApiClient.fromEnv({ SUSESO_API_KEY: 'k', SUSESO_EMPLOYER_RUT: '76543210-K' });
    expect(c).toBeInstanceOf(SusesoApiClient);
  });
});

describe('SusesoApiClient constructor', () => {
  it('rejects empty apiKey', () => {
    expect(() => new SusesoApiClient({ apiKey: '', employerRut: '76543210-K' }))
      .toThrow(SusesoApiError);
  });

  it('rejects empty employerRut', () => {
    expect(() => new SusesoApiClient({ apiKey: 'k', employerRut: '' }))
      .toThrow(SusesoApiError);
  });
});

describe('submitDiat', () => {
  let calls: FetchCall[] = [];
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to /diat with the employer RUT header and bearer token', async () => {
    const { calls: c, impl } = makeFetch({ status: 200, body: { folio: 'F-00001', ack: 'OK' } });
    calls = c;
    const client = new SusesoApiClient({
      apiKey: 'test-key',
      employerRut: '76543210-K',
      baseUrl: 'https://api.suseso.cl/v1',
      fetchImpl: impl,
    });
    const r = await client.submitDiat(diatBase);
    expect(r).toEqual({ folio: 'F-00001', ack: 'OK' });
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.suseso.cl/v1/diat');
    expect(calls[0].headers['Authorization']).toBe('Bearer test-key');
    expect(calls[0].headers['X-Employer-Rut']).toBe('76543210-K');
    expect(JSON.parse(calls[0].body!)).toMatchObject({ workerRut: '15123456-7' });
  });

  it('throws SusesoApiError with status code on HTTP 400', async () => {
    const { impl } = makeFetch({ status: 400, body: { message: 'Invalid RUT', code: 'E_RUT' } });
    const client = new SusesoApiClient({
      apiKey: 'k',
      employerRut: '76543210-K',
      fetchImpl: impl,
    });
    await expect(client.submitDiat(diatBase)).rejects.toBeInstanceOf(SusesoApiError);
  });
});

describe('submitDiep + submitRoi + getStatus', () => {
  it('submitDiep POSTs to /diep and returns folio', async () => {
    const { calls, impl } = makeFetch({ status: 200, body: { folio: 'D-1' } });
    const client = new SusesoApiClient({ apiKey: 'k', employerRut: 'E', fetchImpl: impl });
    const r = await client.submitDiep(diepBase);
    expect(r.folio).toBe('D-1');
    expect(calls[0].url).toMatch(/\/diep$/);
  });

  it('submitRoi POSTs to /roi and returns folio', async () => {
    const { calls, impl } = makeFetch({ status: 200, body: { folio: 'R-1' } });
    const client = new SusesoApiClient({ apiKey: 'k', employerRut: 'E', fetchImpl: impl });
    const r = await client.submitRoi(roiBase);
    expect(r.folio).toBe('R-1');
    expect(calls[0].url).toMatch(/\/roi$/);
  });

  it('getStatus GETs /status/:folio and parses the response', async () => {
    const { calls, impl } = makeFetch({ status: 200, body: { status: 'received' } });
    const client = new SusesoApiClient({ apiKey: 'k', employerRut: 'E', fetchImpl: impl });
    const s = await client.getStatus('F-001');
    expect(s.status).toBe('received');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/status\/F-001$/);
  });

  it('getStatus rejects empty folio', async () => {
    const { impl } = makeFetch({ status: 200, body: { status: 'pending' } });
    const client = new SusesoApiClient({ apiKey: 'k', employerRut: 'E', fetchImpl: impl });
    await expect(client.getStatus('')).rejects.toBeInstanceOf(SusesoApiError);
  });
});
