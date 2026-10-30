import { describe, expect, it } from 'vitest';
import { createTypedEdgesReader } from './typedEdgesReader';
import type { AdminFirestoreLike, AdminCollectionLike, AdminDocLike, AdminQueryLike } from './zkFirebaseReadAdapter';
const edge = (id = 'edge-01', extra: Record<string, unknown> = {}) => ({ id, tenantId: 't1', projectId: 'p1', fromNodeId: 'n1', toNodeId: 'n2', type: 'mitigates', inverseType: 'mitigated_by', weight: 0.8, createdBy: 'private-worker', metadata: { secret: 'not-for-host' }, ...extra });
function fixture(rows = [edge()], nodeOverrides: Record<string, Record<string, unknown> | null> = {}) {
  const trace: unknown[][] = [];
  const nodes: Record<string, Record<string, unknown> | null> = { n1: { projectId: 'p1', tenantId: 't1' }, n2: { projectId: 'p1', tenantId: 't1' }, ...nodeOverrides };
  const query = (filters: Array<[string, unknown]> = [], limit = Infinity): AdminQueryLike => ({
    where(field, op, value) { trace.push(['where', field, op, value]); return query([...filters, [field, value]], limit); },
    limit(n) { trace.push(['limit', n]); return query(filters, n); },
    async get() { trace.push(['edge-get']); return { docs: rows.filter(r => filters.every(([f,v]) => r[f as keyof typeof r] === v)).slice(0,limit).map(r => ({ id: r.id as string, exists: true, data: () => r })) }; },
  });
  const empty = () => { throw new Error('unexpected read'); };
  const collection = (name: string): AdminCollectionLike => ({
    ...query(),
    doc(id): AdminDocLike { return { id, async get() { trace.push(['node-get', id]); return { id, exists: Boolean(nodes[id]), data: () => nodes[id] ?? undefined }; }, collection: empty }; },
    where(field, op, value) { if (name !== 'zettelkasten_edges') throw new Error('wrong collection'); return query().where(field,op,value); },
  });
  const firestore: AdminFirestoreLike = { collection(path) { trace.push(['collection',path]); if(path !== 'tenants') throw new Error('global access'); return { ...query(), doc(tenantId) { trace.push(['tenant',tenantId]); return { id: tenantId, get: empty, collection(name) { trace.push(['subcollection',name]); return collection(name); } }; } }; } };
  return { trace, read: createTypedEdgesReader({ firestore, accessibleTenants: ['t1'], allowedProjects: [{ tenantId: 't1', projectId: 'p1' }] }) };
}
describe('typed-edge reader: bounded tenant/project read-only projection', () => {
  it('queries project before limit and returns literal stored relation without PII', async () => {
    const { read, trace } = fixture(); const result = await read({ tenantId:'t1', projectId:'p1', limit:25 });
    expect(result.edges).toEqual([{ id:'edge-01', fromNodeId:'n1', toNodeId:'n2', type:'mitigates', inverseType:'mitigated_by', weight:0.8 }]);
    expect(trace.indexOf(trace.find(x=>x[0]==='where')!)).toBeLessThan(trace.indexOf(trace.find(x=>x[0]==='limit')!));
    expect(trace).toContainEqual(['where','projectId','==','p1']); expect(trace).toContainEqual(['limit',26]);
    expect(JSON.stringify(result)).not.toMatch(/private-worker|not-for-host/);
  });
  it.each([{tenantId:'t2',projectId:'p1'}, {tenantId:'t1',projectId:'p2'}, {tenantId:'t1/other',projectId:'p1'}, {tenantId:'t1',projectId:''}])('rejects disallowed scope before any read: %j', async scope => {
    const {read,trace}=fixture(); await expect(read(scope)).rejects.toThrow(); expect(trace).toEqual([]);
  });
  it.each([{ projectId:'p2', tenantId:'t1' }, { projectId:'p1', tenantId:'t2' }, {}, null])('omits foreign/legacy/missing endpoint %j', async endpoint => {
    const {read}=fixture([edge()], {n2:endpoint}); const result=await read({tenantId:'t1',projectId:'p1'}); expect(result.edges).toEqual([]); expect(result.omitted).toBe(1);
  });
  it('does not infer types/inverses or accept malformed canonical records', async () => {
    const rows=[edge('a',{type:'related_to'}),edge('b',{inverseType:'caused_by'}),edge('c',{tenantId:'t2'}),edge('d',{fromNodeId:'../../foreign'}),edge('e',{weight:Infinity}),edge('f',{weight:-1}),edge('g',{validFrom:'yesterday'}),edge('h',{fromNodeId:'n2'})];
    const {read,trace}=fixture(rows); const result=await read({tenantId:'t1',projectId:'p1'}); expect(result.edges).toEqual([]); expect(result.omitted).toBe(rows.length); expect(trace.filter(x=>x[0]==='node-get')).toHaveLength(0);
  });
  it('caps candidates, dedupes endpoint reads, and marks truncation', async () => {
    const {read,trace}=fixture(Array.from({length:60},(_,i)=>edge(`edge-${i}`))); const r=await read({tenantId:'t1',projectId:'p1',limit:50});
    expect(r.edges).toHaveLength(50); expect(r.scanLimited).toBe(true); expect(trace).toContainEqual(['limit',51]); expect(trace.filter(x=>x[0]==='node-get')).toHaveLength(2);
  });
  it('does not lose project matches behind a large foreign-project prefix', async () => {
    const rows = [...Array.from({length:250},(_,i)=>edge(`foreign-${i}`,{projectId:'p2'})), edge()];
    const {read}=fixture(rows); const result=await read({tenantId:'t1',projectId:'p1',limit:1});
    expect(result.edges.map(e=>e.id)).toEqual(['edge-01']); expect(result.scanLimited).toBe(false);
  });
  it('preserves stored weight/validity without claiming effective mitigation', async () => {
    const {read}=fixture([edge('dated',{validFrom:'2026-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z',decayFn:'linear'})]);
    const result=await read({tenantId:'t1',projectId:'p1'});
    expect(result.edges[0]).toMatchObject({weight:0.8,validFrom:'2026-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z',decayFn:'linear'});
    expect(JSON.stringify(result)).not.toContain('effectiveWeight');
  });
  it('limits the complete UTF-8 result size with long literal identifiers', async () => {
    const long='x'.repeat(1450); const rows=Array.from({length:50},(_,i)=>edge(`edge-${i}`,{fromNodeId:long+'a',toNodeId:long+'b'}));
    const {read}=fixture(rows,{[long+'a']:{projectId:'p1',tenantId:'t1'},[long+'b']:{projectId:'p1',tenantId:'t1'}});
    const result=await read({tenantId:'t1',projectId:'p1',limit:50}); expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(64*1024);
    expect(result.edges.length).toBeGreaterThan(0); expect(result.edges.length).toBeLessThan(50); expect(result.scanLimited).toBe(true);
  });
  it('redacts storage errors instead of returning successful empty data', async () => {
    const firestore: AdminFirestoreLike={collection(){throw new Error('private-project/credential');}};
    const read=createTypedEdgesReader({firestore,accessibleTenants:['t1'],allowedProjects:[{tenantId:'t1',projectId:'p1'}]});
    await expect(read({tenantId:'t1',projectId:'p1'})).rejects.toThrow('mcp_edges_store_unavailable');
  });
  it.each([0,-1,51,1.5,NaN,Infinity])('rejects invalid limit %s without reads', async limit => {
    const {read,trace}=fixture(); await expect(read({tenantId:'t1',projectId:'p1',limit})).rejects.toThrow(); expect(trace).toEqual([]);
  });
});
