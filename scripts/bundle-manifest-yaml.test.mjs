import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/compliance/bundleExport.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { buildManifest, buildCombinedBundle, buildJsonlBundle } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const HASH = 'a'.repeat(64);
function input(overrides = {}) {
  return { uid: 'dummy-subject', requestId: 'dummy-request', generatedAt: new Date('2030-01-01T00:00:00.000Z'), applicableRegimes: ['GDPR-EU'], incomplete: [], exportedData: { profile: { name: 'Dummy profile' } }, ...overrides };
}
function assertManifest(value) {
  const before = JSON.stringify(value);
  const parsed = load(buildManifest(value, HASH));
  assert.deepEqual(parsed, {
    subject_uid: value.uid, request_id: value.requestId, generated_at: value.generatedAt.toISOString(),
    export_complete: value.incomplete.length === 0, incomplete_categories: value.incomplete,
    applicable_regimes: value.applicableRegimes, data_jsonl_sha256: HASH, categories_included: Object.keys(value.exportedData),
  });
  assert.equal(JSON.stringify(value), before);
}

test('the default manifest parses as a single mapping with a root-level category list', () => assertManifest(input()));
test('all dynamic scalar values survive YAML punctuation, whitespace and Unicode unchanged', () => {
  for (const value of [' value: # note ', 'a\nexport_complete: true', 'a"b\\c', 'Muñoz 中文 🛡️', 'a\u0085b\u2028c\u2029d', 'a\u0000b\t c']) {
    assertManifest(input({ uid: value, requestId: value, applicableRegimes: [value], incomplete: [value], exportedData: { [value]: { dummy: true } } }));
  }
});
test('YAML-like strings remain strings instead of booleans, nulls, aliases, numbers or dates', () => {
  for (const value of ['null', 'true', '0123', '2030-01-01', '*anchor', '[a, b]', '{key: value}', '']) {
    assertManifest(input({ uid: value, requestId: value, applicableRegimes: [value], incomplete: [value], exportedData: { [value]: [] } }));
  }
});
test('empty collections round-trip as arrays rather than YAML nulls', () => assertManifest(input({ applicableRegimes: [], exportedData: {} })));
test('the combined bundle manifest hashes the exact emitted UTF-8 JSONL bytes', () => {
  const supplied = input({ exportedData: { profile: { text: 'Dummy: 中文 # value\nnext' } }, incomplete: ['unavailable: # category'] });
  const { body } = buildCombinedBundle(supplied);
  const manifest = body.split('===== file: manifest.yaml =====\n')[1].split('\n\n===== file: data.jsonl =====')[0];
  const jsonl = body.split('===== file: data.jsonl =====\n')[1].split('\n\n===== file: data.csv =====')[0];
  const parsed = load(manifest);
  assert.equal(jsonl, buildJsonlBundle(supplied));
  assert.equal(parsed.data_jsonl_sha256, createHash('sha256').update(jsonl, 'utf8').digest('hex'));
  assert.equal(parsed.export_complete, false); assert.deepEqual(parsed.incomplete_categories, supplied.incomplete);
});
