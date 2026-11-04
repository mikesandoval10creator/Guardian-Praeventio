const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { readBuiltLayoutWasm } = require('../lib/layout-wasm-gate.cjs');

const root = path.resolve(__dirname, '../..');
const fixtureDir = path.join(root, 'scripts/fixtures/force-graph');
const sourcePath = path.join(root, 'src/workers/forceGraphWorker.ts');
// Preserved from the lab before executing this repository gate. These are
// coordinate-equivalence tolerances, NOT speed/adoption thresholds.
const ABSOLUTE_TOLERANCE = 1e-6;
const RELATIVE_TOLERANCE = 1e-9;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function assertPositionsNear(actual, reference) {
  assert.ok(Array.isArray(actual), 'parity_shape');
  assert.equal(actual.length, reference.length, 'parity_count');
  let maxAbs = 0;
  for (let i = 0; i < reference.length; i++) {
    assert.deepEqual(Object.keys(actual[i]).sort(), Object.keys(reference[i]).sort(), 'parity_shape');
    assert.equal(actual[i].id, reference[i].id, 'parity_id_order');
    for (const axis of Object.hasOwn(reference[i], 'z') ? ['x', 'y', 'z'] : ['x', 'y']) {
      const a = actual[i][axis], b = reference[i][axis];
      assert.ok(Number.isFinite(a) && Number.isFinite(b), 'parity_nonfinite');
      const error = Math.abs(a - b);
      assert.ok(error <= ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(b), `parity_position at node ${i} axis ${axis}: ${error}`);
      maxAbs = Math.max(maxAbs, error);
    }
  }
  return maxAbs;
}

function runWasm(k, payload) {
  for (const name of ['graph_alloc', 'graph_free', 'graph_layout']) assert.equal(typeof k[name], 'function', `missing ABI ${name}`);
  assert.ok(k.memory instanceof WebAssembly.Memory);
  const input = new TextEncoder().encode(JSON.stringify(payload));
  assert.ok(input.length <= 2 * 1024 * 1024, 'input exceeds experimental bridge cap');
  const ptr = k.graph_alloc(input.length);
  assert.ok(Number.isInteger(ptr) && ptr > 0, 'allocation rejected');
  try {
    new Uint8Array(k.memory.buffer, ptr, input.length).set(input);
    const packed = k.graph_layout(ptr, input.length);
    assert.equal(typeof packed, 'bigint');
    const address = Number(packed & 0xffffffffn), length = Number(packed >> 32n);
    assert.ok(address > 0 && length > 0 && length <= 8 * 1024 * 1024, 'invalid output allocation');
    assert.ok(address + length <= k.memory.buffer.byteLength, 'output out of bounds');
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(k.memory.buffer, address, length)));
    } finally {
      k.graph_free(address, length);
    }
  } finally {
    k.graph_free(ptr, input.length);
  }
}

const baseline = [{ id: 'a', x: 0, y: 1 }];
test('parity comparator rejects changed finite coordinates', () => {
  assert.throws(() => assertPositionsNear([{ id: 'a', x: 1, y: 1 }], baseline), /parity_position/);
});
test('parity comparator rejects changed IDs instead of matching only array length', () => {
  assert.throws(() => assertPositionsNear([{ id: 'foreign', x: 0, y: 1 }], baseline), /parity_id_order/);
});
test('parity comparator rejects truncated output', () => {
  assert.throws(() => assertPositionsNear([], baseline), /parity_count/);
});
test('parity comparator rejects non-finite coordinates on either side', () => {
  assert.throws(() => assertPositionsNear([{ id: 'a', x: NaN, y: 1 }], baseline), /parity_nonfinite/);
  assert.throws(() => assertPositionsNear(baseline, [{ id: 'a', x: Infinity, y: 1 }]), /parity_nonfinite/);
});
test('parity comparator rejects an unexpected Z axis', () => {
  assert.throws(() => assertPositionsNear([{ ...baseline[0], z: 0 }], baseline), /parity_shape/);
});
test('canonical WASM contract command includes the differential parity suite', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['test:layout-wasm'].includes('scripts/__tests__/force-graph-wasm-parity.test.cjs'), 'parity suite is not wired into the required artifact gate');
});
test('shared fixtures preserve original inputs and predeclared tolerances', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.absoluteTolerance, ABSOLUTE_TOLERANCE);
  assert.equal(manifest.relativeTolerance, RELATIVE_TOLERANCE);
  assert.deepEqual(manifest.fixtures.map((f) => f.nodes), [100, 1000, 10000]);
  for (const f of manifest.fixtures) {
    const bytes = fs.readFileSync(path.join(fixtureDir, f.file));
    assert.equal(hash(bytes), f.sha256, `fixture ${f.file} changed`);
    assert.equal(bytes.length, f.sizeBytes);
    const payload = JSON.parse(bytes);
    assert.equal(payload.nodes.length, f.nodes);
    assert.equal(payload.links.length, f.links);
    assert.equal(payload.iterations, f.iterations);
    assert.equal(payload.dim, f.dim);
  }
});

const bytes = readBuiltLayoutWasm(); // required mode throws, never silently skips
const cases = [
  ['empty', { nodes: [], links: [] }],
  ['single-unseeded', { nodes: [{ id: 'a' }], links: [] }],
  ['two-seeded', { nodes: [{ id: 'a', x: 0, y: 1 }, { id: 'b', x: 20, y: 3 }], links: [{ source: 'a', target: 'b' }] }],
  ['coincident', { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: 0, y: 0 }], links: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }] }],
  ['warm-3d', { nodes: [{ id: 'a', x: 1, y: 2, z: 8 }, { id: 'b', x: 3, y: 4 }], links: [], dim: 3 }],
  ['dangling', { nodes: [{ id: 'a', x: 0, y: 1 }], links: [{ source: 'a', target: 'missing' }] }],
  ['duplicates', { nodes: [{ id: 'a', x: 1, y: 2 }, { id: 'a', x: 3, y: 4 }, { id: 'b', x: 8, y: 9 }], links: [{ source: 'a', target: 'b' }] }],
  ['unseeded', { nodes: Array.from({ length: 12 }, (_, i) => ({ id: String(i) })), links: [], iterations: 10 }],
  // The central edge has degree3 at BOTH endpoints (strength1/3), unlike
  // a star's leaf edges whose minimum endpoint degree is always1.
  ['mixed-degree', { nodes: ['ha', 'hb', 'a1', 'a2', 'b1', 'b2'].map((id) => ({ id })), links: [
    { source: 'ha', target: 'hb' }, { source: 'ha', target: 'a1' }, { source: 'ha', target: 'a2' },
    { source: 'hb', target: 'b1' }, { source: 'hb', target: 'b2' },
  ] }],
];
for (const count of [100, 1000, 10000]) cases.push([`shared-${count}`, JSON.parse(fs.readFileSync(path.join(fixtureDir, `fixtures-${count}.json`), 'utf8'))]);

test('real WASM differential parity against current product TypeScript', {
  skip: !bytes ? 'optional run: build WASM first; required adoption mode rejects absence' : false,
  timeout: 120_000,
}, async (t) => {
  const sourceBefore = hash(fs.readFileSync(sourcePath));
  // Native TypeScript import on the declared Node24/26 engine, not a frozen
  // lab copy, transpiled algorithm rewrite, stored answer or replacement model.
  const { runSimulation } = await import(pathToFileURL(sourcePath).href);
  t.diagnostic(JSON.stringify({ reference: 'src/workers/forceGraphWorker.ts', referenceSha256: sourceBefore, wasmSha256: hash(bytes), absoluteTolerance: ABSOLUTE_TOLERANCE, relativeTolerance: RELATIVE_TOLERANCE }));
  for (const [name, payload] of cases) {
    await t.test(name, async (child) => {
      const pristine = JSON.stringify(payload);
      const reference = runSimulation(payload);
      assert.deepEqual(runSimulation(payload), reference, 'current TypeScript reference must also be deterministic');
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const actual = runWasm(instance.exports, payload);
      const maxAbs = assertPositionsNear(actual, reference);
      assert.deepEqual(runWasm(instance.exports, payload), actual, 'repeated calls must be deterministic');
      assert.equal(JSON.stringify(payload), pristine, 'input mutation');
      child.diagnostic(JSON.stringify({ case: name, nodes: reference.length, maxAbs }));
    });
  }
  await t.test('semantic mutation of real WASM output is rejected', async () => {
    const payload = cases.find(([name]) => name === 'two-seeded')[1];
    const reference = runSimulation(payload);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const actual = runWasm(instance.exports, payload);
    assertPositionsNear(actual, reference);
    const swapped = actual.map((p) => ({ ...p, x: p.y, y: p.x }));
    assert.throws(() => assertPositionsNear(swapped, reference), /parity_position/);
    const shifted = actual.map((p, i) => ({ ...p, x: p.x + (i === 0 ? 1 : 0) }));
    assert.throws(() => assertPositionsNear(shifted, reference), /parity_position/);
  });
  assert.equal(hash(fs.readFileSync(sourcePath)), sourceBefore, 'reference changed during the run');
});
