// Tests for the hazmat-inventory API client (7 typed wrappers). The server
// owns the compatibility/spill compute; the client just carries the
// path/method/body + auth-header contract and the json<T> error translation
// (server message → server error → http_<status>). The three mutators
// (add/update/delete) strip `idempotencyKey` out of the body and forward it as
// an `Idempotency-Key` header — we assert both halves of that move.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import {
  addHazmatSubstance,
  getHazmatSubstance,
  listHazmatInventory,
  updateHazmatSubstance,
  deleteHazmatSubstance,
  checkHazmatCompatibility,
  buildHazmatSpillPlan,
} from './useHazmatInventory';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errJson(status: number, body: unknown = {}): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

const item = { id: 'h1', name: 'Acetone', hazardClasses: ['flammable'] } as never;
const inventory = [item] as never;

describe('useHazmatInventory API client', () => {
  // ── happy paths: path + method + body + headers + parsed return ──────

  it('addHazmatSubstance → POST substance, parsed return, auth + json headers', async () => {
    const payload = { item, inventory, issues: [] };
    fetchMock.mockResolvedValue(okJson(payload));
    const out = await addHazmatSubstance('p1', { item, inventory });
    expect(out).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/hazmat/substance');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ item, inventory });
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('addHazmatSubstance → forwards idempotencyKey as a header and strips it from the body', async () => {
    fetchMock.mockResolvedValue(okJson({ item, inventory, issues: [] }));
    await addHazmatSubstance('p1', { item, inventory, idempotencyKey: 'idem-add-1' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-add-1');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ item, inventory });
    expect(body.idempotencyKey).toBeUndefined();
  });

  it('addHazmatSubstance → omits the Idempotency-Key header when no key is given', async () => {
    fetchMock.mockResolvedValue(okJson({ item, inventory, issues: [] }));
    await addHazmatSubstance('p1', { item, inventory });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('getHazmatSubstance → POST substance/get, parsed return', async () => {
    fetchMock.mockResolvedValue(okJson({ item }));
    const out = await getHazmatSubstance('p1', { itemId: 'h1', inventory });
    expect(out.item).toEqual(item);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/hazmat/substance/get');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ itemId: 'h1', inventory });
  });

  it('listHazmatInventory → POST inventory, forwards filters, parsed return', async () => {
    fetchMock.mockResolvedValue(okJson({ items: [item], total: 1 }));
    const input = { inventory, filters: { search: 'acet' } };
    const out = await listHazmatInventory('p1', input);
    expect(out).toEqual({ items: [item], total: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/hazmat/inventory');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input);
  });

  it('updateHazmatSubstance → POST substance/update, idempotency header, body stripped', async () => {
    const resp = { item, inventory, issues: [] };
    fetchMock.mockResolvedValue(okJson(resp));
    const out = await updateHazmatSubstance('p1', { item, inventory, idempotencyKey: 'idem-upd-1' });
    expect(out).toEqual(resp);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/hazmat/substance/update');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-upd-1');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ item, inventory });
  });

  it('deleteHazmatSubstance → POST substance/delete, idempotency header, body stripped', async () => {
    fetchMock.mockResolvedValue(okJson({ itemId: 'h1', inventory: [] }));
    const out = await deleteHazmatSubstance('p1', {
      itemId: 'h1',
      inventory,
      idempotencyKey: 'idem-del-1',
    });
    expect(out).toEqual({ itemId: 'h1', inventory: [] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/hazmat/substance/delete');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-del-1');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ itemId: 'h1', inventory });
  });

  it('checkHazmatCompatibility → POST compatibility-check, parsed summary', async () => {
    const resp = { issues: [], summary: { total: 1, incompatible: 0, caution: 0 } };
    fetchMock.mockResolvedValue(okJson(resp));
    const out = await checkHazmatCompatibility('p1', { inventory });
    expect(out).toEqual(resp);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/hazmat/compatibility-check');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ inventory });
  });

  it('buildHazmatSpillPlan → POST spill-plan, parsed plan', async () => {
    fetchMock.mockResolvedValue(okJson({ plan: { steps: ['contain'] } }));
    const out = await buildHazmatSpillPlan('p1', { item });
    expect(out.plan).toEqual({ steps: ['contain'] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/hazmat/spill-plan');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ item });
  });

  // ── error translation (json<T>) ─────────────────────────────────────

  it('throws the server-provided message on a non-ok response (message wins over error)', async () => {
    fetchMock.mockResolvedValue(errJson(400, { message: 'bad inventory', error: 'validation' }));
    await expect(addHazmatSubstance('p1', { item, inventory })).rejects.toThrow('bad inventory');
  });

  it('throws the server error string when only error is present', async () => {
    fetchMock.mockResolvedValue(errJson(403, { error: 'forbidden' }));
    await expect(checkHazmatCompatibility('p1', { inventory })).rejects.toThrow('forbidden');
  });

  it('throws http_<status> when the error body has neither message nor error', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(buildHazmatSpillPlan('p1', { item })).rejects.toThrow('http_500');
  });

  it('tolerates an unparseable error body (falls back to http_<status>)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(deleteHazmatSubstance('p1', { itemId: 'h1', inventory })).rejects.toThrow('http_502');
  });
});
