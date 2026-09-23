// Patch postinstall para artillery@2.0.34 (DEV-tooling: load testing).
//
// Problema: artillery importa `import csv from 'csv-parse'` (default export, API
// callback-style de csv-parse@4) pero el CVE de csv-parse <7.0.2 (prototype
// replacement via columns) obliga a usar csv-parse@7 (via overrides en
// package.json), que ya NO tiene default export → el import revienta al cargar
// los comandos `run` / `run-lambda`.
//
// Fix (2 partes):
//   1. dist/lib/cmds/run.js y lib/cmds/run.ts: el import de `_csv` es dead code
//      (nunca se usa) → eliminarlo.
//   2. dist/lib/util/prepare-test-execution-plan.js y .ts: `csv(data, opts, cb)`
//      se usa promisificado (`p(csv)(data, opts)`) → shim sobre csv-parse/sync
//      (misma salida: array de records) con firma callback-style.
//
// Script idempotente: si los imports ya no existen, no hace nada.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEAD_IMPORT_RE = /^import _csv from ['"]csv-parse['"];\r?\n/m;
const USED_IMPORT_RE = /^import csv from ['"]csv-parse['"];\r?\n/m;
const SHIM = [
  "import { parse as _csvParseSync } from 'csv-parse/sync';",
  '// shim: csv-parse@7 (patched) no expone default callback-style; se emula con sync.',
  'const csv = (data, opts, cb) => {',
  '  try { cb(null, _csvParseSync(data, opts)); } catch (err) { cb(err); }',
  '};',
  '',
].join('\n');

const targets = [
  { rel: 'node_modules/artillery/dist/lib/cmds/run.js', re: DEAD_IMPORT_RE, repl: '' },
  { rel: 'node_modules/artillery/lib/cmds/run.ts', re: DEAD_IMPORT_RE, repl: '' },
  { rel: 'node_modules/artillery/dist/lib/util/prepare-test-execution-plan.js', re: USED_IMPORT_RE, repl: SHIM },
  { rel: 'node_modules/artillery/lib/util/prepare-test-execution-plan.ts', re: USED_IMPORT_RE, repl: SHIM },
];

for (const { rel, re, repl } of targets) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue; // artillery no instalado (prod install) → nada que hacer
  const before = readFileSync(abs, 'utf8');
  if (!re.test(before)) continue; // ya aplicado o formato cambió → sin cambios
  writeFileSync(abs, before.replace(re, repl), 'utf8');
  console.log(`[patch-artillery] csv-parse v7-compat aplicado en ${rel}`);
}

process.exit(0);
