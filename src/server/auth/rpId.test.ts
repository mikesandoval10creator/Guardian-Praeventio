// Unit tests for getWebauthnRpId() — the single WebAuthn RP ID resolver.
//
// Regression target: in production the four signing routes used to fall back
// to `localhost`, so passkey signatures verified against the wrong RP ID and
// always failed. The helper must now fail-loud in prod when the env is unset.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWebauthnRpId, getWebauthnExpectedOrigin } from './rpId.js';

describe('getWebauthnRpId', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.NODE_ENV;
    delete process.env.APP_BASE_URL;
    delete process.env.APP_URL;
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

describe('getWebauthnExpectedOrigin', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.APP_BASE_URL;
    delete process.env.APP_URL;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns APP_BASE_URL verbatim in production (https)', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://app.praeventio.net';
    expect(getWebauthnExpectedOrigin()).toBe('https://app.praeventio.net');
  });

  it('prefers APP_BASE_URL over APP_URL', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://app.praeventio.net';
    process.env.APP_URL = 'https://other.praeventio.net';
    expect(getWebauthnExpectedOrigin()).toBe('https://app.praeventio.net');
  });

  it('throws in production when both APP_BASE_URL and APP_URL are unset', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getWebauthnExpectedOrigin()).toThrowError(/required in production/);
  });

  it('throws in production when the origin is http:// (not https)', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'http://app.praeventio.net';
    expect(() => getWebauthnExpectedOrigin()).toThrowError(/https:\/\/ in production/);
  });

  it('falls back to localhost:5173 in dev/test when unset', () => {
    process.env.NODE_ENV = 'test';
    expect(getWebauthnExpectedOrigin()).toBe('http://localhost:5173');
  });

  it('returns the configured origin in dev when set', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    expect(getWebauthnExpectedOrigin()).toBe('http://localhost:3000');
  });
});
