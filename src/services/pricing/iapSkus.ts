// Praeventio Guard — §2.13 fix (2026-05-22).
//
// Mapping de tier.id → IAP SKU (productId) por plataforma + ciclo.
//
// Pre-2026-05-22: `Pricing.tsx:995` hardcodeaba `praeventio_premium_monthly`
// para TODAS las tiers (gratis exceptuado). Resultado:
//   - Google Play / App Store cobraba el MISMO precio independiente del
//     tier seleccionado en la UI.
//   - El revenue tracking no podía discriminar por plan.
//   - El webhook RTDN/Apple Subscription Notification recibía el mismo
//     productId, perdiendo el contexto del plan vendido.
//
// Fix §2.13 (directiva usuario 2026-05-21): mapear cada tier a su propio
// SKU. Los SKUs se configuran en Play Console + App Store Connect cuando
// el usuario obtenga las cuentas de developer (bloqueador externo §5
// TODO.md). Mientras tanto el código tiene los nombres canónicos.
//
// Convención SKU (alineada con `googlePlayValidator` + `appleSsn`):
//   praeventio_<tier-slug>_<cycle>
//
// donde:
//   <tier-slug> es el `tier.id` minúscula + `-` reemplazado por `_`
//   <cycle> es 'monthly' o 'annual'
//
// Gratuito no tiene SKU (no se compra). Si el caller pide 'gratis', tiramos.
//
// Banking-grade: el productId del receipt se compara contra este map en
// el server-side validator (`googlePlayValidator.ts`, `appleSsn.ts`) para
// rechazar receipts donde el user pretende un tier diferente al pagado.

import type { TierId } from './tiers';

/**
 * Ciclo de facturación. Apple/Google Play soportan monthly + yearly como
 * autorenewable subscriptions. La UI puede en el futuro agregar
 * `weekly`, `quarterly`, etc.; por ahora monthly + annual cubren todo
 * el catálogo Praeventio.
 */
export type BillingCycle = 'monthly' | 'annual';

/**
 * Plataforma IAP. Cada una tiene su propio SKU namespace en su consola
 * (Play Console para Android, App Store Connect para iOS) pero usamos
 * el mismo string en ambas para evitar duplicar la tabla.
 */
export type IapPlatform = 'google-play' | 'app-store';

/**
 * Devuelve el SKU para un tier+cycle dado. Tira si el tier es 'gratis'
 * (no se compra) o si el cycle no es válido.
 *
 * @example
 *   iapSkuForTier('comite-paritario', 'monthly')
 *     // => 'praeventio_comite_paritario_monthly'
 *   iapSkuForTier('empresarial', 'annual')
 *     // => 'praeventio_empresarial_annual'
 */
export function iapSkuForTier(
  tierId: TierId,
  cycle: BillingCycle,
): string {
  if (tierId === 'gratis') {
    throw new Error(
      'iapSkuForTier: tier "gratis" no tiene SKU (no se compra). ' +
        'El caller debe filtrar antes (UI gate o checkout button disabled).',
    );
  }
  if (cycle !== 'monthly' && cycle !== 'annual') {
    throw new Error(`iapSkuForTier: cycle inválido "${cycle}" (esperado 'monthly' | 'annual')`);
  }
  // Convención: tier.id → slug normalizado (lowercase, no hyphens → underscores).
  const slug = tierId.toLowerCase().replace(/-/g, '_');
  return `praeventio_${slug}_${cycle}`;
}

/**
 * Tabla canónica de SKUs por tier+cycle. Útil para:
 *   - Reverse lookup desde receipt productId → tierId (server validators).
 *   - Documentación / configuración manual en Play Console / App Store Connect.
 *
 * @example
 *   ALL_IAP_SKUS
 *     // => {
 *     //   'praeventio_comite_paritario_monthly': { tierId: 'comite-paritario', cycle: 'monthly' },
 *     //   'praeventio_comite_paritario_annual': { tierId: 'comite-paritario', cycle: 'annual' },
 *     //   ...
 *     // }
 */
export interface IapSkuEntry {
  tierId: TierId;
  cycle: BillingCycle;
}

const PAID_TIER_IDS: readonly TierId[] = [
  'comite-paritario',
  'departamento-prevencion',
  'plata',
  'oro',
  'titanio',
  'diamante',
  'empresarial',
  'corporativo',
  'ilimitado',
  'global-titanio',
];

export const ALL_IAP_SKUS: Readonly<Record<string, IapSkuEntry>> = (() => {
  const map: Record<string, IapSkuEntry> = {};
  for (const tierId of PAID_TIER_IDS) {
    for (const cycle of ['monthly', 'annual'] as const) {
      const sku = iapSkuForTier(tierId, cycle);
      map[sku] = { tierId, cycle };
    }
  }
  return Object.freeze(map);
})();

/**
 * Reverse lookup: dado un `productId` de un receipt, devuelve el
 * tierId+cycle al que corresponde. Si el productId no matchea ningún
 * SKU conocido, retorna `null` — el server validator debe rechazar
 * el receipt en ese caso (no es un producto nuestro).
 *
 * @example
 *   tierForIapSku('praeventio_oro_monthly')
 *     // => { tierId: 'oro', cycle: 'monthly' }
 *   tierForIapSku('praeventio_unknown_xyz')
 *     // => null
 */
export function tierForIapSku(productId: string): IapSkuEntry | null {
  return ALL_IAP_SKUS[productId] ?? null;
}

/**
 * Verifica que un productId del receipt corresponda al tierId que la UI
 * pidió comprar. Usado por server-side validators (Play Console webhook
 * + Apple Subscription Notification handler) para detectar manipulación.
 *
 * @example
 *   assertSkuMatchesTier('praeventio_oro_monthly', 'oro')  // OK
 *   assertSkuMatchesTier('praeventio_plata_monthly', 'oro') // throws
 */
export function assertSkuMatchesTier(
  productId: string,
  expectedTierId: TierId,
): void {
  const entry = tierForIapSku(productId);
  if (!entry) {
    throw new Error(
      `assertSkuMatchesTier: productId "${productId}" no es un SKU conocido de Praeventio.`,
    );
  }
  if (entry.tierId !== expectedTierId) {
    throw new Error(
      `assertSkuMatchesTier: productId "${productId}" corresponde a tier "${entry.tierId}", ` +
        `pero el cliente pidió tier "${expectedTierId}". Posible manipulación del receipt.`,
    );
  }
}
