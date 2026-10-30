import { describe, it, expect, vi } from 'vitest';
import { analyzeProjectWithClient, type ProjectSamplingRequest } from './projectAnalysis.js';
import type { ZkReadAdapter, ZkNodeRef } from './zettelkastenServer.js';

const node: ZkNodeRef = {
  id: 'n1', tenantId: 't1', projectId: 'p1', type: 'NOTE',
  title: 'Inspection record', description: 'Recorded observation', tags: [], connections: [],
};
function fixture(nodes: ZkNodeRef[] = [node]) {
  const listNodes = vi.fn(async () => nodes);
  const zk: ZkReadAdapter = {
    listAccessibleTenants: async () => ['t1'], getNode: async () => null,
    listNodes, expandSubgraph: async () => [],
  };
  // Controlled protocol fixture, not a claim of real model inference.
  const sample = vi.fn(async (_request: ProjectSamplingRequest) => ({ content: { type: 'text' as const, text: 'Recorded observation (zk:n1)' } }));
  return { zk, listNodes, sample, allowedProjects: [{ tenantId: 't1', projectId: 'p1' }] };
}

describe('MCP project analysis via the client model', () => {
  it('uses the configured client model with bounded project context, not a server provider', async () => {
    const deps = fixture();
    const result = await analyzeProjectWithClient({ tenantId: 't1', projectId: 'p1', question: 'Summarize the records' }, deps);
    expect(result).toMatchObject({ source: 'mcp-client-sampling', advisory: true, contextNodeIds: ['n1'], text: 'Recorded observation (zk:n1)' });
    expect(deps.listNodes).toHaveBeenCalledWith('t1', { projectId: 'p1', limit: 12 });
    expect(deps.sample).toHaveBeenCalledOnce();
    expect(deps.sample.mock.calls[0][0]).toMatchObject({ includeContext: 'none', maxTokens: 768 });
  });
});
