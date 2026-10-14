import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/server/http/scalarRouteParams.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { scalarRouteParams } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('preserves scalar identifiers and the original params object', () => {
  const params = Object.assign(Object.create(null), { projectId: 'project-a', nodeId: 'node-a' });
  assert.equal(scalarRouteParams(params), params);
  assert.equal(scalarRouteParams(params).projectId, 'project-a');
});

test('rejects wildcard arrays instead of coercing them to an identifier', () => {
  for (const projectId of [['project-a'], ['project-a', 'project-b'], []]) {
    assert.throws(() => scalarRouteParams({ projectId }), /scalar route parameters/);
  }
});

test('does not invent values for omitted optional parameters', () => {
  const params = scalarRouteParams({});
  assert.equal(params.missing, undefined);
  assert.equal(params.missing || 'fallback', 'fallback');
  assert.equal(scalarRouteParams({ optional: '' }).optional, '');
});

test('rejects invalid shapes and non-string values', () => {
  for (const params of [null, undefined, [], 'project-a', { projectId: 1 }, { projectId: undefined }]) {
    assert.throws(() => scalarRouteParams(params), /scalar route parameters/);
  }
});
