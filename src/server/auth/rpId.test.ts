// Unit tests for getWebauthnRpId() — the single WebAuthn RP ID resolver.
//
// Regression target: in production the four signing routes used to fall back
// to `localhost`, so passkey signatures verified against the wrong RP ID and
// always failed. The helper must now fail-loud in prod when the env is unset.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWebauthnRpId } from './rpId.js';

describe('getWebauthnRpId', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the env value verbatim when WEBAUTHN_RP_ID is set (production)', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBAUTHN_RP_ID = 'app.praeventio.net';
    expect(getWebauthnRpId()).toBe('app.praeventio.net');
  });

  it('returns the env value verbatim when WEBAUTHN_RP_ID is set (dev)', () => {
    process.env.NODE_ENV = 'development';
    process.env.WEBAUTHN_RP_ID = 'staging.praeventio.net';
    expect(getWebauthnRpId()).toBe('staging.praeventio.net');
  });

  it('throws in production when WEBAUTHN_RP_ID is missing', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getWebauthnRpId()).toThrowError(/WEBAUTHN_RP_ID is required in production/);
  });

  it('throws in production when WEBAUTHN_RP_ID is the empty string', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBAUTHN_RP_ID = '';
    expect(() => getWebauthnRpId()).toThrowError(/WEBAUTHN_RP_ID is required in production/);
  });

  it('falls back to localhost in development', () => {
    process.env.NODE_ENV = 'development';
    expect(getWebauthnRpId()).toBe('localhost');
  });

  it('falls back to localhost in test', () => {
    process.env.NODE_ENV = 'test';
    expect(getWebauthnRpId()).toBe('localhost');
  });

  it('falls back to localhost when NODE_ENV is unset', () => {
    expect(getWebauthnRpId()).toBe('localhost');
  });
});
