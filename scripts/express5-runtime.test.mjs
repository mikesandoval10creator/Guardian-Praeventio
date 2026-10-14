import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import ts from 'typescript';

const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const routes = new Map();
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.get'
      && ts.isStringLiteral(node.arguments[0])) {
    routes.set(node.arguments[0].text, node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);

// Load the actual route declarations without booting Firebase or server.ts.
function register(app, route, cwd) {
  assert.ok(route, 'Expected route declaration in server.ts');
  const { outputText } = ts.transpileModule(route, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  vm.runInNewContext(outputText, {
    app, path, process: { cwd: () => cwd },
    INDEX_HTML_TEMPLATE: '<html>fixture</html>', stampCspNonce: html => html,
  });
}

test('public association files load from .well-known without exposing other files', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'express5-links-'));
  const directory = path.join(cwd, 'public', '.well-known');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'apple-app-site-association'), '{"applinks":{"paths":["/sos"]}}');
  writeFileSync(path.join(directory, 'assetlinks.json'), '[{"relation":["fixture"]}]');
  writeFileSync(path.join(directory, '.env'), 'DUMMY_SECRET');
  try {
    const app = express();
    for (const name of ['apple-app-site-association', 'assetlinks.json']) {
      const route = `/.well-known/${name}`;
      register(app, routes.get(route), cwd);
      const response = await request(app).get(route);
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], /^application\/json/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.match(response.headers['cache-control'], /max-age=3600/);
      assert.doesNotThrow(() => JSON.parse(response.text));
    }
    assert.equal((await request(app).get('/.well-known/.env')).status, 404);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('production SPA fallback accepts root and deep links after API routes', async () => {
  const app = express();
  app.get('/api/fixture', (_req, res) => res.json({ fixture: true }));
  register(app, routes.get('/{*splat}') ?? routes.get('*'), '/unused');
  for (const route of ['/', '/projects/fixture']) {
    const response = await request(app).get(route);
    assert.equal(response.status, 200);
    assert.equal(response.text, '<html>fixture</html>');
  }
  assert.deepEqual((await request(app).get('/api/fixture')).body, { fixture: true });
});

test('async rejections reach the error handler without Express 4 patches', async () => {
  const app = express();
  app.get('/fixture/error', async () => { throw new Error('dummy outage'); });
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  const response = await request(app).get('/fixture/error').timeout({ response: 1500, deadline: 2000 });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: 'dummy outage' });
});
