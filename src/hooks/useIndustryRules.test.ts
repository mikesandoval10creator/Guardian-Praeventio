import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchApplicableNorms, fetchRequiredEpp, fetchTypicalHazards, listIndustryPresetsRemote, selectIndustryRemote,
} from './useIndustryRules';
import { getIndustryPreset, buildPresetApplication } from '../services/industryRules/industryRuleEngine';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeaders: () => mocks.auth() }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ Authorization: 'test-auth' });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ presets: [] }), { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('industryRules real HTTP client contract', () => {
  it.each([
    { segment: 'applicable-norms', fetcher: fetchApplicableNorms, data: { applicableRegulations: ['DS 594'], minsalProtocols: [] } },
    { segment: 'required-epp', fetcher: fetchRequiredEpp, data: { baseEpp: ['Casco'] } },
    { segment: 'typical-hazards', fetcher: fetchTypicalHazards, data: { label: 'Minería', typicalRisks: [], mandatoryDocuments: [], mandatoryTrainings: [] } },
  ])('encodes the project and filter and decodes $segment', async ({ segment, fetcher, data }) => {
    const industryPrefix = 'GP-A+B & C';
    const payload = { industryPrefix, ...data };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(payload)));

    await expect(fetcher('project/a', industryPrefix)).resolves.toEqual(payload);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/sprint-k/project%2Fa/industry/${segment}?industryPrefix=GP-A%2BB+%26+C`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'test-auth' }) }),
    );
  });

  it('passes a live cancellation signal while preserving authentication', async () => {
    await listIndustryPresetsRemote('project/a');
    expect(mocks.fetch).toHaveBeenCalledWith('/api/sprint-k/project%2Fa/industry/list', expect.objectContaining({
      signal: expect.any(AbortSignal), headers: expect.objectContaining({ Authorization: 'test-auth' }),
    }));
  });
  it.each([{ key: 'caller-idempotency-key' }, { key: undefined }])('sends Idempotency-Key only when supplied: $key', async ({ key }) => {
    const payload = { preset: getIndustryPreset('GP-MIN'), application: buildPresetApplication('project/a', 'GP-MIN') };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
    await expect(selectIndustryRemote('project/a', { industryPrefix: 'GP-MIN' }, key)).resolves.toEqual(payload);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe('/api/sprint-k/project%2Fa/industry/select');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ industryPrefix: 'GP-MIN' }));
    expect(init.headers.Authorization).toBe('test-auth');
    expect(Object.prototype.hasOwnProperty.call(init.headers, 'Idempotency-Key')).toBe(key !== undefined);
    if (key !== undefined) expect(init.headers['Idempotency-Key']).toBe(key);
  });
  it.each([
    { body: { message: 'El proyecto cambió. Vuelve a cargar.', error: 'conflict' }, status: 409, expected: 'El proyecto cambió. Vuelve a cargar.' },
    { body: { error: 'project_not_found' }, status: 404, expected: 'project_not_found' },
    { body: {}, status: 500, expected: 'http_500' },
  ])('preserves error precedence for HTTP $status', async ({ body, status, expected }) => {
    const response = new Response(JSON.stringify(body), { status });
    mocks.fetch.mockResolvedValueOnce(response);
    await expect(listIndustryPresetsRemote('project/a')).rejects.toThrow(expected);
    expect(response.status).toBe(status);
  });
  it('handles a non-JSON error response without exposing its raw body as a client Error', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('<html>upstream-private-detail</html>', { status: 502 }));
    await expect(listIndustryPresetsRemote('project/a')).rejects.toThrow('http_502');
  });
  it('does not fetch when authentication fails', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('authentication_required'));
    await expect(listIndustryPresetsRemote('project/a')).rejects.toThrow('authentication_required');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
