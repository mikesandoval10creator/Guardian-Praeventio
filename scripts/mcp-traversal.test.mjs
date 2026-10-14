import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the real adapter without Firebase, network or a live tenant.
const source = readFileSync(new URL('../src/server/mcp/zkFirebaseReadAdapter.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { createZkFirebaseReadAdapter } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);
const coreSource = readFileSync(new URL('../src/services/mcp/zettelkastenServer.ts', import.meta.url), 'utf8');
const core = ts.transpileModule(coreSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { handleMcpRequest } = await import(
  `data:text/javascript;base64,${Buffer.from(core.outputText).toString('base64')}`
);

function listFixture(maxListNodes) {
  const limits = [];
  const query = {
    where() { return this; },
    limit(value) {
      assert.ok(Number.isInteger(value) && value >= 1, 'Firestore requires a positive integer limit');
      limits.push(value);
      return this;
    },
    async get() { return { docs: [] }; },
  };
  const firestore = { collection(path) {
    assert.equal(path, 'tenants');
    return { doc(tenant) {
      assert.equal(tenant, 'test-tenant');
      return { collection(path) {
        assert.equal(path, 'zettelkasten_nodes');
        return query;
      } };
    } };
  } };
  return { limits, adapter: createZkFirebaseReadAdapter({ firestore, accessibleTenants: ['test-tenant'], maxListNodes }) };
}

test('MCP list requests send bounded integer limits to Firestore', async () => {
  const { limits, adapter } = listFixture();
  for (const [limit, expected] of [[1.5, 1], [0.5, 1], [-2, 1], [99.9, 99], [1000, 100], [undefined, 25], [NaN, 25], [Infinity, 25], [-Infinity, 25], ['7', 25]]) {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'zk.listNodes', arguments: { tenantId: 'test-tenant', limit },
    } }, { adapter, allowedTenantIds: new Set(['test-tenant']) });
    assert.equal(response.error, undefined, `limit=${limit}`);
    assert.equal(limits.at(-1), expected);
  }
});

test('direct adapter calls normalize limits and preserve the configured cap', async () => {
  const { limits, adapter } = listFixture(8);
  for (const [limit, expected] of [[1.5, 1], [0, 1], [-5, 1], [100, 8], [undefined, 8], [NaN, 8], [Infinity, 8], [-Infinity, 8]]) {
    await adapter.listNodes('test-tenant', { limit });
    assert.equal(limits.at(-1), expected);
  }
});

test('list caps are positive integers even when configuration is fractional or non-finite', async () => {
  for (const [cap, expected] of [[3.9, 3], [0, 1], [-1, 1], [NaN, 100], [Infinity, 100], [-Infinity, 100]]) {
    const { limits, adapter } = listFixture(cap);
    await adapter.listNodes('test-tenant', {});
    assert.deepEqual(limits, [expected]);
  }
});

test('list normalization never allows an unauthorized tenant to reach Firestore', async () => {
  const { limits, adapter } = listFixture();
  await assert.rejects(adapter.listNodes('other-tenant', { limit: 1.5 }), /not in accessible list/);
  assert.deepEqual(limits, []);
});

function fixture(nodes, maxSubgraphNodes) {
  const reads = [];
  const collection = {
    doc(id) {
      return {
        async get() {
          reads.push(id);
          return { id, exists: nodes.has(id), data: () => nodes.get(id) };
        },
      };
    },
  };
  const firestore = {
    collection(name) {
      assert.equal(name, 'tenants');
      return { doc(tenant) {
        assert.equal(tenant, 'test-tenant');
        return { collection(name) {
          assert.equal(name, 'zettelkasten_nodes');
          return collection;
        } };
      } };
    },
  };
  return {
    reads,
    adapter: createZkFirebaseReadAdapter({ firestore, accessibleTenants: ['test-tenant'], maxSubgraphNodes }),
  };
}

test('missing nodes consume the traversal read budget', async () => {
  const connections = Array.from({ length: 100 }, (_, i) => `missing-${i}`);
  const { adapter, reads } = fixture(new Map([['root', { connections }]]), 4);
  const result = await adapter.expandSubgraph('test-tenant', 'root', 5);
  assert.deepEqual(result.map(node => node.id), ['root']);
  assert.deepEqual(reads, ['root', 'missing-0', 'missing-1', 'missing-2']);
});

test('duplicate missing references are read only once, preserving BFS order', async () => {
  const nodes = new Map([
    ['root', { connections: ['missing', 'missing', 'child'] }],
    ['child', { connections: ['root'] }],
  ]);
  const { adapter, reads } = fixture(nodes, 3);
  const result = await adapter.expandSubgraph('test-tenant', 'root', 5);
  assert.deepEqual(reads, ['root', 'missing', 'child']);
  assert.deepEqual(result.map(node => node.id), ['root', 'child']);
});

test('an unauthorized tenant is rejected before any read', async () => {
  const { adapter, reads } = fixture(new Map(), 4);
  await assert.rejects(adapter.expandSubgraph('other-tenant', 'root', 5), /not in accessible list/);
  assert.deepEqual(reads, []);
});

test('existing nodes still respect depth and the node cap', async () => {
  const nodes = new Map([
    ['root', { connections: ['a', 'b', 'c'] }],
    ['a', { connections: ['root'] }], ['b', {}], ['c', {}],
  ]);
  const { adapter, reads } = fixture(nodes, 3);
  assert.deepEqual((await adapter.expandSubgraph('test-tenant', 'root', 0)).map(node => node.id), ['root']);
  reads.length = 0;
  assert.deepEqual((await adapter.expandSubgraph('test-tenant', 'root', 5)).map(node => node.id), ['root', 'a', 'b']);
  assert.deepEqual(reads, ['root', 'a', 'b']);
});

test('under-budget traversal reads each breadth-first level in order', async () => {
  const nodes = new Map([
    ['root', { connections: ['a', 'b'] }],
    ['a', { connections: ['a-child'] }],
    ['b', { connections: ['b-child'] }],
    ['a-child', { connections: ['root'] }],
    ['b-child', {}],
  ]);
  const { adapter, reads } = fixture(nodes, 6);
  const result = await adapter.expandSubgraph('test-tenant', 'root', 2);
  const expected = ['root', 'a', 'b', 'a-child', 'b-child'];
  assert.deepEqual(reads, expected);
  assert.deepEqual(result.map(node => node.id), expected);
});
