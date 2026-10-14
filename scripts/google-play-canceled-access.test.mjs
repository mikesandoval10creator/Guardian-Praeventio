import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Evaluate the actual state decisions of verify and RTDN with a fixed clock,
// without importing Google clients, credentials or Firestore.
const source = ts.createSourceFile('googleplay.ts', readFileSync(new URL('../src/server/routes/billing/googleplay.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const expressions = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === 'isActive' && node.initializer) expressions.push(node.initializer.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(expressions.length, 2, 'cover both purchase verification and RTDN state decisions');
const now = Date.parse('2030-01-01T00:00:00Z');
for (const [index, expression] of expressions.entries()) {
  const { outputText } = ts.transpileModule(`export function evaluate(data, expiryDate, now) {
    const subData = data;
    const Date = { now: () => now, parse: globalThis.Date.parse };
    return ${expression};
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const { evaluate } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const active = (state, expiry) => evaluate({ subscriptionState: `SUBSCRIPTION_STATE_${state}` }, expiry, now);
  const name = index === 0 ? 'purchase verification' : 'RTDN webhook';
  test(`${name}: cancellation preserves the remaining paid period`, () => {
    assert.equal(active('CANCELED', '2030-01-02T00:00:00Z'), true);
  });
  test(`${name}: cancellation grants no access at or after expiry, or without a valid expiry`, () => {
    for (const expiry of ['2030-01-01T00:00:00Z', '2029-12-31T00:00:00Z', null, undefined, '', 'invalid']) {
      assert.equal(active('CANCELED', expiry), false);
    }
  });
  test(`${name}: active/grace decisions remain intact and other states stay inactive`, () => {
    for (const state of ['ACTIVE', 'IN_GRACE_PERIOD']) assert.equal(active(state, '2030-01-02T00:00:00Z'), true);
    for (const state of ['PENDING', 'PAUSED', 'ON_HOLD', 'EXPIRED', 'REVOKED', 'UNSPECIFIED', 'PENDING_PURCHASE_CANCELED']) {
      assert.equal(active(state, '2030-01-02T00:00:00Z'), false);
    }
  });
}
