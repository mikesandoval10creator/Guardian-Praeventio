const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

for (const required of [false, true]) {
  test(`actual behavioral memory test without bytes: required=${required}`, (t) => {
    const { root } = fixture(t);
    for (const relative of ['scripts/__tests__/force-graph-wasm-memory-bound.test.cjs', 'scripts/lib/layout-wasm-gate.cjs']) {
      const destination = path.join(root, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.resolve(__dirname, '../..', relative), destination);
    }
    const env = { ...process.env, LAYOUT_WASM_REQUIRED: required ? '1' : '0' };
    // Independent child runner: inherited node:test context would skip all files.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=behavioral memory bound', 'scripts/__tests__/force-graph-wasm-memory-bound.test.cjs'], {
      cwd: root, encoding: 'utf8', env, timeout: 20_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, required ? 1 : 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, required ? /layout_wasm_required_missing/ : /built module absent/);
  });
}

test('full-stack CI builds offline WASM and runs strict behavioral plus browser checks', () => {
  const { load } = require('js-yaml'); // declared devDependency, no new parser dependency
  const workflow = load(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/e2e.yml'), 'utf8'));
  const lane = workflow.jobs['e2e-full-stack'];
  assert.ok(lane, 'required full-stack job absent');
  assert.equal(lane['continue-on-error'], false);
  assert.equal(lane.if, undefined, 'required lane cannot be conditional');
  const step = (name) => {
    const found = lane.steps.find((s) => s.name === name);
    assert.ok(found, `missing step ${name}`);
    assert.equal(found.if, undefined, `${name} cannot be silently skipped`);
    assert.notEqual(found['continue-on-error'], true);
    assert.doesNotMatch(found.run, /\|\|\s*(?:true|exit\s+0)|set\s+\+e/);
    return found;
  };
  const install = step('Install pinned Rust toolchain for experimental layout');
  const pin = fs.readFileSync(path.resolve(__dirname, '../../wasm/force-graph-layout/rust-toolchain.toml'), 'utf8').match(/channel = "([^"]+)"/)[1];
  assert.equal(install.run.trim(), `rustup toolchain install ${pin} --profile minimal --target wasm32-unknown-unknown`);
  const fetch = step('Fetch locked Rust dependencies (network stage only)');
  assert.equal(fetch['working-directory'], 'wasm/force-graph-layout');
  assert.equal(fetch.run.trim(), 'cargo fetch --locked');
  const build = step('Build and verify experimental WASM (not activated)');
  const python = lane.steps.find((s) => s.name === 'Set up Python for offline license audit');
  assert.ok(python, 'required license audit needs an explicit Python runtime');
  assert.equal(python.uses, 'actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0');
  assert.equal(python.with['python-version'], '3.12');
  assert.equal(python.if, undefined);
  assert.notEqual(python['continue-on-error'], true);
  assert.ok(lane.steps.indexOf(python) < lane.steps.indexOf(build));
  assert.equal(build.run.trim(), 'npm run layout-wasm:build\nnpm run test:layout-wasm');
  assert.equal(build.env.LAYOUT_WASM_REQUIRED, '1');
  const browser = step('Run Playwright full-stack tests');
  assert.equal(browser.env.LAYOUT_WASM_REQUIRED, '1');
  assert.match(browser.run, /E2E_FULL_STACK=1/);
  assert.ok(lane.steps.indexOf(install) < lane.steps.indexOf(fetch));
  assert.ok(lane.steps.indexOf(fetch) < lane.steps.indexOf(build));
  assert.ok(lane.steps.indexOf(build) < lane.steps.indexOf(browser));
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'layout-wasm-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modulePath = path.join(root, 'wasm/force-graph-layout/target/wasm32-unknown-unknown/release/force_graph_layout.wasm');
  return { root, modulePath };
}

test('ordinary contract run honestly omits an absent experimental module', (t) => {
  const { readBuiltLayoutWasm } = require('../lib/layout-wasm-gate.cjs');
  const { root } = fixture(t);
  assert.equal(readBuiltLayoutWasm({ root, required: false }), null);
});

test('adoption gate fails rather than skips when the built module is absent', (t) => {
  const { readBuiltLayoutWasm } = require('../lib/layout-wasm-gate.cjs');
  const { root } = fixture(t);
  assert.throws(() => readBuiltLayoutWasm({ root, required: true }), /layout_wasm_required_missing/);
});

test('a corrupt artifact fails even outside the strict adoption lane', (t) => {
  const { readBuiltLayoutWasm } = require('../lib/layout-wasm-gate.cjs');
  const { root, modulePath } = fixture(t);
  fs.mkdirSync(path.dirname(modulePath), { recursive: true });
  fs.writeFileSync(modulePath, 'not a WASM binary');
  assert.throws(() => readBuiltLayoutWasm({ root, required: true }), /layout_wasm_invalid/);
  assert.throws(() => readBuiltLayoutWasm({ root, required: false }), /layout_wasm_invalid/);
});

test('loader returns actual valid bytes (synthetic empty module tests loading only, not the graph ABI)', (t) => {
  const { readBuiltLayoutWasm } = require('../lib/layout-wasm-gate.cjs');
  const { root, modulePath } = fixture(t);
  const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  fs.mkdirSync(path.dirname(modulePath), { recursive: true });
  fs.writeFileSync(modulePath, bytes);
  assert.deepEqual(readBuiltLayoutWasm({ root, required: true }), bytes);
});
