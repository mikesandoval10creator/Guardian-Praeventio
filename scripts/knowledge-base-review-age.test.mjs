import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const NOW = '2030-01-01T00:00:00.000Z';
const source = ts.createSourceFile('knowledgeBase.ts', readFileSync(new URL('../src/server/routes/knowledgeBase.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const callbacks = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'post' && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/:projectId/knowledge-base/:id/use') {
    const callback = node.arguments.at(-1); assert.ok(ts.isArrowFunction(callback)); callbacks.push(callback.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source); assert.equal(callbacks.length, 1);
const output = ts.transpileModule(`export function create(scope) {
  const { scalarRouteParams, guard, getFirestore, FieldValue, logger, captureRouteError, auditServerEvent, Date } = scope;
  return ${callbacks[0]};
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { create } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const service = ts.transpileModule(readFileSync(new URL('../src/services/knowledgeBase/knowledgeBaseService.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { detectObsolescenceCandidates } = await import(`data:text/javascript;base64,${Buffer.from(service).toString('base64')}`);

async function invoke({ reviewed = '2025-01-01T00:00:00.000Z', exists = true, allowed = true, failure } = {}) {
  const article = { id: 'dummy-entry', kind: 'guide', title: 'Dummy article', content: 'Dummy content', tags: [], lastReviewedAt: reviewed, viewCount: 8, isObsolete: false, authorUid: 'dummy-curator' };
  const path = [], patches = [], audit = [], errors = [], steps = [];
  const increment = Symbol('increment');
  const ref = { collection(name) { path.push(name); return this; }, doc(id) { path.push(id); return this; } };
  const db = { collection: name => ref.collection(name), async runTransaction(work) {
    if (failure) throw failure;
    return work({ async get(doc) { assert.equal(doc, ref); steps.push('get'); return { exists }; }, update(doc, patch) {
      assert.equal(doc, ref); steps.push('update'); patches.push(patch);
      for (const [key, value] of Object.entries(patch)) article[key] = value === increment ? article.viewCount + 1 : value;
    } });
  } };
  const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  const handler = create({ scalarRouteParams: value => value,
    guard: async (uid, projectId, response) => {
      assert.equal(uid, 'dummy-user'); assert.equal(projectId, 'dummy-project');
      if (allowed) return { tenantId: 'dummy-tenant' };
      response.status(403).json({ error: 'forbidden' }); return null;
    }, getFirestore: () => db, FieldValue: { increment: amount => { assert.equal(amount, 1); return increment; } },
    Date: class extends globalThis.Date { constructor(value) { super(value ?? NOW); } },
    logger: { error() {} }, captureRouteError: (...args) => errors.push(args), auditServerEvent: async (...args) => audit.push(args),
  });
  await handler({ user: { uid: 'dummy-user' }, params: { projectId: 'dummy-project', id: 'dummy-entry' } }, res);
  return { article, path, patches, audit, errors, steps, res };
}

test('using an old article preserves its review age and stale-review candidacy', async () => {
  const result = await invoke();
  assert.equal(result.res.code, 204);
  assert.equal(result.article.lastReviewedAt, '2025-01-01T00:00:00.000Z');
  assert.equal(result.article.lastUsedAt, NOW);
  assert.equal(result.article.viewCount, 9);
  assert.equal(Object.hasOwn(result.patches[0], 'lastReviewedAt'), false);
  assert.deepEqual(detectObsolescenceCandidates([result.article], NOW), [{ articleId: 'dummy-entry', daysSinceReview: 1826, reason: 'stale_review' }]);
});

test('using a recently reviewed article does not manufacture a newer review', async () => {
  const result = await invoke({ reviewed: '2029-12-01T00:00:00.000Z' });
  assert.equal(result.article.lastReviewedAt, '2029-12-01T00:00:00.000Z');
  assert.deepEqual(detectObsolescenceCandidates([result.article], NOW), []);
});

test('use retains scoped transactional increments and its audit event', async () => {
  const result = await invoke();
  assert.deepEqual(result.path, ['tenants', 'dummy-tenant', 'projects', 'dummy-project', 'knowledge_base', 'dummy-entry']);
  assert.deepEqual(result.steps, ['get', 'update']); assert.equal(result.audit.length, 1);
  assert.equal(result.audit[0][1], 'knowledgeBase.use');
});

test('missing articles are not created or audited as used', async () => {
  const result = await invoke({ exists: false });
  assert.equal(result.res.code, 404); assert.deepEqual(result.patches, []); assert.deepEqual(result.audit, []);
});

test('authorization denial prevents any article access', async () => {
  const result = await invoke({ allowed: false });
  assert.equal(result.res.code, 403); assert.deepEqual(result.path, []); assert.deepEqual(result.patches, []);
});

test('transaction failure returns a safe error without a successful use audit', async () => {
  const failure = new Error('dummy storage detail');
  const result = await invoke({ failure });
  assert.equal(result.res.code, 500); assert.deepEqual(result.res.body, { error: 'internal_error' });
  assert.deepEqual(result.patches, []); assert.deepEqual(result.audit, []);
  assert.deepEqual(result.errors, [[failure, 'knowledgeBase.use']]);
});
