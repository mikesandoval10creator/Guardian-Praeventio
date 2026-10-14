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

function fixture(nodes, maxSubgraphNodes) {
  const reads = [];
  const collection = {
    doc(id) {
      assert.ok(typeof id === 'string' && id.length > 0, 'Firestore document path must be a nonempty string');
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

test('malformed stored connections cannot abort traversal or consume its read budget', async () => {
  const nodes = new Map([
    ['root', { connections: [42, null, false, {}, [], '', 'nested/path/node', 'child'] }],
    ['child', { connections: ['grandchild'] }],
    ['grandchild', {}],
  ]);
  const { adapter, reads } = fixture(nodes, 3);
  const result = await adapter.expandSubgraph('test-tenant', 'root', 2);
  assert.deepEqual(reads, ['root', 'child', 'grandchild']);
  assert.deepEqual(result.map(node => node.id), reads);
});

test('node snapshots expose only valid connection IDs, preserving order and duplicates', async () => {
  const { adapter } = fixture(new Map([['root', {
    connections: ['child', 42, '', 'nested/path/node', null, 'other', 'child'],
  }]]), 3);
  assert.deepEqual((await adapter.getNode('test-tenant', 'root')).connections, ['child', 'other', 'child']);
});

test('missing and non-array stored connection fields remain empty', async () => {
  for (const connections of [undefined, null, 'child', { child: true }]) {
    const { adapter, reads } = fixture(new Map([['root', { connections }]]), 3);
    const result = await adapter.expandSubgraph('test-tenant', 'root', 2);
    assert.deepEqual(result[0].connections, []);
    assert.deepEqual(reads, ['root']);
  }
});
