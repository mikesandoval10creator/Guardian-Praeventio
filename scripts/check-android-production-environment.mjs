import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const environmentName = 'android-production';

export function findProductionEnvironmentProblems(environment) {
  if (typeof environment?.name !== 'string' || environment.name.toLowerCase() !== environmentName) {
    return ['Expected android-production environment metadata'];
  }
  const protectedByReviewers = Array.isArray(environment.protection_rules) &&
    environment.protection_rules.some(rule => rule?.type === 'required_reviewers' &&
      Array.isArray(rule.reviewers) && rule.reviewers.some(entry =>
        ['User', 'Team'].includes(entry?.type) && Number.isSafeInteger(entry?.reviewer?.id) && entry.reviewer.id > 0));
  return protectedByReviewers ? [] : ['android-production must have at least one required User or Team reviewer'];
}

export async function verifyAndroidProductionEnvironment({ repository, token, fetchImpl = globalThis.fetch }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)) {
    return ['GITHUB_REPOSITORY must identify an owner/repository'];
  }
  if (typeof token !== 'string' || !token.trim()) return ['GITHUB_TOKEN is required to verify approval protection'];
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repository}/environments/${environmentName}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    return ['Could not verify android-production approval protection'];
  }
  if (!response.ok) {
    const status = Number.isInteger(response.status) ? response.status : 'unknown';
    return [`Could not verify android-production approval protection (HTTP ${status})`];
  }
  let metadata;
  try { metadata = await response.json(); }
  catch { return ['Invalid android-production environment metadata']; }
  return findProductionEnvironmentProblems(metadata);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const problems = await verifyAndroidProductionEnvironment({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  for (const problem of problems) console.error(`[android-production] FAIL: ${problem}`);
  if (!problems.length) console.log('[android-production] PASS: required approval reviewers verified');
  process.exitCode = problems.length ? 1 : 0;
}
