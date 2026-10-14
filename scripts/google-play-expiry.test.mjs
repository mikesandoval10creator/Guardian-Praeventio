import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

async function load(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const helperUrl = new URL('../src/services/billing/googlePlayExpiry.ts', import.meta.url);
const parseGooglePlayExpiryTime = existsSync(helperUrl)
  ? (await load(readFileSync(helperUrl, 'utf8'))).parseGooglePlayExpiryTime : undefined;
// Execute both actual production expiry expressions, without loading Google,
// credentials, Express, Firestore, or any other route side effects.
const routeUrl = new URL('../src/server/routes/billing/googleplay.ts', import.meta.url);
const source = ts.createSourceFile('googleplay.ts', readFileSync(routeUrl, 'utf8'), ts.ScriptTarget.Latest, true);
const expressions = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === 'expiryDate' && node.initializer) expressions.push(node.initializer.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(expressions.length, 2, 'cover both purchase verification and RTDN expiry writes');

for (const [index, expression] of expressions.entries()) {
  const { evaluate } = await load(`export function evaluate(lineItem, data, parseGooglePlayExpiryTime) { return ${expression}; }`);
  const expiry = value => evaluate({ expiryTime: value }, { lineItems: [{ expiryTime: value }] }, parseGooglePlayExpiryTime);
  const name = index === 0 ? 'purchase verification' : 'RTDN webhook';
  test(`${name}: preserve Google RFC3339 expiry without converting the year to milliseconds`, () => {
    for (const value of ['2030-10-14T12:00:00Z', '2030-10-14T12:00:00.123456789Z', '2030-10-14T12:00:00+05:30', '2028-02-29T00:00:00Z', '0004-02-29T00:00:00Z']) {
      assert.equal(expiry(value), value);
    }
  });
  test(`${name}: missing expiry remains null`, () => {
    for (const value of [null, undefined, '']) assert.equal(expiry(value), null);
  });
  test(`${name}: malformed expiry cannot become a persisted date`, () => {
    for (const value of ['garbage', '2030', '1900000000000', '2030-02-30T12:00:00Z', '2030-13-01T00:00:00Z', '2030-01-01T25:00:00Z', '2100-02-29T00:00:00Z', '0000-01-01T00:00:00Z', 1900000000000, {}]) {
      assert.throws(() => expiry(value), /Invalid Google Play expiryTime/);
    }
  });
}
