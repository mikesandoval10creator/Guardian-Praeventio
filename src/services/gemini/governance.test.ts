// Tests §12.5.1 split step 1 — gemini/governance.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/middleware/geminiCircuit.js', () => ({
  geminiCircuit: {
    isOpen: vi.fn(() => false),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  },
}));

vi.mock('../observability/quotaTracker.js', () => ({
  checkQuotaLimit: vi.fn(async () => ({ allowed: true, reason: undefined })),
  trackGeminiUsage: vi.fn(async () => undefined),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { geminiCircuit } from '../../server/middleware/geminiCircuit.js';
import { checkQuotaLimit, trackGeminiUsage } from '../observability/quotaTracker.js';
import {
  assertGeminiAllowed,
  estimateGeminiCostUsd,
  recordGeminiOutcome,
} from './governance';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(geminiCircuit.isOpen).mockReturnValue(false);
  vi.mocked(checkQuotaLimit).mockResolvedValue({ allowed: true } as never);
});

describe('estimateGeminiCostUsd', () => {
  it('flash 2.0: 1M in + 1M out = 0.075 + 0.30', () => {
    const usd = estimateGeminiCostUsd('gemini-2.0-flash', 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(0.375, 5);
  });

  it('pro 3.1: 1M in + 1M out = 1.25 + 5.00', () => {
    const usd = estimateGeminiCostUsd('gemini-3.1-pro-preview', 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(6.25, 5);
  });

  it('modelo desconocido cae a Pro pricing (never under-bill)', () => {
    const unknown = estimateGeminiCostUsd('gemini-unicorn', 1_000_000, 0);
    const pro = estimateGeminiCostUsd('gemini-3.1-pro-preview', 1_000_000, 0);
    expect(unknown).toBe(pro);
  });

  it('0 tokens = $0', () => {
    expect(estimateGeminiCostUsd('gemini-2.0-flash', 0, 0)).toBe(0);
  });

  it('redondea a 6 decimales', () => {
    const usd = estimateGeminiCostUsd('gemini-2.0-flash', 1, 1);
    expect(Number.isFinite(usd)).toBe(true);
    expect(usd.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });
});

describe('assertGeminiAllowed', () => {
  it('circuit open → throw gemini_circuit_open', async () => {
    vi.mocked(geminiCircuit.isOpen).mockReturnValue(true);
    await expect(assertGeminiAllowed('t-1', 'gold')).rejects.toMatchObject({
      message: 'circuit_open',
      code: 'gemini_circuit_open',
    });
  });

  it('tenantId=system salta quota check', async () => {
    const result = await assertGeminiAllowed('system', 'diamond');
    expect(result).toBeNull();
    expect(checkQuotaLimit).not.toHaveBeenCalled();
  });

  it('quota exceeded → throw gemini_quota_exceeded', async () => {
    vi.mocked(checkQuotaLimit).mockResolvedValue({
      allowed: false,
      reason: 'requests_exceeded',
    } as never);
    await expect(assertGeminiAllowed('t-1', 'bronze')).rejects.toMatchObject({
      code: 'gemini_quota_exceeded',
    });
  });

  it('allowed → devuelve QuotaCheck', async () => {
    const ok = { allowed: true, used: 5, limit: 100 };
    vi.mocked(checkQuotaLimit).mockResolvedValue(ok as never);
    const result = await assertGeminiAllowed('t-1', 'gold');
    expect(result).toEqual(ok);
  });
});

describe('recordGeminiOutcome', () => {
  it('failure → recordFailure en circuit, no track usage', async () => {
    await recordGeminiOutcome('t-1', 'failure');
    expect(geminiCircuit.recordFailure).toHaveBeenCalledWith('gemini');
    expect(trackGeminiUsage).not.toHaveBeenCalled();
  });

  it('success + tenant → recordSuccess + trackUsage', async () => {
    await recordGeminiOutcome('t-1', 'success', {
      tokens: 1000,
      costUsd: 0.05,
    });
    expect(geminiCircuit.recordSuccess).toHaveBeenCalledWith('gemini');
    expect(trackGeminiUsage).toHaveBeenCalledWith('t-1', 1000, 0.05, {
      idempotencyKey: undefined,
    });
  });

  it('success + tenant=system → skip trackUsage', async () => {
    await recordGeminiOutcome('system', 'success', { tokens: 10 });
    expect(geminiCircuit.recordSuccess).toHaveBeenCalled();
    expect(trackGeminiUsage).not.toHaveBeenCalled();
  });

  it('trackUsage falla → NO throw (best-effort)', async () => {
    vi.mocked(trackGeminiUsage).mockRejectedValueOnce(new Error('firestore_down'));
    await expect(
      recordGeminiOutcome('t-1', 'success', { tokens: 100 }),
    ).resolves.toBeUndefined();
  });

  it('respeta circuitKey custom', async () => {
    await recordGeminiOutcome('t-1', 'failure', { circuitKey: 'gemini-flash' });
    expect(geminiCircuit.recordFailure).toHaveBeenCalledWith('gemini-flash');
  });
});
