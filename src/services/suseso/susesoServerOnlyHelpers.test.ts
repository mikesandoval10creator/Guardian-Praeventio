// Praeventio Guard — Sprint 49 D.8.a tests for susesoServerOnlyHelpers.
//
// Coverage:
//   1. loadSusesoCredentials happy path with valid env
//   2. throws on missing SUSESO_MUTUALITY_ID
//   3. throws on missing SUSESO_EMPLOYER_TOKEN
//   4. throws on invalid mutualidad value
//   5. throws on weak (short) employer token
//   6. canonicalize sorts keys deterministically
//   7. verifyEmployerSignature accepts a valid HMAC
//   8. verifyEmployerSignature rejects a tampered payload
//   9. verifyEmployerSignature rejects a malformed token shape
//  10. verifyEmployerSignature returns false when credentials missing

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  loadSusesoCredentials,
  verifyEmployerSignature,
  canonicalize,
} from './susesoServerOnlyHelpers.js';

const STRONG_TOKEN = 'a'.repeat(64); // 64 hex-ish chars, well > 32

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const base = {
    SUSESO_MUTUALITY_ID: 'achs',
    SUSESO_EMPLOYER_TOKEN: STRONG_TOKEN,
  };
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe('loadSusesoCredentials', () => {
  it('returns credentials with valid env', () => {
    const creds = loadSusesoCredentials(envWith({}));
    expect(creds.mutualityId).toBe('achs');
    expect(creds.employerToken).toBe(STRONG_TOKEN);
  });

  it('throws when SUSESO_MUTUALITY_ID is missing', () => {
    expect(() => loadSusesoCredentials(envWith({ SUSESO_MUTUALITY_ID: undefined })))
      .toThrow(/SUSESO_MUTUALITY_ID is not set/);
  });

  it('throws when SUSESO_EMPLOYER_TOKEN is missing', () => {
    expect(() => loadSusesoCredentials(envWith({ SUSESO_EMPLOYER_TOKEN: undefined })))
      .toThrow(/SUSESO_EMPLOYER_TOKEN is not set/);
  });

  it('throws when SUSESO_MUTUALITY_ID is not a recognized mutualidad', () => {
    expect(() => loadSusesoCredentials(envWith({ SUSESO_MUTUALITY_ID: 'nope' })))
      .toThrow(/not a recognized mutualidad/);
  });

  it('throws when SUSESO_EMPLOYER_TOKEN is shorter than 32 chars', () => {
    expect(() => loadSusesoCredentials(envWith({ SUSESO_EMPLOYER_TOKEN: 'short' })))
      .toThrow(/at least 32 chars/);
  });
});

describe('canonicalize', () => {
  it('produces identical output regardless of key order', () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });
});

describe('verifyEmployerSignature', () => {
  const payload = { tenantId: 't1', kind: 'DIAT', victimRut: '11.111.111-1' };

  function sign(p: Record<string, unknown>, key: string = STRONG_TOKEN): string {
    return createHmac('sha256', key).update(canonicalize(p)).digest('hex');
  }

  it('accepts a valid HMAC token', () => {
    const token = sign(payload);
    expect(verifyEmployerSignature(token, payload, envWith({}))).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const token = sign(payload);
    const tampered = { ...payload, victimRut: '22.222.222-2' };
    expect(verifyEmployerSignature(token, tampered, envWith({}))).toBe(false);
  });

  it('rejects a token that is not 64-hex-chars', () => {
    expect(verifyEmployerSignature('not-hex', payload, envWith({}))).toBe(false);
    expect(verifyEmployerSignature('abc123', payload, envWith({}))).toBe(false);
  });

  it('returns false when credentials are missing (does not throw)', () => {
    const token = sign(payload);
    const broken = envWith({ SUSESO_EMPLOYER_TOKEN: undefined });
    expect(verifyEmployerSignature(token, payload, broken)).toBe(false);
  });

  it('rejects a HMAC signed with a different key', () => {
    const otherToken = sign(payload, 'b'.repeat(64));
    expect(verifyEmployerSignature(otherToken, payload, envWith({}))).toBe(false);
  });
});
