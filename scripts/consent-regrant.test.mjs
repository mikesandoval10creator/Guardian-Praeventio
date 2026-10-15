import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Extract actual consent operations without loading Firebase or production services.
const source = ts.createSourceFile('ley19628.ts', readFileSync(new URL('../src/services/compliance/ley19628.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['ComplianceError', 'consentDocId', 'recordConsent', 'revokeConsent', 'getConsentStatus']);
const selected = source.statements.filter(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && names.has(node.name?.text));
assert.equal(selected.length, names.size);
const output = ts.transpileModule(`export function create(scope) {
 const { FieldValue, Date } = scope;
 const CONSENTS_COLLECTION = 'compliance_consents';
 ${selected.map(node => node.getText(source).replace(/^export /, '')).join('\n')}
 return { recordConsent, revokeConsent, getConsentStatus };
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { create } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const grant = (overrides = {}) => ({ uid: 'dummy-A', purpose: 'marketing', granted: true, legalBasis: 'consent', textVersion: 'dummy-v1', ...overrides });
function fixture() {
 const store = new Map(), writes = [], deletion = Symbol('field-delete'); let clock = 1000, fail = false;
 function ref(id) {
  return { async set(data, options) {
    if (fail) throw new Error('dummy write failed');
    assert.ok(Object.values(data).every(value => value !== undefined), 'undefined is not field deletion');
    const result = options?.merge ? { ...store.get(id) } : {};
    for (const [key, value] of Object.entries(data)) { if (value === deletion) delete result[key]; else result[key] = value; }
    writes.push({ id, data, options }); store.set(id, result);
  }, async get() { return { exists: store.has(id), data: () => store.get(id) }; }, async update(data) { store.set(id, { ...store.get(id), ...data }); } };
 }
 const db = { collection(name) { assert.equal(name, 'compliance_consents'); return { doc: ref, where(field, op, uid) {
   assert.equal(field, 'uid'); assert.equal(op, '=='); return { async get() { return { docs: [...store.values()].filter(data => data.uid === uid).map(data => ({ data: () => ({ ...data }) })) }; } };
 } }; } };
 const ops = create({ FieldValue: { delete: () => deletion }, Date: { now: () => clock } });
 return { db, store, writes, ...ops, setTime: value => { clock = value; }, failWrite: () => { fail = true; } };
}

test('grant, revoke, re-grant removes the stale revocation and returns consistent status', async () => {
 const f = fixture(); await f.recordConsent(f.db, grant());
 f.setTime(2000); await f.revokeConsent(f.db, 'dummy-A', 'marketing');
 assert.equal((await f.getConsentStatus(f.db, 'dummy-A')).marketing.revokedAt, 2000);
 f.setTime(3000); const returned = await f.recordConsent(f.db, grant({ textVersion: 'dummy-v2' }));
 const persisted = (await f.getConsentStatus(f.db, 'dummy-A')).marketing;
 assert.equal(persisted.granted, true); assert.equal(Object.hasOwn(persisted, 'revokedAt'), false);
 assert.deepEqual(persisted, returned); assert.equal(returned.grantedAt, 3000);
});
test('re-grant preserves unrelated metadata and other users and purposes', async () => {
 const f = fixture(); await f.recordConsent(f.db, grant()); await f.revokeConsent(f.db, 'dummy-A', 'marketing');
 f.store.get('dummy-A__marketing').auditTag = 'dummy-keep';
 await f.recordConsent(f.db, grant({ purpose: 'analytics' })); await f.recordConsent(f.db, grant({ uid: 'dummy-B' }));
 await f.revokeConsent(f.db, 'dummy-A', 'analytics'); await f.revokeConsent(f.db, 'dummy-B', 'marketing');
 const analytics = { ...f.store.get('dummy-A__analytics') }, other = { ...f.store.get('dummy-B__marketing') };
 await f.recordConsent(f.db, grant());
 assert.equal(f.store.get('dummy-A__marketing').auditTag, 'dummy-keep');
 assert.equal(Object.hasOwn(f.store.get('dummy-A__marketing'), 'revokedAt'), false);
 assert.deepEqual(f.store.get('dummy-A__analytics'), analytics); assert.deepEqual(f.store.get('dummy-B__marketing'), other);
});
test('fresh grants keep their timestamp and expose no persistence sentinel', async () => {
 const f = fixture(); const returned = await f.recordConsent(f.db, grant({ grantedAt: 500 }));
 assert.equal(returned.grantedAt, 500); assert.equal(Object.hasOwn(returned, 'revokedAt'), false);
 assert.deepEqual(f.store.get('dummy-A__marketing'), returned);
});
test('denied consent does not erase an existing revocation', async () => {
 const f = fixture(); await f.recordConsent(f.db, grant()); await f.revokeConsent(f.db, 'dummy-A', 'marketing');
 await f.recordConsent(f.db, grant({ granted: false }));
 assert.equal(f.store.get('dummy-A__marketing').revokedAt, 1000); assert.equal(f.store.get('dummy-A__marketing').granted, false);
});
test('core-service revocation stays rejected and invalid uid never writes', async () => {
 const f = fixture(); await assert.rejects(f.revokeConsent(f.db, 'dummy-A', 'core_service'), error => error.code === 'core_consent_required');
 await assert.rejects(f.recordConsent(f.db, grant({ uid: '' })), error => error.code === 'invalid_uid'); assert.equal(f.writes.length, 0);
});
test('a failed re-grant leaves the revoked record unchanged', async () => {
 const f = fixture(); await f.recordConsent(f.db, grant()); await f.revokeConsent(f.db, 'dummy-A', 'marketing');
 const before = { ...f.store.get('dummy-A__marketing') }; f.failWrite();
 await assert.rejects(f.recordConsent(f.db, grant()), /dummy write failed/); assert.deepEqual(f.store.get('dummy-A__marketing'), before);
});
