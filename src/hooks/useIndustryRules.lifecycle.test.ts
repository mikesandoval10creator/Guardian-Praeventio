import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listIndustryPresetsRemote, selectIndustryRemote, fetchApplicableNorms, fetchRequiredEpp, fetchTypicalHazards } from './useIndustryRules';
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
function hangUntilAbort(_path: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init.signal!;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
const endpoints = [
  { name: 'list', run: (signal?: AbortSignal) => listIndustryPresetsRemote('project/a', signal) },
  { name: 'select', run: (signal?: AbortSignal) => selectIndustryRemote('project/a', { industryPrefix: 'GP-MIN' }, 'stable-key', signal) },
  { name: 'norms', run: (signal?: AbortSignal) => fetchApplicableNorms('project/a', 'GP-MIN', signal) },
  { name: 'epp', run: (signal?: AbortSignal) => fetchRequiredEpp('project/a', 'GP-MIN', signal) },
  { name: 'hazards', run: (signal?: AbortSignal) => fetchTypicalHazards('project/a', 'GP-MIN', signal) },
];
describe('industryRules deadlines and cancellation', () => {
  it.each(endpoints)('bounds a hanging $name request even with a caller signal', async ({ run }) => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(hangUntilAbort);
    const caller = new AbortController();
    const checked = expect(run(caller.signal)).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15_000);
    await checked;
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(endpoints)('honors caller cancellation for $name', async ({ run }) => {
    mocks.fetch.mockImplementation(hangUntilAbort);
    const caller = new AbortController();
    const checked = expect(run(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    caller.abort();
    await checked;
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it.each(endpoints)('does not fetch a pre-cancelled $name request', async ({ run }) => {
    const caller = new AbortController();
    caller.abort();
    await expect(run(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('retains the POST body and idempotency header', async () => {
    const payload = { preset: getIndustryPreset('GP-MIN'), application: buildPresetApplication('project/a', 'GP-MIN') };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
    await selectIndustryRemote('project/a', { industryPrefix: 'GP-MIN' }, 'stable-key');
    expect(mocks.fetch).toHaveBeenCalledWith('/api/sprint-k/project%2Fa/industry/select', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ industryPrefix: 'GP-MIN' }),
      headers: expect.objectContaining({ 'Idempotency-Key': 'stable-key', Authorization: 'test-auth' }),
    }));
  });
  it('cleans the timer and caller listener after success', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    await listIndustryPresetsRemote('p', caller.signal);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('cleans resources after HTTP failure and retains its error', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Proyecto no disponible' }), { status: 403 }));
    await expect(listIndustryPresetsRemote('p')).rejects.toThrow('Proyecto no disponible');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds authentication and never fetches after late auth completion', async () => {
    vi.useFakeTimers();
    let release!: (value: Record<string, string>) => void;
    mocks.auth.mockReturnValue(new Promise<Record<string, string>>((resolve) => { release = resolve; }));
    const checked = expect(listIndustryPresetsRemote('p')).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15_000);
    await checked;
    release({ Authorization: 'test-auth' });
    await Promise.resolve();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a hung JSON body and ignores its late completion', async () => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    const body = new Promise((resolve) => { release = resolve; });
    const response = new Response('{}');
    vi.spyOn(response, 'json').mockReturnValue(body);
    mocks.fetch.mockResolvedValue(response);
    const checked = expect(listIndustryPresetsRemote('p')).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15_000);
    await checked;
    release({ presets: [] });
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
