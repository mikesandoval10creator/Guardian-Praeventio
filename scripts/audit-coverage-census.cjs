#!/usr/bin/env node
/**
 * audit-coverage-census.cjs
 *
 * Coverage Book for docs/audits/CONTEXT_AUDIT_2026-06.md.
 *
 * Control measure for the Context Audit: proves the report accounts for the
 * TOTALITY of the tracked codebase. Every file returned by `git ls-files`
 * is assigned to exactly ONE coverage category. The acceptance gate is
 * UNMAPPED == 0 (no file escapes the audit).
 *
 * Two granularities are produced:
 *   1. CATEGORY level (hard gate): every file maps to a feature surface
 *      (pages/components/server/hooks/services/routes) or an infra bucket
 *      (I-PLAT / I-CORE / I-I18N / I-DATA / I-BUILD / I-TEST / I-DOCS /
 *      I-ASSETS). UNMAPPED must be 0.
 *   2. BLOCK level (best-effort): feature files are tagged with a likely
 *      functional block (B1..B18) via path/keyword heuristics. This is an
 *      AID for the human reviewer, NOT a hard gate — files that do not
 *      keyword-match a block are reported under "B?-needs-human" so the
 *      reviewer can place them. Honest by design (no silent bucketing).
 *
 * Usage:
 *   node scripts/audit-coverage-census.cjs            # summary
 *   node scripts/audit-coverage-census.cjs --unmapped # list unmapped (should be empty)
 *   node scripts/audit-coverage-census.cjs --blocks   # block-level tally
 *   node scripts/audit-coverage-census.cjs --json      # machine-readable
 *
 * Exit code: non-zero if UNMAPPED > 0 (CI-friendly).
 */
'use strict';

const { execSync } = require('node:child_process');

function trackedFiles() {
  const out = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// CATEGORY classification (hard gate). Ordered: first match wins.
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  // Tests first — they belong to I-TEST regardless of their subject directory.
  ['I-TEST', (f) => /(^|\/)__tests__\//.test(f)],
  ['I-TEST', (f) => /(^|\/)__smoke__\//.test(f)],
  ['I-TEST', (f) => /(^|\/)rules-tests\//.test(f)],
  ['I-TEST', (f) => /(^|\/)tests\//.test(f)],
  ['I-TEST', (f) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(f)],
  ['I-TEST', (f) => /(^|\/)loadtest\//.test(f)],
  ['I-TEST', (f) => /(^|\/)src\/test\//.test(f)],

  // Feature surfaces (frontend + server).
  ['FEAT-pages', (f) => /^src\/pages\//.test(f)],
  ['FEAT-components', (f) => /^src\/components\//.test(f)],
  ['FEAT-routes', (f) => /^src\/routes\//.test(f)],
  ['FEAT-server', (f) => /^src\/server\//.test(f)],
  ['FEAT-server', (f) => /^server\.ts$/.test(f)],
  ['FEAT-hooks', (f) => /^src\/hooks\//.test(f)],
  ['FEAT-services', (f) => /^src\/services\//.test(f)],

  // Infra buckets.
  ['I-I18N', (f) => /^src\/i18n\//.test(f)],
  ['I-DATA', (f) => /^src\/data\//.test(f)],
  ['I-PLAT', (f) => /^(android|ios|fastlane)\//.test(f)],
  ['I-PLAT', (f) => /^packages\/capacitor-mesh\//.test(f)],
  ['I-PLAT', (f) => /^src\/workers\//.test(f)],
  ['I-PLAT', (f) => /^(capacitor\.config|ionic\.config)/.test(f)],
  ['I-CORE', (f) => /^src\/(contexts|store|providers|lib|utils|types|constants)(\/|\.)/.test(f)],
  ['I-CORE', (f) => /^src\/(App\.tsx|main\.tsx|index\.css|vite-env\.d\.ts|constants\.ts)$/.test(f)],
  ['I-DOCS', (f) => /^docs\//.test(f)],
  ['I-DOCS', (f) => /^tasks\//.test(f)],
  ['I-DOCS', (f) => /^templates\//.test(f)],
  ['I-DOCS', (f) => /\.md$/.test(f)],
  ['I-ASSETS', (f) => /^public\//.test(f)],
  ['I-ASSETS', (f) => /^marketplace\//.test(f)],
  ['I-BUILD', (f) => /^(infra|infrastructure)\//.test(f)],
  ['I-BUILD', (f) => /^scripts\//.test(f)],
  ['I-BUILD', (f) => /^\.github\//.test(f)],
  ['I-BUILD', (f) => /^\.claude\//.test(f)],
  ['I-BUILD', (f) => /^\.telemetry\//.test(f)],
  ['I-BUILD', (f) => /^(firestore|storage)\.rules$/.test(f)],
  ['I-TEST', (f) => /^firestore\.test\.rules$/.test(f)],
  ['I-BUILD', (f) => /^\.husky\//.test(f)],
  ['I-BUILD', (f) => /^(Dockerfile|Gemfile|Rakefile|Makefile|Procfile)/.test(f)],
  ['I-BUILD', (f) => /^bin\//.test(f)],
  ['I-DOCS', (f) => /^LICENSE$/.test(f)],
  ['I-ASSETS', (f) => /^index\.html$/.test(f)],
  ['I-BUILD', (f) => /^(vite|vitest[^/]*|playwright|stryker|tsconfig|tailwind|postcss|eslint)[^/]*\.(ts|js|cjs|mjs|json)$/.test(f)],
  ['I-BUILD', (f) => /^(package(-lock)?\.json|\.npmrc|\.nvmrc|\.gitignore|\.editorconfig|firebase\.json|\.firebaserc)$/.test(f)],
  // Catch-all root config / dotfiles.
  ['I-BUILD', (f) => /^[^/]+\.(json|yml|yaml|js|cjs|mjs|ts|toml|lock|xml|env|example|sh|conf|config)$/.test(f)],
  ['I-BUILD', (f) => /^\.[^/]+$/.test(f)],
];

function classifyCategory(f) {
  for (const [cat, fn] of CATEGORY_RULES) {
    if (fn(f)) return cat;
  }
  return null; // UNMAPPED
}

// ---------------------------------------------------------------------------
// BLOCK classification (best-effort aid). Keyword → block. First match wins.
// Applied only to FEAT-* files. Non-matching → 'B?-needs-human'.
// ---------------------------------------------------------------------------
const BLOCK_RULES = [
  ['B1-Emergencia', /emergenc|\bsos\b|evacuat|evacuac|loneworker|lone-worker|lone_worker|mandown|man-down|fall(detection|monitor)|refug|restrictedzone|restricted-zone|brigade|brigada|firstresponder|first-responder|drill|contingenc|comms|geofenc|panic/i],
  ['B7-Salud', /health|salud|medic|medicine|vital|fatigue|circadian|mentalload|mental-load|hygiene|vigilanc|aptitud|aptitude|anatomy|drug|disease|epidemi|biometr|healthvault|health-vault|wearable|telemetry|heartrate|heart-rate/i],
  ['B3-Ergonomia', /ergonom|reba|rula|tmert|prexor|posture|pose|landmark|plaesi|musculo/i],
  ['B2-RiesgoIPER', /\biper\b|riskrad|risk-rad|riskrank|risk-rank|riskmatrix|residualrisk|residual-risk|bowtie|\bjsa\b|criticalcontrol|critical-control|shiftrisk|shift-risk|preshift|heatmap|maturity|hazard|peligr/i],
  ['B4-Incidentes', /incident|rootcause|root-cause|investigat|lessonslearned|lessons-learned|correctiveaction|corrective-action|cuasi|nearmiss|near-miss|accident/i],
  ['B5-Cumplimiento', /complian|cumplim|suseso|regulat|legalobl|legal-obl|legalcalendar|legal-calendar|nonconform|non-conform|industryrul|industry-rul|\bdte\b|\bdiat\b|\bdiep\b|\bds54\b|\bds44\b|\bds40\b|privacyret|privacy-ret|retention/i],
  ['B6-Capacitacion', /curricul|training|capacita|microtrain|micro-train|safetytalk|safety-talk|spacedrep|spaced-rep|skillgap|skill-gap|apprentic|onboard|lesson|coursew|gamif|arcade|claw|quiz/i],
  ['B8-PermisosLOTO', /workpermit|work-permit|permiso|\bloto\b|lockout|tagout|softblock|soft-block|exception|engineeringcontrol|engineering-control|stoppage|paraliz/i],
  ['B9-Inspecciones', /inspect|checklist|observ|\bbbs\b|sitebook|site-book|libroobr|formbuilder|form-builder|photoevidence|photo-evidence|qrsign|qr-sign|qrack|qr-ack|findings/i],
  ['B10-EPP', /\bepp\b|equipment|maintenanc|mantenim|horometr|signalet|hazmat|asset|\bppe\b|inventory|spare/i],
  ['B11-Contratistas', /contractor|subcontrat|visitor|visita|vendoronboard|vendor-onboard|accredit|acredit|consultativesale|consultative-sale/i],
  ['B12-CPHS', /\bcphs\b|comite|committee|parit|cultureP|culture-p|meetingpack|meeting-pack|agenda|organic| racimatrix|raci/i],
  ['B13-MOC', /operationalchange|operational-change|\bmoc\b|changemgmt|change-mgmt|shifthandover|shift-handover|commut|continuit|criticalrole|critical-role|managementofchange/i],
  ['B14-IA', /gemini|\bslm\b|\bai[A-Z]|aiToggle|aiguardrail|ai-guardrail|aiquality|ai-quality|explainab|coachrag|coach-rag|aifeedback|ai-feedback|researchmode|research-mode|copilot|asesor|\bllm\b|\brag\b|orchestrat|prompt|mediapipe|onnx|tinyllama/i],
  ['B15-Billing', /billing|subscription|suscrip|\btier\b|payment|webpay|mercadopago|mercado-pago|khipu|preventioncost|prevention-cost|invoice|paywall|pricing|checkout|\biap\b/i],
  ['B16-Offline', /offline|\bpwa\b|capacitor|\bmesh\b|syncstatus|sync-status|sync\b|servicework|service-work|indexeddb|sqlite|conflictqueue|conflict-queue|sensorbus|sensor-bus/i],
  ['B17-Admin', /\badmin\b|tenant|\bauth\b|\brbac\b|\bauditchain|audit-chain|auditportal|audit-portal|auditlog|audit-log|auditTrail|pyme|oauth|\brole\b|permission|magiclink|magic-link|session|verifyauth|login|signup|account/i],
  ['B18-Analitica', /analytic|report|dashboard|\bkpi\b|metric|aggregat|orgmetric|org-metric|dataconfidence|data-confidence|portablehist|portable-hist|safetyperform|safety-perform|safetymetric|safety-metric|projectcompar|project-compar|predictivealert|predictive-alert|reportsautom|reports-autom|chart|\bbi\b/i],
];

function classifyBlock(f) {
  for (const [block, re] of BLOCK_RULES) {
    if (re.test(f)) return block;
  }
  return 'B?-needs-human';
}

function main() {
  const args = process.argv.slice(2);
  const files = trackedFiles();

  const byCategory = new Map();
  const unmapped = [];
  const featFiles = [];

  for (const f of files) {
    const cat = classifyCategory(f);
    if (!cat) {
      unmapped.push(f);
      continue;
    }
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    if (cat.startsWith('FEAT-')) featFiles.push(f);
  }

  const byBlock = new Map();
  for (const f of featFiles) {
    const b = classifyBlock(f);
    byBlock.set(b, (byBlock.get(b) || 0) + 1);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      total: files.length,
      unmapped: unmapped.length,
      categories: Object.fromEntries([...byCategory].sort()),
      blocks: Object.fromEntries([...byBlock].sort()),
    }, null, 2));
    process.exit(unmapped.length === 0 ? 0 : 1);
  }

  if (args.includes('--unmapped')) {
    console.log(`UNMAPPED (${unmapped.length}):`);
    unmapped.forEach((f) => console.log('  ' + f));
    process.exit(unmapped.length === 0 ? 0 : 1);
  }

  console.log(`Coverage Book — total tracked files: ${files.length}`);
  console.log(`UNMAPPED: ${unmapped.length}  ${unmapped.length === 0 ? '(gate PASS)' : '(gate FAIL)'}`);
  console.log('\nBy category:');
  [...byCategory].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    console.log(`  ${String(n).padStart(5)}  ${c}`);
  });
  const catTotal = [...byCategory.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${String(catTotal).padStart(5)}  TOTAL (mapped)`);

  if (args.includes('--blocks')) {
    console.log('\nFeature files by best-effort block (aid, not a gate):');
    [...byBlock].sort((a, b) => b[1] - a[1]).forEach(([b, n]) => {
      console.log(`  ${String(n).padStart(5)}  ${b}`);
    });
    const featTotal = [...byBlock.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${String(featTotal).padStart(5)}  TOTAL feature files`);
  }

  process.exit(unmapped.length === 0 ? 0 : 1);
}

main();
