#!/usr/bin/env node
/**
 * fill-ios-aasa.mjs
 *
 * Replaces every `TEAMID.` prefix in `public/.well-known/apple-app-site-association`
 * with the real 10-character Apple Team ID.
 *
 * Idempotent: works on a copy in memory, only writes when the resulting JSON
 * is valid and different from the input. On any failure the original file is
 * left untouched.
 *
 * Inputs (priority: CLI args > env vars):
 *   --team-id <id>     APPLE_TEAM_ID
 *   --file <path>      AASA_FILE        (default: public/.well-known/apple-app-site-association)
 *   --dry-run                           (print what would change, don't write)
 *
 * Exit codes:
 *   0  success (file updated or already correct)
 *   1  invalid arguments / file not found
 *   2  reserved (parity with android script)
 *   3  JSON validation failed after replacement
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLACEHOLDER = 'TEAMID';
// Apple Team IDs are exactly 10 alphanumeric characters (upper case),
// e.g. `A1B2C3D4E5`. We accept any case on input and upper-case it.
const TEAM_ID_REGEX = /^[A-Z0-9]{10}$/;

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
 * Replace every `TEAMID.` prefix inside `appID` strings and the
 * `webcredentials.apps` array. Returns a new object; does not mutate.
 *
 * We do NOT do a naïve string replace on the file: that would corrupt any
 * legitimate `"TEAMID"` literal outside the appID prefix (unlikely, but the
 * structured walk is cheap insurance).
 */
export function applyTeamId(json, teamId) {
  if (!json || typeof json !== 'object') {
    throw new Error('aasa: top-level must be an object');
  }
  const cloned = JSON.parse(JSON.stringify(json));
  const replace = (s) =>
    typeof s === 'string' && s.startsWith(`${PLACEHOLDER}.`)
      ? `${teamId}.${s.slice(PLACEHOLDER.length + 1)}`
      : s;

  const details = cloned.applinks?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (typeof d.appID === 'string') d.appID = replace(d.appID);
      if (Array.isArray(d.appIDs)) d.appIDs = d.appIDs.map(replace);
    }
  }
  const wcApps = cloned.webcredentials?.apps;
  if (Array.isArray(wcApps)) {
    cloned.webcredentials.apps = wcApps.map(replace);
  }
  const acApps = cloned.appclips?.apps;
  if (Array.isArray(acApps)) {
    cloned.appclips.apps = acApps.map(replace);
  }
  return cloned;
}

/**
 * Validate the resulting AASA JSON. Returns { ok, errors }.
 */
export function validateAasa(json) {
  const errors = [];
  if (!json || typeof json !== 'object') {
    errors.push('top-level must be an object');
    return { ok: false, errors };
  }
  const haystack = JSON.stringify(json);
  if (haystack.includes(`${PLACEHOLDER}.`)) {
    errors.push(`still contains "${PLACEHOLDER}." prefix`);
  }
  const details = json.applinks?.details;
  if (Array.isArray(details)) {
    for (const [i, d] of details.entries()) {
      const ids = [];
      if (typeof d.appID === 'string') ids.push(d.appID);
      if (Array.isArray(d.appIDs)) ids.push(...d.appIDs);
      for (const id of ids) {
        const prefix = id.split('.')[0];
        if (!TEAM_ID_REGEX.test(prefix)) {
          errors.push(`applinks.details[${i}] appID prefix not a Team ID: ${prefix}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function main(argv, deps = {}) {
  const {
    read = readFileSync,
    write = writeFileSync,
    exists = existsSync,
    log = console.log,
    err = console.error,
    env = process.env,
  } = deps;

  const opts = parseArgs(argv);
  const file =
    opts.file ||
    env.AASA_FILE ||
    path.join('public', '.well-known', 'apple-app-site-association');

  let teamId = opts['team-id'] || env.APPLE_TEAM_ID;
  if (!teamId) {
    err('error: need --team-id <ID> (or APPLE_TEAM_ID env var)');
    return 1;
  }
  teamId = String(teamId).toUpperCase();
  if (!TEAM_ID_REGEX.test(teamId)) {
    err(`error: team id must be 10 alphanumeric chars (got: ${teamId})`);
    return 1;
  }

  if (!exists(file)) {
    err(`error: file not found: ${file}`);
    return 1;
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
    updated = applyTeamId(json, teamId);
  } catch (e) {
    err(`error: ${e.message}`);
    return 1;
  }

  const validation = validateAasa(updated);
  if (!validation.ok) {
    err('error: resulting JSON failed validation:');
    for (const v of validation.errors) err(`  - ${v}`);
    return 3;
  }

  const serialized = JSON.stringify(updated, null, 2) + '\n';
  if (serialized === raw) {
    log(`no change: ${file} already uses team id ${teamId}`);
    return 0;
  }

  if (opts['dry-run']) {
    log(`[dry-run] would write team id ${teamId} to ${file}`);
    log(serialized);
    return 0;
  }

  write(file, serialized, 'utf8');
  log(`wrote team id ${teamId} to ${file}`);
  return 0;
}

const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectInvocation) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
