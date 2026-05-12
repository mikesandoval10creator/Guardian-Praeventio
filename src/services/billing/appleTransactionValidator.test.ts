import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  __setAppleSeamForTests,
  validateAppleTransaction,
  type AppleTransactionPayload,
} from './appleTransactionValidator.js';

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
const BUNDLE_ID = 'com.praeventio.guard';
const PRODUCT_ID = 'praeventio_premium_monthly';
const FAR_FUTURE = Date.now() + 30 * 24 * 60 * 60 * 1000;
const PAST = Date.now() - 24 * 60 * 60 * 1000;

function validPayload(over: Partial<AppleTransactionPayload> = {}): AppleTransactionPayload {
  return {
    bundleId: BUNDLE_ID,
    productId: PRODUCT_ID,
    transactionId: 'tx-123',
    originalTransactionId: 'otx-original',
    expiresDate: FAR_FUTURE,
    purchaseDate: Date.now(),
    type: 'Auto-Renewable Subscription',
    ...over,
  };
}

function setEnv(opts: { withConfig: boolean } = { withConfig: true }) {
  if (opts.withConfig) {
    process.env.APPLE_API_KEY_PATH = '/dev/null'; // never actually read — seam stubs fetch
    process.env.APPLE_KEY_ID = 'TESTKEY00';
    process.env.APPLE_ISSUER_ID = '57246542-96fe-1a63-e053-0824d011072a';
    process.env.APPLE_BUNDLE_ID = BUNDLE_ID;
  } else {
    delete process.env.APPLE_API_KEY_PATH;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_ISSUER_ID;
    delete process.env.APPLE_BUNDLE_ID;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────
describe('validateAppleTransaction', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    setEnv({ withConfig: true });
  });

  afterEach(() => {
    __setAppleSeamForTests(null);
    process.env = { ...originalEnv };
  });

  it('returns config_missing when bundle id env is unset', async () => {
    setEnv({ withConfig: false });
    const result = await validateAppleTransaction('tx', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('config_missing'); }
  });

  it('returns config_missing when only some Apple env vars are set', async () => {
    setEnv({ withConfig: true });
    delete process.env.APPLE_KEY_ID;
    // Inject a seam so we don't accidentally hit the real Apple API.
    __setAppleSeamForTests({
      fetchTransaction: vi.fn(),
    });
    const result = await validateAppleTransaction('tx', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('config_missing'); }
  });

  it('grants entitlement on valid JWS with matching bundle + product', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 200,
        body: { signedTransactionInfo: 'jws.fake.token' },
      })),
      verifyJws: async <T,>(_jws: string) => ({
        payload: validPayload() as T,
        verifiedChain: false,
      }),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productId).toBe(PRODUCT_ID);
      expect(result.expiryMs).toBe(FAR_FUTURE);
      expect(result.environment).toBe('production');
      expect(result.originalTransactionId).toBe('otx-original');
    }
  });

  it('falls back to sandbox on 404 + errorCode 4040010', async () => {
    const fetchTransaction = vi
      .fn()
      .mockResolvedValueOnce({
        status: 404,
        body: { errorCode: 4040010, errorMessage: 'Transaction not found in production' },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { signedTransactionInfo: 'jws.fake.token' },
      });
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction,
      verifyJws: async <T,>(_jws: string) => ({
        payload: validPayload() as T,
        verifiedChain: false,
      }),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.environment).toBe('sandbox');
    expect(fetchTransaction).toHaveBeenCalledTimes(2);
    expect(fetchTransaction.mock.calls[0][0]).toContain('api.storekit.itunes.apple.com');
    expect(fetchTransaction.mock.calls[1][0]).toContain('storekit-sandbox');
  });

  it('rejects with transaction_not_found when both prod and sandbox return 404', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 404,
        body: { errorCode: 4040010, errorMessage: 'gone' },
      })),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('transaction_not_found'); }
  });

  it('rejects with bundle_mismatch when JWS payload bundleId differs', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 200,
        body: { signedTransactionInfo: 'jws' },
      })),
      verifyJws: async <T,>(_jws: string) => ({
        payload: validPayload({ bundleId: 'com.attacker.app' }) as T,
        verifiedChain: false,
      }),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('bundle_mismatch'); }
  });

  it('rejects with product_mismatch when JWS productId differs from claimed', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 200,
        body: { signedTransactionInfo: 'jws' },
      })),
      verifyJws: async <T,>(_jws: string) => ({
        payload: validPayload({ productId: 'some_other_sku' }) as T,
        verifiedChain: false,
      }),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('product_mismatch'); }
  });

  it('rejects with expired when expiresDate is in the past', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 200,
        body: { signedTransactionInfo: 'jws' },
      })),
      verifyJws: async <T,>(_jws: string) => ({
        payload: validPayload({ expiresDate: PAST }) as T,
        verifiedChain: false,
      }),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('expired'); }
  });

  it('rejects with revoked when revocationDate is present', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 200,
        body: { signedTransactionInfo: 'jws' },
      })),
      verifyJws: async <T,>(_jws: string) => ({
        payload: validPayload({ revocationDate: Date.now() - 1000 }) as T,
        verifiedChain: false,
      }),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('revoked'); }
  });

  it('maps 401 from Apple to permission_denied', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 401,
        body: { errorMessage: 'JWT expired' },
      })),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('permission_denied'); }
  });

  it('maps 503 to transient_error', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 503,
        body: { errorMessage: 'Service unavailable' },
      })),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('transient_error'); }
  });

  it('rejects with jws_invalid when response is missing signedTransactionInfo', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 200,
        body: { somethingElse: true },
      })),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('jws_invalid'); }
  });

  it('rejects with transaction_not_found when transactionId is empty', async () => {
    __setAppleSeamForTests({ bearerOverride: 'fake-bearer', fetchTransaction: vi.fn() });
    const result = await validateAppleTransaction('', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('transaction_not_found'); }
  });

  it('rejects with jws_invalid when payload lacks originalTransactionId', async () => {
    __setAppleSeamForTests({
      bearerOverride: 'fake-bearer',
      fetchTransaction: vi.fn(async () => ({
        status: 200,
        body: { signedTransactionInfo: 'jws' },
      })),
      verifyJws: async <T,>(_jws: string) => ({
        payload: validPayload({ originalTransactionId: undefined }) as T,
        verifiedChain: false,
      }),
    });
    const result = await validateAppleTransaction('tx-123', PRODUCT_ID);
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('jws_invalid'); }
  });
});
