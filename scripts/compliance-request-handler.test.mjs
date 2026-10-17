import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('ley19628.ts', readFileSync(new URL('../src/services/compliance/ley19628.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['ComplianceError', 'processDataAccessRequest'];
const selected = source.statements.filter(node => (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && names.includes(node.name?.text));
assert.equal(selected.length, names.length);
const output = ts.transpileModule(`export function create(Date, logger, FieldValue) {
 const REQUESTS_COLLECTION = 'compliance_data_requests';
 ${selected.map(node => node.getText(source).replace(/^export /, '')).join('\n')}
 return processDataAccessRequest;
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { create } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const deletedField = Symbol('deleted field');
const loggedErrors = [];
const processRequest = create(
 { now: () => 2000 },
 { error: (...args) => loggedErrors.push(args) },
 { delete: () => deletedField },
);
function fixture(type = 'access', status = 'pending', exists = true) {
 let row = { uid: 'dummy-subject', type, status, requestedAt: 1000 };
 const writes = [];
 const db = { collection(name) {
  assert.equal(name, 'compliance_data_requests');
  return { doc(id) {
   assert.equal(id, 'dummy-request');
   return { async get() { return { id, exists, data: () => ({ ...row }) }; }, async update(patch) {
    writes.push({ ...patch });
    row = { ...row, ...patch };
    for (const [key, value] of Object.entries(patch)) {
     if (value === deletedField) delete row[key];
    }
   } };
  } };
 } };
 return { db, writes, stored: () => row };
}
for (const type of ['access', 'portability', 'erasure', 'rectification']) {
 test(`${type}: no handler must reject without recording completion`, async () => {
  const f = fixture(type);
  await assert.rejects(processRequest(f.db, 'dummy-request'), error => error.code === 'handler_missing');
  assert.equal(f.stored().status, 'rejected');
  assert.equal(f.stored().rejectionReason, 'processing_failed');
  assert.ok(f.writes.every(patch => patch.status !== 'completed'));
 });
 test(`${type}: matching handler completes once and preserves its result`, async () => {
  const f = fixture(type); const calls = [];
  const work = async request => { calls.push(request); return { downloadUrl: '/dummy-export' }; };
  const handlers = type === 'access' || type === 'portability' ? { onExport: work } : type === 'erasure' ? { onErase: work } : { onRectify: work };
  const result = await processRequest(f.db, 'dummy-request', handlers);
  assert.equal(result.status, 'completed'); assert.equal(f.stored().status, 'completed');
  assert.equal(calls.length, 1); assert.equal(calls[0].uid, 'dummy-subject'); assert.equal(result.completedAt, 2000);
  assert.deepEqual(f.writes.map(patch => patch.status), ['processing', 'completed']);
  if (type === 'access' || type === 'portability') assert.equal(result.exportedToUrl, '/dummy-export');
 });
}
test('an unrelated configured handler does not count as execution', async () => {
 const f = fixture('erasure'); let called = false;
 await assert.rejects(processRequest(f.db, 'dummy-request', { onExport: async () => { called = true; return { downloadUrl: '/dummy' }; } }), error => error.code === 'handler_missing');
 assert.equal(called, false); assert.equal(f.stored().status, 'rejected');
});
test('already completed requests remain idempotent even without handlers', async () => {
 const f = fixture('erasure', 'completed'); const result = await processRequest(f.db, 'dummy-request');
 assert.equal(result.status, 'completed'); assert.equal(f.writes.length, 0);
});
test('handler failures retain diagnostics only in the internal log and do not complete', async () => {
 const f = fixture('rectification'); const failure = new Error('dummy handler failure');
 await assert.rejects(processRequest(f.db, 'dummy-request', { onRectify: async () => { throw failure; } }), error => error === failure);
 assert.equal(f.stored().status, 'rejected'); assert.equal(f.stored().rejectionReason, 'processing_failed');
 assert.deepEqual(loggedErrors.at(-1), [
  'compliance_data_request_processing_failed', failure,
  { requestId: 'dummy-request', type: 'rectification' },
 ]);
});
test('missing requests keep the not-found response without a write', async () => {
 const f = fixture('access', 'pending', false);
 await assert.rejects(processRequest(f.db, 'dummy-request'), error => error.code === 'not_found'); assert.equal(f.writes.length, 0);
});
test('a request rejected for a missing handler can be retried after configuration', async () => {
 const f = fixture('erasure');
 await assert.rejects(processRequest(f.db, 'dummy-request'), error => error.code === 'handler_missing');
 let calls = 0; const result = await processRequest(f.db, 'dummy-request', { onErase: async () => { calls += 1; } });
 assert.equal(calls, 1); assert.equal(f.stored().status, 'completed');
 assert.equal(Object.hasOwn(f.stored(), 'rejectionReason'), false);
 assert.equal(Object.hasOwn(result, 'rejectionReason'), false);
});
