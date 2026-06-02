#!/usr/bin/env node
/**
 * audit-test-coverage-map.cjs
 *
 * File-by-file coverage of the I-TEST category (1.2k+ files) without prose:
 * maps every test file to the SOURCE module it exercises and to a functional
 * block, then reports which source areas have/lack co-located tests.
 *
 * Rationale: tests mirror their subject. Reading each test deeply is low-value;
 * the audit-relevant facts are (a) every test is accounted for, (b) which
 * source files have a co-located test, (c) where the coverage gaps are, and
 * (d) the skip/fixme inventory.
 *
 * Output: docs/audits/file-ledger/DEEP-TESTS-map.md
 *
 * Usage: node scripts/audit-test-coverage-map.cjs
 */
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const LEDGER = path.join(ROOT, 'docs/audits/file-ledger/ledger.json');
const OUT = path.join(ROOT, 'docs/audits/file-ledger/DEEP-TESTS-map.md');

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return e.stdout ? String(e.stdout) : ''; }
}

function main() {
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const all = ledger.map((r) => r.path);
  const allSet = new Set(all);
  const tests = ledger.filter((r) => r.category === 'I-TEST');
  const srcCode = ledger.filter((r) => /\.(ts|tsx)$/.test(r.path) && !/\.(test|spec)\./.test(r.path) && (r.category.startsWith('FEAT') || r.category === 'I-CORE'));

  // 1. co-located test detection for each source file
  let withTest = 0;
  const noTestByBlock = {};
  for (const s of srcCode) {
    const base = s.path.replace(/\.(tsx?|jsx?)$/, '');
    const has = allSet.has(base + '.test.ts') || allSet.has(base + '.test.tsx') ||
                allSet.has(base + '.spec.ts') || allSet.has(base + '.spec.tsx');
    if (has) withTest++;
    else {
      const b = s.block || s.category;
      noTestByBlock[b] = (noTestByBlock[b] || 0) + 1;
    }
  }

  // 2. classify each test by kind/location
  const kind = {};
  for (const t of tests) {
    let k = 'co-located unit';
    if (/(^|\/)__tests__\/server\//.test(t.path)) k = 'server (supertest)';
    else if (/rules-tests\//.test(t.path) || /\.rules\.test\./.test(t.path)) k = 'firestore rules';
    else if (/\.firestore\.test\./.test(t.path)) k = 'firestore (emulator)';
    else if (/(^|\/)(tests|e2e)\//.test(t.path) || /\.spec\.ts$/.test(t.path)) k = 'e2e/playwright';
    else if (/__smoke__/.test(t.path)) k = 'smoke';
    else if (/(^|\/)__tests__\//.test(t.path)) k = '__tests__ suite';
    kind[k] = (kind[k] || 0) + 1;
  }

  // 3. skip/fixme inventory
  const skips = sh(`rg -n "describe\\.skip|it\\.skip|test\\.skip|describe\\.fixme|\\.fixme\\(|xit\\(|xdescribe\\(" -g '*.ts' -g '*.tsx' src tests 2>/dev/null`).trim().split('\n').filter(Boolean);

  // build doc
  let md = `# DEEP — Tests: mapa de cobertura (I-TEST) · 2026-06-02\n\n`;
  md += `Cobertura mecánica de los ${tests.length} archivos de test (categoría I-TEST). Los tests reflejan su módulo-sujeto; esta es la capa factual del barrido para esa categoría (cada test contabilizado + dónde están los gaps).\n\n`;

  md += `## 1. Tests por tipo\n\n| Tipo | Archivos |\n|---|---:|\n`;
  for (const [k, n] of Object.entries(kind).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${n} |\n`;
  md += `| **TOTAL I-TEST** | **${tests.length}** |\n\n`;

  md += `## 2. Cobertura co-located de código fuente\n\n`;
  md += `Archivos de código (FEAT*/I-CORE, no-test) con test co-located (\`*.test.ts(x)\` hermano):\n\n`;
  md += `- **Con test co-located:** ${withTest} / ${srcCode.length} (${(withTest / srcCode.length * 100).toFixed(1)}%)\n`;
  md += `- **Sin test co-located:** ${srcCode.length - withTest} (pueden estar cubiertos por suites \`__tests__/\` no co-located)\n\n`;
  md += `> Nota: muchos módulos se prueban vía suites en \`src/__tests__/\` (server supertest, contracts) que no son co-located; este conteo subestima la cobertura real. Es un indicador de gaps, no la cobertura definitiva (usar \`vitest --coverage\` para la métrica oficial).\n\n`;

  md += `### Sin test co-located, por bloque/categoría (top)\n\n| Bloque/Categoría | Archivos sin test co-located |\n|---|---:|\n`;
  for (const [b, n] of Object.entries(noTestByBlock).sort((a, b) => b[1] - a[1]).slice(0, 25)) md += `| ${b} | ${n} |\n`;
  md += `\n`;

  md += `## 3. Inventario de skips/fixme (${skips.length})\n\n`;
  if (skips.length) {
    md += `\`\`\`\n${skips.slice(0, 60).join('\n')}\n\`\`\`\n`;
    if (skips.length > 60) md += `\n_(+${skips.length - 60} más)_\n`;
  } else {
    md += `Ninguno detectado.\n`;
  }
  md += `\n## 4. Para decisión del usuario\n\n`;
  md += `- Los gaps de §2 son candidatos a priorizar tests (especialmente bloques de vida/privacidad).\n`;
  md += `- Los skips de §3 deben reconciliarse (reactivar o documentar por qué).\n`;
  md += `- La cobertura oficial debe medirse con \`vitest run --coverage\`; este mapa es estructural.\n`;

  fs.writeFileSync(OUT, md);
  console.log(`Test coverage map written: ${path.relative(ROOT, OUT)}`);
  console.log(`Tests: ${tests.length} · src with co-located test: ${withTest}/${srcCode.length} · skips: ${skips.length}`);
}

main();
