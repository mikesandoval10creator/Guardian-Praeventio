// Praeventio Guard \u2014 tests for the SOS rate-limiter keyGenerator.
//
// The route /api/emergency/sos is mounted as `verifyAuth, sosLimiter, ...`
// so under production req.user is always populated when the limiter runs.
// `sosLimiter` is a module-level singleton; any future refactor that
// moves it BEFORE verifyAuth (or attaches it to a different route that
// forgets auth) would silently degrade the key from per-uid to per-IP.
//
// The probe pins the contract:
//
//   1. With req.user populated, the key MUST be exactly the uid.
//   2. With req.user missing (refactor regression), the key MUST NOT fall
//      back to a per-IP shared value \u2014 it must surface a sentinel that
//      rejects rather than letting a saturated worker block the corporate
//      NAT and DOS coworkers under the same egress IP.
//
// These tests probe the keyGenerator directly, no Express required.

import { describe, it, expect } from 'vitest';
import { sosLimiterKey } from '../../server/routes/emergency.js';

function fakeReq(opts: { uid?: string; ip?: string }): unknown {
  return {
    user: opts.uid !== undefined ? { uid: opts.uid } : undefined,
    ip: opts.ip,
  };
}

describe('sosLimiterKey', () => {
  it('returns the caller uid when req.user is populated (per-user rate-limit)', () => {
    // sosLimiterKey accepts a Request but we pass a minimal stub here.
    const key = (sosLimiterKey as unknown as (r: unknown) => string)(fakeReq({ uid: 'alice', ip: '10.0.0.5' }));
    expect(key).toBe('alice');
  });

  it('does NOT silently fall back to a per-IP shared key when req.user is missing', () => {
    // stub request without user. ipKeyGenerator COULD resolve a value here,
    // but the fix MUST NOT use it — a saturated single worker would otherwise
    // DOS coworkers behind the same NAT egress IP.
    const key = (sosLimiterKey as unknown as (r: unknown) => string)(fakeReq({ ip: '203.0.113.7' }));
    if (key === '203.0.113.7') {
      throw new Error(
        `sosLimiterKey returned the request IP ("${key}") when req.user was undefined. ` +
          `This would let a saturated worker block every coworker behind the same NAT ` +
          `egress. The fix must surface a non-IP sentinel so the route returns 500 ` +
          `instead of throttling the shared IP.`,
      );
    }
    expect(typeof key).toBe('string');
    expect(key).not.toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });

  it('uses the caller uid even when no IP is available', () => {
    const key = (sosLimiterKey as unknown as (r: unknown) => string)(fakeReq({ uid: 'bob' }));
    expect(key).toBe('bob');
  });
});
