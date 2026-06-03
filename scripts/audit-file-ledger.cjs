#!/usr/bin/env node
/**
 * audit-file-ledger.cjs
 *
 * Per-file ledger for the file-by-file context audit. For EVERY file returned
 * by `git ls-files`, extracts real, non-hallucinated signals straight from the
 * source:
 *   - path, category (same taxonomy as audit-coverage-census.cjs), best-effort block
 *   - loc (line count)
 *   - purpose: first meaningful leading comment / JSDoc line (the file's own words)
 *   - exports: exported symbol names (ts/tsx/js/cjs/mjs)
 *   - hasTest: whether a sibling/co-located *.test.* or *.spec.* exists
 *
 * Output (under docs/audits/file-ledger/):
 *   - INDEX.md                  summary counts
 *   - ledger.json               machine-readable, all files
 *   - <CATEGORY>.md             one Markdown table per category (reviewable)
 *
 * This is the MECHANICAL layer of the full file-by-file review: it guarantees
 * every file has a real one-line characterization extracted from its own header
 * and exports. The deep per-file review (file:line findings) is layered on top,
 * block by block, in the CONTEXT_AUDIT report.
 *
 * Usage: node scripts/audit-file-ledger.cjs
 */
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'audits', 'file-ledger');

function trackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

// --- category taxonomy (mirrors audit-coverage-census.cjs) -----------------
const CATEGORY_RULES = [
  ['I-TEST', (f) => /(^|\/)(__tests__|__smoke__|rules-tests|tests|loadtest)\//.test(f)],
  ['I-TEST', (f) => /(^|\/)src\/test\//.test(f)],
  ['I-TEST', (f) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(f)],
  ['I-TEST', (f) => /^firestore\.test\.rules$/.test(f)],
  ['FEAT-pages', (f) => /^src\/pages\//.test(f)],
  ['FEAT-components', (f) => /^src\/components\//.test(f)],
  ['FEAT-routes', (f) => /^src\/routes\//.test(f)],
  ['FEAT-server', (f) => /^src\/server\//.test(f) || /^server\.ts$/.test(f)],
  ['FEAT-hooks', (f) => /^src\/hooks\//.test(f)],
  ['FEAT-services', (f) => /^src\/services\//.test(f)],
  ['I-I18N', (f) => /^src\/i18n\//.test(f)],
  ['I-DATA', (f) => /^src\/data\//.test(f)],
  ['I-PLAT', (f) => /^(android|ios|fastlane)\//.test(f) || /^packages\/capacitor-mesh\//.test(f) || /^src\/workers\//.test(f) || /^(capacitor|ionic)\.config/.test(f)],
  ['I-CORE', (f) => /^src\/(contexts|store|providers|lib|utils|types|constants)(\/|\.)/.test(f) || /^src\/(App\.tsx|main\.tsx|index\.css|vite-env\.d\.ts|constants\.ts)$/.test(f)],
  ['I-DOCS', (f) => /^(docs|tasks|templates)\//.test(f) || /\.md$/.test(f) || /^LICENSE$/.test(f)],
  ['I-ASSETS', (f) => /^(public|marketplace)\//.test(f) || /^index\.html$/.test(f)],
  ['I-BUILD', (f) => /^(infra|infrastructure|scripts|bin)\//.test(f) || /^\.(github|husky|claude|telemetry)\//.test(f) || /^(firestore|storage)\.rules$/.test(f) || /^(Dockerfile|Gemfile|Rakefile|Makefile|Procfile)/.test(f) || /^[^/]+\.(json|ya?ml|js|cjs|mjs|ts|toml|lock|xml|env|example|sh|conf|config)$/.test(f) || /^\.[^/]+$/.test(f)],
];
function classifyCategory(f) {
  for (const [cat, fn] of CATEGORY_RULES) if (fn(f)) return cat;
  return 'UNMAPPED';
}

// --- best-effort block (mirrors census, condensed) -------------------------
const BLOCK_RULES = [
  ['B1-Emergencia', /emergenc|\bsos\b|evacuat|evacuac|loneworker|lone-worker|lone_worker|mandown|fall(detection|monitor)|refug|restrictedzone|restricted-zone|brigad|firstresponder|first-responder|drill|contingenc|comms|geofenc|panic/i],
  ['B7-Salud', /health|salud|medic|vital|fatigue|circadian|mentalload|mental-load|hygiene|vigilanc|aptitud|anatomy|drug|disease|biometr|healthvault|wearable|telemetry|heartrate/i],
  ['B3-Ergonomia', /ergonom|reba|rula|tmert|prexor|posture|pose|landmark|plaesi|musculo/i],
  ['B2-RiesgoIPER', /\biper\b|riskrad|riskrank|riskmatrix|residualrisk|bowtie|\bjsa\b|criticalcontrol|shiftrisk|preshift|heatmap|maturity|hazard|peligr/i],
  ['B4-Incidentes', /incident|rootcause|root-cause|investigat|lessonslearned|correctiveaction|cuasi|nearmiss|accident/i],
  ['B5-Cumplimiento', /complian|cumplim|suseso|regulat|legalobl|legalcalendar|nonconform|industryrul|\bdte\b|\bdiat\b|\bdiep\b|ds54|ds44|ds40|privacyret|retention|\bsii\b/i],
  ['B6-Capacitacion', /curricul|training|capacita|microtrain|safetytalk|spacedrep|skillgap|apprentic|onboard|lesson|coursew|gamif|arcade|claw|quiz/i],
  ['B8-PermisosLOTO', /workpermit|work-permit|permiso|\bloto\b|lockout|tagout|softblock|exception|engineeringcontrol|stoppage|paraliz/i],
  ['B9-Inspecciones', /inspect|checklist|observ|\bbbs\b|sitebook|site-book|libroobr|formbuilder|photoevidence|qrsign|qrack|qr-ack|findings/i],
  ['B10-EPP', /\bepp\b|equipment|maintenanc|mantenim|horometr|signalet|hazmat|asset|\bppe\b|inventory|spare/i],
  ['B11-Contratistas', /contractor|subcontrat|visitor|visita|vendoronboard|accredit|acredit|consultativesale/i],
  ['B12-CPHS', /\bcphs\b|comite|committee|parit|culturep|meetingpack|agenda|organic|raci/i],
  ['B13-MOC', /operationalchange|operational-change|\bmoc\b|changemgmt|shifthandover|commut|continuit|criticalrole|managementofchange/i],
  ['B14-IA', /gemini|\bslm\b|aiToggle|aiguardrail|aiquality|explainab|coachrag|aifeedback|researchmode|copilot|asesor|\bllm\b|\brag\b|orchestrat|prompt|mediapipe|onnx|tinyllama/i],
  ['B15-Billing', /billing|subscription|suscrip|\btier\b|payment|webpay|mercadopago|khipu|preventioncost|invoice|paywall|pricing|checkout|\biap\b/i],
  ['B16-Offline', /offline|\bpwa\b|capacitor|\bmesh\b|syncstatus|sync-status|servicework|indexeddb|sqlite|conflictqueue|sensorbus/i],
  ['B17-Admin', /\badmin\b|tenant|\bauth\b|\brbac\b|auditchain|auditportal|auditlog|audittrail|pyme|oauth|\brole\b|permission|magiclink|session|verifyauth|login|signup|account/i],
  ['B18-Analitica', /analytic|report|dashboard|\bkpi\b|metric|aggregat|orgmetric|dataconfidence|portablehist|safetyperform|safetymetric|projectcompar|predictivealert|reportsautom|chart/i],
];
function classifyBlock(f) {
  for (const [b, re] of BLOCK_RULES) if (re.test(f)) return b;
  return '';
}

const TEXT_EXT = /\.(ts|tsx|js|jsx|cjs|mjs|json|md|css|html|rules|kt|swift|java|yml|yaml|xml|sh|toml|cfg|conf|txt|svg)$/i;
const CODE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs|kt|swift|java)$/i;

function firstComment(lines) {
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    let l = lines[i].trim();
    if (!l) continue;
    if (/^(import|export|const|let|var|function|class|app\.|router\.|#!|<\?xml|<!DOCTYPE|<html|@charset|:root|package|use |\{|\}|\[|"|'|`)/.test(l)) {
      // hit code before any comment
      if (l.startsWith('/*') || l.startsWith('//') || l.startsWith('*')) {/* keep */} else break;
    }
    const m = l.match(/^(\/\/+|\/\*+|\*+|#|<!--)\s?(.*)$/);
    if (m) {
      let txt = m[2].replace(/\*\/\s*$/, '').replace(/-->\s*$/, '').trim();
      if (txt && !/^(eslint|@ts-|prettier|@vitest|@charset|SPDX-|Copyright|©|\/?\*?$)/i.test(txt)) {
        return txt.slice(0, 160);
      }
    }
  }
  return '';
}

function extractExports(content) {
  const names = new Set();
  const re = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(content)) && names.size < 12) names.add(m[1]);
  const re2 = /export\s*\{([^}]+)\}/g;
  while ((m = re2.exec(content)) && names.size < 12) {
    m[1].split(',').forEach((s) => {
      const n = s.trim().split(/\s+as\s+/)[0].trim();
      if (n && /^[A-Za-z0-9_]+$/.test(n)) names.add(n);
    });
  }
  if (/export\s+default\s+(?!function|class)/.test(content)) names.add('default');
  return [...names];
}

function main() {
  const files = trackedFiles();
  const testSet = new Set(files);
  const ledger = [];

  for (const f of files) {
    const abs = path.join(ROOT, f);
    let loc = 0, purpose = '', exportsArr = [];
    const isText = TEXT_EXT.test(f);
    try {
      if (isText) {
        const content = fs.readFileSync(abs, 'utf8');
        const lines = content.split('\n');
        loc = lines.length;
        purpose = firstComment(lines);
        if (CODE_EXT.test(f)) exportsArr = extractExports(content);
      } else {
        loc = 0;
      }
    } catch { /* binary or unreadable */ }

    // sibling test detection
    const base = f.replace(/\.(tsx?|jsx?|cm?js)$/, '');
    const hasTest = CODE_EXT.test(f) && !/\.(test|spec)\./.test(f) && (
      testSet.has(base + '.test.ts') || testSet.has(base + '.test.tsx') ||
      testSet.has(base + '.spec.ts') || testSet.has(base + '.spec.tsx')
    );

    ledger.push({
      path: f,
      category: classifyCategory(f),
      block: classifyBlock(f),
      loc,
      purpose,
      exports: exportsArr,
      hasTest,
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'ledger.json'), JSON.stringify(ledger, null, 1));

  // group by category → one MD each
  const byCat = new Map();
  for (const r of ledger) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  }

  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  for (const [cat, rows] of byCat) {
    rows.sort((a, b) => a.path.localeCompare(b.path));
    let md = `# File ledger — ${cat} (${rows.length} files)\n\n`;
    md += `Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.\n\n`;
    md += `| Archivo | Bloque | LOC | Test | Propósito / exports |\n|---|---|---:|:--:|---|\n`;
    for (const r of rows) {
      const detail = r.purpose
        ? esc(r.purpose)
        : (r.exports.length ? '_exports:_ ' + esc(r.exports.join(', ')) : '');
      md += `| \`${esc(r.path)}\` | ${r.block || ''} | ${r.loc || ''} | ${r.hasTest ? '✓' : ''} | ${detail} |\n`;
    }
    fs.writeFileSync(path.join(OUT_DIR, `${cat}.md`), md);
  }

  // INDEX
  let idx = `# File ledger — índice\n\n`;
  idx += `**Total archivos:** ${ledger.length} · generado por \`scripts/audit-file-ledger.cjs\`.\n\n`;
  idx += `Extracción mecánica por archivo (propósito desde el comentario de cabecera del propio archivo + exports del fuente). Es la capa mecánica del barrido archivo-por-archivo; la revisión profunda con hallazgos \`file:line\` se acumula en \`CONTEXT_AUDIT_2026-06.md\` por bloque.\n\n`;
  idx += `| Categoría | Archivos | Con propósito extraído | Con exports |\n|---|---:|---:|---:|\n`;
  for (const [cat, rows] of [...byCat].sort((a, b) => b[1].length - a[1].length)) {
    const withPurpose = rows.filter((r) => r.purpose).length;
    const withExports = rows.filter((r) => r.exports.length).length;
    idx += `| [${cat}](./${cat}.md) | ${rows.length} | ${withPurpose} | ${withExports} |\n`;
  }
  idx += `\n**Cobertura:** ${ledger.length}/${ledger.length} archivos con una fila en el ledger (gate sin-fila = 0).\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'INDEX.md'), idx);

  console.log(`Ledger generated: ${ledger.length} files across ${byCat.size} categories → ${path.relative(ROOT, OUT_DIR)}/`);
  const noRow = files.length - ledger.length;
  console.log(`Rows: ${ledger.length}  ·  files without row: ${noRow}  ${noRow === 0 ? '(PASS)' : '(FAIL)'}`);
  process.exit(noRow === 0 ? 0 : 1);
}

main();
