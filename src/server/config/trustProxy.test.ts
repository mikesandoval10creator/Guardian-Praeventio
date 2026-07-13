import { describe, expect, it } from 'vitest';

import { resolveTrustProxySetting } from './trustProxy.js';

describe('resolveTrustProxySetting', () => {
  it('keeps direct local processes untrusted by default', () => {
    expect(resolveTrustProxySetting({})).toBe(false);
  });

  it('trusts exactly the managed ingress hop on Cloud Run', () => {
    expect(resolveTrustProxySetting({ K_SERVICE: 'guardian-praeventio' })).toBe(1);
  });

  it.each([
    ['0', false],
    ['1', 1],
    ['2', 2],
  ] as const)('maps TRUST_PROXY_HOPS=%s to %s', (raw, expected) => {
    expect(resolveTrustProxySetting({ TRUST_PROXY_HOPS: raw })).toBe(expected);
  });

  it.each(['', ' ', '-1', '1.5', 'abc', '1e2', '9007199254740992'])(
    'rejects ambiguous TRUST_PROXY_HOPS=%j',
    (raw) => {
      expect(() => resolveTrustProxySetting({ TRUST_PROXY_HOPS: raw })).toThrow(
        'TRUST_PROXY_HOPS must be 0 or a positive safe integer',
      );
    },
  );
});
