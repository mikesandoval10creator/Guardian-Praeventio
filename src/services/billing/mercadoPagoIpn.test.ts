// Praeventio Guard — Round 18 R2 (deferred from R17): MercadoPago IPN handler tests.
//
// MP delivers payment notifications to /api/billing/webhook/mercadopago. This
// file unit-tests the two pure entry points the route handler calls:
//
//   1. verifyMercadoPagoIpnSignature(body, signature, secret) — HMAC-SHA256.
//      MP signature scheme in production is `ts=<ts>,v1=<hex>` with a manifest
//      derived from id+request-id+ts. For round-18 we ship the simpler
//      "raw HMAC over body" variant — same shape as R1 R17 telemetry. Once
//      R19 ships the unified canonical-body fix, both telemetry and IPN will
//      switch to the manifest format together.
//
//   2. processMercadoPagoIpn(body) — fetches the payment via the
//      mercadoPagoAdapter, maps MP status to invoice outcome, updates the
//      invoice doc, audits, and is idempotent via processed_mp_ipn/{paymentId}.
//
// Mocks:
//   • `mercadoPagoAdapter` is mocked to control getPayment without real network.
//   • `firebase-admin` is mocked with a minimal in-memory shape.
//
// We run these tests with `vi.hoisted` so the mock object is shared between
// the vi.mock factory and the test body.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// ───────────────────────────────────────────────────────────────────────────
// Hoisted mocks — shared between vi.mock factories and tests.
// ───────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const getPaymentMock = vi.fn();
  type StoreEntry = { data: any };
  const store = new Map<string, StoreEntry>();
  const getSpy = vi.fn();
  const setSpy = vi.fn();
  const updateSpy = vi.fn();
  const addSpy = vi.fn();

  const firestoreFactory = () => ({
    collection: (col: string) => ({
      doc: (id: string) => {
        const path = `${col}/${id}`;
        return {
          get: async () => {
            getSpy(path);
            const entry = store.get(path);
            return {
              exists: !!entry,
              data: () => entry?.data,
            };
          },
          set: async (data: any, opts?: { merge?: boolean }) => {
            setSpy(path, data, opts);
            const prev = store.get(path);
            if (opts?.merge && prev?.data) {
              store.set(path, { data: { ...prev.data, ...data } });
            } else {
              store.set(path, { data: { ...data } });
            }
          },
          update: async (data: any) => {
            updateSpy(path, data);
            const prev = store.get(path);
            if (!prev) throw new Error('cannot update missing doc');
            store.set(path, { data: { ...prev.data, ...data } });
          },
        };
      },
      add: async (data: any) => {
        addSpy(col, data);
        const id = `auto_${Math.random().toString(36).slice(2, 10)}`;
        store.set(`${col}/${id}`, { data: { ...data } });
        return { id };
      },
    }),
  });

  return { getPaymentMock, store, getSpy, setSpy, updateSpy, addSpy, firestoreFactory };
});

vi.mock('./mercadoPagoAdapter.js', () => ({
  mercadoPagoAdapter: {
    isConfigured: () => true,
    createPreference: vi.fn(),
    getPayment: mocks.getPaymentMock,
  },
  MercadoPagoAdapterError: class MercadoPagoAdapterError extends Error {
    method: string;
    constructor(method: string, cause: unknown) {
      super(`MercadoPagoAdapter.${method}() failed`);
      this.method = method;
    }
  },
}));

vi.mock('firebase-admin', () => {
  const factory = mocks.firestoreFactory;
  const FieldValue = {
    serverTimestamp: () => ({ __ts: true }),
  };
  const fs = factory();
  return {
    default: {
      firestore: Object.assign(() => fs, { FieldValue }),
    },
    firestore: Object.assign(() => fs, { FieldValue }),
  };
});

// Import AFTER vi.mock declarations so the module under test sees the stubs.
import {
  verifyMercadoPagoIpnSignature,
  verifyMercadoPagoIpnSignatureFromBody,
  processMercadoPagoIpn,
} from './mercadoPagoIpn.js';
import { canonicalize } from '../../server/middleware/canonicalBody.js';

beforeEach(() => {
  mocks.getPaymentMock.mockReset();
  mocks.store.clear();
  mocks.getSpy.mockReset();
  mocks.setSpy.mockReset();
  mocks.updateSpy.mockReset();
  mocks.addSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// Signature verify tests
// ───────────────────────────────────────────────────────────────────────────

describe('verifyMercadoPagoIpnSignature', () => {
  const SECRET = 'mp-ipn-secret-test';

  function sign(body: string): string {
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    return `sha256=${hex}`;
  }

  it('accepts a valid signature', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    expect(verifyMercadoPagoIpnSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    const sig = sign(body);
    // Flip last hex char (still well-formed length)
    const tampered = sig.slice(0, -1) + (sig.slice(-1) === '0' ? '1' : '0');
    expect(verifyMercadoPagoIpnSignature(body, tampered, SECRET)).toBe(false);
  });

  it('rejects a missing/empty signature', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    expect(verifyMercadoPagoIpnSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects a malformed signature header (no sha256= prefix)', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    // Missing the "sha256=" prefix → must reject.
    expect(verifyMercadoPagoIpnSignature(body, hex, SECRET)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Round 18 R6 — canonical-JSON variant.
// ───────────────────────────────────────────────────────────────────────────

describe('verifyMercadoPagoIpnSignatureFromBody (RFC 8785 canonical)', () => {
  const SECRET = 'mp-ipn-secret-test';
  const ORIGINAL_FALLBACK = process.env.LEGACY_HMAC_FALLBACK;

  function signCanonical(parsed: unknown): string {
    const hex = crypto
      .createHmac('sha256', SECRET)
      .update(canonicalize(parsed ?? {}))
      .digest('hex');
    return `sha256=${hex}`;
  }
  function signLegacy(parsed: unknown): string {
    const hex = crypto
      .createHmac('sha256', SECRET)
      .update(JSON.stringify(parsed ?? {}))
      .digest('hex');
    return `sha256=${hex}`;
  }

  beforeEach(() => {
    delete process.env.LEGACY_HMAC_FALLBACK;
  });
  afterEach(() => {
    if (ORIGINAL_FALLBACK === undefined) delete process.env.LEGACY_HMAC_FALLBACK;
    else process.env.LEGACY_HMAC_FALLBACK = ORIGINAL_FALLBACK;
  });

  it('accepts a body signed with the canonical-JSON form', () => {
    const body = { type: 'payment', data: { id: '123' } };
    expect(verifyMercadoPagoIpnSignatureFromBody(body, signCanonical(body), SECRET)).toBe(true);
  });

  it('accepts the same logical body regardless of producer key order', () => {
    // Two semantically-identical bodies with different key insertion orders
    // produce the SAME canonical string and thus the SAME HMAC.
    const orderA = { type: 'payment', data: { id: '123' } };
    const orderB = { data: { id: '123' }, type: 'payment' };
    const sig = signCanonical(orderA);
    expect(verifyMercadoPagoIpnSignatureFromBody(orderB, sig, SECRET)).toBe(true);
  });

  it('rejects a body whose HMAC was computed over JSON.stringify (non-canonical, fallback OFF)', () => {
    // Construct a body where JSON.stringify(body) !== canonicalize(body).
    // {b:2, a:1} stringifies as {"b":2,"a":1} but canonicalises to
    // {"a":1,"b":2} — different bytes, different HMAC.
    const body = { b: 2, a: 1 };
    expect(JSON.stringify(body)).not.toBe(canonicalize(body));
    expect(verifyMercadoPagoIpnSignatureFromBody(body, signLegacy(body), SECRET)).toBe(false);
  });

  it('accepts a JSON.stringify-signed body when LEGACY_HMAC_FALLBACK=1', () => {
    process.env.LEGACY_HMAC_FALLBACK = '1';
    const body = { b: 2, a: 1 };
    expect(verifyMercadoPagoIpnSignatureFromBody(body, signLegacy(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body even with LEGACY_HMAC_FALLBACK=1', () => {
    process.env.LEGACY_HMAC_FALLBACK = '1';
    const original = { type: 'payment', data: { id: '123' } };
    const tampered = { type: 'payment', data: { id: '999' } };
    // Sig was over original — verifying tampered must fail under both paths.
    expect(verifyMercadoPagoIpnSignatureFromBody(tampered, signCanonical(original), SECRET)).toBe(
      false,
    );
  });

  it('rejects an empty signature regardless of body', () => {
    expect(verifyMercadoPagoIpnSignatureFromBody({ type: 'payment' }, '', SECRET)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// processMercadoPagoIpn tests
// ───────────────────────────────────────────────────────────────────────────

describe('processMercadoPagoIpn', () => {
  it('marks invoice as paid for status=approved', async () => {
    const invoiceId = 'inv_mp_123_aaa';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: {
        id: invoiceId,
        status: 'pending-payment',
        paymentMethod: 'mercadopago',
        totals: { total: 100, currency: 'PEN' },
      },
    });
    mocks.getPaymentMock.mockResolvedValueOnce({
      status: 'approved',
      status_detail: 'accredited',
      external_reference: invoiceId,
      amount: 100,
      currency: 'PEN',
    });

    const result = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_42' } });

    expect(result.outcome).toBe('paid');
    expect(result.invoiceId).toBe(invoiceId);
    expect(mocks.store.get(`invoices/${invoiceId}`)?.data.status).toBe('paid');
    // Audit log row was added.
    const auditCalls = mocks.addSpy.mock.calls.filter(([col]) => col === 'audit_logs');
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0][1]).toMatchObject({
      action: 'billing.mercadopago.ipn.processed',
      module: 'billing',
      details: { paymentId: 'pay_42', outcome: 'paid' },
    });
  });

  it('marks invoice as rejected for status=rejected', async () => {
    const invoiceId = 'inv_mp_123_bbb';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: { id: invoiceId, status: 'pending-payment', paymentMethod: 'mercadopago' },
    });
    mocks.getPaymentMock.mockResolvedValueOnce({
      status: 'rejected',
      status_detail: 'cc_rejected_other_reason',
      external_reference: invoiceId,
    });

    const result = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_43' } });
    expect(result.outcome).toBe('rejected');
    expect(mocks.store.get(`invoices/${invoiceId}`)?.data.status).toBe('rejected');
  });

  it('keeps invoice pending for status=pending|in_process', async () => {
    const invoiceId = 'inv_mp_123_ccc';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: { id: invoiceId, status: 'pending-payment', paymentMethod: 'mercadopago' },
    });
    mocks.getPaymentMock.mockResolvedValueOnce({
      status: 'pending',
      status_detail: 'pending_waiting_payment',
      external_reference: invoiceId,
    });

    const result = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_44' } });
    expect(result.outcome).toBe('pending');
    // Invoice doc still pending-payment.
    expect(mocks.store.get(`invoices/${invoiceId}`)?.data.status).toBe('pending-payment');
  });

  it('is idempotent on replay (second call does NOT re-process)', async () => {
    const invoiceId = 'inv_mp_123_ddd';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: { id: invoiceId, status: 'pending-payment', paymentMethod: 'mercadopago' },
    });
    mocks.getPaymentMock.mockResolvedValue({
      status: 'approved',
      status_detail: 'accredited',
      external_reference: invoiceId,
    });

    const r1 = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_dup' } });
    const r2 = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_dup' } });

    expect(r1.outcome).toBe('paid');
    expect(r2.outcome).toBe('paid'); // replayed via processed_mp_ipn doc
    // getPayment called ONLY ONCE — second call short-circuits via idempotency.
    expect(mocks.getPaymentMock).toHaveBeenCalledTimes(1);
    // Only one audit log row.
    const auditCalls = mocks.addSpy.mock.calls.filter(([col]) => col === 'audit_logs');
    expect(auditCalls.length).toBe(1);
  });

  it('rejects non-payment notification types (returns pending without fetching)', async () => {
    // MP also delivers `merchant_order` and other types — we only care about
    // `payment`. Anything else short-circuits to {outcome:'pending'} without
    // touching the MP API or invoice doc.
    const result = await processMercadoPagoIpn({
      type: 'merchant_order',
      data: { id: 'mo_99' },
    });
    expect(result.outcome).toBe('pending');
    expect(result.invoiceId).toBe('');
    expect(mocks.getPaymentMock).not.toHaveBeenCalled();
  });

  it('throws when MP API call fails', async () => {
    mocks.getPaymentMock.mockRejectedValueOnce(new Error('MP 503 service unavailable'));

    await expect(
      processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_err' } }),
    ).rejects.toThrow(/MP/);
  });
});
