import { describe, expect, it } from 'vitest';

import {
  isSubscriptionPlan,
  normalizeSubscriptionPlanId,
  subscriptionPlanForPaidTier,
  cycleFromInvoiceDoc,
  cycleFromProductId,
  resolveInvoiceCycle,
  DEFAULT_SUBSCRIPTION_CYCLE,
  planFromIapProductId,
  planWorkerCap,
  planProjectCap,
  recommendPlanForFaena,
} from './subscriptionPlan';
import { iapSkuForTier } from './iapSkus';
import { getTierById } from './tiers';

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

  describe('resolveInvoiceCycle (cycle + source for warn-on-default)', () => {
    it('source="field" when the structured top-level cycle is present', () => {
      expect(resolveInvoiceCycle({ cycle: 'annual' })).toEqual({ cycle: 'annual', source: 'field' });
      expect(resolveInvoiceCycle({ cycle: 'monthly' })).toEqual({ cycle: 'monthly', source: 'field' });
    });

    it('source="description" when only the legacy line-item description carries it', () => {
      expect(
        resolveInvoiceCycle({ lineItems: [{ description: 'Suscripción oro (annual)' }] }),
      ).toEqual({ cycle: 'annual', source: 'description' });
      expect(
        resolveInvoiceCycle({ lineItems: [{ description: 'Suscripción oro (monthly)' }] }),
      ).toEqual({ cycle: 'monthly', source: 'description' });
    });

    it('source="default" when the cycle is NOT derivable from a real doc (the warn case)', () => {
      expect(resolveInvoiceCycle({})).toEqual({ cycle: 'monthly', source: 'default' });
      expect(resolveInvoiceCycle({ cycle: 'weekly' })).toEqual({ cycle: 'monthly', source: 'default' });
      expect(resolveInvoiceCycle({ lineItems: [{ description: 'no cycle token' }] })).toEqual({
        cycle: 'monthly',
        source: 'default',
      });
    });

    it('source="default" for a null/undefined doc (a "no doc", not a data gap)', () => {
      expect(resolveInvoiceCycle(null)).toEqual({ cycle: 'monthly', source: 'default' });
      expect(resolveInvoiceCycle(undefined)).toEqual({ cycle: 'monthly', source: 'default' });
    });

    it('cycleFromInvoiceDoc stays in lock-step with resolveInvoiceCycle().cycle', () => {
      for (const doc of [{ cycle: 'annual' }, { lineItems: [{ description: 'x (monthly)' }] }, {}, null]) {
        expect(cycleFromInvoiceDoc(doc)).toBe(resolveInvoiceCycle(doc).cycle);
      }
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

describe('per-plan scale caps (derived from tiers.ts — single source of truth)', () => {
  it('worker cap per faena mirrors tiers.ts trabajadoresMax (cobre = 24, not the stale 72)', () => {
    expect(planWorkerCap('free')).toBe(getTierById('gratis').trabajadoresMax); // 3
    expect(planWorkerCap('cobre')).toBe(24);
    expect(planWorkerCap('plata')).toBe(getTierById('plata').trabajadoresMax); // 99
    expect(planWorkerCap('diamante')).toBe(Infinity);
  });

  it('project cap mirrors tiers.ts proyectosMax (diamante = 50, a real limit)', () => {
    expect(planProjectCap('free')).toBe(1);
    expect(planProjectCap('cobre')).toBe(3);
    expect(planProjectCap('diamante')).toBe(50);
  });

  it('recommends the smallest plan whose per-faena cap covers the headcount', () => {
    // A faena that crosses the CPHS threshold (25) can no longer run on Cobre
    // (cap 24); the next plan up is Plata, which unlocks the Comité Paritario band.
    expect(recommendPlanForFaena(0)).toBe('free');
    expect(recommendPlanForFaena(3)).toBe('free');
    expect(recommendPlanForFaena(24)).toBe('cobre');
    expect(recommendPlanForFaena(25)).toBe('plata');
    // Above every finite cap still resolves (Diamante is unlimited on workers).
    expect(recommendPlanForFaena(100_000)).toBe('diamante');
  });
});
