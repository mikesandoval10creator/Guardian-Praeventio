import { describe, expect, it } from 'vitest';

import {
  isSubscriptionPlan,
  normalizeSubscriptionPlanId,
  subscriptionPlanForPaidTier,
  cycleFromInvoiceDoc,
  cycleFromProductId,
  DEFAULT_SUBSCRIPTION_CYCLE,
  planFromIapProductId,
} from './subscriptionPlan';
import { iapSkuForTier } from './iapSkus';

describe('subscription plan normalization (7-metal scheme)', () => {
  it('maps canonical tier ids to plan ids (1:1 in the 7-metal scheme)', () => {
    expect(subscriptionPlanForPaidTier('gratis')).toBe('free');
    expect(subscriptionPlanForPaidTier('cobre')).toBe('cobre');
    expect(subscriptionPlanForPaidTier('plata')).toBe('plata');
    expect(subscriptionPlanForPaidTier('diamante')).toBe('diamante');
  });

  it('normalizes pre-collapse legacy ids onto the 7-metal scheme (closest-up)', () => {
    expect(normalizeSubscriptionPlanId('comite-paritario')).toBe('plata');
    expect(normalizeSubscriptionPlanId('comite')).toBe('plata');
    expect(normalizeSubscriptionPlanId('departamento-prevencion')).toBe('oro');
    expect(normalizeSubscriptionPlanId('departamento')).toBe('oro');
    expect(normalizeSubscriptionPlanId('empresarial')).toBe('platino');
    expect(normalizeSubscriptionPlanId('corporativo')).toBe('platino');
    expect(normalizeSubscriptionPlanId('ilimitado')).toBe('diamante');
    expect(normalizeSubscriptionPlanId('global-titanio')).toBe('diamante');
  });

  it('maps the older premium/basic aliases', () => {
    expect(normalizeSubscriptionPlanId('premium')).toBe('oro');
    expect(normalizeSubscriptionPlanId('basic')).toBe('cobre');
  });

  it('keeps current plan ids stable', () => {
    expect(normalizeSubscriptionPlanId('oro')).toBe('oro');
    expect(normalizeSubscriptionPlanId('cobre')).toBe('cobre');
  });

  it('rejects unknown ids instead of casting them into the entitlement system', () => {
    expect(normalizeSubscriptionPlanId('galactic-emperor')).toBeNull();
    expect(isSubscriptionPlan('galactic-emperor')).toBe(false);
  });
});

describe('subscription billing-cycle resolution (server-side, total)', () => {
  it('the safe default is monthly (never over-grants an entitlement window)', () => {
    expect(DEFAULT_SUBSCRIPTION_CYCLE).toBe('monthly');
  });

  describe('cycleFromInvoiceDoc', () => {
    it('reads the structured top-level cycle field', () => {
      expect(cycleFromInvoiceDoc({ cycle: 'annual' })).toBe('annual');
      expect(cycleFromInvoiceDoc({ cycle: 'monthly' })).toBe('monthly');
    });

    it('ignores an invalid cycle value and defaults to monthly', () => {
      expect(cycleFromInvoiceDoc({ cycle: 'weekly' })).toBe('monthly');
      expect(cycleFromInvoiceDoc({ cycle: 123 })).toBe('monthly');
    });

    it('falls back to the line-item description for legacy invoices (no top-level field)', () => {
      expect(
        cycleFromInvoiceDoc({ lineItems: [{ description: 'Suscripción oro (annual)' }] }),
      ).toBe('annual');
      expect(
        cycleFromInvoiceDoc({ lineItems: [{ description: 'Suscripción oro (monthly)' }] }),
      ).toBe('monthly');
    });

    it('returns the default for null / undefined / empty / shapeless docs (never throws)', () => {
      expect(cycleFromInvoiceDoc(null)).toBe('monthly');
      expect(cycleFromInvoiceDoc(undefined)).toBe('monthly');
      expect(cycleFromInvoiceDoc({})).toBe('monthly');
      expect(cycleFromInvoiceDoc({ lineItems: [] })).toBe('monthly');
      expect(cycleFromInvoiceDoc({ lineItems: [{ description: 'no cycle token' }] })).toBe('monthly');
    });
  });

  describe('cycleFromProductId', () => {
    it('derives the cycle from a real store SKU (round-trips iapSkuForTier)', () => {
      expect(cycleFromProductId(iapSkuForTier('oro', 'annual'))).toBe('annual');
      expect(cycleFromProductId(iapSkuForTier('oro', 'monthly'))).toBe('monthly');
    });

    it('defaults to monthly for unknown / missing SKUs (never throws)', () => {
      expect(cycleFromProductId('com.unknown.sku')).toBe('monthly');
      expect(cycleFromProductId(null)).toBe('monthly');
      expect(cycleFromProductId(undefined)).toBe('monthly');
      expect(cycleFromProductId('')).toBe('monthly');
    });
  });

  describe('planFromIapProductId (SKU → plan; was the IAP "comite" bug)', () => {
    it('maps a real store SKU to the bought plan (round-trip)', () => {
      expect(planFromIapProductId(iapSkuForTier('oro', 'annual'))).toBe('oro');
      expect(planFromIapProductId(iapSkuForTier('plata', 'monthly'))).toBe('plata');
      expect(planFromIapProductId(iapSkuForTier('diamante', 'annual'))).toBe('diamante');
      // The exact bug case: a raw oro SKU must NOT collapse to a wrong plan.
      expect(planFromIapProductId('praeventio_oro_annual')).toBe('oro');
    });

    it('also accepts a tier/plan id passed directly', () => {
      expect(planFromIapProductId('oro')).toBe('oro');
      expect(planFromIapProductId('plata')).toBe('plata');
    });

    it('returns null for an unknown SKU / null / empty (caller decides the fallback)', () => {
      expect(planFromIapProductId('com.unknown.sku')).toBeNull();
      expect(planFromIapProductId(null)).toBeNull();
      expect(planFromIapProductId(undefined)).toBeNull();
      expect(planFromIapProductId('')).toBeNull();
    });
  });
});
