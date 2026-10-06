#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const NSC_PATH = path.resolve(__dirname, '../android/app/src/main/res/xml/network_security_config.xml');

// Require canonical standard Base64 and exactly 32 SHA-256 bytes. Android
// padded and unpadded values work; Node's permissive decoder alone is unsafe.
function decodePin(value) {
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64').replace(/=$/, '') !== value.replace(/=$/, '')) return null;
  return decoded;
}
function findPinProblems(source) {
  const problems = [];
  const xml = source.replace(/<!--[\s\S]*?-->/g, '');
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<network-security-config>[\s\S]*<\/network-security-config>\s*$/.test(xml)) return ['network security XML root is invalid'];
  if (/cleartextTrafficPermitted\s*=\s*["']true["']/.test(xml)) problems.push('release network policy permits cleartext');
  if (/<certificates\b[^>]*src=["']user["']/.test(xml.replace(/<debug-overrides>[\s\S]*?<\/debug-overrides>/g, ''))) problems.push('release network policy trusts user CAs');
  const domains = xml.match(/<domain-config\b[\s\S]*?<\/domain-config>/g) || [];
  const pinned = domains.filter(block => /<domain\b[^>]*>\s*app\.praeventio\.net\s*<\/domain>/.test(block));
  if (pinned.length !== 1) return [...problems, 'exactly one app.praeventio.net domain policy is required'];
  const sets = pinned[0].match(/<pin-set\b[\s\S]*?<\/pin-set>/g) || [];
  if (sets.length !== 1) return [...problems, 'exactly one production pin-set is required'];
  if (/expiration\s*=/.test(sets[0])) problems.push('production pin-set must not expire');
  const pins = [...sets[0].matchAll(/<pin\s+digest=["']([^"']+)["']\s*>([^<]+)<\/pin>/g)];
  if (pins.length < 2) problems.push('leaf and distinct backup pins are required');
  const values = [];
  for (const [, digest, value] of pins) {
    const decoded = decodePin(value.trim());
    if (digest !== 'SHA-256' || !decoded) problems.push('pin must be canonical Base64 decoding to 32 SHA-256 bytes');
    else values.push(decoded.toString('hex'));
  }
  if (new Set(values).size !== values.length) problems.push('leaf and backup pins must use different public keys');
  return problems;
}
module.exports = { decodePin, findPinProblems, NSC_PATH };
if (require.main === module) {
  const flag = process.argv.indexOf('--config');
  let problems;
  try { problems = findPinProblems(fs.readFileSync(flag >= 0 ? process.argv[flag + 1] : NSC_PATH, 'utf8')); }
  catch { problems = ['network security config missing or unreadable']; }
  for (const problem of problems) console.error(`[cert-pinning] FAIL: ${problem}`);
  if (!problems.length) console.log('Cert-pinning ratchet: PASS (distinct SHA-256 pins, HTTPS-only)');
  process.exit(problems.length ? 1 : 0);
}
