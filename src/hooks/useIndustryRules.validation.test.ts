import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRequiredEpp, listIndustryPresetsRemote, selectIndustryRemote, fetchApplicableNorms, fetchTypicalHazards } from './useIndustryRules';
import { getIndustryPreset, buildPresetApplication, listIndustryPresets } from '../services/industryRules/industryRuleEngine';
vi.mock('../lib/apiAuth', () => ({ apiAuthHeaders: async () => ({}) }));
afterEach(() => { vi.unstubAllGlobals(); });
describe('industry HTTP response validation', () => {
  it('accepts current list, EPP, norms and hazards response shapes', async () => {
    const p = getIndustryPreset('GP-MIN');
    const cases = [
      { body: { presets: listIndustryPresets() }, run: () => listIndustryPresetsRemote('project-a') },
      { body: { industryPrefix: p.industryPrefix, baseEpp: p.baseEpp }, run: () => fetchRequiredEpp('project-a', 'GP-MIN') },
      { body: { industryPrefix: p.industryPrefix, applicableRegulations: p.applicableRegulations, minsalProtocols: p.minsalProtocols }, run: () => fetchApplicableNorms('project-a', 'GP-MIN') },
      { body: { industryPrefix: p.industryPrefix, label: p.label, typicalRisks: p.typicalRisks, mandatoryDocuments: p.mandatoryDocuments, mandatoryTrainings: p.mandatoryTrainings }, run: () => fetchTypicalHazards('project-a', 'GP-MIN') },
    ];
    for (const { body, run } of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
      await expect(run()).resolves.toEqual(body);
    }
  });
  it('rejects an invalid nested risk severity instead of changing or defaulting it', async () => {
    const application = { ...buildPresetApplication('project-a', 'GP-MIN'), risksToCreate: [{ riskType: 'altura', severity: 'low' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ application, preset: getIndustryPreset('GP-MIN') }))));
    await expect(selectIndustryRemote('project-a', { industryPrefix: 'GP-MIN' })).rejects.toMatchObject({ code: 'industry_response_invalid' });
  });
  it.each(listIndustryPresets())('preserves the actual producer DTO for $prefix', async ({ prefix }) => {
    const payload = { preset: getIndustryPreset(prefix), application: buildPresetApplication('project-a', prefix) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(selectIndustryRemote('project-a', { industryPrefix: prefix })).resolves.toEqual(payload);
  });
  it.each([
    { payload: { industryPrefix: 'GP-MIN', baseEpp: null } },
    { payload: { industryPrefix: 'GP-MIN', baseEpp: ['Casco', 7] } },
    { payload: { industryPrefix: '', baseEpp: [] } },
    { payload: { industryPrefix: 'GP-MIN', baseEpp: [' '] } },
    { payload: null }, { payload: [] },
  ])('rejects malformed EPP data %#', async ({ payload }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(fetchRequiredEpp('project-a', 'GP-MIN')).rejects.toMatchObject({ code: 'industry_response_invalid' });
  });
  it('accepts an explicitly empty valid EPP list without fabricating requirements', async () => {
    const payload = { industryPrefix: 'GP-MIN', baseEpp: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(fetchRequiredEpp('project-a', 'GP-MIN')).resolves.toEqual(payload);
  });
  it.each([
    { payload: { ...getIndustryPreset('GP-MIN'), mandatoryTrainings: null } },
    { payload: { ...getIndustryPreset('GP-MIN'), baseEpp: undefined } },
    { payload: { ...getIndustryPreset('GP-MIN'), severityOverrides: { height: 'low' } } },
  ])('rejects incomplete nested presets %#', async ({ payload }) => {
    const body = { preset: payload, application: buildPresetApplication('project-a', 'GP-MIN') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(selectIndustryRemote('project-a', { industryPrefix: 'GP-MIN' })).rejects.toMatchObject({ code: 'industry_response_invalid' });
  });
  it('turns malformed success JSON into a controlled validation error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>provider-detail</html>', { status: 200 })));
    await expect(fetchRequiredEpp('project-a', 'GP-MIN')).rejects.toMatchObject({
      code: 'industry_response_invalid', status: 200,
    });
  });
  it.each([
    { endpoint: 'list', run: () => listIndustryPresetsRemote('project-a') },
    { endpoint: 'select', run: () => selectIndustryRemote('project-a', { industryPrefix: 'GP-MIN' }) },
    { endpoint: 'norms', run: () => fetchApplicableNorms('project-a', 'GP-MIN') },
    { endpoint: 'hazards', run: () => fetchTypicalHazards('project-a', 'GP-MIN') },
  ])('rejects missing fields for $endpoint', async ({ run }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(run()).rejects.toMatchObject({ code: 'industry_response_invalid', status: 200 });
  });
  it('rejects missing EPP data instead of treating a 200 body as a typed DTO', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(fetchRequiredEpp('project-a', 'GP-MIN')).rejects.toMatchObject({
      code: 'industry_response_invalid', status: 200,
    });
  });
});
