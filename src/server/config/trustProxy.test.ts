import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { ipOnlyKey } from '../middleware/limiters.js';
import { configureTrustProxy, resolveTrustProxySetting } from './trustProxy.js';

function makeProbeApp(env: Record<string, string | undefined>) {
  const app = express();
  configureTrustProxy(app, env);
  app.get('/probe', (req, res) => res.json({ ip: req.ip, key: ipOnlyKey(req) }));
  return app;
}

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

describe('configureTrustProxy', () => {
  it('ignores a forged forwarded address outside Cloud Run', async () => {
    const response = await request(makeProbeApp({}))
      .get('/probe')
      .set('X-Forwarded-For', '198.51.100.10');

    expect(response.body.ip).not.toBe('198.51.100.10');
  });

  it.each(['198.51.100.10', '203.0.113.20'])(
    'uses distinct managed-ingress client address %s',
    async (clientIp) => {
      const response = await request(makeProbeApp({ K_SERVICE: 'guardian-praeventio' }))
        .get('/probe')
        .set('X-Forwarded-For', clientIp);

      expect(response.body).toEqual({ ip: clientIp, key: clientIp });
    },
  );

  it('ignores caller-controlled values before the trusted suffix', async () => {
    const response = await request(makeProbeApp({ K_SERVICE: 'guardian-praeventio' }))
      .get('/probe')
      .set('X-Forwarded-For', '192.0.2.44, 198.51.100.10');

    expect(response.body.ip).toBe('198.51.100.10');
  });
});
