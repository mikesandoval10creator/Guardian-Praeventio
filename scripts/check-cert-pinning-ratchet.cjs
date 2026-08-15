#!/usr/bin/env node
// scripts/check-cert-pinning-ratchet.cjs
//
// MASVS-NETWORK-2 cert-pinning release gate.
//
// The Android network_security_config.xml ships with a <pin-set> for
// app.praeventio.net. Two pins are declared (leaf + backup) and one of them
// MUST match every TLS handshake; if neither matches, Android refuses the
// connection. Because real SPKI SHA-256 digests depend on the live production
// certificate, the file at HEAD carries literal placeholder strings
// (PIN_SHA256_LEAF_REPLACE_AT_PROD_DEPLOY / _BACKUP_REPLACE_AT_PROD_DEPLOY)
// that the release owner replaces via the procedure in
// docs/mobile-signing-runbook.md §4 before the first store build.
//
// This ratchet runs in CI (npm run lint:cert-pinning) and refuses to pass if
// ANY of:
//   • The file is missing the <pin-set> for app.praeventio.net.
//   • There is fewer than 2 pins (RFC 7469 §4.2.2 leaf + backup).
//   • Any pin uses a digest weaker than SHA-256.
//   • The pinned domain-config has cleartextTrafficPermitted="true".
//   • Any pin still carries a literal PLACEHOLDER string.
//
// Exit codes:
//   0 — all checks pass (pinned, 2+ pins, SHA-256, no placeholders, no cleartext)
//   1 — at least one check failed; the build is not shippable.
//   2 — the file is missing or unparseable (catastrophic).
//
// Usage:
//   node scripts/check-cert-pinning-ratchet.cjs            # gate (CI)
//   node scripts/check-cert-pinning-ratchet.cjs --verbose  # print the extracted pins
//
// The unit-test counterpart (MASVS-NETWORK-2 describe block in
// src/__tests__/mobile/androidBuildWiring.test.ts) covers the same
// invariants as a loud-local failure during `npm run test` so the ratchet is
// belt + suspenders: a developer running tests will see the failure BEFORE
// CI runs the ratchet script.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const NSC_PATH = path.join(
  REPO_ROOT,
  'android',
  'app',
  'src',
  'main',
  'res',
  'xml',
  'network_security_config.xml',
);

const PLACEHOLDER_TOKENS = [
  'PIN_SHA256_LEAF_REPLACE_AT_PROD_DEPLOY',
  'PIN_SHA256_BACKUP_REPLACE_AT_PROD_DEPLOY',
];

function fail(check, message) {
  console.error(`[FAIL] ${check}: ${message}`);
  failures += 1;
}

let failures = 0;

if (!fs.existsSync(NSC_PATH)) {
  console.error(`[FAIL] file: ${NSC_PATH} does not exist`);
  process.exit(2);
}

const nsc = fs.readFileSync(NSC_PATH, 'utf8');

// Quick well-formedness probe — the file is small enough that we don't need
// a full XML parser to enforce the structural checks below, but malformed
// XML would be a catastrophic config regression so we surface it explicitly.
const openTags = (nsc.match(/<network-security-config>/g) || []).length;
const closeTags = (nsc.match(/<\/network-security-config>/g) || []).length;
if (openTags !== 1 || closeTags !== 1) {
  console.error(`[FAIL] file: <network-security-config> root appears ${openTags}× open / ${closeTags}× close`);
  process.exit(2);
}

// Check 1: a <domain-config> for app.praeventio.net exists.
const domainConfigs = nsc.match(/<domain-config[\s\S]*?<\/domain-config>/g) || [];
const pinnedDomain = domainConfigs.find((block) =>
  // Match the exact <domain> child element of <domain-config>, not a
  // substring (CodeQL js/incomplete-url-substring-sanitization):
  //   <domain includeSubdomains="false">app.praeventio.net</domain>
  // The regex anchor on </domain> ensures no trailing host suffix can match.
  /<domain[^>]*>app\.praeventio\.net<\/domain>/.test(block),
);
if (!pinnedDomain) {
  fail(
    'domain pinned',
    'no <domain-config> includes app.praeventio.net — pinning is missing entirely',
  );
} else {
  // Check 2: that block contains a <pin-set>.
  if (!/<pin-set[\s\S]*<\/pin-set>/.test(pinnedDomain)) {
    fail('pin-set present', '<domain-config> for app.praeventio.net has no <pin-set>');
  }

  // Check 3: cleartext disabled (no true).
  if (/cleartextTrafficPermitted="true"/.test(pinnedDomain)) {
    fail(
      'cleartext disabled',
      'pinned domain-config has cleartextTrafficPermitted="true" — pinning is moot over cleartext',
    );
  }

  // Check 4: >= 2 pins.
  const pins = pinnedDomain.match(/<pin digest="([^"]+)">([^<]+)<\/pin>/g) || [];
  if (pins.length < 2) {
    fail(
      'pin count',
      `pin-set has ${pins.length} pin(s); need ≥2 (RFC 7469 §4.2.2 leaf + backup)`,
    );
  }

  // Check 5: every pin uses SHA-256.
  const digests = (pinnedDomain.match(/<pin digest="([^"]+)">/g) || []).map((d) =>
    d.match(/digest="([^"]+)"/)[1],
  );
  for (const d of digests) {
    if (d !== 'SHA-256') {
      fail('digest', `pin uses digest=${d}; only SHA-256 is accepted (Android's mandatory digest per platform docs)`);
    }
  }

  // Check 5b: every pin value is exactly 43 chars of base64 (no padding '=').
  // This is the canonical SPKI SHA-256 digest length (256 bits / 6 bits per
  // base64 char = 42.67 → 43 chars). Shorter or longer values are malformed.
  // Real pins from openssl enc -base64 always come out this way; anything
  // else is a copy-paste error or a fabricated value.
  const pinValueMatches =
    pinnedDomain.match(/<pin digest="SHA-256">([^<]+)<\/pin>/g) || [];
  for (const tag of pinValueMatches) {
    const value = tag.match(/>([^<]+)</)?.[1] ?? '';
    if (!/^[A-Za-z0-9+/]{43}$/.test(value)) {
      fail(
        'pin value format',
        `pin value "${value.slice(0, 12)}..." is not exactly 43 chars of base64 (no padding). Re-extract with openssl or replace with a real digest.`,
      );
    }
  }

  // Check 6: no placeholder strings (this is the release gate).
  let placeholderFound = false;
  for (const token of PLACEHOLDER_TOKENS) {
    if (nsc.includes(token)) {
      placeholderFound = true;
      fail(
        'placeholder pin',
        `pin still carries placeholder "${token}". Run the procedure in docs/mobile-signing-runbook.md §4 before shipping.`,
      );
    }
  }

  // Verbose dump of the current pin set for the operator running the gate.
  if (process.argv.includes('--verbose')) {
    console.log('--- Current pin-set for app.praeventio.net ---');
    if (pins.length === 0) {
      console.log('  (none)');
    } else {
      for (const p of pins) {
        const m = p.match(/digest="([^"]+)">([^<]+)</);
        console.log(`  digest=${m[1]}  value=${m[2]}`);
      }
    }
    console.log('---');
  }
}

if (failures > 0) {
  console.error(`\nCert-pinning ratchet: ${failures} failure(s). Build is NOT shippable.`);
  process.exit(1);
}

console.log('Cert-pinning ratchet: PASS (pinned, ≥2 SHA-256 pins, no placeholders, cleartext disabled)');