import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workflow = yaml.load(readFileSync(new URL('../.github/workflows/mobile-release.yml', import.meta.url), 'utf8'));

test('production verifies required reviewers before candidate preparation and again before upload', () => {
  for (const jobName of ['preflight', 'android-production-upload']) {
    const job = workflow.jobs[jobName];
    const index = job.steps.findIndex(step => step.run?.includes('node scripts/check-android-production-environment.mjs'));
    assert.ok(index >= 0, `${jobName} must execute the runtime protection verifier`);
    assert.equal(job.permissions.actions, 'read');
    assert.equal(job.permissions.contents, 'read');
    assert.equal(job.steps[index].env.GITHUB_TOKEN, '${{ github.token }}');
    assert.ok(job.steps.slice(0, index).some(step => step.uses?.startsWith('actions/checkout@')));
    if (jobName === 'preflight') {
      assert.match(job.steps[index].if, /workflow_dispatch/);
      assert.match(job.steps[index].if, /inputs.track == 'production'/);
      assert.ok(index < job.steps.findIndex(step => step.id === 'gate'));
    } else {
      assert.ok(index < job.steps.findIndex(step => step.run?.includes('fastlane android upload_candidate')));
      assert.equal(job.environment, 'android-production');
    }
  }
});

const loadVerifier = () => import('./check-android-production-environment.mjs');
const protectedEnvironment = type => ({
  name: 'android-production',
  protection_rules: [{ type: 'required_reviewers', reviewers: [{ type, reviewer: { id: 123 } }] }],
});

test('only real User or Team required reviewers satisfy the approval gate', async () => {
  const { findProductionEnvironmentProblems: check } = await loadVerifier();
  for (const type of ['User', 'Team']) assert.deepEqual(check(protectedEnvironment(type)), []);
  for (const environment of [null, {}, { name: 'other' },
    { name: 'android-production', protection_rules: [] },
    { name: 'android-production', protection_rules: [{ type: 'wait_timer', wait_timer: 60 }] },
    { name: 'android-production', protection_rules: [{ type: 'required_reviewers', reviewers: [] }] },
    protectedEnvironment('Unknown'),
    { name: 'android-production', protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 0 } }] }] },
  ]) assert.ok(check(environment).length > 0);
});

test('verification is a bounded authenticated read of the exact environment', async () => {
  const { verifyAndroidProductionEnvironment: verify } = await loadVerifier();
  const problems = await verify({ repository: 'dummy/repo', token: 'dummy-secret', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/dummy/repo/environments/android-production');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer dummy-secret');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => protectedEnvironment('User') };
  } });
  assert.deepEqual(problems, []);
});

test('missing environment and unreadable HTTP responses fail closed without reading bodies', async () => {
  const { verifyAndroidProductionEnvironment: verify } = await loadVerifier();
  for (const status of [404, 403, 500]) {
    const problems = await verify({ repository: 'dummy/repo', token: 'dummy-secret', fetchImpl: async () => ({
      ok: false, status, json: () => { throw new Error('Response bodies must not be read'); },
    }) });
    assert.ok(problems.length > 0);
    assert.match(problems.join(' '), new RegExp(String(status)));
    assert.ok(!problems.join(' ').includes('dummy-secret'));
  }
});

test('network failures and malformed JSON fail closed with sanitized diagnostics', async () => {
  const { verifyAndroidProductionEnvironment: verify } = await loadVerifier();
  for (const fetchImpl of [
    async () => { throw new Error('dummy-secret from transport'); },
    async () => ({ ok: true, json: async () => { throw new Error('dummy-secret from body'); } }),
  ]) {
    const problems = await verify({ repository: 'dummy/repo', token: 'dummy-secret', fetchImpl });
    assert.ok(problems.length > 0);
    assert.ok(!problems.join(' ').includes('dummy-secret'));
  }
});

test('missing credentials or invalid repository never issue a network request', async () => {
  const { verifyAndroidProductionEnvironment: verify } = await loadVerifier();
  for (const input of [{ repository: 'dummy/repo' }, { repository: 'bad', token: 'dummy' },
    { repository: '../repo', token: 'dummy' }]) {
    let called = false;
    const problems = await verify({ ...input, fetchImpl: async () => { called = true; } });
    assert.ok(problems.length > 0);
    assert.equal(called, false);
  }
});

test('CLI exits unsuccessfully without leaking credentials when the repository is invalid', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-android-production-environment.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'dummy-secret', GITHUB_REPOSITORY: 'invalid' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[android-production\] FAIL: GITHUB_REPOSITORY/);
  assert.doesNotMatch(result.stdout + result.stderr, /dummy-secret/);
});
