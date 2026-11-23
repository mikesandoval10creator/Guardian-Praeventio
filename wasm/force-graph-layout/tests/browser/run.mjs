import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { env } from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';
import express from 'express';
import { build } from 'vite';
import { securityHeaders } from '../../../../src/server/middleware/securityHeaders.ts';

assert.equal(env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
const { readBuiltLayoutWasm } = require('../../../../scripts/lib/layout-wasm-gate.cjs');
const wasm = readBuiltLayoutWasm({ required: true });
const bundle = await build({ configFile: false, publicDir: false, worker: { format: 'es' }, build: {
  write: false, rollupOptions: { input: fileURLToPath(new URL('./entry.mjs', import.meta.url)) },
} });
assert.ok(!Array.isArray(bundle) && 'output' in bundle);
const entry = bundle.output.find((asset) => asset.type === 'chunk' && asset.isEntry);
assert.ok(entry);
const assets = new Map(bundle.output.map((asset) => [asset.fileName, asset.type === 'chunk' ? asset.code : asset.source]));
const app = express();
app.use(securityHeaders);
app.get('/', (_req, res) => res.type('html').send(`<script type="module" nonce="${res.locals.cspNonce}" src="/${entry.fileName}"></script>`));
app.get('/engine.wasm', (_req, res) => res.type('application/wasm').send(wasm));
app.get('/empty.wasm', (_req, res) => res.type('application/wasm').send(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])));
app.use((req, res) => {
  const asset = assets.get(req.path.slice(1));
  if (asset === undefined) return res.sendStatus(404);
  return res.type('text/javascript').send(typeof asset === 'string' ? asset : Buffer.from(asset));
});
const server = app.listen(0, '127.0.0.1');
let browser;
try {
  await once(server, 'listening');
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  const workers = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(new URL(worker.url())));
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await page.goto(origin);
  assert.ok(response.ok());
  const policy = await response.headerValue('content-security-policy');
  assert.match(policy, /script-src [^;]*'wasm-unsafe-eval'/);
  assert.match(policy, /worker-src 'self'/);
  await page.waitForFunction(() => typeof globalThis.layoutProbe === 'function');
  const run = (scenario, payload) => page.evaluate(([mode, input]) => globalThis.layoutProbe(mode, input), [scenario, payload]);
  const baseline = await run('off');
  assert.equal(baseline.engine, 'typescript');
  assert.deepEqual(baseline.positions.map(({ id }) => id), ['a', 'b']);
  assert.ok(!requests.some((path) => path.endsWith('.wasm')));
  const actual = await run('on');
  assert.equal(actual.engine, 'wasm');
  assert.deepEqual(actual.positions.map(({ id }) => id), ['a', 'b']);
  actual.positions.forEach((p, i) => {
    for (const key of ['x', 'y']) assert.ok(Math.abs(p[key] - baseline.positions[i][key]) <= 1e-6 + 1e-9 * Math.abs(baseline.positions[i][key]));
  });
  const fallback = await run('bad-abi');
  assert.deepEqual(fallback, { ...baseline, fallbackReason: 'layout_worker_failed' });
  assert.deepEqual(await run('abort'), { error: 'AbortError' });
  const fixture = require('../../../../scripts/fixtures/force-graph/fixtures-1000.json');
  const nodes = fixture.nodes.map(({ id }) => ({ id }));
  for (const input of [
    { nodes, links: fixture.links, iterations: 80, dim: 2 },
    { nodes: nodes.map((node, i) => i === 1 ? { ...node, x: 0, y: 1, z: 2 }
      : i === 2 ? { ...node, x: 40, z: -3 } : node), links: fixture.links, iterations: 80, dim: 3 },
  ]) {
    const reference = await run('off', input);
    const result = await run('on', input);
    assert.equal(reference.engine, 'typescript');
    assert.equal(result.engine, 'wasm');
    for (const positions of [reference.positions, result.positions]) {
      assert.deepEqual(positions.map(({ id }) => id), nodes.map(({ id }) => id));
    }
    result.positions.forEach((point, index) => {
      const expected = reference.positions[index];
      for (const axis of input.dim === 2 ? ['x', 'y'] : ['x', 'y', 'z']) {
        assert.ok(Math.abs(point[axis] - expected[axis]) <= 1e-6 + 1e-9 * Math.abs(expected[axis]),
          `${input.dim}D ${point.id}.${axis}: WASM ${point[axis]} vs TypeScript ${expected[axis]}`);
      }
    });
    globalThis.console.log(`PASS: ${input.dim}D layout parity with missing coordinates (${nodes.length} nodes)`);
  }
  assert.ok(workers.some((url) => /\/forceGraphWasmWorker-[^/]+\.js$/.test(url.pathname)));
  assert.ok(workers.every((url) => url.origin === origin));
  assert.deepEqual(errors, []);
  globalThis.console.log('PASS: bundled layout workers under production-mode CSP: TypeScript default, real WASM parity, invalid ABI fallback, abort');
} finally {
  try { await browser?.close(); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
