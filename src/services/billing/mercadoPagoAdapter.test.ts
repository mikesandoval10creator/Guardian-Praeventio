// Praeventio Guard — mercadoPagoAdapter unit tests.
//
// We mock the `mercadopago` SDK entirely so these tests:
//   • run offline (no real MP network),
//   • don't require a sandbox access token,
//   • exercise the response-mapping + isConfigured logic deterministically.
//
// The mock exposes a stub `Preference` and `Payment` class whose `create`
// and `get` methods are vitest spies we override per test. The
// `MercadoPagoConfig` constructor is captured so we can assert the
// adapter wired the right access token + sandbox flag.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const preferenceCreateMock = vi.fn();
const paymentGetMock = vi.fn();
const configCtorMock = vi.fn();

vi.mock('mercadopago', () => {
  class MercadoPagoConfigStub {
    accessToken: string;
    options?: Record<string, unknown>;
    constructor(cfg: { accessToken: string; options?: Record<string, unknown> }) {
      configCtorMock(cfg);
      this.accessToken = cfg.accessToken;
      this.options = cfg.options;
    }
  }
  class PreferenceStub {
    constructor(_config: unknown) {
      // no-op; mock spies live at the module scope.
    }
    create = preferenceCreateMock;
  }
  class PaymentStub {
    constructor(_config: unknown) {}
    get = paymentGetMock;
  }
  return {
    default: MercadoPagoConfigStub,
    MercadoPagoConfig: MercadoPagoConfigStub,
    Preference: PreferenceStub,
    Payment: PaymentStub,
  };
});

// Import AFTER vi.mock is registered so the adapter sees the stubs.
import {
  __resetMercadoPagoAdapterStateForTests,
  mercadoPagoAdapter,
  MercadoPagoAdapterError,
} from './mercadoPagoAdapter.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  preferenceCreateMock.mockReset();
  paymentGetMock.mockReset();
  configCtorMock.mockReset();
  __resetMercadoPagoAdapterStateForTests();
  delete process.env.MP_ACCESS_TOKEN;
  delete process.env.MP_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('mercadoPagoAdapter.isConfigured', () => {
  it('returns false when MP_ACCESS_TOKEN is not set', () => {
    expect(mercadoPagoAdapter.isConfigured()).toBe(false);
  });

  it('returns true when MP_ACCESS_TOKEN is set', () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-12345-abc';
    expect(mercadoPagoAdapter.isConfigured()).toBe(true);
  });

  it('returns false when MP_ACCESS_TOKEN is the empty string', () => {
    // An empty token is a fail-closed signal — never count it as
    // configured. Sending "" through the SDK would 401 noisily.
    process.env.MP_ACCESS_TOKEN = '';
    expect(mercadoPagoAdapter.isConfigured()).toBe(false);
  });
});

describe('mercadoPagoAdapter.createPreference', () => {
  it('returns { id, init_point } from the mocked SDK', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    preferenceCreateMock.mockResolvedValueOnce({
      id: 'PREF_abc123',
      init_point: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=PREF_abc123',
      sandbox_init_point:
        'https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=PREF_abc123',
    });

    const result = await mercadoPagoAdapter.createPreference({
      items: [
        {
          title: 'Plan Comité Paritario (mensual)',
          quantity: 1,
          unit_price: 49.9,
          currency_id: 'PEN',
        },
      ],
      payer: { email: 'cliente@example.com' },
      back_urls: {
        success: 'https://app.praeventio.net/pricing/success',
        pending: 'https://app.praeventio.net/pricing/retry',
        failure: 'https://app.praeventio.net/pricing/failed',
      },
      notification_url: 'https://app.praeventio.net/api/billing/webhook/mercadopago',
      external_reference: 'inv_test_001',
    });

    expect(result.id).toBe('PREF_abc123');
    expect(result.init_point).toContain('pref_id=PREF_abc123');
    expect(preferenceCreateMock).toHaveBeenCalledTimes(1);
    const arg = preferenceCreateMock.mock.calls[0][0];
    expect(arg.body.items[0].currency_id).toBe('PEN');
    expect(arg.body.payer.email).toBe('cliente@example.com');
    expect(arg.body.external_reference).toBe('inv_test_001');
  });

  it('returns the sandbox_init_point when MP_ENV=sandbox', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-sandbox';
    process.env.MP_ENV = 'sandbox';
    preferenceCreateMock.mockResolvedValueOnce({
      id: 'PREF_sbx',
      init_point: 'https://www.mercadopago.cl/...',
      sandbox_init_point: 'https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=PREF_sbx',
    });

    const result = await mercadoPagoAdapter.createPreference({
      items: [{ title: 't', quantity: 1, unit_price: 10, currency_id: 'PEN' }],
      payer: { email: 'a@b.com' },
      back_urls: { success: 's', pending: 'p', failure: 'f' },
      notification_url: 'n',
      external_reference: 'r',
    });

    // Sandbox env should prefer the sandbox URL so QA never accidentally
    // hits production payouts.
    expect(result.init_point).toContain('sandbox.mercadopago');
  });

  it('wraps SDK errors in MercadoPagoAdapterError (not silent)', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    preferenceCreateMock.mockRejectedValueOnce(new Error('MP network down'));

    await expect(
      mercadoPagoAdapter.createPreference({
        items: [{ title: 't', quantity: 1, unit_price: 10, currency_id: 'PEN' }],
        payer: { email: 'a@b.com' },
        back_urls: { success: 's', pending: 'p', failure: 'f' },
        notification_url: 'n',
        external_reference: 'r',
      }),
    ).rejects.toBeInstanceOf(MercadoPagoAdapterError);
  });

  it('throws if called without MP_ACCESS_TOKEN configured', async () => {
    // No env set in beforeEach — adapter must fail closed rather than
    // calling SDK with empty creds.
    await expect(
      mercadoPagoAdapter.createPreference({
        items: [{ title: 't', quantity: 1, unit_price: 10, currency_id: 'PEN' }],
        payer: { email: 'a@b.com' },
        back_urls: { success: 's', pending: 'p', failure: 'f' },
        notification_url: 'n',
        external_reference: 'r',
      }),
    ).rejects.toBeInstanceOf(MercadoPagoAdapterError);
    expect(preferenceCreateMock).not.toHaveBeenCalled();
  });

  it('throws if init_point is missing on the response (malformed)', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    preferenceCreateMock.mockResolvedValueOnce({ id: 'PREF_x' /* no init_point */ });

    await expect(
      mercadoPagoAdapter.createPreference({
        items: [{ title: 't', quantity: 1, unit_price: 10, currency_id: 'PEN' }],
        payer: { email: 'a@b.com' },
        back_urls: { success: 's', pending: 'p', failure: 'f' },
        notification_url: 'n',
        external_reference: 'r',
      }),
    ).rejects.toBeInstanceOf(MercadoPagoAdapterError);
  });
});

describe('mercadoPagoAdapter.getPayment', () => {
  it('returns mapped status fields from the mocked SDK', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    paymentGetMock.mockResolvedValueOnce({
      id: 12345,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'inv_test_001',
      transaction_amount: 49.9,
      currency_id: 'PEN',
    });

    const result = await mercadoPagoAdapter.getPayment('12345');

    expect(result.status).toBe('approved');
    expect(result.status_detail).toBe('accredited');
    expect(result.external_reference).toBe('inv_test_001');
    expect(result.amount).toBe(49.9);
    expect(result.currency).toBe('PEN');
    expect(paymentGetMock).toHaveBeenCalledWith({ id: '12345' });
  });

  it('wraps SDK getPayment errors in MercadoPagoAdapterError', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    paymentGetMock.mockRejectedValueOnce(new Error('404 not found'));

    await expect(mercadoPagoAdapter.getPayment('99999')).rejects.toBeInstanceOf(
      MercadoPagoAdapterError,
    );
  });
});
