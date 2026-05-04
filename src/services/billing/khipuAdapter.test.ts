// Praeventio Guard — khipuAdapter unit tests.
//
// We mock the global `fetch` end-to-end so these tests:
//   • run offline (no real Khipu network),
//   • don't require sandbox credentials,
//   • exercise the request-shape + response-mapping logic deterministically.
//
// HMAC tests use the real `node:crypto` (no point mocking that — it's
// part of the contract under test).

import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KhipuAdapter,
  KhipuAdapterError,
  KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC,
} from './khipuAdapter.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.KHIPU_RECEIVER_ID;
  delete process.env.KHIPU_SECRET;
  delete process.env.KHIPU_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ───────────────────────────────────────────────────────────────────────────
// Test helpers
// ───────────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const SAMPLE_TX = {
  buyOrder: 'inv_test_001',
  sessionId: 'session-uid-1',
  amount: 11990,
  subject: 'Praeventio Guard — Plan Plata (mensual)',
  currency: 'CLP' as const,
  returnUrl: 'https://app.praeventio.net/billing/khipu/return',
  cancelUrl: 'https://app.praeventio.net/pricing',
  notifyUrl: 'https://app.praeventio.net/api/billing/khipu/webhook',
};

// ───────────────────────────────────────────────────────────────────────────
// fromEnv / SANDBOX_DEFAULTS
// ───────────────────────────────────────────────────────────────────────────

describe('KhipuAdapter.fromEnv', () => {
  it('returns sandbox defaults when env vars are missing', () => {
    const adapter = KhipuAdapter.fromEnv();
    expect(adapter.config).toEqual(KhipuAdapter.SANDBOX_DEFAULTS);
    expect(adapter.config.environment).toBe('integration');
    expect(adapter.isConfigured()).toBe(false);
  });

  it('reads production credentials from env vars', () => {
    process.env.KHIPU_RECEIVER_ID = '999888';
    process.env.KHIPU_SECRET = 'real-prod-secret';
    process.env.KHIPU_ENV = 'production';
    const adapter = KhipuAdapter.fromEnv();
    expect(adapter.config.receiverId).toBe('999888');
    expect(adapter.config.secret).toBe('real-prod-secret');
    expect(adapter.config.environment).toBe('production');
    expect(adapter.isConfigured()).toBe(true);
  });

  it('defaults environment to integration when KHIPU_ENV is unset but creds exist', () => {
    process.env.KHIPU_RECEIVER_ID = '999888';
    process.env.KHIPU_SECRET = 'some-secret';
    const adapter = KhipuAdapter.fromEnv();
    expect(adapter.config.environment).toBe('integration');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// createPayment
// ───────────────────────────────────────────────────────────────────────────

describe('KhipuAdapter.createPayment', () => {
  it('POSTs the correct body shape with x-api-key header', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        payment_id: 'pmt_abc',
        payment_url: 'https://khipu.com/payment/info/pmt_abc',
        simplified_transfer_url: 'https://khipu.com/payment/simplified/pmt_abc',
        transfer_url: 'https://khipu.com/payment/manual/pmt_abc',
        app_url: 'khipu:///pmt_abc',
        expires_date: '2030-01-01T00:00:00Z',
      }),
    );
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    await adapter.createPayment(SAMPLE_TX);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = (fetchMock.mock.calls as any[])[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe('https://payment-api.khipu.com/v3/payments');
    expect(init.method).toBe('POST');
    expect((init.headers as any)['x-api-key']).toBe(
      KhipuAdapter.SANDBOX_DEFAULTS.secret,
    );
    expect((init.headers as any)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(11990);
    expect(body.currency).toBe('CLP');
    expect(body.transaction_id).toBe('inv_test_001');
    expect(body.return_url).toBe(SAMPLE_TX.returnUrl);
    expect(body.cancel_url).toBe(SAMPLE_TX.cancelUrl);
    expect(body.notify_url).toBe(SAMPLE_TX.notifyUrl);
    expect(body.subject).toBe(SAMPLE_TX.subject);
  });

  it('maps payment_url and simplified_transfer_url correctly', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        payment_id: 'pmt_xyz',
        payment_url: 'https://khipu.com/payment/info/pmt_xyz',
        simplified_transfer_url: 'https://khipu.com/payment/simplified/pmt_xyz',
        transfer_url: 'https://khipu.com/payment/manual/pmt_xyz',
        expires_date: '2030-01-01T00:00:00Z',
      }),
    );
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    const result = await adapter.createPayment(SAMPLE_TX);

    expect(result.paymentId).toBe('pmt_xyz');
    expect(result.paymentUrl).toBe('https://khipu.com/payment/info/pmt_xyz');
    expect(result.simplifiedTransferUrl).toBe(
      'https://khipu.com/payment/simplified/pmt_xyz',
    );
    expect(result.transferUrl).toBe('https://khipu.com/payment/manual/pmt_xyz');
    expect(result.expiresAt).toBe('2030-01-01T00:00:00Z');
    // raw is preserved for audit
    expect(result.raw).toBeDefined();
  });

  it('throws KhipuAdapterError on 4xx', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, { error: 'invalid_amount', message: 'amount too low' }),
    );
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    await expect(adapter.createPayment(SAMPLE_TX)).rejects.toBeInstanceOf(
      KhipuAdapterError,
    );
  });

  it('throws KhipuAdapterError on network failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ENOTFOUND payment-api.khipu.com');
    });
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    await expect(adapter.createPayment(SAMPLE_TX)).rejects.toBeInstanceOf(
      KhipuAdapterError,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getPaymentStatus
// ───────────────────────────────────────────────────────────────────────────

describe('KhipuAdapter.getPaymentStatus', () => {
  it('returns "completed" for a paid Khipu payment (status=done)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        payment_id: 'pmt_paid',
        transaction_id: 'inv_test_001',
        amount: 11990,
        status: 'done',
        expires_date: '2030-01-01T00:00:00Z',
      }),
    );
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    const result = await adapter.getPaymentStatus('pmt_paid');

    expect(result.status).toBe('completed');
    expect(result.buyOrder).toBe('inv_test_001');
    expect(result.amount).toBe(11990);
    expect(result.paymentId).toBe('pmt_paid');
  });

  it('returns "expired" when expires_date is in the past', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        payment_id: 'pmt_old',
        transaction_id: 'inv_test_002',
        amount: 11990,
        status: 'pending',
        expires_date: '2000-01-01T00:00:00Z', // long past
      }),
    );
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    const result = await adapter.getPaymentStatus('pmt_old');

    expect(result.status).toBe('expired');
  });

  it('returns "cancelled" for status=failed', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        payment_id: 'pmt_fail',
        transaction_id: 'inv_test_003',
        amount: 11990,
        status: 'failed',
        expires_date: '2030-01-01T00:00:00Z',
      }),
    );
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    const result = await adapter.getPaymentStatus('pmt_fail');

    expect(result.status).toBe('cancelled');
  });

  it('returns "pending" for status=verifying (bank not yet confirmed)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        payment_id: 'pmt_pending',
        transaction_id: 'inv_test_004',
        amount: 11990,
        status: 'verifying',
        expires_date: '2030-01-01T00:00:00Z',
      }),
    );
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchMock as any);

    const result = await adapter.getPaymentStatus('pmt_pending');

    expect(result.status).toBe('pending');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// verifyWebhookSignature
// ───────────────────────────────────────────────────────────────────────────

function makeSignedHeader(secret: string, rawBody: string, ts: number): string {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  return `t=${ts},s=${sig}`;
}

describe('KhipuAdapter.verifyWebhookSignature', () => {
  it('accepts a valid HMAC-signed payload', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    const rawBody = JSON.stringify({ payment_id: 'pmt_abc', status: 'done' });
    const ts = Math.floor(Date.now() / 1000);
    const header = makeSignedHeader(
      KhipuAdapter.SANDBOX_DEFAULTS.secret,
      rawBody,
      ts,
    );

    expect(adapter.verifyWebhookSignature(rawBody, header)).toBe(true);
  });

  it('rejects a tampered body (HMAC mismatch)', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    const rawBody = JSON.stringify({ payment_id: 'pmt_abc', status: 'done' });
    const ts = Math.floor(Date.now() / 1000);
    const header = makeSignedHeader(
      KhipuAdapter.SANDBOX_DEFAULTS.secret,
      rawBody,
      ts,
    );

    // Attacker swaps the body but reuses the signature.
    const tamperedBody = JSON.stringify({ payment_id: 'pmt_abc', status: 'cancelled' });
    expect(adapter.verifyWebhookSignature(tamperedBody, header)).toBe(false);
  });

  it('rejects malformed signature header (no t=, no s=)', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    expect(adapter.verifyWebhookSignature('{}', 'garbage-header')).toBe(false);
    expect(adapter.verifyWebhookSignature('{}', '')).toBe(false);
    expect(adapter.verifyWebhookSignature('{}', 't=123')).toBe(false); // missing s=
    expect(adapter.verifyWebhookSignature('{}', 's=abc')).toBe(false); // missing t=
  });

  it('rejects an expired timestamp (drift > 300s)', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    const rawBody = '{"x":1}';
    const nowSec = Math.floor(Date.now() / 1000);
    const oldTs = nowSec - (KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC + 60); // 6 min old
    const header = makeSignedHeader(
      KhipuAdapter.SANDBOX_DEFAULTS.secret,
      rawBody,
      oldTs,
    );

    // Even though HMAC is correct, timestamp drift kills it.
    expect(adapter.verifyWebhookSignature(rawBody, header, () => nowSec)).toBe(
      false,
    );
  });

  it('rejects a future timestamp beyond drift window (clock skew defence)', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    const rawBody = '{"x":1}';
    const nowSec = Math.floor(Date.now() / 1000);
    const futureTs = nowSec + (KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC + 60);
    const header = makeSignedHeader(
      KhipuAdapter.SANDBOX_DEFAULTS.secret,
      rawBody,
      futureTs,
    );

    expect(adapter.verifyWebhookSignature(rawBody, header, () => nowSec)).toBe(
      false,
    );
  });

  it('accepts a signature exactly at the drift boundary (t=now-300s)', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    const rawBody = '{"x":1}';
    const nowSec = 2_000_000_000;
    const ts = nowSec - KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC; // exactly at boundary
    const header = makeSignedHeader(
      KhipuAdapter.SANDBOX_DEFAULTS.secret,
      rawBody,
      ts,
    );

    expect(adapter.verifyWebhookSignature(rawBody, header, () => nowSec)).toBe(
      true,
    );
  });

  it('rejects when signature is signed with a different secret', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    const rawBody = '{"x":1}';
    const ts = Math.floor(Date.now() / 1000);
    const header = makeSignedHeader('wrong-secret', rawBody, ts);

    expect(adapter.verifyWebhookSignature(rawBody, header)).toBe(false);
  });

  it('rejects when s= length differs (timingSafeEqual length-mismatch path)', () => {
    const adapter = new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS);
    const rawBody = '{"x":1}';
    const ts = Math.floor(Date.now() / 1000);
    // Truncated signature — wrong length on purpose.
    const header = `t=${ts},s=deadbeef`;

    expect(adapter.verifyWebhookSignature(rawBody, header)).toBe(false);
  });

  it('drift tolerance constant is exactly 300 seconds', () => {
    expect(KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC).toBe(300);
  });
});
