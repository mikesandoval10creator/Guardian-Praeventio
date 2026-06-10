#!/usr/bin/env node
// scripts/validate-i18n.cjs
//
// Enforces CLAUDE.md Rule #18 (locale parity) for the LAUNCH locales.
//
// Context: every user-facing `t('key', 'default')` call resolves against the
// `common` namespace. `es` (Spanish-CL) is the product baseline and the key
// superset; `en` and `pt-BR` are the other launch locales that ship eagerly
// (src/i18n/index.ts `resources`). A key present in `es` but absent from `en`
// or `pt-BR` makes that locale fall back to the inline Spanish default — i.e. a
// Brazilian user sees Spanish text. This guard makes that gap visible and,
// once baselined, prevents it from GROWING: a new `es` key with no `en`/`pt-BR`
// translation fails the gate.
//
// Out of scope (by design): the lazy locales (`fr`, `de`, `it`, `ja`, `zh-CN`,
// `ar`, `ko`, `hi`, `zh-TW`, `ru`). They are intentional stubs, dynamically
// imported and covered by the `en`→`es` fallback chain until a country grows
// its pack. Holding them to full parity here would be dishonest noise.
//
// Ratchet philosophy (mirrors check-convention-guard.cjs): the per-locale set
// of missing keys lives in `scripts/i18n-parity-baseline.json` and may only
// SHRINK. Report-only when the baseline file is absent (so it can be seeded).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(REPO_ROOT, 'src', 'i18n', 'locales');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'i18n-parity-baseline.json');

/** Spanish-CL is the product baseline + the key superset. */
const REFERENCE = 'es';
/** Launch locales that ship eagerly and must reach parity with the reference. */
const REQUIRED = ['en', 'pt-BR'];

/** Flatten a nested translation object into dotted keys (i18next keySeparator '.'). */
function flatten(obj, prefix = '', out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const kk = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, kk, out);
    } else {
      out[kk] = v;
    }
  }
  return out;
}

/** Set of dotted keys for a locale's common.json, or `null` if the file is absent. */
function loadKeys(locale) {
  const p = path.join(LOCALES_DIR, locale, 'common.json');
  if (!fs.existsSync(p)) return null;
  return new Set(Object.keys(flatten(JSON.parse(fs.readFileSync(p, 'utf8')))));
}

/** Keys present in the reference but missing from `locale`, sorted. */
function missingFor(locale, refKeys) {
  const lk = loadKeys(locale);
  if (!lk) return null;
  return [...refKeys].filter((k) => !lk.has(k)).sort();
}

/** Compute the live parity gap of every REQUIRED locale against REFERENCE. */
function scan() {
  const ref = loadKeys(REFERENCE);
  if (!ref) {
    throw new Error(`validate-i18n: reference locale '${REFERENCE}' not found.`);
  }
  const missing = {};
  for (const loc of REQUIRED) missing[loc] = missingFor(loc, ref) ?? [];
  return { referenceCount: ref.size, missing };
}

// ── AUDIT-2026-06 B20: used-but-undeclared ratchet ─────────────────────────
//
// The parity gate above only compares DECLARED keys across locales. The 2026-06
// audit found ~3.1k literal `t('key', 'inline default')` usages whose key does
// not exist in es/common.json at all — those render the inline Spanish default
// for EVERY locale and are invisible to the parity check. This scan makes them
// visible and ratchets the list: it may only SHRINK (declare the key in `es`
// + launch locales to remove it); NEW code using an undeclared literal key
// fails the gate.
//
// Scope: literal first-arg keys only (`t('a.b.c'…)`). Dynamic keys
// (template literals) can't be statically ratcheted and stay out of scope.

const SRC_DIR = path.join(REPO_ROOT, 'src');
const USED_KEY_RE = /\bt\(\s*['"]([A-Za-z0-9_][A-Za-z0-9_.-]*)['"]/g;

function* walkSources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests/rules-tests no son copy de usuario.
      if (entry.name === '__tests__' || entry.name === 'rules-tests') continue;
      yield* walkSources(full);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
    ) {
      yield full;
    }
  }
}

/** Set of literal i18n keys referenced from product source. */
function scanUsedKeys() {
  const used = new Set();
  for (const file of walkSources(SRC_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = USED_KEY_RE.exec(text)) !== null) {
      // Heurística anti-falsos-positivos: las claves i18n del proyecto son
      // jerárquicas (contienen un punto). `t('x')` sin punto suele ser otra
      // función `t` (formatters, tests de tipos, etc.).
      if (m[1].includes('.')) used.add(m[1]);
    }
  }
  return used;
}

/** Used literal keys that do NOT exist in the `es` reference, sorted. */
function undeclaredUsed() {
  const ref = loadKeys(REFERENCE);
  if (!ref) throw new Error(`validate-i18n: reference '${REFERENCE}' not found.`);
  return [...scanUsedKeys()].filter((k) => !ref.has(k)).sort();
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[i18n-parity] Could not parse baseline: ${err.message}`);
    process.exit(2);
  }
  return null;
}

function main() {
  const { referenceCount, missing } = scan();
  const baseline = loadBaseline();

  if (!baseline) {
    console.log('[i18n-parity] REPORT-ONLY (no baseline yet)\n');
    console.log(`reference '${REFERENCE}': ${referenceCount} keys`);
    for (const loc of REQUIRED) {
      console.log(`  ${loc}: ${missing[loc].length} missing`);
    }
    console.log('\nSeed scripts/i18n-parity-baseline.json to activate the gate.');
    process.exit(0);
  }

  let failures = 0;
  const baseMissing = baseline.missing || {};

  for (const loc of REQUIRED) {
    const base = new Set(baseMissing[loc] || []);
    // ── HARD GATE: a key missing now but not baselined is a NEW gap. ──
    const newGaps = missing[loc].filter((k) => !base.has(k));
    if (newGaps.length) {
      failures += newGaps.length;
      console.error(
        `\n[i18n-parity] FAIL ${loc} — ${newGaps.length} new untranslated key(s) ` +
          `(present in '${REFERENCE}', missing from '${loc}'):`,
      );
      newGaps.slice(0, 25).forEach((k) => console.error(`  ${k}`));
      if (newGaps.length > 25) console.error(`  …and ${newGaps.length - 25} more`);
      console.error(
        `  → add the translation to src/i18n/locales/${loc}/common.json`,
      );
    }
    // ── Ratchet cleanup notice (non-fatal). ──
    const fixed = [...base].filter((k) => !missing[loc].includes(k));
    if (fixed.length) {
      console.log(
        `\n[i18n-parity] ✅ ${loc} — ${fixed.length} key(s) now translated; ` +
          `remove from baseline.missing.${loc}.`,
      );
    }
  }

  // ── AUDIT-2026-06 B20: used-but-undeclared ratchet ──
  const undeclared = undeclaredUsed();
  const baseUndeclared = new Set(baseline.usedUndeclared || []);
  if (baseline.usedUndeclared) {
    const newUndeclared = undeclared.filter((k) => !baseUndeclared.has(k));
    if (newUndeclared.length) {
      failures += newUndeclared.length;
      console.error(
        `\n[i18n-parity] FAIL — ${newUndeclared.length} NEW t('key') usage(s) whose key ` +
          `does not exist in '${REFERENCE}' common.json (inline default shown to EVERY locale):`,
      );
      newUndeclared.slice(0, 25).forEach((k) => console.error(`  ${k}`));
      if (newUndeclared.length > 25) {
        console.error(`  …and ${newUndeclared.length - 25} more`);
      }
      console.error(
        `  → declare the key in src/i18n/locales/es/common.json (+ en, pt-BR)`,
      );
    }
    const fixedUndeclared = [...baseUndeclared].filter((k) => !undeclared.includes(k));
    if (fixedUndeclared.length) {
      console.log(
        `\n[i18n-parity] ✅ ${fixedUndeclared.length} formerly-undeclared key(s) now declared; ` +
          `remove from baseline.usedUndeclared.`,
      );
    }
  }

  console.log('');
  if (failures) {
    console.error(`[i18n-parity] FAIL: ${failures} new untranslated key(s).`);
    process.exit(1);
  }
  const total = REQUIRED.map((l) => `${l}:${missing[l].length}`).join(' · ');
  const undeclaredNote = baseline.usedUndeclared
    ? ` · undeclared-used: ${undeclared.length}/${baseUndeclared.size} baselined`
    : '';
  console.log(
    `[i18n-parity] PASS — launch-locale parity held (gap baselined: ${total}${undeclaredNote}).`,
  );
  process.exit(0);
}

module.exports = {
  flatten,
  loadKeys,
  missingFor,
  scan,
  scanUsedKeys,
  undeclaredUsed,
  REFERENCE,
  REQUIRED,
  LOCALES_DIR,
  BASELINE_PATH,
};

if (require.main === module) main();
