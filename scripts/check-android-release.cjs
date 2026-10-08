#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { findPinProblems, NSC_PATH } = require('./check-cert-pinning-ratchet.cjs');
const { findStoreBuildProblems, ASSET_RELATIVE } = require('./check-store-build-config.cjs');
const ROOT = path.resolve(__dirname, '..');
function findFirebaseProblems(config) {
  const client = config?.client?.find(c => c?.client_info?.android_client_info?.package_name === 'com.praeventio.guard');
  if (!client || !config?.project_info?.project_id || !/^\d+$/.test(String(config?.project_info?.project_number || '')) || !/^1:\d+:android:[a-f0-9]+$/i.test(client?.client_info?.mobilesdk_app_id || '') || !client?.api_key?.some(k => /^AIza[A-Za-z0-9_-]{35}$/.test(k.current_key || ''))) return ['Firebase native configuration missing or invalid for com.praeventio.guard'];
  return [];
}
function findReleaseProblems(root = ROOT, env = process.env) {
  const problems = [];
  try { problems.push(...findFirebaseProblems(JSON.parse(fs.readFileSync(path.join(root, 'android/app/google-services.json'), 'utf8')))); }
  catch { problems.push('Firebase native configuration missing or unreadable'); }
  for (const name of ['KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']) {
    if (!env[name]?.trim()) problems.push(`release signing requires ${name}`);
  }
  if (env.KEYSTORE_PATH && !fs.existsSync(env.KEYSTORE_PATH)) problems.push('release signing keystore file missing');
  try { problems.push(...findPinProblems(fs.readFileSync(path.join(root, path.relative(ROOT, NSC_PATH)), 'utf8'))); }
  catch { problems.push('production TLS policy missing'); }
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, ASSET_RELATIVE), 'utf8'));
    if (config?.appId !== 'com.praeventio.guard') problems.push('synced Capacitor application ID must be com.praeventio.guard');
    if (findStoreBuildProblems(config).length) problems.push('synced Capacitor configuration is not store-safe');
    if (!fs.existsSync(path.join(root, 'android/app/src/main/assets/public/index.html'))) problems.push('synced web bundle missing');
  } catch { problems.push('synced Capacitor production config missing or invalid'); }
  return problems;
}
module.exports = { findFirebaseProblems, findReleaseProblems };
if (require.main === module) {
  const problems = findReleaseProblems();
  for (const problem of problems) console.error(`[android-release] FAIL: ${problem}`);
  if (!problems.length) console.log('[android-release] PASS: native release inputs validated');
  process.exit(problems.length ? 1 : 0);
}
