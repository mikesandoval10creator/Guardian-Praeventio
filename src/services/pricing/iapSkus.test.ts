// §2.13 IAP SKU mapping tests.

import { describe, it, expect } from 'vitest';
import {
  iapSkuForTier,
  tierForIapSku,
  assertSkuMatchesTier,
  ALL_IAP_SKUS,
} from './iapSkus';

describe('iapSkuForTier', () => {
  it('mapea tier+monthly al SKU canónico', () => {
    expect(iapSkuForTier('comite-paritario', 'monthly')).toBe(
      'praeventio_comite_paritario_monthly',
    );
    expect(iapSkuForTier('oro', 'monthly')).toBe('praeventio_oro_monthly');
    expect(iapSkuForTier('empresarial', 'monthly')).toBe('praeventio_empresarial_monthly');
  });

  it('mapea tier+annual al SKU canónico', () => {
    expect(iapSkuForTier('plata', 'annual')).toBe('praeventio_plata_annual');
    expect(iapSkuForTier('diamante', 'annual')).toBe('praeventio_diamante_annual');
  });

  it('tira si tier es gratis (no se compra)', () => {
    expect(() => iapSkuForTier('gratis', 'monthly')).toThrow(/no tiene SKU/);
  });

  it('tira si cycle es inválido', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => iapSkuForTier('oro', 'weekly')).toThrow(/cycle inválido/);
  });

  it('normaliza tier ids con hyphens (departamento-prevencion)', () => {
    expect(iapSkuForTier('departamento-prevencion', 'monthly')).toBe(
      'praeventio_departamento_prevencion_monthly',
    );
    expect(iapSkuForTier('global-titanio', 'annual')).toBe(
      'praeventio_global_titanio_annual',
    );
  });
});

describe('ALL_IAP_SKUS', () => {
  it('incluye 10 paid tiers × 2 cycles = 20 SKUs total', () => {
    expect(Object.keys(ALL_IAP_SKUS).length).toBe(20);
  });

  it('NO incluye gratis (no es paid)', () => {
    const allSkus = Object.keys(ALL_IAP_SKUS);
    const gratisSkus = allSkus.filter((s) => s.includes('gratis'));
    expect(gratisSkus.length).toBe(0);
  });

  it('cada SKU tiene tierId + cycle válidos', () => {
    for (const [sku, entry] of Object.entries(ALL_IAP_SKUS)) {
      expect(sku).toMatch(/^praeventio_[a-z_]+_(monthly|annual)$/);
      expect(['monthly', 'annual']).toContain(entry.cycle);
      expect(entry.tierId).not.toBe('gratis');
    }
  });

  it('está frozen (immutable)', () => {
    expect(Object.isFrozen(ALL_IAP_SKUS)).toBe(true);
  });
});

describe('tierForIapSku (reverse lookup)', () => {
  it('resuelve un SKU conocido a tier+cycle', () => {
    expect(tierForIapSku('praeventio_oro_monthly')).toEqual({
      tierId: 'oro',
      cycle: 'monthly',
    });
    expect(tierForIapSku('praeventio_empresarial_annual')).toEqual({
      tierId: 'empresarial',
      cycle: 'annual',
    });
  });

  it('retorna null para SKU desconocido', () => {
    expect(tierForIapSku('praeventio_premium_monthly')).toBeNull(); // SKU legacy descartado
    expect(tierForIapSku('com.competitor.subscription')).toBeNull();
    expect(tierForIapSku('')).toBeNull();
  });
});

describe('assertSkuMatchesTier (anti-fraud)', () => {
  it('OK cuando productId matchea expectedTier', () => {
    expect(() =>
      assertSkuMatchesTier('praeventio_oro_monthly', 'oro'),
    ).not.toThrow();
    expect(() =>
      assertSkuMatchesTier('praeventio_ilimitado_annual', 'ilimitado'),
    ).not.toThrow();
  });

  it('tira si productId corresponde a OTRO tier (manipulación)', () => {
    expect(() =>
      assertSkuMatchesTier('praeventio_plata_monthly', 'oro'),
    ).toThrow(/posible manipulación|manipulacion/i);
  });

  it('tira si productId no es un SKU conocido', () => {
    expect(() =>
      assertSkuMatchesTier('com.competitor.sub', 'oro'),
    ).toThrow(/no es un SKU conocido/);
  });
});

describe('§2.13 — el SKU legacy descartado NO está en el map', () => {
  it('praeventio_premium_monthly (pre-fix global SKU) no debe resolver', () => {
    expect(tierForIapSku('praeventio_premium_monthly')).toBeNull();
    expect(ALL_IAP_SKUS['praeventio_premium_monthly']).toBeUndefined();
  });
});
