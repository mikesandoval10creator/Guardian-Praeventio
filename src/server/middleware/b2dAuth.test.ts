// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.9 â€” b2dAuth middleware tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const verifyApiKeyMock = vi.hoisted(() => vi.fn());
const checkQuotaLimitMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/b2d/apiKeyService.js', () => ({
  verifyApiKey: verifyApiKeyMock,
}));

vi.mock('../../services/observability/quotaTracker.js', () => ({
  checkQuotaLimit: checkQuotaLimitMock,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { b2dAuth } from './b2dAuth.js';

function makeApp() {
  const app = express();
  app.get('/probe', b2dAuth('climate.read'), (req, res) => {
    res.json({ ok: true, customerId: req.b2dKey?.customerId });
  });
  return app;
}

beforeEach(() => {
  verifyApiKeyMock.mockReset();
  checkQuotaLimitMock.mockReset();
});

describe('b2dAuth middleware', () => {
  it('rejects requests with no Authorization header â†’ 401 missing_api_key', async () => {
    const res = await request(makeApp()).get('/probe');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'missing_api_key' });
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
  });

  it('rejects requests with malformed scheme â†’ 401 missing_api_key', async () => {
    const res = await request(makeApp())
      .get('/probe')
      .set('Authorization', 'Basic some:thing');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'missing_api_key' });
  });

  it('rejects unknown keys â†’ 401 invalid_api_key', async () => {
    verifyApiKeyMock.mockResolvedValue(null);
    const res = await request(makeApp())
      .get('/probe')
      .set('Authorization', 'Bearer pk_test_unknown');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_api_key' });
  });

  it('rejects keys missing the required scope â†’ 403 scope_required', async () => {
    verifyApiKeyMock.mockResolvedValue({
      id: 'k1',
      customerId: 'c1',
      tier: 'hazmat-base',
      scopes: ['hazmat.calculate'],
      keyHash: 'h',
      keyPrefix: 'p',
      status: 'active',
      createdAt: 0,
    });
    const res = await request(makeApp())
      .get('/probe')
      .set('Authorization', 'Bearer pk_test_xxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'scope_required', required: 'climate.read' });
  });

  it('blocks when quota is exceeded â†’ 429 with rate-limit headers', async () => {
    verifyApiKeyMock.mockResolvedValue({
      id: 'k2',
      customerId: 'c2',
      tier: 'climate-base',
      scopes: ['climate.read'],
      keyHash: 'h',
      keyPrefix: 'p',
      status: 'active',
      createdAt: 0,
    });
    checkQuotaLimitMock.mockResolvedValue({
      allowed: false,
      limit: 500,
      reason: 'requests_exceeded',
      usage: { tenantId: 'c2', date: '2026-05-04', geminiTokens: 0, geminiRequests: 500, geminiCostUsd: 0 },
    });
    const res = await request(makeApp())
      .get('/probe')
      .set('Authorization', 'Bearer pk_test_xxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('quota_exceeded');
    expect(res.body.tier).toBe('climate-base');
    expect(res.headers['x-ratelimit-limit']).toBe('500');
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('passes through on success and surfaces remaining quota header', async () => {
    verifyApiKeyMock.mockResolvedValue({
      id: 'k3',
      customerId: 'c3',
      tier: 'climate-pro',
      scopes: ['climate.read'],
      keyHash: 'h',
      keyPrefix: 'p',
      status: 'active',
      createdAt: 0,
    });
    checkQuotaLimitMock.mockResolvedValue({
      allowed: true,
      limit: 2000,
      usage: { tenantId: 'c3', date: '2026-05-04', geminiTokens: 0, geminiRequests: 17, geminiCostUsd: 0 },
    });
    const res = await request(makeApp())
      .get('/probe')
      .set('Authorization', 'Bearer pk_test_xxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, customerId: 'c3' });
    expect(res.headers['x-ratelimit-limit']).toBe('2000');
    expect(res.headers['x-ratelimit-remaining']).toBe(String(2000 - 17));
  });

  it('grants suite.all keys access to ALL scopes', async () => {
    verifyApiKeyMock.mockResolvedValue({
      id: 'k4',
      customerId: 'c4',
      tier: 'suite-pro',
      scopes: ['suite.all'],
      keyHash: 'h',
      keyPrefix: 'p',
      status: 'active',
      createdAt: 0,
    });
    checkQuotaLimitMock.mockResolvedValue({
      allowed: true,
      limit: 5000,
      usage: { tenantId: 'c4', date: '2026-05-04', geminiTokens: 0, geminiRequests: 0, geminiCostUsd: 0 },
    });
    const res = await request(makeApp())
      .get('/probe')
      .set('Authorization', 'Bearer pk_live_xxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('c4');
  });
});
