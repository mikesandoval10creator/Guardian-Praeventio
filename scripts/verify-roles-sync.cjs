#!/usr/bin/env node
/**
 * Verifies that role identifiers in src/types/roles.ts and firestore.rules
 * stay in sync. Exits non-zero with a diff if they diverge.
 *
 * Wired into CI (.github/workflows/ci.yml) so that a PR which adds a role
 * to one side without the other will fail the check before it lands.
 *
 * Checks performed:
 *   - isValidRole()    in rules == ALL_ROLES         in TS
 *   - isWorkerRole()   in rules == WORKER_ROLES      in TS
 *   - isAdmin()        in rules == ADMIN_ROLES       in TS
 *   - isSupervisor()   in rules == SUPERVISOR_ROLES  in TS
 *   - isDoctor()       in rules == DOCTOR_ROLES      in TS
 *
 * Self-test:
 *   node scripts/verify-roles-sync.cjs --self-test
 *   Exercises the parsers against synthetic inputs (matched + mismatched)
 *   to ensure parser regressions are caught.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const rolesTsPath = path.join(repoRoot, 'src', 'types', 'roles.ts');
const rulesPath = path.join(repoRoot, 'firestore.rules');

// ANSI color helpers — degrade to plain text when stdout isn't a TTY.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red: s => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: s => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: s => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  bold: s => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};

function fail(msg) {
  console.error(`\n${c.red('verify-roles-sync FAIL:')} ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// TS parser
//
// Trade-off: we use Node's `vm` module to evaluate roles.ts in a sandbox
// after stripping the few TS-only annotations we expect. This is far more
// robust than the previous `\[([^\]]+)\]` regex (which broke on multi-line
// arrays, embedded comments, and nested brackets) and keeps us honest about
// the actual runtime values — including the Set-deduped `ALL_ROLES`.
//
// Risks: roles.ts must remain a leaf module with no runtime imports. If it
// ever grows imports/decorators/enums, this stripper needs to grow too.
// We assert presence of the four arrays explicitly so any drift surfaces.
// ---------------------------------------------------------------------------
function parseRolesTs(source) {
  // Strip TS-only syntax we know roles.ts uses. Order matters.
  let stripped = source
    // Remove `export type ...` declarations (single-line and multi-line until ;)
    .replace(/export\s+type\s+[^;]+;/g, '')
    // Remove `as const` assertions
    .replace(/\s+as\s+const\b/g, '')
    // Remove `as readonly string[]` / `as Foo[]` style cast assertions
    // (covers `(IDENT as readonly string[]).method(...)` patterns inside fn bodies)
    .replace(/\s+as\s+readonly\s+[A-Za-z0-9_<>|\s]+\[\]/g, '')
    .replace(/\s+as\s+[A-Za-z0-9_<>|]+(?:\[\])?/g, '')
    // Remove explicit `: readonly string[]` style annotations on consts
    .replace(/(:\s*readonly\s+[A-Za-z0-9_<>\[\]\s|]+?)(\s*=)/g, '$2')
    // Remove function-level type guards: `function foo(x: unknown): x is Y {`
    .replace(/:\s*unknown(?=\s*[),])/g, '')
    .replace(/\)\s*:\s*[A-Za-z0-9_]+\s+is\s+[A-Za-z0-9_]+\s*\{/g, ') {')
    // Replace `export` with nothing (we'll capture via sandbox globals)
    .replace(/\bexport\s+/g, '');

  // Wrap so we can capture the consts by writing them onto an object.
  const wrapper = `
    ${stripped}
    __out.ADMIN_ROLES = ADMIN_ROLES;
    __out.SUPERVISOR_ROLES = SUPERVISOR_ROLES;
    __out.DOCTOR_ROLES = DOCTOR_ROLES;
    __out.WORKER_ROLES = WORKER_ROLES;
    try { __out.ALL_ROLES = ALL_ROLES; } catch (e) {}
  `;

  const sandbox = { __out: {}, Set, Array };
  vm.createContext(sandbox);
  try {
    vm.runInContext(wrapper, sandbox, { filename: 'roles.ts (sandboxed)' });
  } catch (err) {
    fail(`failed to evaluate roles.ts in sandbox: ${err.message}`);
  }

  for (const name of ['ADMIN_ROLES', 'SUPERVISOR_ROLES', 'DOCTOR_ROLES', 'WORKER_ROLES']) {
    if (!Array.isArray(sandbox.__out[name])) {
      fail(`could not extract ${name} from src/types/roles.ts (got ${typeof sandbox.__out[name]})`);
    }
  }
  return sandbox.__out;
}

// ---------------------------------------------------------------------------
// Rules parser — handles both forms used in firestore.rules:
//   1) `role in ['a', 'b', ...]`            (e.g. isValidRole, isWorkerRole, isSupervisor)
//   2) `role == 'a' || role == 'b' || ...`  (e.g. isAdmin, isDoctor)
// ---------------------------------------------------------------------------
function extractRulesRoles(source, helperName) {
  // Grab the helper body (everything between the first `{` after the name and its matching `}`).
  const headRe = new RegExp(`function\\s+${helperName}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const headMatch = source.match(headRe);
  if (!headMatch) fail(`could not find function ${helperName}() in firestore.rules`);
  const start = headMatch.index + headMatch[0].length;

  // Scan forward to the matching closing brace.
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) fail(`unbalanced braces in ${helperName}() body`);
  const body = source.slice(start, i - 1);

  const roles = new Set();

  // Form 1: every `in [ ... ]` literal in the body.
  const inListRe = /\bin\s*\[([^\]]+)\]/g;
  let m;
  while ((m = inListRe.exec(body)) !== null) {
    for (const part of m[1].split(',')) {
      const cleaned = part.trim().replace(/^['"]|['"]$/g, '');
      if (cleaned) roles.add(cleaned);
    }
  }

  // Form 2: every `... == 'role'` equality check (only those comparing the
  // role token, not e.g. `data.uid == request.auth.uid`).
  // We require the LHS to mention `role` (covers `request.auth.token.role`,
  // `users/...data.role`, and bare `role`).
  const eqRe = /\.role\s*==\s*['"]([^'"]+)['"]|(?:^|[\s(])role\s*==\s*['"]([^'"]+)['"]/g;
  while ((m = eqRe.exec(body)) !== null) {
    const v = m[1] || m[2];
    if (v) roles.add(v);
  }

  if (roles.size === 0) {
    fail(`could not extract any roles from ${helperName}() — parser may be out of date`);
  }
  return [...roles];
}

function diff(name, tsList, rulesList) {
  const tsSet = new Set(tsList);
  const rulesSet = new Set(rulesList);
  const onlyInTs = [...tsSet].filter(r => !rulesSet.has(r));
  const onlyInRules = [...rulesSet].filter(r => !tsSet.has(r));
  if (onlyInTs.length || onlyInRules.length) {
    console.error(`\n${c.red('X')} ${c.bold(name)} mismatch:`);
    if (onlyInTs.length) console.error(`   ${c.yellow('only in roles.ts:')}        ${onlyInTs.join(', ')}`);
    if (onlyInRules.length) console.error(`   ${c.yellow('only in firestore.rules:')} ${onlyInRules.join(', ')}`);
    return false;
  }
  console.log(`${c.green('OK')} ${name}: ${tsList.length} role${tsList.length === 1 ? '' : 's'} match`);
  return true;
}

// ---------------------------------------------------------------------------
// Self-test mode
// ---------------------------------------------------------------------------
function runSelfTest() {
  console.log(c.bold('Running parser self-tests...\n'));
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ${c.green('OK')} ${msg}`);
    } else {
      console.error(`  ${c.red('FAIL')} ${msg}`);
      failed++;
    }
  }
  function arrEq(a, b) {
    return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  }

  // --- TS parser tests --------------------------------------------------
  const goodTs = `
    export const ADMIN_ROLES = ['admin', 'gerente'] as const;
    export const SUPERVISOR_ROLES = [
      'supervisor',
      'medico_ocupacional', // doctors are supervisors
    ] as const;
    export const DOCTOR_ROLES = ['medico_ocupacional'] as const;
    export const WORKER_ROLES = ['worker', 'pintor'] as const;
    const _all = [...ADMIN_ROLES, ...SUPERVISOR_ROLES, ...DOCTOR_ROLES, ...WORKER_ROLES];
    export const ALL_ROLES: readonly string[] = Array.from(new Set(_all));
    export type AdminRole = typeof ADMIN_ROLES[number];
    export function isAdminRole(role: unknown): role is AdminRole { return false; }
  `;
  const parsed = parseRolesTs(goodTs);
  assert(arrEq(parsed.ADMIN_ROLES, ['admin', 'gerente']), 'TS parser extracts ADMIN_ROLES');
  assert(arrEq(parsed.SUPERVISOR_ROLES, ['supervisor', 'medico_ocupacional']), 'TS parser extracts SUPERVISOR_ROLES with comments + multiline');
  assert(arrEq(parsed.DOCTOR_ROLES, ['medico_ocupacional']), 'TS parser extracts DOCTOR_ROLES');
  assert(arrEq(parsed.WORKER_ROLES, ['worker', 'pintor']), 'TS parser extracts WORKER_ROLES');
  assert(arrEq(parsed.ALL_ROLES, ['admin', 'gerente', 'supervisor', 'medico_ocupacional', 'worker', 'pintor']),
    'TS parser dedupes ALL_ROLES');

  // --- Rules parser tests -----------------------------------------------
  const goodRules = `
    function isAdmin() {
      return isEmailVerified() && (
        request.auth.token.role == 'admin' ||
        request.auth.token.role == 'gerente'
      );
    }
    function isDoctor() {
      return request.auth.token.role == 'medico_ocupacional';
    }
    function isSupervisor() {
      return request.auth.token.role in ['supervisor', 'prevencionista', 'medico_ocupacional'];
    }
    function isWorkerRole(role) {
      return role in ['worker', 'pintor'];
    }
    function isValidRole(role) {
      return role in ['admin', 'gerente', 'supervisor', 'worker'];
    }
  `;
  assert(arrEq(extractRulesRoles(goodRules, 'isAdmin'), ['admin', 'gerente']),
    'Rules parser handles equality-chain (isAdmin)');
  assert(arrEq(extractRulesRoles(goodRules, 'isDoctor'), ['medico_ocupacional']),
    'Rules parser handles single equality (isDoctor) — the original B7 regression');
  assert(arrEq(extractRulesRoles(goodRules, 'isSupervisor'), ['supervisor', 'prevencionista', 'medico_ocupacional']),
    'Rules parser handles in-list (isSupervisor)');
  assert(arrEq(extractRulesRoles(goodRules, 'isWorkerRole'), ['worker', 'pintor']),
    'Rules parser handles in-list with role param (isWorkerRole)');

  // --- Mismatch detection -----------------------------------------------
  const badRules = goodRules.replace("'medico_ocupacional'", "'medico'"); // simulate the historic bug
  const badDoctor = extractRulesRoles(badRules, 'isDoctor');
  assert(arrEq(badDoctor, ['medico']),
    'Rules parser surfaces the medico/medico_ocupacional divergence (would fail the diff check)');

  // diff() should reject the mismatch
  const origConsole = console.error;
  let captured = '';
  console.error = (...args) => { captured += args.join(' ') + '\n'; };
  const ok = diff('isDoctor / DOCTOR_ROLES', ['medico_ocupacional'], badDoctor);
  console.error = origConsole;
  assert(ok === false, 'diff() returns false on a known mismatch');
  assert(/only in roles.ts/.test(captured) && /only in firestore.rules/.test(captured),
    'diff() prints both sides of the mismatch');

  console.log('');
  if (failed > 0) {
    console.error(c.red(`Self-test failed: ${failed} assertion(s) failed.`));
    process.exit(1);
  }
  console.log(c.green('Self-test passed.'));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (process.argv.includes('--self-test')) {
  runSelfTest();
}

const tsSource = fs.readFileSync(rolesTsPath, 'utf8');
const rulesSource = fs.readFileSync(rulesPath, 'utf8');

const ts = parseRolesTs(tsSource);

// Compute the effective ALL_ROLES the same way roles.ts does, so that even
// if the file's own ALL_ROLES has a bug (e.g. omits DOCTOR_ROLES) we compare
// against the *intent*. We additionally print a warning if the file's own
// ALL_ROLES disagrees with the dedup of all four lists.
const tsAllExpected = Array.from(new Set([
  ...ts.ADMIN_ROLES,
  ...ts.SUPERVISOR_ROLES,
  ...ts.DOCTOR_ROLES,
  ...ts.WORKER_ROLES,
]));
if (Array.isArray(ts.ALL_ROLES)) {
  const fileSet = new Set(ts.ALL_ROLES);
  const expectedSet = new Set(tsAllExpected);
  const missing = [...expectedSet].filter(r => !fileSet.has(r));
  if (missing.length) {
    console.warn(
      `${c.yellow('!')} roles.ts ALL_ROLES is missing roles that should be there: ${missing.join(', ')}\n` +
      `   (verifier compares the intended union, not the buggy ALL_ROLES.)`
    );
  }
}

let ok = true;
ok = diff('isValidRole / ALL_ROLES', tsAllExpected, extractRulesRoles(rulesSource, 'isValidRole')) && ok;
ok = diff('isAdmin / ADMIN_ROLES', ts.ADMIN_ROLES, extractRulesRoles(rulesSource, 'isAdmin')) && ok;
ok = diff('isSupervisor / SUPERVISOR_ROLES', ts.SUPERVISOR_ROLES, extractRulesRoles(rulesSource, 'isSupervisor')) && ok;
ok = diff('isDoctor / DOCTOR_ROLES', ts.DOCTOR_ROLES, extractRulesRoles(rulesSource, 'isDoctor')) && ok;
ok = diff('isWorkerRole / WORKER_ROLES', ts.WORKER_ROLES, extractRulesRoles(rulesSource, 'isWorkerRole')) && ok;

if (!ok) {
  fail('role lists in src/types/roles.ts and firestore.rules diverge — fix and re-run.');
}

console.log(`\n${c.green('All role lists in sync.')}\n`);
