#!/usr/bin/env node
/**
 * Verifies that role identifiers in src/types/roles.ts and firestore.rules
 * stay in sync. Exits non-zero with a diff if they diverge.
 *
 * Wired into CI (.github/workflows/ci.yml) so that a PR which adds a role
 * to one side without the other will fail the check before it lands.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const rolesTsPath = path.join(repoRoot, 'src', 'types', 'roles.ts');
const rulesPath = path.join(repoRoot, 'firestore.rules');

function fail(msg) {
  console.error(`\n❌ verify-roles-sync: ${msg}\n`);
  process.exit(1);
}

function extractTsArray(source, name) {
  // Matches: export const NAME = ['a', 'b', ...] as const;
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]+)\\]`, 'm');
  const m = source.match(re);
  if (!m) fail(`could not find ${name} in src/types/roles.ts`);
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function extractRulesArray(source, helperName) {
  // Matches: function helperName(role) { return role in ['a', 'b', ...]; }
  // OR a single equality:  role == 'medico_ocupacional'
  const re = new RegExp(`function ${helperName}\\s*\\([^)]*\\)\\s*{[^}]*?in\\s*\\[([^\\]]+)\\]`, 'm');
  const m = source.match(re);
  if (!m) fail(`could not find ${helperName}() with a list literal in firestore.rules`);
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function diff(name, tsList, rulesList) {
  const tsSet = new Set(tsList);
  const rulesSet = new Set(rulesList);
  const onlyInTs = [...tsSet].filter(r => !rulesSet.has(r));
  const onlyInRules = [...rulesSet].filter(r => !tsSet.has(r));
  if (onlyInTs.length || onlyInRules.length) {
    console.error(`\n❌ ${name} mismatch:`);
    if (onlyInTs.length) console.error(`   only in roles.ts: ${onlyInTs.join(', ')}`);
    if (onlyInRules.length) console.error(`   only in firestore.rules: ${onlyInRules.join(', ')}`);
    return false;
  }
  console.log(`✓ ${name}: ${tsList.length} roles match`);
  return true;
}

const ts = fs.readFileSync(rolesTsPath, 'utf8');
const rules = fs.readFileSync(rulesPath, 'utf8');

let ok = true;

// isValidRole() in rules == ALL_ROLES in TS (concat of admin + supervisor + worker, deduped)
const tsAdmin = extractTsArray(ts, 'ADMIN_ROLES');
const tsSupervisor = extractTsArray(ts, 'SUPERVISOR_ROLES');
const tsWorker = extractTsArray(ts, 'WORKER_ROLES');
const tsAll = Array.from(new Set([...tsAdmin, ...tsSupervisor, ...tsWorker]));

const rulesAll = extractRulesArray(rules, 'isValidRole');
ok = diff('isValidRole / ALL_ROLES', tsAll, rulesAll) && ok;

// isWorkerRole() in rules == WORKER_ROLES in TS
const rulesWorker = extractRulesArray(rules, 'isWorkerRole');
ok = diff('isWorkerRole / WORKER_ROLES', tsWorker, rulesWorker) && ok;

if (!ok) {
  fail('role lists in src/types/roles.ts and firestore.rules diverge — fix and re-run.');
}

console.log('\n✅ All role lists in sync.\n');
