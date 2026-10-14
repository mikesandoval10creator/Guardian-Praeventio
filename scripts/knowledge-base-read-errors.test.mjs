import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual GET callback, without initializing Firebase or network clients.
const source = ts.createSourceFile('knowledgeBase.ts', readFileSync(new URL('../src/server/routes/knowledgeBase.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const callbacks = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'get' && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === '/:projectId/knowledge-base') {
    const callback = node.arguments.at(-1);
    assert.ok(ts.isArrowFunction(callback));
    callbacks.push(callback.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(callbacks.length, 1);
const { outputText } = ts.transpileModule(`export function create(scope) {
  const { scalarRouteParams, guard, getFirestore, logger, captureRouteError } = scope;
  return ${callbacks[0]};
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { create } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

async function invoke({ failure, docs = [], query = {}, authorized = true } = {}) {
  const reads = [], captured = [], logs = [];
  const collection = {
    collection(name) { reads.push(name); return this; },
    doc(id) { reads.push(id); return this; },
    async get() { if (failure) throw failure; return { docs }; },
  };
  const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  const callback = create({
    scalarRouteParams: value => value,
    guard: async (uid, projectId, response) => {
      assert.equal(uid, 'dummy-user'); assert.equal(projectId, 'dummy-project');
      if (authorized) return { tenantId: 'dummy-tenant' };
      response.status(403).json({ error: 'forbidden' }); return null;
    },
    getFirestore: () => collection,
    logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    captureRouteError: (...args) => captured.push(args),
  });
  await callback({ user: { uid: 'dummy-user' }, params: { projectId: 'dummy-project' }, query }, res);
  return { res, reads, captured, logs };
}

for (const code of ['permission-denied', 'unavailable']) {
  test(`GET reports ${code} as a failure instead of a successful empty corpus`, async () => {
    const failure = Object.assign(new Error('dummy internal storage detail'), { code });
    for (const query of [{}, { category: 'guide' }, { search: 'dummy query' }]) {
      const result = await invoke({ failure, query });
      assert.equal(result.res.code, 500);
      assert.deepEqual(result.res.body, { error: 'internal_error' });
      assert.deepEqual(result.captured, [[failure, 'knowledgeBase.list']]);
      assert.ok(result.logs.some(args => args[0] === 'knowledgeBase.list.error'));
    }
  });
}

test('GET retains the successful empty-corpus contract', async () => {
  const { res, captured } = await invoke();
  assert.equal(res.code, 200); assert.deepEqual(res.body, { entries: [], searched: false, category: null });
  assert.deepEqual(captured, []);
});

test('GET preserves tenant/project scoping and category filtering', async () => {
  const docs = ['guide', 'faq'].map(kind => ({ id: kind, data: () => ({ kind, title: kind, content: 'dummy content' }) }));
  const { res, reads } = await invoke({ docs, query: { category: 'guide' } });
  assert.equal(res.code, 200); assert.deepEqual(res.body.entries.map(entry => entry.id), ['guide']);
  assert.deepEqual(reads, ['tenants', 'dummy-tenant', 'projects', 'dummy-project', 'knowledge_base']);
});

test('GET does not read the corpus after authorization denial', async () => {
  const { res, reads, captured } = await invoke({ authorized: false });
  assert.equal(res.code, 403); assert.deepEqual(reads, []); assert.deepEqual(captured, []);
});
