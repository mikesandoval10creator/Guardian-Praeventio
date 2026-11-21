import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { env } from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import express from 'express';
import { build } from 'vite';
import { securityHeaders } from '../../../../src/server/middleware/securityHeaders.ts';

assert.equal(env.NODE_ENV, 'production', 'Use the production CSP for this check');
const wasm = await readFile(new URL('../../target/wasm32-unknown-unknown/release/guardian_gaussian_splat.wasm', import.meta.url));
const bundle = await build({
  configFile: false,
  publicDir: false,
  worker: { format: 'es' },
  build: {
    write: false,
    rollupOptions: { input: fileURLToPath(new URL('./scene.mjs', import.meta.url)) },
  },
});
assert.ok(!Array.isArray(bundle) && 'output' in bundle);
const entry = bundle.output.find((asset) => asset.type === 'chunk' && asset.isEntry);
assert.ok(entry);
const assets = new Map(bundle.output.map((asset) => [asset.fileName, asset.type === 'chunk' ? asset.code : asset.source]));
const app = express();
app.use(securityHeaders);
app.get('/', (_req, res) => res.type('html').send(
  `<!doctype html><canvas width="256" height="256"></canvas><script type="module" nonce="${res.locals.cspNonce}" src="/${entry.fileName}"></script>`,
));
app.get('/engine.wasm', (_req, res) => res.type('application/wasm').send(wasm));
app.use((req, res) => {
  const bytes = assets.get(req.path.slice(1));
  if (bytes === undefined) return res.sendStatus(404);
  return res.type('text/javascript').send(typeof bytes === 'string' ? bytes : Buffer.from(bytes));
});
const server = app.listen(0, '127.0.0.1');
let browser;
try {
  await once(server, 'listening');
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
  const errors = [];
  const workers = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker.url()));
  const response = await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.ok(response.ok());
  const policy = await response.headerValue('content-security-policy');
  assert.match(policy, /script-src [^;]*'wasm-unsafe-eval'/);
  assert.match(policy, /worker-src 'self'/);
  await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 15_000 });
  const canvas = page.locator('canvas');
  const empty = await canvas.screenshot();
  const invalid = await page.evaluate(() => globalThis.splatProbe(true));
  assert.deepEqual(invalid, { detached: true, reason: 'invalid_geometry' });
  assert.ok(empty.equals(await canvas.screenshot()), 'Invalid capture must not change the canvas');
  const valid = await page.evaluate(() => globalThis.splatProbe(false));
  assert.deepEqual(valid, { detached: true, count: 1 });
  await expect.poll(async () => empty.equals(await canvas.screenshot()), { timeout: 10_000 }).toBe(false);
  await page.evaluate(() => globalThis.removeSplatProbe());
  await expect.poll(async () => empty.equals(await canvas.screenshot()), { timeout: 10_000 }).toBe(true);
  const validators = workers.map((url) => new URL(url)).filter((url) => /\/validationWorker-[^/]+\.js$/.test(url.pathname));
  assert.equal(validators.length, 2, `Expected two validation workers; observed ${workers.join(', ')}`);
  assert.ok(validators.every((url) => url.origin === new URL(response.url()).origin));
  assert.deepEqual(errors, []);
  globalThis.console.log('PASS: bundled module worker, WASM, and PlayCanvas under the production-mode middleware CSP');
} finally {
  try { await browser?.close(); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
