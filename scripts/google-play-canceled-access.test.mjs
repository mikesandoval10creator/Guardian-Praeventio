import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Evaluate the actual state decisions of verify and RTDN with a fixed clock,
// without importing Google clients, credentials or Firestore.
const source = ts.createSourceFile('googleplay.ts', readFileSync(new URL('../src/server/routes/billing/googleplay.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const expressions = [];
const decisions = [];
function visit(node) {
  if (ts.isBlock(node)) {
    const end = node.statements.findIndex(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'isActive'));
    if (end >= 0) decisions.push(node.statements.slice(0, end + 1).filter(statement => {
      if (ts.isIfStatement(statement)) return statement.getText(source).includes('lineItem');
      return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
        ts.isIdentifier(declaration.name) && ['lineItem', 'expiryDate', 'isActive'].includes(declaration.name.text));
    }).map(statement => statement.getText(source)).join('\n'));
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === 'isActive' && node.initializer) expressions.push(node.initializer.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(expressions.length, 2, 'cover both purchase verification and RTDN state decisions');
const now = Date.parse('2030-01-01T00:00:00Z');
assert.equal(decisions.length, 2);
const helper = readFileSync(new URL('../src/services/billing/googlePlayExpiry.ts', import.meta.url), 'utf8');
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
  test(`${name}: canceled access uses only the paid period of the matching SKU`, async () => {
    const { outputText } = ts.transpileModule(`${helper}
      export function decide(data, sku, now) { const subData=data; const productId=sku; const subscriptionId=sku;
        const Date={now:()=>now,parse:globalThis.Date.parse};
        ${decisions[index]}
        return isActive;
      }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    const { decide } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
    const item = (productId, expiryTime) => ({ productId, expiryTime });
    const data = lineItems => ({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', lineItems });
    assert.equal(decide(data([item('other', '2035-01-01T00:00:00Z'), item('target', '2029-12-31T00:00:00Z')]), 'target', now), false);
    assert.equal(decide(data([item('other', '2029-12-31T00:00:00Z'), item('target', '2030-01-02T00:00:00Z')]), 'target', now), true);
    assert.throws(() => decide(data([item('other', '2035-01-01T00:00:00Z')]), 'target', now), /Google Play product mismatch/);
  });
}
