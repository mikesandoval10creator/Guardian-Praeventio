#!/usr/bin/env node
// scripts/validate-pr-scope.cjs
//
// PR scope gate (anti-#1039, CLAUDE.md #24). Prevents a PR from touching
// security/config "protected" files outside the scope of its title.
//
// Root cause it prevents: PR #1039 was titled "feat: mount SpiDashboard" but
// also blanked the Android `assetlinks.json` signing fingerprint AND swept 245
// `.claude/skills/` files into git via an indiscriminate `git add` — a
// security regression unrelated to its stated scope.
//
// PROTECTED FILE PATTERNS (touching any of these requires explicit opt-in):
//   public/.well-known/*           — signing fingerprints, AASA, PGP, etc.
//   firestore.rules                — Firestore security rules
//   .claude/*                      — harness config / skills / commands
//   .env* (but NOT .env.example)   — secrets
//   scripts/*-baseline.json        — ratchet baselines (legitimate in some PRs)
//   android/**/AndroidManifest.xml — Android signing config
//   firebase.json                  — Firebase deploy config
//   .github/workflows/*            — CI config
//
// OPT-IN: a PR title containing `[scope-override]` bypasses the gate and
// requires a justification in the PR body (advisory — CI is non-blocking).
//
// INPUTS (one of two modes):
//   A) GitHub Actions context (recommended):
//      - PR_TITLE env var (from github.event.pull_request.title)
//      - PR_BODY  env var (from github.event.pull_request.body; optional)
//      - Uses `git diff --name-only origin/<base>...HEAD` for changed files.
//   B) Local / pre-push: pass files via stdin (one per line) or let the
//      script compute changed files via `git diff --name-only main...HEAD`.
//
// Exit codes:
//   0 — passed (or scope-override present)
//   1 — violation found (protected files touched without opt-in)
//   2 — configuration error
//
// Usage:
//   node scripts/validate-pr-scope.cjs                        # local check
//   PR_TITLE="feat: mount X" node scripts/validate-pr-scope.cjs

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

// Protected file patterns (glob-style, checked with minimatch-compatible logic).
// Each entry is a { label, test: (relPath: string) => boolean }.
const PROTECTED = [
  {
    label: 'public/.well-known/* (signing fingerprints / AASA / PGP)',
    test: (f) => f.startsWith('public/.well-known/'),
  },
  {
    label: 'firestore.rules (Firestore security rules)',
    test: (f) => f === 'firestore.rules',
  },
  {
    label: '.claude/* (harness config / skills / commands)',
    test: (f) => f.startsWith('.claude/'),
  },
  {
    label: '.env* secrets (but not .env.example)',
    test: (f) => /^\.env/.test(f) && f !== '.env.example',
  },
  {
    label: 'scripts/*-baseline.json (ratchet baselines)',
    test: (f) => /^scripts\/[^/]+-baseline\.json$/.test(f),
  },
  {
    label: 'android/**/AndroidManifest.xml (Android signing config)',
    test: (f) => f.startsWith('android/') && f.endsWith('AndroidManifest.xml'),
  },
  {
    label: 'firebase.json (Firebase deploy config)',
    test: (f) => f === 'firebase.json',
  },
  {
    label: '.github/workflows/* (CI config)',
    test: (f) => f.startsWith('.github/workflows/'),
  },
];

/** Normalise a file path to repo-relative posix. */
function normalise(f) {
  return f.trim().replace(/\\/g, '/');
}

/** Get changed files via git. Falls back to empty list on error. */
function getChangedFiles(base = 'main') {
  try {
    const raw = execSync(`git diff --name-only ${base}...HEAD`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return raw.split('\n').map(normalise).filter(Boolean);
  } catch {
    // If git fails (shallow clone, no base branch), try ORIG_HEAD or skip.
    try {
      const raw = execSync('git diff --name-only ORIG_HEAD...HEAD', {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return raw.split('\n').map(normalise).filter(Boolean);
    } catch {
      console.warn('[pr-scope-gate] Could not determine changed files — skipping check.');
      return [];
    }
  }
}

function main() {
  const prTitle = process.env.PR_TITLE || '';
  const prBody = process.env.PR_BODY || '';

  // Determine changed files: prefer stdin if piped, otherwise git diff.
  let changedFiles;
  if (!process.stdin.isTTY) {
    // Files piped on stdin (one per line).
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    changedFiles = raw.split('\n').map(normalise).filter(Boolean);
  } else {
    // Determine base branch: GitHub Actions sets GITHUB_BASE_REF.
    const base = process.env.GITHUB_BASE_REF || 'main';
    changedFiles = getChangedFiles(base);
  }

  if (changedFiles.length === 0) {
    console.log('[pr-scope-gate] No changed files detected — nothing to check.');
    process.exit(0);
  }

  // Scope-override opt-in.
  const hasOverride = /\[scope-override\]/i.test(prTitle);
  if (hasOverride) {
    if (!prBody.trim()) {
      console.warn(
        '[pr-scope-gate] WARNING: [scope-override] present but PR body is empty — ' +
          'please justify the protected-file changes.',
      );
    } else {
      console.log('[pr-scope-gate] scope-override present — gate bypassed (advisory).');
    }
    process.exit(0);
  }

  // Check each changed file against protected patterns.
  const violations = [];
  for (const file of changedFiles) {
    for (const { label, test } of PROTECTED) {
      if (test(file)) {
        violations.push({ file, label });
        break; // one violation per file is enough
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `[pr-scope-gate] PASS — ${changedFiles.length} changed file(s), none in protected set.`,
    );
    process.exit(0);
  }

  // Report violations.
  console.error('\n[pr-scope-gate] VIOLATION — protected files touched outside PR scope:');
  console.error(`PR title: "${prTitle || '(not set — run locally or via CI)'}"\n`);
  for (const { file, label } of violations) {
    console.error(`  ${file}`);
    console.error(`    Reason: ${label}`);
  }
  console.error(
    '\nIf these changes are intentional, add [scope-override] to the PR title and ' +
      'justify in the PR body why the protected files were modified.',
  );
  console.error(
    'This prevents the #1039-class regression where a "feat: mount X" PR silently ' +
      'blanked the Android signing fingerprint (assetlinks.json) + swept 245 skill ' +
      'files into git unrelated to its stated scope.',
  );
  process.exit(1);
}

module.exports = { PROTECTED, normalise, getChangedFiles };

if (require.main === module) main();
