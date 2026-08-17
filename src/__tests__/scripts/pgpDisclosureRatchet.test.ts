// src/__tests__/scripts/pgpDisclosureRatchet.test.ts
//
// Loud-local companion to scripts/check-pgp-disclosure-ratchet.cjs.
// Verifies that `public/.well-known/pgp-key.asc` is either a real ASCII-armored
// PGP public key block OR (during the brief rotation window) the documented
// PLACEHOLDER sentinel — never a malformed value. The CI ratchet refuses
// placeholders outright; this test refuses ONLY malformation (which would
// regress the rotation procedure described in docs/security/PGP_GENERATION.md).
//
// Refs: ticket 39aaa66d-73fe-812a-ab8e-c2632704b84a
//       ("[P2][seguridad] Canal cifrado para reportar vulnerabilidades pendiente
//        (PGP placeholder)").

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const KEY_PATH = resolve(REPO_ROOT, 'public/.well-known/pgp-key.asc');
const SEC_PATH = resolve(REPO_ROOT, 'public/.well-known/security.txt');

const PLACEHOLDER_HEADER = '-----BEGIN PLACEHOLDER-----';
const PGP_HEADER = '-----BEGIN PGP PUBLIC KEY BLOCK-----';
const PGP_FOOTER = '-----END PGP PUBLIC KEY BLOCK-----';

describe('PGP disclosure key companion (public/.well-known/pgp-key.asc)', () => {
  it('is one of: real PGP block OR the documented PLACEHOLDER sentinel — never malformed', () => {
    const content = readFileSync(KEY_PATH, 'utf8');

    const isPlaceholder = content.startsWith(PLACEHOLDER_HEADER);
    const isRealBlock =
      content.includes(PGP_HEADER) && content.includes(PGP_FOOTER);

    expect(
      isPlaceholder || isRealBlock,
      'pgp-key.asc must be either the PLACEHOLDER sentinel (during rotation window) or a real PGP block — anything else is a regression.',
    ).toBe(true);
  });

  it('security.txt has an ACTIVE Encryption: directive (not commented)', () => {
    const content = readFileSync(SEC_PATH, 'utf8');
    const activeLines = content
      .split(/\r?\n/)
      .filter((line) => /^Encryption:\s*/.test(line));
    expect(
      activeLines.length,
      'security.txt must have at least one uncommented `Encryption:` directive (RFC 9116 §2.5.10).',
    ).toBeGreaterThanOrEqual(1);

    const encryptionUrl = activeLines[0]?.split(':').slice(1).join(':').trim() ?? '';
    const validUrl =
      /https?:\/\/[^/]+\/\.well-known\/pgp-key\.asc/.test(encryptionUrl) ||
      encryptionUrl === '/.well-known/pgp-key.asc';
    expect(
      validUrl,
      `Encryption: URL must point at pgp-key.asc (got: ${encryptionUrl})`,
    ).toBe(true);
  });

  it('is consistent: when the key file is the placeholder, Encryption: must NOT be active (rotation half-state)', () => {
    const keyContent = readFileSync(KEY_PATH, 'utf8');
    const secContent = readFileSync(SEC_PATH, 'utf8');
    const isPlaceholder = keyContent.startsWith(PLACEHOLDER_HEADER);
    const encryptionActive = /^Encryption:\s*/m.test(secContent);

    if (isPlaceholder) {
      expect(
        encryptionActive,
        'If pgp-key.asc is the PLACEHOLDER sentinel, security.txt Encryption: must remain commented — otherwise reporters would be referred to a non-existent key.',
      ).toBe(false);
    } else {
      expect(
        encryptionActive,
        'If pgp-key.asc is a real PGP block, security.txt Encryption: MUST be active (otherwise the URL is orphan).',
      ).toBe(true);
    }
  });
});