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

// Mock `withSentryScope` so tests can assert the (module, context, fn)
// arguments the adapter passes to it. Without this, mutants on the
// context object literals (action / buyOrder / amount / tokenLength)
// survive — they have no observable effect inside the no-op fallback
// path the real Sentry takes in unit tests.
const withSentryScopeMock = vi.fn();
vi.mock('../observability/sentryInstrumentation', () => ({
  withSentryScope: (mod: string, ctx: unknown, fn: () => Promise<unknown>) => {
    withSentryScopeMock(mod, ctx);
    return fn();
  },
}));

// Captured Options instances per Transaction construction. Tests inspect
// `lastTxOptions()` to assert which environment / credentials the adapter
// actually selected — without this, the env-routing tests pass trivially
// because the stubbed Transaction discards its constructor argument and
// the Stryker mutants on the production-routing ternary survive.
let lastTxOptionsCaptured:
  | { commerceCode: string; apiKey: string; environment: string }
  | null = null;
function lastTxOptions() {
  return lastTxOptionsCaptured;
}

vi.mock('transbank-sdk', () => {
  class OptionsStub {
    constructor(
      public commerceCode: string,
      public apiKey: string,
      public environment: string,
    ) {}
  }
  class TransactionStub {
    constructor(options: unknown) {
      // Capture the Options that the adapter constructed via
      // resolveOptions() so tests can assert env-routing decisions.
      if (options instanceof OptionsStub) {
        lastTxOptionsCaptured = {
          commerceCode: options.commerceCode,
          apiKey: options.apiKey,
          environment: options.environment,
        };
      }
    }
    create = createMock;
    commit = commitMock;
    refund = refundMock;
  }
  // Mirror the real CJS shape of `transbank-sdk`: the adapter does
  // `import transbankSdk from 'transbank-sdk'` and destructures, so a
  // `default` is required. Spread the same object as named exports so
  // any `import { X } from 'transbank-sdk'` consumer keeps working.
  const sdk = {
    WebpayPlus: { Transaction: TransactionStub },
    Options: OptionsStub,
    Environment: {
      Integration: 'https://webpay3gint.transbank.cl',
      Production: 'https://webpay3g.transbank.cl',
    },
    IntegrationApiKeys: { WEBPAY: 'TEST_API_KEY' },
    IntegrationCommerceCodes: { WEBPAY_PLUS: '597055555532' },
  };
  return { default: sdk, ...sdk };
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
  withSentryScopeMock.mockClear();
  lastTxOptionsCaptured = null;
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

  // ─────────────────────────────────────────────────────────────────────
  // Sprint 20 18th-wave Bucket B — PCI / card_number masking guard.
  //
  // Stryker Run #3 surfaced `webpayAdapter.ts:220:11` (MethodExpression on
  // `card_number.slice(-4)`) as a surviving mutant. If the slice is mutated
  // away we leak the full PAN into the audit log, Sentry, and analytics.
  // These tests pin the post-condition: cardLast4 is ALWAYS exactly 4
  // characters and ALWAYS the trailing 4 digits — never the first 12.
  // ─────────────────────────────────────────────────────────────────────
  describe('cardLast4 PCI masking', () => {
    it('masks a 16-digit PAN to exactly the last 4 digits (not the full PAN)', async () => {
      // Test card from PCI test vectors. We assert THREE things to kill the
      // slice mutation (`slice(-4)` → `slice(0)`, `slice(0, -4)`, `slice()`):
      //   1. length is exactly 4 (kills `slice(0)`).
      //   2. value equals the trailing 4 (kills `slice(0, -4)` which would
      //      give the FIRST 12 digits — a PCI breach).
      //   3. value does NOT contain the BIN/leading digits (kills any
      //      mutation that lets the full PAN through).
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_pci_16',
        response_code: 0,
        card_detail: { card_number: '4111111111111111' },
      });

      const result = await webpayAdapter.commitTransaction('TKN_pci_16');

      expect(result.cardLast4).toBe('1111');
      expect(result.cardLast4).toHaveLength(4);
      // The full PAN must NOT appear anywhere in the cardLast4 field.
      expect(result.cardLast4).not.toBe('4111111111111111');
      // The BIN (first 6 = 411111) must NOT leak — explicit PCI guard.
      expect(result.cardLast4).not.toContain('411111');
    });

    it('masks a 13-digit Amex-style PAN to exactly 4 digits', async () => {
      // 13-digit cards (legacy Amex / some Visa) are still in the wild.
      // The slice(-4) contract must hold regardless of input length.
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_pci_13',
        response_code: 0,
        card_detail: { card_number: '3782822463100' },
      });

      const result = await webpayAdapter.commitTransaction('TKN_pci_13');

      expect(result.cardLast4).toBe('3100');
      expect(result.cardLast4).toHaveLength(4);
      // Issuer prefix (37 = Amex) must NOT leak.
      expect(result.cardLast4!.startsWith('37')).toBe(false);
    });

    it('returns undefined cardLast4 when card_detail.card_number is missing', async () => {
      // Defensive: Transbank may omit card_detail on FAILED/REJECTED paths,
      // or proxies may strip it. We must NOT throw, and the field must be
      // explicitly undefined (not the literal string 'undefined').
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_pci_missing',
        response_code: 0,
        // card_detail intentionally absent
      });

      const result = await webpayAdapter.commitTransaction('TKN_pci_missing');

      expect(result.cardLast4).toBeUndefined();
    });

    it('returns undefined cardLast4 when card_number is null (not the string "null")', async () => {
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_pci_null',
        response_code: 0,
        card_detail: { card_number: null },
      });

      const result = await webpayAdapter.commitTransaction('TKN_pci_null');

      expect(result.cardLast4).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // AUTHORIZED gate matrix — kills `:197:7` ConditionalExpression mutant.
  //
  // The gate is `responseCode === 0 && responseStatus === 'AUTHORIZED'`.
  // A mutation that drops either operand (or short-circuits the &&) would
  // mark a non-authorized transaction as paid — catastrophic.
  //
  // We exhaustively cover the 4 quadrants of (code∈{0, ≠0}) × (status∈
  // {AUTHORIZED, ≠AUTHORIZED}) plus a non-AUTHORIZED status enumeration
  // so the test fails on EITHER operand being dropped.
  // ─────────────────────────────────────────────────────────────────────
  describe('AUTHORIZED gate (response_code × status quadrants)', () => {
    it('Q1: code=0 + status=AUTHORIZED → AUTHORIZED (only this combo)', async () => {
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_q1',
        response_code: 0,
      });
      const result = await webpayAdapter.commitTransaction('TKN_q1');
      expect(result.status).toBe('AUTHORIZED');
    });

    it('Q2a: code=0 + status=FAILED → NOT AUTHORIZED (status guard works)', async () => {
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'FAILED',
        buy_order: 'inv_q2a',
        response_code: 0,
      });
      const result = await webpayAdapter.commitTransaction('TKN_q2a');
      expect(result.status).not.toBe('AUTHORIZED');
    });

    it('Q2b: code=0 + status=REVERSED → NOT AUTHORIZED', async () => {
      // Defensive: a reversed-then-redelivered token must not flip back to
      // AUTHORIZED if a mutation drops the status guard.
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'REVERSED',
        buy_order: 'inv_q2b',
        response_code: 0,
      });
      const result = await webpayAdapter.commitTransaction('TKN_q2b');
      expect(result.status).not.toBe('AUTHORIZED');
    });

    it('Q2c: code=0 + status=NULLIFIED → NOT AUTHORIZED', async () => {
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'NULLIFIED',
        buy_order: 'inv_q2c',
        response_code: 0,
      });
      const result = await webpayAdapter.commitTransaction('TKN_q2c');
      expect(result.status).not.toBe('AUTHORIZED');
    });

    it('Q3: code=-1 + status=AUTHORIZED → NOT AUTHORIZED (code guard works)', async () => {
      // Conflicting fields: status says AUTHORIZED but code says decline.
      // The && gate must kick out — never trust just one field.
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_q3',
        response_code: -1,
      });
      const result = await webpayAdapter.commitTransaction('TKN_q3');
      expect(result.status).not.toBe('AUTHORIZED');
      expect(result.status).toBe('REJECTED');
    });

    it('Q3b: code=-7 + status=AUTHORIZED → NOT AUTHORIZED', async () => {
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_q3b',
        response_code: -7,
      });
      const result = await webpayAdapter.commitTransaction('TKN_q3b');
      expect(result.status).toBe('REJECTED');
    });

    it('Q4: code=-3 + status=FAILED → REJECTED (matrix bottom-right)', async () => {
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'FAILED',
        buy_order: 'inv_q4',
        response_code: -3,
      });
      const result = await webpayAdapter.commitTransaction('TKN_q4');
      expect(result.status).toBe('REJECTED');
    });

    it('positive non-zero code (1) → FAILED (defensive — kills code===0 → code>=0 mutation)', async () => {
      // If `:197:7` were mutated from `=== 0` to `>= 0`, this test would
      // wrongly map to AUTHORIZED. Pin the exact-zero contract.
      commitMock.mockResolvedValueOnce({
        amount: 11990,
        status: 'AUTHORIZED',
        buy_order: 'inv_pos',
        response_code: 1,
      });
      const result = await webpayAdapter.commitTransaction('TKN_pos');
      expect(result.status).not.toBe('AUTHORIZED');
      expect(result.status).toBe('FAILED');
    });
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

  // ─────────────────────────────────────────────────────────────────────
  // Sprint 20 18th-wave Bucket B — refund-mapping defensive tests.
  // Kill string-equality + toUpperCase mutants in `mapRefundResponse`.
  // ─────────────────────────────────────────────────────────────────────
  it('normalizes lowercase type "reversed" to REVERSED (toUpperCase)', async () => {
    // If the `.toUpperCase()` call were mutated away, lowercase input from
    // a Transbank proxy would fall through to the NULLIFIED branch and
    // mis-classify a reversal as a void.
    refundMock.mockResolvedValueOnce({
      type: 'reversed',
      balance: 0,
    });
    const result = await webpayAdapter.refundTransaction('TKN_lower', 11990);
    expect(result.type).toBe('REVERSED');
  });

  it('falls back to NULLIFIED for unknown type strings (defensive)', async () => {
    // Anything that's not literally REVERSED falls to NULLIFIED — preserves
    // the conservative classification so we never report a partial refund
    // as a same-day reversal (which has different accounting treatment).
    refundMock.mockResolvedValueOnce({
      type: 'PARTIAL_VOID',
      nullified_amount: 5000,
      balance: 6990,
    });
    const result = await webpayAdapter.refundTransaction('TKN_other', 5000);
    expect(result.type).toBe('NULLIFIED');
  });

  it('falls back to requestedAmount when nullified_amount is missing', async () => {
    // Pin the `typeof response?.nullified_amount === 'number'` guard. A
    // mutation that drops the typeof check would let `undefined` flow
    // through as the authorizedAmount and break downstream accounting.
    refundMock.mockResolvedValueOnce({
      type: 'NULLIFIED',
      // nullified_amount intentionally absent
      balance: 0,
    });
    const result = await webpayAdapter.refundTransaction('TKN_missing_amt', 7500);
    expect(result.authorizedAmount).toBe(7500);
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

  // ─────────────────────────────────────────────────────────────────────
  // Sprint 20 18th-wave Bucket B — staleness-window boundary tests.
  //
  // Kills mutants on the `now() - lockedAtMs < WEBPAY_IDEMPOTENCY_STALE_LOCK_MS`
  // comparison and on the `5 * 60 * 1000` constant. Without these, a
  // mutation `<` → `<=` would let a still-fresh lock be stolen, and a
  // mutation `<` → `>` would deadlock all real redeliveries.
  // ─────────────────────────────────────────────────────────────────────
  it('staleness window constant is exactly 5 minutes (300000 ms)', () => {
    // Pin the magic number — kills `5 * 60 * 1000` arithmetic mutants
    // (e.g. `5 * 60 * 100` would shrink the window to 30s and let active
    // workers be evicted; `5 * 60 * 10000` would block all retries for 50min).
    expect(WEBPAY_IDEMPOTENCY_STALE_LOCK_MS).toBe(5 * 60 * 1000);
    expect(WEBPAY_IDEMPOTENCY_STALE_LOCK_MS).toBe(300000);
  });

  it('lock at exactly the staleness boundary (delta === STALE_LOCK_MS) is still in-flight', async () => {
    // The check is `now() - lockedAtMs < STALE_LOCK_MS`. At delta ===
    // STALE_LOCK_MS the comparison must be FALSE — i.e. the lock is
    // stealable, not in-flight. We pin the strict-less-than semantics by
    // injecting a deterministic clock.
    const lockedAtMs = 1_000_000;
    const now = lockedAtMs + WEBPAY_IDEMPOTENCY_STALE_LOCK_MS;
    const ref = makeFakeRef({ status: 'in_progress', lockedAtMs });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => now);
    // delta === window → strict `<` is false → fall through to steal-the-lock.
    expect(result.acquired).toBe(true);
    expect(result.inFlight).toBeFalsy();
  });

  it('lock 1ms before the boundary is in-flight (acquired=false)', async () => {
    // delta === STALE_LOCK_MS - 1 → strict `<` is true → still in-flight.
    const lockedAtMs = 1_000_000;
    const now = lockedAtMs + WEBPAY_IDEMPOTENCY_STALE_LOCK_MS - 1;
    const ref = makeFakeRef({ status: 'in_progress', lockedAtMs });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => now);
    expect(result.acquired).toBe(false);
    expect(result.inFlight).toBe(true);
  });

  it('lock with lockedAtMs = 0 (missing/legacy) falls through to steal', async () => {
    // Defensive: legacy docs that didn't write lockedAtMs should be
    // immediately stealable, not deadlock the redelivery flow.
    const ref = makeFakeRef({ status: 'in_progress' /* no lockedAtMs */ });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => Date.now());
    expect(result.acquired).toBe(true);
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

  // ─────────────────────────────────────────────────────────────────────
  // 2026-05-18 Stryker baseline lift: kill survivors detected on Run #5.
  //
  // The previous score (60.55%) reflected unverified branches for:
  //   - serverTimestamp factory path (use it vs default new Date())
  //   - completedAt presence in the update payload
  // ─────────────────────────────────────────────────────────────────────
  it('uses serverTimestamp factory when provided (preserves Admin SDK FieldValue)', async () => {
    // The Admin SDK `FieldValue.serverTimestamp()` returns a sentinel that
    // Firestore replaces server-side. If a mutation drops the factory call
    // and falls back to `new Date()`, the doc would carry the client clock
    // (subject to skew) instead of the canonical server time. Pin both:
    //   1. the factory IS invoked (kills mutation that ignores it)
    //   2. its return value appears verbatim in the update payload
    const ref = makeFakeRef({ status: 'in_progress', lockedAtMs: Date.now() });
    const sentinel = { __serverTimestamp: true };
    const factory = vi.fn(() => sentinel);
    await finalizeWebpayIdempotencyLock(ref as any, {
      outcome: 'paid',
      invoiceId: 'inv_finalize_st',
      serverTimestamp: factory,
    });
    expect(factory).toHaveBeenCalledTimes(1);
    const [payload] = ref.update.mock.calls[0];
    expect(payload.completedAt).toBe(sentinel);
  });

  it('falls back to new Date() when serverTimestamp factory is not provided', async () => {
    // Pin the `args.serverTimestamp ? ... : new Date()` ternary. A mutation
    // that always-picks-one-branch would either skip the factory invocation
    // (when supplied) or never produce a Date (when not). The other test
    // covers the truthy branch; this one pins the falsy branch.
    const ref = makeFakeRef({ status: 'in_progress', lockedAtMs: Date.now() });
    await finalizeWebpayIdempotencyLock(ref as any, {
      outcome: 'rejected',
      invoiceId: 'inv_finalize_date',
      // serverTimestamp intentionally omitted
    });
    const [payload] = ref.update.mock.calls[0];
    expect(payload.completedAt).toBeInstanceOf(Date);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2026-05-18 Stryker baseline lift — mapCommitResponse defensive paths.
//
// Targets surviving mutants on the response coercion fallbacks. Each test
// pins a specific operand of a ternary so a mutation collapsing the branch
// would flip the contract.
// ───────────────────────────────────────────────────────────────────────
describe('mapCommitResponse defensive coercion (Sprint 41 ratchet)', () => {
  it('amount falls to 0 when SDK response omits the field (zero-default)', async () => {
    // Pin `typeof response?.amount === 'number' ? response.amount : 0`. A
    // mutation that replaces the typeof guard with `true` would let
    // `undefined` flow through as amount and break downstream invoice math.
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      buy_order: 'inv_no_amount',
      response_code: 0,
      // amount intentionally absent
    });
    const result = await webpayAdapter.commitTransaction('TKN_no_amount');
    expect(result.amount).toBe(0);
  });

  it('amount falls to 0 when response sends a non-numeric amount (string)', async () => {
    // Some Transbank proxies serialize numbers as strings ("11990"). The
    // typeof guard must NOT accept the string — otherwise downstream
    // arithmetic on `result.amount` produces NaN propagation.
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      buy_order: 'inv_str_amount',
      response_code: 0,
      amount: '11990' as unknown as number,
    });
    const result = await webpayAdapter.commitTransaction('TKN_str_amount');
    expect(result.amount).toBe(0);
    expect(typeof result.amount).toBe('number');
  });

  it('buyOrder falls to empty string when buy_order is missing (never undefined)', async () => {
    // Pin `response?.buy_order ?? ''`. A mutation that drops the
    // nullish-coalescing operand would let `undefined` flow through and
    // break the audit log key generation downstream.
    commitMock.mockResolvedValueOnce({
      status: 'FAILED',
      response_code: -1,
      // buy_order intentionally absent
    });
    const result = await webpayAdapter.commitTransaction('TKN_no_buy_order');
    expect(result.buyOrder).toBe('');
    expect(typeof result.buyOrder).toBe('string');
  });

  it('authorizationCode is undefined when authorization_code is missing', async () => {
    // Pin `response?.authorization_code ?? undefined`. The undefined branch
    // is the legal contract — never the literal string 'undefined'.
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      buy_order: 'inv_no_auth',
      amount: 11990,
      response_code: 0,
      // authorization_code intentionally absent
    });
    const result = await webpayAdapter.commitTransaction('TKN_no_auth');
    expect(result.authorizationCode).toBeUndefined();
  });

  it('cardLast4 is undefined when card_number is not a string (number type)', async () => {
    // Defensive: card_number could theoretically arrive as a number from a
    // misbehaving proxy. The `typeof === 'string'` guard must reject it.
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      buy_order: 'inv_num_card',
      amount: 11990,
      response_code: 0,
      card_detail: { card_number: 4111111111111111 as unknown as string },
    });
    const result = await webpayAdapter.commitTransaction('TKN_num_card');
    expect(result.cardLast4).toBeUndefined();
  });

  it('raw payload is preserved verbatim on the result for audit', async () => {
    // Pin `raw: response`. A mutation that drops the assignment would lose
    // the audit-log payload entirely. We compare the reference identity by
    // checking a sentinel key the SDK would never invent on its own.
    const sentinel = '__test_marker_xyz__';
    const responseBody = {
      status: 'AUTHORIZED',
      buy_order: 'inv_raw',
      amount: 11990,
      response_code: 0,
      __test_marker__: sentinel,
    };
    commitMock.mockResolvedValueOnce(responseBody);
    const result = await webpayAdapter.commitTransaction('TKN_raw');
    expect((result.raw as { __test_marker__: string }).__test_marker__).toBe(
      sentinel,
    );
  });

  it('response_code: -7 (final card-side decline boundary) → REJECTED', async () => {
    // -7 is the last card-side decline in the Transbank table. Pin the
    // `responseCode < 0` boundary — a mutation `<` → `<=` would still pass
    // for -1, but a `<` → `===` would silently break this case.
    commitMock.mockResolvedValueOnce({
      status: 'FAILED',
      buy_order: 'inv_neg_seven',
      amount: 11990,
      response_code: -7,
    });
    const result = await webpayAdapter.commitTransaction('TKN_neg_seven');
    expect(result.status).toBe('REJECTED');
  });

  it('response_code: -50 (outside known table) → REJECTED (any negative is card-side)', async () => {
    // Catch any `< 0` mutation that would treat unknown negative codes as
    // AUTHORIZED or FAILED. Anything negative-and-non-transient maps to
    // REJECTED per the conservative contract.
    commitMock.mockResolvedValueOnce({
      status: 'FAILED',
      buy_order: 'inv_neg_fifty',
      amount: 11990,
      response_code: -50,
    });
    const result = await webpayAdapter.commitTransaction('TKN_neg_fifty');
    expect(result.status).toBe('REJECTED');
  });

  it('response_code as a string ("0") is treated as malformed → FAILED', async () => {
    // Pin `typeof responseCode === 'number'`. A proxy that JSONifies
    // response_code as a string MUST NOT collapse to AUTHORIZED — the
    // typeof guard catches it and we fall back to FAILED (retry path).
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      buy_order: 'inv_str_code',
      amount: 11990,
      response_code: '0' as unknown as number,
    });
    const result = await webpayAdapter.commitTransaction('TKN_str_code');
    expect(result.status).toBe('FAILED');
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2026-05-18 Stryker baseline lift — refund-mapping defensive paths.
// ───────────────────────────────────────────────────────────────────────
describe('mapRefundResponse defensive coercion (Sprint 41 ratchet)', () => {
  it('balance is undefined when SDK omits the field (never 0 by default)', async () => {
    // Pin `typeof response?.balance === 'number' ? response.balance : undefined`.
    // A mutation collapsing the ternary would either return 0 (wrong — looks
    // like a fully drained card) or `undefined`-as-number (NaN propagation).
    refundMock.mockResolvedValueOnce({
      type: 'NULLIFIED',
      nullified_amount: 5000,
      // balance intentionally absent
    });
    const result = await webpayAdapter.refundTransaction('TKN_no_bal', 5000);
    expect(result.balance).toBeUndefined();
  });

  it('balance is undefined when value is non-numeric (typeof guard)', async () => {
    refundMock.mockResolvedValueOnce({
      type: 'NULLIFIED',
      nullified_amount: 5000,
      balance: 'unknown' as unknown as number,
    });
    const result = await webpayAdapter.refundTransaction('TKN_str_bal', 5000);
    expect(result.balance).toBeUndefined();
  });

  it('authorizationCode is undefined when absent on refund response', async () => {
    refundMock.mockResolvedValueOnce({
      type: 'NULLIFIED',
      nullified_amount: 5000,
      balance: 6990,
      // authorization_code intentionally absent
    });
    const result = await webpayAdapter.refundTransaction('TKN_no_authcode', 5000);
    expect(result.authorizationCode).toBeUndefined();
  });

  it('raw payload preserved verbatim on the refund result for audit', async () => {
    const sentinel = '__refund_marker_42__';
    const responseBody = {
      type: 'NULLIFIED',
      nullified_amount: 5000,
      balance: 6990,
      __test_marker__: sentinel,
    };
    refundMock.mockResolvedValueOnce(responseBody);
    const result = await webpayAdapter.refundTransaction('TKN_refund_raw', 5000);
    expect((result.raw as { __test_marker__: string }).__test_marker__).toBe(
      sentinel,
    );
  });

  it('handles entirely empty refund response (defensive)', async () => {
    // Pin `(response?.type ?? '').toString().toUpperCase()` for the case
    // where response is `{}` — the optional-chaining + nullish operand
    // must collapse to '' so toUpperCase succeeds (no throw).
    refundMock.mockResolvedValueOnce({});
    const result = await webpayAdapter.refundTransaction('TKN_empty', 3000);
    expect(result.type).toBe('NULLIFIED'); // default
    expect(result.authorizedAmount).toBe(3000); // requestedAmount fallback
    expect(result.balance).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2026-05-18 Stryker baseline lift — idempotency lock defensive paths.
// ───────────────────────────────────────────────────────────────────────
describe('acquireWebpayIdempotencyLock defensive paths (Sprint 41 ratchet)', () => {
  it('writes a 7-day expiresAt for Firestore TTL hint', async () => {
    // Pin `new Date(lockedAtMs + 7 * 24 * 60 * 60 * 1000)`. A mutation on
    // any of the multiplicands (7→6, 24→23, 60→59) would change the TTL
    // window and either leak completed locks (too short) or block
    // re-emission (too long). Use a fixed clock for byte-level pinning.
    const fixedNow = 1_700_000_000_000;
    const ref = makeFakeRef(null);
    const result = await acquireWebpayIdempotencyLock(
      ref as any,
      () => fixedNow,
    );
    expect(result.acquired).toBe(true);
    const [data] = ref.set.mock.calls[0];
    expect(data.expiresAt).toBeInstanceOf(Date);
    const expectedMs = fixedNow + 7 * 24 * 60 * 60 * 1000;
    expect((data.expiresAt as Date).getTime()).toBe(expectedMs);
  });

  it('writes both lockedAtMs and receivedAtMs to the same value (audit pair)', async () => {
    // The doc carries `lockedAtMs` (for staleness math) and `receivedAtMs`
    // (for human-readable audit). They must match on initial acquisition;
    // a mutation that drops `receivedAtMs` would break the audit trail.
    const fixedNow = 1_750_000_000_000;
    const ref = makeFakeRef(null);
    await acquireWebpayIdempotencyLock(ref as any, () => fixedNow);
    const [data] = ref.set.mock.calls[0];
    expect(data.lockedAtMs).toBe(fixedNow);
    expect(data.receivedAtMs).toBe(fixedNow);
  });

  it('alreadyDone payload omits invoiceId when stored value is not a string', async () => {
    // Pin `typeof data.invoiceId === 'string' ? data.invoiceId : undefined`.
    // A mutation that drops the typeof check would return the wrong type
    // (number/null) and downstream consumers would break casting to string.
    const ref = makeFakeRef({
      status: 'done',
      outcome: 'paid',
      invoiceId: 42 as unknown as string,
    });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => Date.now());
    expect(result.alreadyDone).toBe(true);
    expect(result.invoiceId).toBeUndefined();
  });

  it('returns done with valid string invoiceId echoed through', async () => {
    // Companion to the above: the truthy branch of the typeof guard.
    const ref = makeFakeRef({
      status: 'done',
      outcome: 'rejected',
      invoiceId: 'inv_already_done_99',
    });
    const result = await acquireWebpayIdempotencyLock(ref as any, () => Date.now());
    expect(result.invoiceId).toBe('inv_already_done_99');
    expect(result.outcome).toBe('rejected');
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2026-05-18 Stryker baseline lift — env / init configuration paths.
// ───────────────────────────────────────────────────────────────────────
describe('webpayAdapter env + init configuration (Sprint 41 ratchet)', () => {
  it('uses WEBPAY_ENVIRONMENT as alternate name for WEBPAY_ENV', async () => {
    // The adapter accepts EITHER env var name. A mutation removing the
    // OR-clause would break deployments using the alternate name (which
    // matches the convention used by other modules in the repo).
    process.env.WEBPAY_COMMERCE_CODE = '597000000999';
    process.env.WEBPAY_API_KEY = 'alt-env-secret';
    process.env.WEBPAY_ENVIRONMENT = 'production';
    expect(webpayAdapter.isConfigured()).toBe(true);
    createMock.mockResolvedValueOnce({ token: 'TKN_prod', url: 'https://prod' });
    await expect(
      webpayAdapter.createTransaction({
        buyOrder: 'inv_alt_env',
        sessionId: 'sess',
        amount: 1000,
        returnUrl: 'https://x',
      }),
    ).resolves.toEqual({ token: 'TKN_prod', url: 'https://prod' });
    // Codex P2 PR #359: assert the SDK Options actually carried the
    // production URL. Without this the env-routing mutant survives
    // because TransactionStub discards its constructor argument.
    expect(lastTxOptions()).toEqual({
      commerceCode: '597000000999',
      apiKey: 'alt-env-secret',
      environment: 'https://webpay3g.transbank.cl', // Environment.Production
    });
  });

  it('production environment via init() switches the SDK env URL', async () => {
    // Pin `config.environment === 'production' ? Environment.Production : ...`.
    // A mutation flipping the ternary would route prod credentials to the
    // sandbox URL — silently leaking real charges into the integration env.
    webpayAdapter.init({
      commerceCode: 'real-commerce',
      apiKey: 'real-api',
      environment: 'production',
    });
    expect(webpayAdapter.isConfigured()).toBe(true);
    // Codex P2: trigger resolveOptions() and verify the Options instance
    // the adapter built carries the production URL. isConfigured() alone
    // doesn't prove anything about routing — TransactionStub had to be
    // upgraded to capture the constructor argument for this assertion.
    createMock.mockResolvedValueOnce({ token: 'T_init_prod', url: 'u' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv_init_prod',
      sessionId: 'sess',
      amount: 1,
      returnUrl: 'https://x',
    });
    expect(lastTxOptions()).toEqual({
      commerceCode: 'real-commerce',
      apiKey: 'real-api',
      environment: 'https://webpay3g.transbank.cl', // Environment.Production
    });
  });

  it('integration environment via init() routes to Integration URL', async () => {
    // Pin the OTHER branch of the ternary. Without this, a mutation that
    // hardcoded Environment.Production would still pass the prod-routing
    // test but break sandbox setups.
    webpayAdapter.init({
      commerceCode: 'sandbox-c',
      apiKey: 'sandbox-k',
      environment: 'integration',
    });
    createMock.mockResolvedValueOnce({ token: 'T_init_int', url: 'u' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv_init_int',
      sessionId: 'sess',
      amount: 1,
      returnUrl: 'https://x',
    });
    expect(lastTxOptions()?.environment).toBe('https://webpay3gint.transbank.cl');
    expect(lastTxOptions()?.commerceCode).toBe('sandbox-c');
  });

  it('init() with empty commerceCode → isConfigured() returns false', async () => {
    // Pin `Boolean(config.commerceCode && config.apiKey)`. A mutation that
    // drops one operand of the && would either falsely report configured
    // (with empty creds → SDK fails opaquely) or always-false (deploys
    // can't ever activate).
    webpayAdapter.init({
      commerceCode: '',
      apiKey: 'has-key',
      environment: 'integration',
    });
    expect(webpayAdapter.isConfigured()).toBe(false);
  });

  it('init() with empty apiKey → isConfigured() returns false', async () => {
    webpayAdapter.init({
      commerceCode: 'has-code',
      apiKey: '',
      environment: 'integration',
    });
    expect(webpayAdapter.isConfigured()).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2026-05-18 Stryker baseline lift round 2 — error classes + env paths.
//
// Target the lower-score regions: WebpayAdapterError fields/message and
// the readEnvOptions branch logic. These are pure constructors / branch
// checks — easy to pin tightly so Stryker mutants can't survive.
// ───────────────────────────────────────────────────────────────────────
describe('WebpayAdapterError shape (Sprint 41 ratchet round 2)', () => {
  it('wraps Error cause: name === WebpayAdapterError, message includes method + cause msg', async () => {
    const cause = new Error('Transbank 504');
    commitMock.mockRejectedValueOnce(cause);
    try {
      await webpayAdapter.commitTransaction('TKN_err_cause');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as WebpayAdapterError;
      expect(err).toBeInstanceOf(WebpayAdapterError);
      expect(err.name).toBe('WebpayAdapterError');
      expect(err.method).toBe('commitTransaction');
      expect(err.message).toContain('WebpayAdapter.commitTransaction()');
      expect(err.message).toContain('failed');
      expect(err.message).toContain('Transbank 504');
      expect(err.cause).toBe(cause);
    }
  });

  it('wraps string cause: message contains the string verbatim', async () => {
    // Pin `typeof cause === 'string'` branch. A mutation collapsing the
    // ternary would either always produce "unknown error" (losing the
    // diagnostic) or throw on the .message access.
    const cause = 'network timeout literal';
    commitMock.mockRejectedValueOnce(cause);
    try {
      await webpayAdapter.commitTransaction('TKN_str_cause');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as WebpayAdapterError;
      expect(err.message).toContain('network timeout literal');
      expect(err.cause).toBe(cause);
    }
  });

  it('wraps non-Error / non-string cause: message contains "unknown error"', async () => {
    // Pin the fallback branch `: 'unknown error'`. A mutation flipping
    // the literal would lose the diagnostic floor (e.g. mutate to '' or
    // undefined).
    const cause = { weird: 'object', not: 'Error' };
    commitMock.mockRejectedValueOnce(cause);
    try {
      await webpayAdapter.commitTransaction('TKN_obj_cause');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as WebpayAdapterError;
      expect(err.message).toContain('unknown error');
      expect(err.cause).toBe(cause);
    }
  });

  it('createTransaction error carries method="createTransaction" tag', async () => {
    // Pin per-call `method` field. A mutation that hardcoded the field to
    // a single value would let a refund error masquerade as a create
    // error and break Sentry breadcrumbs.
    createMock.mockRejectedValueOnce(new Error('boom'));
    try {
      await webpayAdapter.createTransaction({
        buyOrder: 'inv',
        sessionId: 's',
        amount: 1,
        returnUrl: 'https://x',
      });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as WebpayAdapterError).method).toBe('createTransaction');
    }
  });

  it('refundTransaction error carries method="refundTransaction" tag', async () => {
    refundMock.mockRejectedValueOnce(new Error('refund denied'));
    try {
      await webpayAdapter.refundTransaction('TKN', 1000);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as WebpayAdapterError).method).toBe('refundTransaction');
    }
  });
});

describe('readEnvOptions branch coverage (Sprint 41 ratchet round 2)', () => {
  it('returns null when only WEBPAY_COMMERCE_CODE is set (key missing)', async () => {
    // `if (!code || !key) return null` — pin the right operand of ||.
    // A mutation `||` → `&&` would let this case fall through to the
    // production-route check.
    process.env.WEBPAY_COMMERCE_CODE = '597000000001';
    // WEBPAY_API_KEY intentionally unset
    expect(webpayAdapter.isConfigured()).toBe(false);
  });

  it('returns null when only WEBPAY_API_KEY is set (code missing)', async () => {
    // Pin the left operand of `!code || !key`.
    process.env.WEBPAY_API_KEY = 'k';
    expect(webpayAdapter.isConfigured()).toBe(false);
  });

  it('WEBPAY_ENV=integration routes to Integration (not Production)', async () => {
    // Pin `process.env.WEBPAY_ENV === 'production'` strict-equality. A
    // mutation `===` → `!==` would route the explicit integration env
    // to Production (catastrophic — sandbox creds against prod URL).
    process.env.WEBPAY_COMMERCE_CODE = '597000000002';
    process.env.WEBPAY_API_KEY = 'k';
    process.env.WEBPAY_ENV = 'integration';
    expect(webpayAdapter.isConfigured()).toBe(true);
    createMock.mockResolvedValueOnce({ token: 'T_int', url: 'https://int' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv',
      sessionId: 's',
      amount: 1,
      returnUrl: 'https://x',
    });
    // Codex P2 PR #359: assert the SDK Options actually carried the
    // integration URL. Without this the prod-routing mutant survives.
    expect(lastTxOptions()?.environment).toBe('https://webpay3gint.transbank.cl');
    expect(lastTxOptions()?.commerceCode).toBe('597000000002');
  });

  it('WEBPAY_ENV neither prod nor int (e.g. "staging") → Integration default', async () => {
    // Pin the `=== 'production'` literal. A mutation to `!== 'production'`
    // would route every non-prod string (including 'staging') through prod.
    process.env.WEBPAY_COMMERCE_CODE = '597000000003';
    process.env.WEBPAY_API_KEY = 'k';
    process.env.WEBPAY_ENV = 'staging';
    expect(webpayAdapter.isConfigured()).toBe(true);
    createMock.mockResolvedValueOnce({ token: 'T_def', url: 'https://def' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv',
      sessionId: 's',
      amount: 1,
      returnUrl: 'https://x',
    });
    expect(lastTxOptions()?.environment).toBe('https://webpay3gint.transbank.cl');
  });

  it('WEBPAY_ENV unset, WEBPAY_ENVIRONMENT=production → Production', async () => {
    // Pin the `||` between the two env names. A mutation `||` → `&&`
    // would require BOTH set, breaking deployments using only one.
    process.env.WEBPAY_COMMERCE_CODE = '597000000004';
    process.env.WEBPAY_API_KEY = 'k';
    // WEBPAY_ENV intentionally unset
    process.env.WEBPAY_ENVIRONMENT = 'production';
    expect(webpayAdapter.isConfigured()).toBe(true);
    createMock.mockResolvedValueOnce({ token: 'T_env_prod', url: 'u' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv',
      sessionId: 's',
      amount: 1,
      returnUrl: 'https://x',
    });
    // Codex P2: verify SDK Options received Production URL — assertion
    // that fails if the OR-clause is mutated to AND.
    expect(lastTxOptions()?.environment).toBe('https://webpay3g.transbank.cl');
  });

  it('init() priority over env vars when explicit init was called', async () => {
    // Pin the priority chain `if (state.options) return state.options`.
    // Even if env vars say production, an explicit init() should win.
    process.env.WEBPAY_COMMERCE_CODE = 'env-code';
    process.env.WEBPAY_API_KEY = 'env-key';
    process.env.WEBPAY_ENV = 'production'; // env says prod
    webpayAdapter.init({
      commerceCode: 'init-code',
      apiKey: 'init-key',
      environment: 'integration', // init says integration — must win
    });
    expect(webpayAdapter.isConfigured()).toBe(true);
    createMock.mockResolvedValueOnce({ token: 'T_init', url: 'https://init' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv',
      sessionId: 's',
      amount: 1,
      returnUrl: 'https://x',
    });
    // Codex P2: the captured Options must contain the init-supplied
    // values, NOT the env-supplied ones. A mutation that flipped the
    // priority would show env-code / production here.
    expect(lastTxOptions()).toEqual({
      commerceCode: 'init-code',
      apiKey: 'init-key',
      environment: 'https://webpay3gint.transbank.cl',
    });
  });

  it('readEnvOptions: half-configured env (only code, no key) → fall through to sandbox', async () => {
    // Codex P2 PR #359: `if (!code || !key) return null` — without
    // exercising resolveOptions(), the previous "only-code" test only
    // verified isConfigured() returns false but didn't prove the
    // adapter falls back to sandbox defaults instead of constructing
    // SDK Options with a missing credential.
    process.env.WEBPAY_COMMERCE_CODE = '597000000005';
    // WEBPAY_API_KEY intentionally absent
    createMock.mockResolvedValueOnce({ token: 'T_half', url: 'u' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv_half',
      sessionId: 's',
      amount: 1,
      returnUrl: 'https://x',
    });
    // The captured Options must be the sandbox defaults, NOT a partial
    // payload with the orphan commerceCode and empty apiKey.
    expect(lastTxOptions()?.commerceCode).toBe('597055555532'); // sandbox
    expect(lastTxOptions()?.apiKey).toBe('TEST_API_KEY'); // sandbox
    expect(lastTxOptions()?.environment).toBe('https://webpay3gint.transbank.cl');
  });

  it('sandbox fallback when neither init nor env are configured (no throw)', async () => {
    // Pin `buildIntegrationOptions()` fallback. With nothing set, the
    // adapter still allows createTransaction (development convenience).
    expect(webpayAdapter.isConfigured()).toBe(false);
    createMock.mockResolvedValueOnce({ token: 'T_sb', url: 'https://sb' });
    await expect(
      webpayAdapter.createTransaction({
        buyOrder: 'inv_sandbox',
        sessionId: 'sess_sb',
        amount: 1500,
        returnUrl: 'https://sb-return',
      }),
    ).resolves.toEqual({ token: 'T_sb', url: 'https://sb' });
    expect(createMock).toHaveBeenCalledWith(
      'inv_sandbox',
      'sess_sb',
      1500,
      'https://sb-return',
    );
    // Codex P2: assert the sandbox-default Options were actually
    // constructed (not just that the call didn't throw).
    expect(lastTxOptions()).toEqual({
      commerceCode: '597055555532', // IntegrationCommerceCodes.WEBPAY_PLUS
      apiKey: 'TEST_API_KEY', // IntegrationApiKeys.WEBPAY
      environment: 'https://webpay3gint.transbank.cl', // Environment.Integration
    });
  });
});

describe('mapCommitResponse full payload assertions (Sprint 41 ratchet round 2)', () => {
  it('AUTHORIZED response maps ALL fields exactly (kills field-drop mutants)', async () => {
    // Each `result.X` assertion kills a corresponding `X: ...` field drop
    // in the return statement. Pin every field to a unique value so
    // any mutation that swaps fields would be caught.
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      buy_order: 'INV-UNIQUE-12345',
      amount: 99777,
      response_code: 0,
      authorization_code: 'AUTH-XYZ',
      card_detail: { card_number: '4111111111119876' },
    });
    const result = await webpayAdapter.commitTransaction('TKN_full');
    expect(result.status).toBe('AUTHORIZED');
    expect(result.buyOrder).toBe('INV-UNIQUE-12345');
    expect(result.amount).toBe(99777);
    expect(result.authorizationCode).toBe('AUTH-XYZ');
    expect(result.cardLast4).toBe('9876');
    expect(result.raw).toBeDefined();
  });

  it('REJECTED response preserves buyOrder + amount + raw (no field loss on decline)', async () => {
    commitMock.mockResolvedValueOnce({
      status: 'FAILED',
      buy_order: 'INV-REJECTED-99',
      amount: 11000,
      response_code: -4,
    });
    const result = await webpayAdapter.commitTransaction('TKN_rej_full');
    expect(result.status).toBe('REJECTED');
    expect(result.buyOrder).toBe('INV-REJECTED-99');
    expect(result.amount).toBe(11000);
    expect(result.authorizationCode).toBeUndefined();
    expect(result.cardLast4).toBeUndefined();
  });

  it('AUTHORIZED requires BOTH operands (code=0 alone does not authorize)', async () => {
    // Targets line 197 ConditionalExpression survivors. With code=0 but
    // status="PENDING", we must NOT map to AUTHORIZED. A mutation that
    // dropped the second operand of && would let this slip through.
    commitMock.mockResolvedValueOnce({
      status: 'PENDING',
      buy_order: 'inv_pending_zero',
      amount: 5000,
      response_code: 0,
    });
    const result = await webpayAdapter.commitTransaction('TKN_pending_zero');
    expect(result.status).toBe('FAILED');
    expect(result.status).not.toBe('AUTHORIZED');
  });
});

describe('mapRefundResponse explicit field assertions (Sprint 41 ratchet round 2)', () => {
  it('REVERSED response preserves all fields (full check kills field-drop)', async () => {
    refundMock.mockResolvedValueOnce({
      type: 'REVERSED',
      authorization_code: 'AUTH-RFND-1',
      nullified_amount: 12000,
      balance: 0,
    });
    const result = await webpayAdapter.refundTransaction('TKN_rev_full', 12000);
    expect(result.type).toBe('REVERSED');
    expect(result.authorizationCode).toBe('AUTH-RFND-1');
    expect(result.authorizedAmount).toBe(12000);
    expect(result.balance).toBe(0);
  });

  it('exact-equality "REVERSED" matters: "reverse" (typo) → NULLIFIED', async () => {
    // Pin `rawType === 'REVERSED'` strict-equality. A mutation `===` →
    // `.includes(` or `.startsWith(` would let "reverse" or "REVERSING"
    // through and corrupt accounting categorization.
    refundMock.mockResolvedValueOnce({
      type: 'REVERSE', // missing trailing D
      nullified_amount: 5000,
    });
    const result = await webpayAdapter.refundTransaction('TKN_typo', 5000);
    expect(result.type).toBe('NULLIFIED');
  });

  it('refund preserves the SDK requestedAmount when nullified_amount=0', async () => {
    // Pin `typeof === 'number'` guard. nullified_amount=0 IS a valid
    // number (zero), so the typeof check should accept it. A mutation
    // that fell to requestedAmount in this case would mis-account.
    refundMock.mockResolvedValueOnce({
      type: 'NULLIFIED',
      nullified_amount: 0,
      balance: 11990,
    });
    const result = await webpayAdapter.refundTransaction('TKN_zero', 5000);
    expect(result.authorizedAmount).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2026-05-18 Stryker baseline lift round 3 — Sentry scope context.
//
// withSentryScope is invoked with `(moduleName, context, fn)`. Stryker
// generates mutants on the context object literals (swap field values,
// drop fields, mutate string action names). These tests assert the exact
// shape per-method so every mutant is observable.
// ───────────────────────────────────────────────────────────────────────
describe('withSentryScope invocation shape (Sprint 41 ratchet round 3)', () => {
  it('createTransaction passes module=webpay + action + buyOrder + amount (no sessionId)', async () => {
    createMock.mockResolvedValueOnce({ token: 'T', url: 'u' });
    await webpayAdapter.createTransaction({
      buyOrder: 'inv_sentry_create',
      sessionId: 'sess_x',
      amount: 13579,
      returnUrl: 'https://ret',
    });
    expect(withSentryScopeMock).toHaveBeenCalledTimes(1);
    const [mod, ctx] = withSentryScopeMock.mock.calls[0];
    expect(mod).toBe('webpay');
    expect(ctx).toEqual({
      action: 'createTransaction',
      buyOrder: 'inv_sentry_create',
      amount: 13579,
    });
    // PII guard: sessionId and returnUrl must NOT leak into Sentry context.
    expect(ctx).not.toHaveProperty('sessionId');
    expect(ctx).not.toHaveProperty('returnUrl');
  });

  it('commitTransaction passes module=webpay + action + tokenLength (no token value)', async () => {
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      buy_order: 'inv',
      amount: 1,
      response_code: 0,
    });
    await webpayAdapter.commitTransaction('TKN_thirteen!');
    expect(withSentryScopeMock).toHaveBeenCalledTimes(1);
    const [mod, ctx] = withSentryScopeMock.mock.calls[0];
    expect(mod).toBe('webpay');
    expect(ctx).toEqual({
      action: 'commitTransaction',
      tokenLength: 'TKN_thirteen!'.length,
    });
    // PII guard: the token value itself must never be in the Sentry payload.
    expect(JSON.stringify(ctx)).not.toContain('TKN_thirteen!');
  });

  it('commitTransaction handles null-ish token: tokenLength === 0 (no throw)', async () => {
    commitMock.mockResolvedValueOnce({
      status: 'FAILED',
      response_code: -98,
    });
    // The adapter uses `token?.length ?? 0` so undefined → 0.
    await webpayAdapter.commitTransaction(undefined as unknown as string);
    expect(withSentryScopeMock).toHaveBeenCalledTimes(1);
    const [, ctx] = withSentryScopeMock.mock.calls[0];
    expect((ctx as { tokenLength: number }).tokenLength).toBe(0);
  });

  it('refundTransaction passes amount + tokenLength (Sentry context for refunds)', async () => {
    refundMock.mockResolvedValueOnce({
      type: 'NULLIFIED',
      nullified_amount: 4000,
      balance: 1000,
    });
    await webpayAdapter.refundTransaction('TKN_refund_sentry', 4000);
    expect(withSentryScopeMock).toHaveBeenCalledTimes(1);
    const [mod, ctx] = withSentryScopeMock.mock.calls[0];
    expect(mod).toBe('webpay');
    expect(ctx).toEqual({
      action: 'refundTransaction',
      amount: 4000,
      tokenLength: 'TKN_refund_sentry'.length,
    });
    // PII guard: the token itself never appears in Sentry context.
    expect(JSON.stringify(ctx)).not.toContain('TKN_refund_sentry');
  });

  it('each adapter method routes through withSentryScope exactly once', async () => {
    // Pin the wrapper presence on all three entry points. A mutation that
    // strips the withSentryScope wrapper would still pass functional tests
    // but lose Sentry breadcrumbs in prod — this assertion catches it.
    createMock.mockResolvedValueOnce({ token: 't', url: 'u' });
    commitMock.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      response_code: 0,
      buy_order: '',
      amount: 0,
    });
    refundMock.mockResolvedValueOnce({ type: 'NULLIFIED' });
    await webpayAdapter.createTransaction({
      buyOrder: 'a', sessionId: 'b', amount: 1, returnUrl: 'c',
    });
    await webpayAdapter.commitTransaction('TKN');
    await webpayAdapter.refundTransaction('TKN', 1);
    expect(withSentryScopeMock).toHaveBeenCalledTimes(3);
    const modules = withSentryScopeMock.mock.calls.map((c) => c[0]);
    expect(modules).toEqual(['webpay', 'webpay', 'webpay']);
    const actions = withSentryScopeMock.mock.calls.map(
      (c) => (c[1] as { action: string }).action,
    );
    expect(actions).toEqual([
      'createTransaction',
      'commitTransaction',
      'refundTransaction',
    ]);
  });
});
