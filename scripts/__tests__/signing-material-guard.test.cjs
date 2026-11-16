const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const fs = require('node:fs');
const os = require('node:os');
const script = path.join(root, 'scripts/check-signing-material.cjs');
const repos = [];
const env = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
afterEach(() => { for (const repo of repos.splice(0)) fs.rmSync(repo, { recursive: true, force: true }); });
function git(repo, ...args) {
  const result = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
function repo() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.RUNNER_TEMP || os.tmpdir(), 'signing-guard-'));
  repos.push(dir);
  git(dir, 'init', '-q');
  const hooks = path.join(dir, 'empty-hooks');
  fs.mkdirSync(hooks);
  git(dir, 'config', 'core.hooksPath', hooks);
  fs.copyFileSync(path.join(root, '.gitignore'), path.join(dir, '.gitignore'));
  return dir;
}
function stage(dir, name) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'DUMMY_MATERIAL_DO_NOT_USE');
  git(dir, 'add', '-f', '--', name);
}
function commit(dir) {
  git(dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'fixture');
}
function guard(dir, mode = '--staged') {
  return spawnSync(process.execPath, [script, mode], { cwd: dir, env, encoding: 'utf8' });
}


test('canonical local config and signing containers are ignored at every depth', () => {
  const paths = ['android/local.properties', 'local.properties', 'android/key.properties', 'private/release.jks', 'backup/release.keystore', 'android/app/release.p12', 'backup/release.pfx'];
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: root, input: paths.join('\n') + '\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(new Set(result.stdout.trim().split(/\r?\n/)), new Set(paths));
});

test('force-adding an ignored signing container is blocked by the staged guard', () => {
  const dir = repo();
  stage(dir, 'android/app/release.p12');
  const result = guard(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /signing-material-guard.*BLOCKED/);
  assert.doesNotMatch(result.stderr, /DUMMY_MATERIAL_DO_NOT_USE/);
});

test('classifier blocks protected names/case variants without banning public templates', () => {
  const { forbiddenPath } = require('../check-signing-material.cjs');
  for (const file of ['release.JKS', 'private/foo.KeYsToRe', 'release.P12', 'release.pFx', 'android/local.properties', 'KEY.properties', 'keystore.properties', 'signing.properties', 'dir with space/release.p12', 'line\nbreak.p12', 'dir\\release.JKS']) assert.equal(forbiddenPath(file), true, file);
  for (const file of ['signing.properties.example', 'release.jks.example', 'public-certificate.pem', 'README.md', 'gradle.properties']) assert.equal(forbiddenPath(file), false, file);
});
test('safe templates and normal source pass staged and tracked modes', () => {
  const dir = repo();
  stage(dir, 'signing.properties.example');
  stage(dir, 'README.md');
  assert.equal(guard(dir).status, 0);
  assert.equal(guard(dir, '--tracked').status, 0);
});
test('CI tracked mode catches a protected file with an otherwise empty staging diff', () => {
  const dir = repo();
  stage(dir, 'backup/release.keystore');
  commit(dir);
  assert.equal(guard(dir).status, 0);
  const result = guard(dir, '--tracked');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BLOCKED/);
});
test('deleting a previously tracked signing file is allowed for cleanup', () => {
  const dir = repo();
  stage(dir, 'release.jks');
  commit(dir);
  git(dir, 'rm', '--', 'release.jks');
  assert.equal(guard(dir).status, 0);
  assert.equal(guard(dir, '--tracked').status, 0);
});
test('renaming a normal tracked file to a protected name is blocked', () => {
  const dir = repo();
  stage(dir, 'before.txt');
  commit(dir);
  git(dir, 'mv', '--', 'before.txt', 'release.P12');
  assert.equal(guard(dir).status, 1);
});
test('staged local properties are blocked even after a force-add', () => {
  const dir = repo();
  stage(dir, 'android/local.properties');
  assert.equal(guard(dir).status, 1);
});
test('unknown modes fail closed rather than silently selecting a weaker mode', () => {
  assert.equal(guard(repo(), '--typo').status, 2);
});
test('Git inspection failures are errors, never a clean scan', () => {
  const dir = repo();
  fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
  const result = spawnSync(process.execPath, [script, '--staged'], { cwd: dir, env: { ...env, GIT_CEILING_DIRECTORIES: dir }, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Git inspection failed/);
  assert.doesNotMatch(result.stdout, /PASS/);
});

test('new guard is wired to precommit and CI without removing gitleaks', () => {
  assert.match(fs.readFileSync(path.join(root, '.husky/pre-commit'), 'utf8'), /node scripts\/check-signing-material\.cjs --staged/);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /node scripts\/check-signing-material\.cjs --tracked/);
  assert.match(workflow, /node --test scripts\/__tests__\/signing-material-guard\.test\.cjs/);
  assert.match(workflow, /gitleaks\/gitleaks-action@v3/);
});
