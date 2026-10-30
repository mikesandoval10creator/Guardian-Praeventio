import { describe, it, expect, vi } from 'vitest';
import { analyzeProjectWithClient, parseSamplingProjects, type ProjectSamplingRequest } from './projectAnalysis.js';
import type { ZkReadAdapter, ZkNodeRef } from './zettelkastenServer.js';

const node: ZkNodeRef = { id: 'n1', tenantId: 't1', projectId: 'p1', type: 'NOTE',
  title: 'Inspection record', description: 'Recorded observation', tags: [], connections: [] };
const args = { tenantId: 't1', projectId: 'p1', question: 'Summarize' };
function fixture(nodes: ZkNodeRef[] = [node]) {
  const listNodes = vi.fn(async () => nodes);
  const zk: ZkReadAdapter = { listAccessibleTenants: async () => ['t1'], getNode: async () => null,
    listNodes, expandSubgraph: async () => [] };
  const sample = vi.fn(async (_request: ProjectSamplingRequest) => ({ content: { type: 'text', text: 'Recorded observation (zk:n1)' } }));
  return { zk, listNodes, sample, allowedProjects: [{ tenantId: 't1', projectId: 'p1' }] };
}

describe('sampling scope, minimization and failure boundaries', () => {
  it.each([{ tenantId: 'other' }, { projectId: 'other' }])('denies an unconfigured scope before reading', async changed => {
    const deps = fixture();
    await expect(analyzeProjectWithClient({ ...args, ...changed }, deps)).rejects.toThrow('mcp_sampling_project_not_allowed');
    expect(deps.listNodes).not.toHaveBeenCalled(); expect(deps.sample).not.toHaveBeenCalled();
  });
  it('rechecks the current tenant access', async () => {
    const deps = fixture(); deps.zk.listAccessibleTenants = async () => [];
    await expect(analyzeProjectWithClient(args, deps)).rejects.toThrow('mcp_sampling_tenant_not_allowed');
    expect(deps.listNodes).not.toHaveBeenCalled();
  });
  it('excludes foreign/unstamped projects, metadata and connections', async () => {
    const deps = fixture([{ ...node, metadata: { private: 'DO_NOT_SHARE' }, connections: ['foreign-node'] },
      { ...node, id: 'foreign-p', projectId: 'other' }, { ...node, id: 'foreign-t', tenantId: 'other' },
      { ...node, id: 'legacy', projectId: undefined }]);
    await analyzeProjectWithClient(args, deps);
    const request = JSON.stringify(deps.sample.mock.calls[0][0]);
    expect(request).not.toMatch(/DO_NOT_SHARE|foreign-node|foreign-p|foreign-t|legacy/);
  });
  it('returns empty context honestly without calling a model', async () => {
    const deps = fixture([]);
    expect(await analyzeProjectWithClient(args, deps)).toMatchObject({ sampled: false, source: 'project-records', contextNodeIds: [] });
    expect(deps.sample).not.toHaveBeenCalled();
  });
  it('preserves citation IDs exactly rather than truncating their identity', async () => {
    const id = 'n'.repeat(250);
    const deps = fixture([{ ...node, id }]);
    deps.sample.mockResolvedValueOnce({ content: { type: 'text', text: `Recorded observation (zk:${id})` } });
    const result = await analyzeProjectWithClient(args, deps);
    expect(result.contextNodeIds).toEqual([id]);
    expect(JSON.parse(deps.sample.mock.calls[0][0].messages[0].content.text).records[0].id).toBe(id);
  });
  it('caps context even if the adapter ignores its query limit', async () => {
    const deps = fixture(Array.from({ length: 40 }, (_, i) => ({ ...node, id: `n${i}`, description: 'x'.repeat(10000) })));
    await analyzeProjectWithClient(args, deps);
    const records = JSON.parse(deps.sample.mock.calls[0][0].messages[0].content.text).records;
    expect(records).toHaveLength(12); expect(records[0].description).toHaveLength(1000);
  });
  it.each(['', ' '.repeat(4), 'x'.repeat(1001)])('rejects invalid questions', async question => {
    const deps = fixture();
    await expect(analyzeProjectWithClient({ ...args, question }, deps)).rejects.toThrow('mcp_sampling_invalid_arguments');
    expect(deps.listNodes).not.toHaveBeenCalled();
  });
  it('does not echo secret-bearing client errors', async () => {
    const deps = fixture(); deps.sample.mockRejectedValueOnce(new Error('PRIVATE_UPSTREAM_DETAIL'));
    await expect(analyzeProjectWithClient(args, deps)).rejects.toThrow(/^mcp_sampling_unavailable$/);
  });
  it.each(['', 'x'.repeat(12001)])('rejects empty or oversized model output', async text => {
    const deps = fixture(); deps.sample.mockResolvedValueOnce({ content: { type: 'text', text } });
    await expect(analyzeProjectWithClient(args, deps)).rejects.toThrow('mcp_sampling_invalid_response');
  });
  it('rejects non-text output', async () => {
    const deps = fixture(); deps.sample.mockResolvedValueOnce({ content: { type: 'image', text: '' } });
    await expect(analyzeProjectWithClient(args, deps)).rejects.toThrow('mcp_sampling_invalid_response');
  });
  it.each(['Unverifiable assertion', 'Invented reference (zk:outside-project)'])('rejects missing or invented citations', async text => {
    const deps = fixture(); deps.sample.mockResolvedValueOnce({ content: { type: 'text', text } });
    await expect(analyzeProjectWithClient(args, deps)).rejects.toThrow('mcp_sampling_invalid_citations');
  });
});

describe('operator model-context sharing opt-in', () => {
  it('is disabled by default', () => {
    expect(parseSamplingProjects(undefined, ['t1'])).toEqual([]);
    expect(parseSamplingProjects('[]', ['t1'])).toEqual([]);
  });
  it('accepts configured tenant-project pairs', () => {
    const projects = [{ tenantId: 't1', projectId: 'p1' }];
    expect(parseSamplingProjects(JSON.stringify(projects), ['t1'])).toEqual(projects);
  });
  it.each(['', '{}', 'null', '[{}]', '[{"tenantId":"other","projectId":"p1"}]', '[{"tenantId":"t1","projectId":"../p1"}]'])('fails closed on invalid configuration', raw => {
    expect(() => parseSamplingProjects(raw, ['t1'])).toThrow('mcp_sampling_invalid_project_config');
  });
});
