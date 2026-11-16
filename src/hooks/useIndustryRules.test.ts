import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listIndustryPresetsRemote } from './useIndustryRules';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeaders: () => mocks.auth() }));
beforeEach(() => {
  mocks.auth.mockResolvedValue({ Authorization: 'test-auth' });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ presets: [] }), { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('industryRules request lifetime', () => {
  it('passes a live cancellation signal while preserving authentication', async () => {
    await listIndustryPresetsRemote('project/a');
    expect(mocks.fetch).toHaveBeenCalledWith('/api/sprint-k/project%2Fa/industry/list', expect.objectContaining({
      signal: expect.any(AbortSignal), headers: expect.objectContaining({ Authorization: 'test-auth' }),
    }));
  });
});
