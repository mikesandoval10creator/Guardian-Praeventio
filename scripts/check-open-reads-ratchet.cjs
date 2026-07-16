#!/usr/bin/env node
// scripts/check-open-reads-ratchet.cjs
//
// Allowlist ratchet for `@firebase/security-rules/no-open-reads` warnings on
// firestore.rules. Context: exactly 4 collections are DELIBERATELY
// anonymous-readable (§UX-anonymous 2026-05-21 Instagram-model + ADR 0021
// life-safety public AED map) — normatives, dea_locations, community_glossary,
// global_templates — each justified inline in firestore.rules and covered by
// rules tests. The plugin's parser (v0.0.2) returns an ESTree stub with
// `comments: []`, so per-line `eslint-disable` is IMPOSSIBLE in .rules files.
//
// This wrapper runs the real ESLint CLI (`--format json`) on firestore.rules,
// maps each no-open-reads warning to its enclosing `match` chain via a
// heuristic brace-stack parse, and enforces STRICT equality with the baseline:
//
//   • open read NOT in baseline  → FAIL (exit 1). Stronger than the raw rule,
//     which only warns. A new anonymous-read collection is a security review
//     event, not lint noise.
//   • baseline entry no longer warned (read tightened) → FAIL until pruned
//     with --write, so a stale allowlist can't silently re-admit the read.
//   • all other ESLint findings pass through untouched: errors (e.g.
//     no-open-writes) keep failing, other warnings keep printing.
//
//   node scripts/check-open-reads-ratchet.cjs            # gate (used by lint:rules)
//   node scripts/check-open-reads-ratchet.cjs --write    # regenerate baseline
//
// Raw, unfiltered ESLint output remains available via `npm run lint:rules:raw`.
//
// Heuristic parser notes: strings and `//` comments are stripped per line;
// complete inline `{...}` pairs (path variables like `{userId}`, `{doc=**}`)
// net to zero depth and are removed before counting. Assumes multi-line match
// blocks (the repo style) — a single-line `match /x/{y} { allow read … }`
// would not be attributed. Mirrors the documented heuristic tolerance of
// check-connectivity-ratchet.cjs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(REPO_ROOT, 'firestore.rules');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'open-reads-ratchet-baseline.json');
const ESLINT_BIN = path.join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
const RULE_ID = '@firebase/security-rules/no-open-reads';
// The standard root frame — dropped from chains for readability.
const ROOT_RE = /^\/databases\/\{[^}]+\}\/documents$/;

/** Strip string literals and `//` comments so their braces don't skew depth. */
function sanitizeLine(line) {
  let s = line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
  const slash = s.indexOf('//');
  if (slash !== -1) s = s.slice(0, slash);
  return s;
}

/**
 * Map 1-based line numbers in a rules source to their enclosing `match`
 * chain (root /databases/{db}/documents frame dropped), e.g. line inside
 * `match /normatives/{id} { … }` → "/normatives/{id}"; nested matches join.
 * Returns chains in the order of the (sorted) input lines.
 */
function mapOpenReads(rulesText, lines) {
  const wanted = new Set(lines);
  const found = new Map(); // line → chain
  const stack = []; // { path, depth }
  let depth = 0;

  const src = rulesText.split(/\r?\n/);
  for (let i = 0; i < src.length; i++) {
    const lineNo = i + 1;

    if (wanted.has(lineNo)) {
      const frames = stack
        .map((f) => f.path)
        .filter((p) => !ROOT_RE.test(p));
      found.set(lineNo, frames.join('') || '(top-level)');
    }

    let s = sanitizeLine(src[i]);
    // Remove complete inline pairs — `{userId}`, `{doc=**}` — net zero depth.
    while (/\{[^{}]*\}/.test(s)) s = s.replace(/\{[^{}]*\}/g, '');

    const decl = /^\s*match\s+(\S+)/.exec(sanitizeLine(src[i]));
    let pushedForThisLine = false;
    for (const ch of s) {
      if (ch === '{') {
        depth += 1;
        if (decl && !pushedForThisLine) {
          stack.push({ path: decl[1], depth });
          pushedForThisLine = true;
        }
      } else if (ch === '}') {
        if (stack.length && stack[stack.length - 1].depth === depth) stack.pop();
        depth -= 1;
      }
    }
  }

  return [...lines].sort((a, b) => a - b).map((l) => found.get(l));
}

/** Run the real ESLint CLI on firestore.rules and return parsed messages. */
function runEslintJson() {
  if (!fs.existsSync(ESLINT_BIN)) {
    console.error(`[open-reads-ratchet] eslint binary not found: ${ESLINT_BIN}`);
    process.exit(2);
  }
  const res = spawnSync(
    process.execPath,
    [ESLINT_BIN, 'firestore.rules', '--format', 'json'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // 0 = clean, 1 = lint problems found — both produce valid JSON on stdout.
  if (res.status !== 0 && res.status !== 1) {
    console.error('[open-reads-ratchet] eslint crashed:\n' + (res.stderr || res.stdout || ''));
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    console.error('[open-reads-ratchet] could not parse eslint JSON output:\n' + res.stdout);
    process.exit(2);
  }
  return parsed.flatMap((f) => f.messages || []);
}

/**
 * Live scan: { openReads: sorted chains for no-open-reads warnings,
 *              others: every other ESLint message (passed through) }.
 */
function collectLive() {
  const messages = runEslintJson();
  const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
  const openReadMsgs = messages.filter((m) => m.ruleId === RULE_ID);
  const others = messages.filter((m) => m.ruleId !== RULE_ID);
  const chains = mapOpenReads(rulesText, openReadMsgs.map((m) => m.line));
  return { openReads: [...chains].sort(), others };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(openReads) {
  const payload = {
    comment:
      'Deliberate anonymous-read collections (allow read: if true) in firestore.rules. ' +
      'Each MUST be justified inline (no PII, write-gated, rules-tested). ' +
      'Gate: scripts/check-open-reads-ratchet.cjs (lint:rules + pre-commit + ' +
      'src/__tests__/scripts/openReadsRatchet.test.ts). Regenerate: --write.',
    rule: RULE_ID,
    allowed_count: openReads.length,
    allowed: openReads,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[open-reads-ratchet] baseline written: ${openReads.length} allowed open read(s).`);
  openReads.forEach((c) => console.log(`  ${c}`));
}

function main() {
  const write = process.argv.includes('--write');
  const { openReads, others } = collectLive();

  // Pass through every non-open-reads finding exactly as ESLint reported it.
  let otherErrors = 0;
  if (others.length) {
    console.error(`\nfirestore.rules — findings outside the open-reads allowlist gate:`);
    for (const m of others) {
      if (m.severity === 2) otherErrors += 1;
      console.error(
        `  ${m.line}:${m.column}  ${m.severity === 2 ? 'error' : 'warning'}  ${m.message}  ${m.ruleId || ''}`,
      );
    }
  }

  if (write) {
    writeBaseline(openReads);
    process.exit(otherErrors ? 1 : 0);
  }

  const baseline = readBaseline();
  if (!baseline) {
    console.error(
      '[open-reads-ratchet] no baseline — report only. Generate with:\n' +
        '  node scripts/check-open-reads-ratchet.cjs --write',
    );
    openReads.forEach((c) => console.log(`  open read: ${c}`));
    process.exit(otherErrors ? 1 : 0);
  }

  const base = new Set(baseline.allowed || []);
  const liveSet = new Set(openReads);
  let failures = otherErrors;

  const added = openReads.filter((c) => !base.has(c));
  if (added.length) {
    failures += added.length;
    console.error('\n[open-reads-ratchet] FAIL — NEW anonymous-read collection(s):');
    added.forEach((c) => console.error(`  ${c}`));
    console.error(
      '  → an `allow read: if true` outside the deliberate-public allowlist is a\n' +
        '    security review event. Justify inline (no PII, write-gated, ≥5 rules\n' +
        '    tests, security_spec.md) + regenerate with --write, or revert.',
    );
  }

  const resolved = [...base].filter((c) => !liveSet.has(c));
  if (resolved.length) {
    failures += resolved.length;
    console.error(
      '\n[open-reads-ratchet] FAIL — baseline entries no longer read-open; prune the\n' +
        'allowlist so it cannot silently re-admit them (`--write`):',
    );
    resolved.forEach((c) => console.error(`  ${c}`));
  }

  if (failures) {
    console.error(`\n[open-reads-ratchet] FAIL: ${failures} issue(s).`);
    process.exit(1);
  }
  console.log(
    `[open-reads-ratchet] PASS — ${openReads.length} deliberate anonymous-read ` +
      'collection(s) held (justifications inline in firestore.rules; a new open ' +
      'read fails this gate).',
  );
  process.exit(0);
}

module.exports = { mapOpenReads, collectLive, runEslintJson, sanitizeLine, RULE_ID };

if (require.main === module) main();
