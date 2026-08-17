#!/usr/bin/env node
// scripts/check-pgp-disclosure-ratchet.cjs
//
// RFC 9116 (security.txt) + OpenPGP disclosure-key release gate.
//
// `public/.well-known/security.txt` references `pgp-key.asc` via the
// `Encryption:` directive (RFC 9116 §2.5.10). The referenced file MUST be
// a real ASCII-armored OpenPGP public key block (RFC 4880 §11), not a
// placeholder, so that vulnerability reporters can encrypt their PoC
// end-to-end against contacto@praeventio.net.
//
// This ratchet runs in CI (npm run lint:pgp-disclosure) and refuses to
// pass if ANY of:
//   • `pgp-key.asc` is missing or empty.
//   • `pgp-key.asc` starts with `-----BEGIN PLACEHOLDER-----` (the
//     pre-rotation sentinel committed intentionally so the URL returns 200
//     instead of 404 — see SECURITY.md §17 for the rationale).
//   • `pgp-key.asc` does NOT start with `-----BEGIN PGP PUBLIC KEY BLOCK-----`.
//   • `pgp-key.asc` does NOT end with `-----END PGP PUBLIC KEY BLOCK-----`.
//   • When `gpg` is available on PATH: `gpg --show-keys` cannot parse the
//     block (rejects the file as not-a-real-key). This catches tampered or
//     truncated blocks that pass the textual header/footer sniff but fail
//     real PGP parsing.
//   • `security.txt` does NOT have an active `Encryption:` line (still
//     commented out, e.g. `# Encryption:`).
//   • The `Encryption:` URL in `security.txt` does not point at the same
//     host+path as the key file would be served from.
//
// When `gpg` is NOT on PATH (e.g. minimal Windows CI runners), the ratchet
// falls back to a structural-only check (header + footer + placeholder
// rejection). The structural check is weaker but still catches the
// regression modes that mattered historically (placeholder re-introduction
// or `Encryption:` re-commenting after a manual edit).
//
// Exit codes:
//   0 — all checks pass (real key block + active Encryption + URL matches)
//   1 — at least one check failed; build is not shippable.
//
// Usage:
//   node scripts/check-pgp-disclosure-ratchet.cjs
//   node scripts/check-pgp-disclosure-ratchet.cjs --verbose   # show fingerprint if extractable

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const KEY_PATH = path.join(REPO_ROOT, 'public', '.well-known', 'pgp-key.asc');
const SEC_PATH = path.join(REPO_ROOT, 'public', '.well-known', 'security.txt');

const VERBOSE = process.argv.includes('--verbose');

function fail(check, message) {
  console.error(`✗ ${check}: ${message}`);
}

function ok(check, message) {
  console.log(`✓ ${check}: ${message}`);
}

function main() {
  let failed = 0;

  // 1. Files exist.
  if (!fs.existsSync(KEY_PATH)) {
    fail('key-file', `missing: ${path.relative(REPO_ROOT, KEY_PATH)}`);
    process.exit(1);
  }
  if (!fs.existsSync(SEC_PATH)) {
    fail('security-txt', `missing: ${path.relative(REPO_ROOT, SEC_PATH)}`);
    process.exit(1);
  }

  const keyContent = fs.readFileSync(KEY_PATH, 'utf8');
  const secContent = fs.readFileSync(SEC_PATH, 'utf8');

  // 2. Key file is non-empty.
  if (keyContent.trim().length === 0) {
    fail('key-file', 'is empty');
    failed += 1;
  } else {
    ok('key-file', `${keyContent.length} bytes`);
  }

  // 3. Key file is NOT the placeholder sentinel.
  if (/-----BEGIN PLACEHOLDER-----/.test(keyContent)) {
    fail('key-file', 'still carries BEGIN PLACEHOLDER sentinel');
    failed += 1;
  } else {
    ok('placeholder', 'no PLACEHOLDER sentinel detected');
  }

  // 4. Key file starts with a real PGP PUBLIC KEY BLOCK header.
  if (!/-----BEGIN PGP PUBLIC KEY BLOCK-----/.test(keyContent)) {
    fail('key-file', 'missing `-----BEGIN PGP PUBLIC KEY BLOCK-----` header');
    failed += 1;
  } else {
    ok('pgp-header', 'BEGIN PGP PUBLIC KEY BLOCK present');
  }

  // 5. Key file ends with the matching footer.
  if (!/-----END PGP PUBLIC KEY BLOCK-----/.test(keyContent)) {
    fail('key-file', 'missing `-----END PGP PUBLIC KEY BLOCK-----` footer');
    failed += 1;
  } else {
    ok('pgp-footer', 'END PGP PUBLIC KEY BLOCK present');
  }

  // 6. When gpg is available, run a real cryptographic parse. This catches
  //    tampered/truncated blocks that pass the textual header/footer sniff
  //    but fail real PGP parsing.
  const gpgProbe = spawnSync('gpg', ['--version'], { encoding: 'utf8' });
  if (gpgProbe.status === 0) {
    const gpgShow = spawnSync('gpg', ['--show-keys', KEY_PATH], { encoding: 'utf8' });
    if (gpgShow.status !== 0) {
      fail('pgp-parse', `gpg --show-keys failed (status=${gpgShow.status}): ${gpgShow.stderr.slice(0, 200)}`);
      failed += 1;
    } else {
      // Extract the primary fingerprint: a 40-hex-char token (possibly with
      // internal whitespace depending on gpg version). Pattern accepts both
      // `2ED5078CE2A19C2BF74E2C5C089A06D2A29030B2` and `2ED5 078C ... 30B2`.
      const fpMatch = gpgShow.stdout.match(/\b([0-9A-F]{4}(?:[ ]{1,3}[0-9A-F]{4}){9}|[0-9A-F]{40})\b/m);
      if (!fpMatch) {
        fail('pgp-parse', 'gpg accepted the block but no primary fingerprint was emitted');
        failed += 1;
      } else {
        const fp = fpMatch[1].replace(/\s+/g, '').toUpperCase();
        const fpFormatted = fp.match(/.{1,4}/g).join(' ');
        // Extract expiry: pattern `expires: YYYY-MM-DD`.
        const expMatch = gpgShow.stdout.match(/\[expires:\s*(\d{4}-\d{2}-\d{2})\]/);
        ok('pgp-parse', `gpg parsed; fingerprint=${fpFormatted}${expMatch ? `; expires=${expMatch[1]}` : ''}`);
        if (VERBOSE) {
          console.log(`    raw fingerprint: ${fp}`);
        }
      }
    }
  } else {
    console.log('~ pgp-parse: SKIPPED (gpg not on PATH — structural-only check)');
  }

  // 7. security.txt has an ACTIVE Encryption: line (not commented).
  const encryptionLines = secContent.split(/\r?\n/).filter((l) => /^Encryption:\s*/.test(l));
  if (encryptionLines.length === 0) {
    fail('security-txt-encryption', 'no active `Encryption:` directive (still commented?)');
    failed += 1;
  } else {
    ok('security-txt-encryption', `${encryptionLines.length} active Encryption: directive(s)`);
    if (VERBOSE) {
      encryptionLines.forEach((l) => console.log(`    ${l.trim()}`));
    }
  }

  // 8. The Encryption URL must point at a path that serves pgp-key.asc.
  //    Acceptable forms: full https:// URL ending in pgp-key.asc OR a
  //    relative path starting with `/.well-known/pgp-key.asc`.
  const encryptionUrl = encryptionLines[0]?.split(':').slice(1).join(':').trim() ?? '';
  const validUrl =
    /https?:\/\/[^/]+\/\.well-known\/pgp-key\.asc/.test(encryptionUrl) ||
    encryptionUrl === '/.well-known/pgp-key.asc';
  if (!validUrl) {
    fail('security-txt-encryption-url', `URL does not point at pgp-key.asc: ${encryptionUrl}`);
    failed += 1;
  } else if (VERBOSE) {
    ok('security-txt-encryption-url', encryptionUrl);
  }

  if (failed > 0) {
    console.error(`\n[pgp-disclosure-ratchet] FAIL — ${failed} check(s) failed.`);
    console.error('Run `npm run lint:pgp-disclosure -- --verbose` for details.');
    console.error('See docs/security/PGP_GENERATION.md for the rotation procedure.');
    process.exit(1);
  }
  console.log('\n[pgp-disclosure-ratchet] PASS — pgp-key.asc is a real PGP block, security.txt Encryption: is active.');
  process.exit(0);
}

main();