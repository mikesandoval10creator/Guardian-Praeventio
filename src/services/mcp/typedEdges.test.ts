import { describe, expect, it } from 'vitest';
import { typedEdgesOptIn, typedEdgesInput, storedEdgeSchema } from './typedEdges';
import { EDGE_TYPES, EDGE_INVERSES } from '../zettelkasten/edges';
describe('typed edge contracts', () => {
  it.each([undefined,'','0','true','yes',' 1','1 ','01'])('does not interpret %j as operator consent', raw => expect(typedEdgesOptIn(raw)).toBe(false));
  it('requires literal 1 for opt-in', () => expect(typedEdgesOptIn('1')).toBe(true));
  it('does not normalize literal scope IDs', () => expect(typedEdgesInput.parse({tenantId:'tenant-01',projectId:'project-001'})).toEqual({tenantId:'tenant-01',projectId:'project-001',limit:25}));
  it.each(EDGE_TYPES)('accepts only the stored canonical/inverse pair for %s', type => {
    expect(storedEdgeSchema.safeParse({id:'edge1',tenantId:'t1',projectId:'p1',fromNodeId:'a',toNodeId:'b',type,inverseType:EDGE_INVERSES[type]}).success).toBe(true);
  });
  it.each(['../outside','/x','..','.', '__reserved__','\uD800'])('rejects path or invalid node ID %j', fromNodeId => {
    expect(storedEdgeSchema.safeParse({id:'edge1',tenantId:'t1',projectId:'p1',fromNodeId,toNodeId:'b',type:'requires',inverseType:'required_by'}).success).toBe(false);
  });
});
