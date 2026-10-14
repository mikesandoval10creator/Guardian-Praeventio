import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import ts from 'typescript';

const source = readFileSync(new URL('../src/server/routes/healthVault.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('healthVault.ts', source, ts.ScriptTarget.Latest, true);
const paths = ['/view/:tokenId/:secret', '/view/:tokenId/:secret/file/:recordId'];
const declarations = ast.statements.filter(statement => {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  return call.expression.getText(ast) === 'router.get'
    && ts.isStringLiteral(call.arguments[0]) && paths.includes(call.arguments[0].text);
});

test('retired routes have one terminating handler, without dormant clinical readers', () => {
  for (const path of paths) {
    assert.equal(declarations.filter(statement => statement.expression.arguments[0].text === path).length, 1);
  }
});

test('retired routes reject access without reading clinical storage', async () => {
  const app = express();
  const router = express.Router();
  let storageCalls = 0;
  const storageTripwire = () => { storageCalls++; throw new Error('Clinical storage must not be called'); };
  for (const declaration of declarations) {
    const { outputText } = ts.transpileModule(declaration.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    vm.runInNewContext(outputText, {
      router, healthVaultViewLimiter: (_req, _res, next) => next(),
      getFirestore: storageTripwire, getStorage: storageTripwire,
      findShareById: storageTripwire,
    });
  }
  app.use(router);
  for (const path of ['/view/dummy-token/dummy-secret', '/view/dummy-token/dummy-secret/file/dummy-record']) {
    const response = await request(app).get(path).timeout({ response: 1500, deadline: 2000 });
    assert.equal(response.status, 410);
    assert.equal(response.body.error, 'legacy_share_reissue_required');
    assert.match(response.headers['cache-control'], /no-store/);
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
  }
  assert.equal(storageCalls, 0);
});
