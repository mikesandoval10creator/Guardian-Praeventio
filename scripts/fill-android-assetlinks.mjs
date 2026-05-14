#!/usr/bin/env node
/**
 * fill-android-assetlinks.mjs
 *
 * Replaces the `REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD` placeholder in
 * `public/.well-known/assetlinks.json` with the SHA-256 cert fingerprint of
 * a real release keystore.
 *
 * Idempotent: works on a copy in memory, only writes when the resulting JSON
 * is valid and different from the input. On any failure the original file is
 * left untouched (no partial writes).
 *
 * Inputs (priority: CLI args > env vars):
 *   --keystore <path>           ANDROID_KEYSTORE_PATH
 *   --alias <name>              ANDROID_KEY_ALIAS
 *   --storepass <pw>            ANDROID_KEYSTORE_PASSWORD
 *   --keypass <pw>              ANDROID_KEY_PASSWORD       (optional, defaults to storepass)
 *   --sha256 <fingerprint>      ANDROID_SHA256             (bypasses keytool — for CI / pre-computed)
 *   --file <path>               ASSETLINKS_FILE            (default: public/.well-known/assetlinks.json)
 *   --dry-run                                              (print what would change, don't write)
 *   --append                                               (add fingerprint as second entry instead of replacing)
 *
 * Exit codes:
 *   0  success (file updated or already correct)
 *   1  invalid arguments / file not found
 *   2  keytool failed / fingerprint not found in keytool output
 *   3  JSON validation failed after replacement
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLACEHOLDER = 'REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD';
const SHA256_REGEX = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/**
 * Parse argv into a flat options bag. Supports `--flag value` and `--flag=value`.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const eq = tok.indexOf('=');
    if (eq >= 0) {
      out[tok.slice(2, eq)] = tok.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[tok.slice(2)] = next;
        i++;
      } else {
        out[tok.slice(2)] = true;
      }
    }
  }
  return out;
}

/**
 * Extract the SHA-256 fingerprint from `keytool -list -v` output.
 *
 * keytool emits something like:
 *   ...
 *   Certificate fingerprints:
 *            SHA1: AA:BB:...
 *            SHA256: 14:6D:E9:83:...:64
 *            Signature algorithm name: SHA256withRSA
 *
 * Returns the upper-case colon-separated hex string, or null if not found.
 */
export function extractSha256(keytoolOutput) {
  if (!keytoolOutput) return null;
  // Match "SHA256:" (with optional leading whitespace, case-insensitive label,
  // then whitespace then the hex). Allow lower or upper case hex.
  const re = /SHA-?256\s*[:=]\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31})/m;
  const m = keytoolOutput.match(re);
  if (!m) return null;
  return m[1].toUpperCase();
}

/**
 * Replace (or append, if `append=true`) the SHA-256 fingerprint inside the
 * parsed assetlinks JSON. Returns a new object; does not mutate input.
 *
 * Throws if the structure does not match the expected
 * `[{ target: { sha256_cert_fingerprints: [...] } }]` shape.
 */
export function applyFingerprint(json, sha256, { append = false } = {}) {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('assetlinks.json: top-level must be a non-empty array');
  }
  const cloned = JSON.parse(JSON.stringify(json));
  const entry = cloned[0];
  if (!entry || !entry.target || !Array.isArray(entry.target.sha256_cert_fingerprints)) {
    throw new Error('assetlinks.json: entry[0].target.sha256_cert_fingerprints missing');
  }
  const list = entry.target.sha256_cert_fingerprints;
  if (append) {
    // Add only if not already present and not still a placeholder list.
    const filtered = list.filter((s) => s !== PLACEHOLDER);
    if (!filtered.includes(sha256)) filtered.push(sha256);
    entry.target.sha256_cert_fingerprints = filtered;
  } else {
    // Replace ANY placeholder occurrence; preserve real fingerprints already
    // present (so re-running with the same SHA is a no-op).
    entry.target.sha256_cert_fingerprints = list.map((s) =>
      s === PLACEHOLDER ? sha256 : s,
    );
    // Dedup.
    entry.target.sha256_cert_fingerprints = [
      ...new Set(entry.target.sha256_cert_fingerprints),
    ];
  }
  return cloned;
}

/**
 * Validate that the resulting JSON is well-formed and free of placeholders.
 * Returns { ok, errors }.
 */
export function validateAssetlinks(json) {
  const errors = [];
  if (!Array.isArray(json) || json.length === 0) {
    errors.push('top-level must be a non-empty array');
    return { ok: false, errors };
  }
  for (const [i, entry] of json.entries()) {
    if (!entry.relation || !Array.isArray(entry.relation)) {
      errors.push(`entry[${i}].relation must be an array`);
    }
    if (!entry.target || entry.target.namespace !== 'android_app') {
      errors.push(`entry[${i}].target.namespace must be "android_app"`);
    }
    const fps = entry.target?.sha256_cert_fingerprints;
    if (!Array.isArray(fps) || fps.length === 0) {
      errors.push(`entry[${i}].target.sha256_cert_fingerprints must be a non-empty array`);
      continue;
    }
    for (const fp of fps) {
      if (fp === PLACEHOLDER) {
        errors.push(`entry[${i}] still contains placeholder fingerprint`);
      } else if (!SHA256_REGEX.test(fp)) {
        errors.push(`entry[${i}] fingerprint not in colon-hex form: ${fp}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Run keytool to extract the SHA-256. Separated so tests can stub it.
 */
export function runKeytool({
  keystore,
  alias,
  storepass,
  keypass,
  runner = spawnSync,
}) {
  const args = [
    '-list',
    '-v',
    '-keystore',
    keystore,
    '-alias',
    alias,
    '-storepass',
    storepass,
  ];
  if (keypass) args.push('-keypass', keypass);
  const res = runner('keytool', args, { encoding: 'utf8' });
  if (res.error) {
    throw new Error(`keytool not found or failed to spawn: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `keytool exited ${res.status}: ${(res.stderr || '').trim() || (res.stdout || '').trim()}`,
    );
  }
  return res.stdout || '';
}

/**
 * End-to-end main. Exposed for tests so they can drive it with a fake fs and
 * a fake keytool runner.
 */
export async function main(argv, deps = {}) {
  const {
    read = readFileSync,
    write = writeFileSync,
    exists = existsSync,
    keytool = runKeytool,
    log = console.log,
    err = console.error,
    env = process.env,
  } = deps;

  const opts = parseArgs(argv);
  const file =
    opts.file ||
    env.ASSETLINKS_FILE ||
    path.join('public', '.well-known', 'assetlinks.json');

  if (!exists(file)) {
    err(`error: file not found: ${file}`);
    return 1;
  }

  // Resolve SHA-256: explicit override > keytool.
  let sha256 = opts.sha256 || env.ANDROID_SHA256 || null;
  if (sha256) {
    sha256 = sha256.toUpperCase();
    if (!SHA256_REGEX.test(sha256)) {
      err(`error: --sha256 not in colon-hex form (XX:XX:...×32): ${sha256}`);
      return 1;
    }
  } else {
    const keystore = opts.keystore || env.ANDROID_KEYSTORE_PATH;
    const alias = opts.alias || env.ANDROID_KEY_ALIAS;
    const storepass = opts.storepass || env.ANDROID_KEYSTORE_PASSWORD;
    const keypass = opts.keypass || env.ANDROID_KEY_PASSWORD || storepass;
    if (!keystore || !alias || !storepass) {
      err(
        'error: need --keystore + --alias + --storepass (or env equivalents), or --sha256',
      );
      return 1;
    }
    let output;
    try {
      output = keytool({ keystore, alias, storepass, keypass });
    } catch (e) {
      err(`error: ${e.message}`);
      return 2;
    }
    sha256 = extractSha256(output);
    if (!sha256) {
      err('error: SHA-256 fingerprint not found in keytool output');
      return 2;
    }
  }

  let raw;
  try {
    raw = read(file, 'utf8');
  } catch (e) {
    err(`error: cannot read ${file}: ${e.message}`);
    return 1;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    err(`error: ${file} is not valid JSON: ${e.message}`);
    return 1;
  }

  let updated;
  try {
    updated = applyFingerprint(json, sha256, { append: !!opts.append });
  } catch (e) {
    err(`error: ${e.message}`);
    return 1;
  }

  const validation = validateAssetlinks(updated);
  if (!validation.ok) {
    err('error: resulting JSON failed validation:');
    for (const v of validation.errors) err(`  - ${v}`);
    return 3;
  }

  const serialized = JSON.stringify(updated, null, 2) + '\n';
  if (serialized === raw) {
    log(`no change: ${file} already contains ${sha256}`);
    return 0;
  }

  if (opts['dry-run']) {
    log(`[dry-run] would write SHA-256 ${sha256} to ${file}`);
    log(serialized);
    return 0;
  }

  write(file, serialized, 'utf8');
  log(`wrote SHA-256 ${sha256} to ${file}`);
  return 0;
}

// Only run main() if invoked directly (not when imported by tests).
const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectInvocation) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
