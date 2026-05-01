// Praeventio Guard — webpayAdapter unit tests.
//
// We mock `transbank-sdk` end-to-end so these tests:
//   • run offline (no real Transbank network),
//   • don't require sandbox credentials,
//   • exercise the response-mapping logic deterministically.
//
// The mock exposes a stub `WebpayPlus.Transaction` class whose
// `create / commit / refund` methods are vitest spies that we override
// per test. `Options`, `Environment`, `IntegrationApiKeys`, and
// `IntegrationCommerceCodes` are kept minimal — just enough surface so
// the adapter's `new Options(...)` calls succeed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();
const commitMock = vi.fn();
const refundMock = vi.fn();

vi.mock('transbank-sdk', () => {
  class TransactionStub {
    constructor(_options: unknown) {
      // no-op; we don't care about options in tests
    }
    create = createMock;
    commit = commitMock;
    refund = refundMock;
  }
  class OptionsStub {
    constructor(
      public commerceCode: string,
      public apiKey: string,
      public environment: string,
    ) {}
  }
  return {
    WebpayPlus: { Transaction: TransactionStub },
    Options: OptionsStub,
    Environment: {
      Integration: 'https://webpay3gint.transbank.cl',
      Production: 'https://webpay3g.transbank.cl',
    },
    IntegrationApiKeys: { WEBPAY: 'TEST_API_KEY' },
    IntegrationCommerceCodes: { WEBPAY_PLUS: '597055555532' },
  };
});

// Import AFTER vi.mock is registered.
import {
  __resetWebpayAdapterStateForTests,
  acquireWebpayIdempotencyLock,
  finalizeWebpayIdempotencyLock,
  WebpayAdapterError,
  webpayAdapter,
  WEBPAY_IDEMPOTENCY_STALE_LOCK_MS,
} from './webpayAdapter.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  createMock.mockReset();
  commitMock.mockReset();
  refundMock.mockReset();
  __resetWebpayAdapterStateForTests();
  // Wipe any env that might leak between tests.
  delete process.env.WEBPAY_COMMERCE_CODE;
  delete process.env.WEBPAY_API_KEY;
  delete process.env.WEBPAY_ENV;
  delete process.env.WEBPAY_ENVIRONMENT;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('webpayAdapter.isConfigured', () => {
  it('returns true when both WEBPAY_COMMERCE_CODE and WEBPAY_API_KEY are set', () => {
    process.env.WEBPAY_COMMERCE_CODE = '597000000001';
    process.env.WEBPAY_API_KEY = 'super-secret';
    expect(webpayAdapter.isConfigured()).toBe(true);
  });

  it('returns false when only one env var is present', () => {
    process.env.WEBPAY_COMMERCE_CODE = '597000000001';
    expect(webpayAdapter.isConfigured()).toBe(false);
  });

  it('returns false when neither env var is set (sandbox-only mode)', () => {
    expect(webpayAdapter.isConfigured()).toBe(false);
  });

  it('returns true after explicit init() with valid config', () => {
    webpayAdapter.init({
      commerceCode: '597000000001',
      apiKey: 'super-secret',
      environment: 'integration',
    });
    expect(webpayAdapter.isConfigured()).toBe(true);
  });
});

describe('webpayAdapter.createTransaction', () => {
  it('returns { token, url } from the mocked SDK create()', async () => {
    createMock.mockResolvedValueOnce({
      token: 'TKN_abc123',
      url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction',
    });

    const result = await webpayAdapter.createTransaction({
      buyOrder: 'inv_test_001',
      sessionId: 'session-uid-1',
      amount: 11990,
      returnUrl: 'https://app.praeventio.net/billing/webpay/return',
    });

    expect(result).toEqual({
      token: 'TKN_abc123',
      url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction',
    });
    expect(createMock).toHaveBeenCalledWith(
      'inv_test_001',
      'session-uid-1',
      11990,
      'https://app.praeventio.net/billing/webpay/return',
    );
  });

  it('wraps SDK errors in WebpayAdapterError (not silent)', async () => {
    createMock.mockRejectedValueOnce(new Error('Transbank network down'));

    await expect(
      webpayAdapter.createTransaction({
        buyOrder: 'inv_x',
        sessionId: 'sess',
        amount: 1000,
        returnUrl: 'https://x',
      }),
    ).rejects.toBeInstanceOf(WebpayAdapterError);
  });
});

describe('webpayAdapter.commitTransaction', () => {
  it('maps response_code: 0, status: AUTHORIZED to AUTHORIZED', async () => {
    commitMock.mockResolvedValueOnce({
      vci: 'TSY',
      amount: 11990,
      status: 'AUTHORIZED',
      buy_order: 'inv_test_001',
      session_id: 'session-uid-1',
      card_detail: { card_number: '6623' },
      accounting_date: '0428',
      transaction_date: '2026-04-28T12:00:00.000Z',
      authorization_code: '1213',
      payment_type_code: 'VN',
      response_code: 0,
      installments_number: 0,
    });

    const result = await webpayAdapter.commitTransaction('TKN_abc123');

    expect(result.status).toBe('AUTHORIZED');
    expect(result.buyOrder).toBe('inv_test_001');
    expect(result.amount).toBe(11990);
    expect(result.authorizationCode).toBe('1213');
    expect(result.cardLast4).toBe('6623');
  });

  it('maps response_code: -1, status: FAILED to REJECTED', async () => {
    commitMock.mockResolvedValueOnce({
      vci: 'TSN',
      amount: 11990,
      status: 'FAILED',
      buy_order: 'inv_test_002',
      response_code: -1,
    });

    const result = await webpayAdapter.commitTransaction('TKN_xyz789');

    expect(result.status).toBe('REJECTED');
    expect(result.buyOrder).toBe('inv_test_002');
    expect(result.amount).toBe(11990);
    expect(result.authorizationCode).toBeUndefined();
  });

  it('maps response_code: 0 with non-AUTHORIZED status to FAILED (malformed defensive)', async () => {
    // response_code 0 but status != AUTHORIZED is a Transbank shape we never
    // expect in practice; treat it as malformed (FAILED) so the user can retry,
    // not as a hard card decline.
    commitMock.mockResolvedValueOnce({
      amount: 11990,
      status: 'PENDING',
      buy_order: 'inv_test_003',
      response_code: 0,
    });
    const result = await webpayAdapter.commitTransaction('TKN_pending');
    expect(result.status).toBe('FAILED');
  });

  it('maps response_code: -3 (card-side decline) to REJECTED', async () => {
    commitMock.mockResolvedValueOnce({
      amount: 11990,
      status: 'FAILED',
      buy_order: 'inv_test_decline_3',
      response_code: -3,
    });
    const result = await webpayAdapter.commitTransaction('TKN_decline_3');
    expect(result.status).toBe('REJECTED');
  });

  it('maps response_code: -96 (timeout) to FAILED so the user can retry', async () => {
    commitMock.mockResolvedValueOnce({
      amount: 11990,
      status: 'FAILED',
      buy_order: 'inv_test_timeout_96',
      response_code: -96,
    });
    const result = await webpayAdapter.commitTransaction('TKN_timeout_96');
    expect(result.status).toBe('FAILED');
  });

  it('maps response_code: -97 (network) to FAILED so the user can retry', async () => {
    commitMock.mockResolvedValueOnce({
      amount: 11990,
      status: 'FAILED',
      buy_order: 'inv_test_timeout_97',
      response_code: -97,
    });
    const result = await webpayAdapter.commitTransaction('TKN_timeout_97');
    expect(result.status).toBe('FAILED');
  });

  it('maps response_code: -98 (unavailable) to FAILED so the user can retry', async () => {
    commitMock.mockResolvedValueOnce({
      amount: 11990,
      status: 'FAILED',
      buy_order: 'inv_test_timeout_98',
      response_code: -98,
    });
    const result = await webpayAdapter.commitTransaction('TKN_timeout_98');
    expect(result.status).toBe('FAILED');
  });

  it('maps a malformed response (no response_code) to FAILED defensively', async () => {
    commitMock.mockResolvedValueOnce({
      // No response_code, no status — Transbank misbehaving / proxy mangled.
      buy_order: 'inv_test_malformed',
      amount: 11990,
    });
    const result = await webpayAdapter.commitTransaction('TKN_malformed');
    expect(result.status).toBe('FAILED');
  });

  it('wraps SDK commit errors in WebpayAdapterError', async () => {
    commitMock.mockRejectedValueOnce(new Error('500 Internal Server Error'));
    await expect(
      webpayAdapter.commitTransaction('TKN_broken'),
    ).rejects.toBeInstanceOf(WebpayAdapterError);
  });
});

describe('webpayAdapter.refundTransaction', () => {
  it('returns { type, balance } correctly for a NULLIFIED partial refund', async () => {
    refundMock.mockResolvedValueOnce({
      type: 'NULLIFIED',
      authorization_code: '1213',
      authorization_date: '2026-04-28T12:05:00.000Z',
      nullified_amount: 5000,
      balance: 6990,
      response_code: 0,
    });

    const result = await webpayAdapter.refundTransaction('TKN_abc123', 5000);

    expect(result.type).toBe('NULLIFIED');
    expect(result.balance).toBe(6990);
    expect(result.authorizationCode).toBe('1213');
    expect(result.authorizedAmount).toBe(5000);
    expect(refundMock).toHaveBeenCalledWith('TKN_abc123', 5000);
  });

  it('returns type REVERSED for a same-day full reversal', async () => {
    refundMock.mockResolvedValueOnce({
      type: 'REVERSED',
      balance: 0,
    });
    const result = await webpayAdapter.refundTransaction('TKN_abc123', 11990);
    expect(result.type).toBe('REVERSED');
    expect(result.balance).toBe(0);
  });

  it('wraps SDK refund errors in WebpayAdapterError', async () => {
    refundMock.mockRejectedValueOnce(new Error('refund window expired'));
    await expect(
      webpayAdapter.refundTransaction('TKN_old', 1000),
    ).rejects.toBeInstanceOf(WebpayAdapterError);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Idempotency helpers — `processed_webpay/{token_ws}` lock-then-complete.
//
// These tests treat the helper as pure: we pass in a fake Firestore
// document ref (just the methods the helper actually uses) and inspect
// the writes. No real Firestore. The same helper is called by
// `/billing/webpay/return` in server.ts.
// ───────────────────────────────────────────────────────────────────────

interface FakeDocSnap {
  exists: boolean;
  data(): Record<string, any> | undefined;
}

interface FakeDocRef {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function makeFakeRef(initial: Record<string, any> | null): FakeDocRef {
  let stored: Record<string, any> | null = initial ? { ...initial } : null;
  return {
    get: vi.fn(async () => ({
      exists: stored !== null,
      data: () => (stored === null ? undefined : { ...stored }),
    } as FakeDocSnap)),
    set: vi.fn(async (data: Record<string, any>, opts?: { merge?: boolean }) => {
      stored = opts?.merge && stored ? { ...stored, ...data } : { ...data };
    }),
    update: vi.fn(async (data: Record<string, any>) => {
      stored = stored ? { ...stored, ...data } : { ...data };
    }),
  };
}

describe('acquireWebpayIdempotencyLock', () => {
  it('writes status=in_progress when no doc exists (fresh token)', async () => {
    const ref = makeFakeRef(null);
    const result = await acquireWebpayIdempotencyLock(ref as any, () => Date.now());
    expect(result.acquired).toBe(true);
    expect(result.outcome).toBeUndefined();
    expect(ref.set).toHaveBeenCalledTimes(1);
    const [data, opts] = ref.set.mock.calls[0];
    expect(data.status).toBe('in_progress');
    expect(opts).toEqual({ merge: true });
  });

  it('returns acquired=false + outcome when doc is status=done (duplicate redelivery)', async () => {
    const ref = makeFakeRef({
      status: 'done',
      outcome: 'paid',
      invoiceId: 'inv_abc',
    });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => Date.now());
    expect(result.acquired).toBe(false);
    expect(result.alreadyDone).toBe(true);
    expect(result.outcome).toBe('paid');
    expect(result.invoiceId).toBe('inv_abc');
    expect(ref.set).not.toHaveBeenCalled();
  });

  it('returns acquired=false when another worker holds a fresh in_progress lock', async () => {
    const lockedAtMs = Date.now() - 30 * 1000; // 30s ago — well within 5 min.
    const ref = makeFakeRef({
      status: 'in_progress',
      lockedAtMs,
    });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => Date.now());
    expect(result.acquired).toBe(false);
    expect(result.alreadyDone).toBeFalsy();
    expect(result.inFlight).toBe(true);
    expect(ref.set).not.toHaveBeenCalled();
  });

  it('steals a stale in_progress lock (older than the staleness window)', async () => {
    const lockedAtMs = Date.now() - (WEBPAY_IDEMPOTENCY_STALE_LOCK_MS + 1000);
    const ref = makeFakeRef({ status: 'in_progress', lockedAtMs });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => Date.now());
    expect(result.acquired).toBe(true);
    expect(ref.set).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeWebpayIdempotencyLock', () => {
  it('writes status=done with outcome + invoiceId on success', async () => {
    const ref = makeFakeRef({ status: 'in_progress', lockedAtMs: Date.now() });
    await finalizeWebpayIdempotencyLock(ref as any, {
      outcome: 'paid',
      invoiceId: 'inv_finalize_1',
    });
    expect(ref.update).toHaveBeenCalledTimes(1);
    const [payload] = ref.update.mock.calls[0];
    expect(payload.status).toBe('done');
    expect(payload.outcome).toBe('paid');
    expect(payload.invoiceId).toBe('inv_finalize_1');
  });

  it('does NOT throw when finalize update fails (best-effort)', async () => {
    const ref = makeFakeRef({ status: 'in_progress', lockedAtMs: Date.now() });
    ref.update.mockRejectedValueOnce(new Error('firestore unavailable'));
    await expect(
      finalizeWebpayIdempotencyLock(ref as any, {
        outcome: 'paid',
        invoiceId: 'inv_finalize_2',
      }),
    ).resolves.toBeUndefined();
  });
});
