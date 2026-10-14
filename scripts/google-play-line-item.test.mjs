import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual production selection and expiry statements without
// loading Google clients, authentication, credentials or Firestore.
const source = ts.createSourceFile('googleplay.ts', readFileSync(new URL('../src/server/routes/billing/googleplay.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const expiryHelper = readFileSync(new URL('../src/services/billing/googlePlayExpiry.ts', import.meta.url), 'utf8');
const groups = [];
function visit(node) {
  if (ts.isBlock(node)) {
    const end = node.statements.findIndex(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'expiryDate'));
    if (end >= 0) {
      const statements = node.statements.slice(0, end + 1).filter(statement => {
        if (ts.isIfStatement(statement)) return statement.getText(source).includes('lineItem');
        return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
          ts.isIdentifier(declaration.name) && ['lineItem', 'expiryDate'].includes(declaration.name.text));
      });
      groups.push(statements.map(statement => statement.getText(source)).join('\n'));
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(groups.length, 2, 'cover verify and RTDN selection before expiry writes');
for (const [index, statements] of groups.entries()) {
  const { outputText } = ts.transpileModule(`${expiryHelper}
    export function evaluate(data, sku) { const subData=data; const productId=sku; const subscriptionId=sku;
      ${statements}
      return { expiryDate, orderId: typeof lineItem === 'undefined' ? null : lineItem.latestSuccessfulOrderId };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const { evaluate } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const name = index === 0 ? 'purchase verification' : 'RTDN webhook';
  const target = { productId: 'target-sku', expiryTime: '2030-01-02T00:00:00Z', latestSuccessfulOrderId: 'dummy-target-order' };
  const unrelated = { productId: 'other-sku', expiryTime: '2035-01-01T00:00:00Z', latestSuccessfulOrderId: 'dummy-other-order' };
  test(`${name}: select the exact requested SKU regardless of line-item order`, () => {
    for (const lineItems of [[unrelated, target], [target, unrelated]]) {
      assert.equal(evaluate({ lineItems }, 'target-sku').expiryDate, target.expiryTime);
    }
  });
  test(`${name}: reject a purchase without the requested SKU before computing an expiry`, () => {
    for (const lineItems of [[unrelated], [], undefined, null]) {
      assert.throws(() => evaluate({ lineItems }, 'target-sku'), /Google Play product mismatch/);
    }
  });
}
