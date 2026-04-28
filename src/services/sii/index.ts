// Praeventio Guard — SII module facade.
//
// Single import entry point for the rest of the app:
//
//   import { getSiiAdapter, calculateDteTotals } from '@/src/services/sii';
//
// `getSiiAdapter()` resolves the runtime PSE based on the `SII_PSE` env var.
// Falls back to `noopSiiAdapter` (a success-shaped fake) so dev/CI never
// crash on an unset env var. Production deploys MUST set `SII_PSE` to one
// of the supported PSE keys.
//
// SCAFFOLDING ONLY — every PSE except `noop` throws `SiiNotImplementedError`
// today. See SII_INTEGRATION.md for the runbook describing how Round 2
// will pick a PSE and replace the throwing stubs.

import { bsaleAdapter } from './bsaleAdapter';
import { libredteAdapter } from './libredteAdapter';
import { openfacturaAdapter } from './openfacturaAdapter';
import {
  calculateDteTotals,
  noopSiiAdapter,
  SiiAdapterError,
  SiiNotImplementedError,
} from './siiAdapter';
import { simpleApiAdapter } from './simpleApiAdapter';
import type { SiiAdapter } from './types';

/**
 * Recognised values for the `SII_PSE` env var. Anything else (including
 * unset / empty) falls back to the `noop` adapter so dev never crashes.
 */
export type SiiPseKey =
  | 'openfactura'
  | 'simpleapi'
  | 'bsale'
  | 'libredte'
  | 'noop';

const SII_PSE_KEYS: ReadonlySet<SiiPseKey> = new Set<SiiPseKey>([
  'openfactura',
  'simpleapi',
  'bsale',
  'libredte',
  'noop',
]);

/**
 * Resolve the active SII adapter from env. Pure dispatch — does not call
 * the PSE, so it is safe to import at module top level.
 */
export function getSiiAdapter(): SiiAdapter {
  const raw = (process.env.SII_PSE ?? 'noop').toLowerCase().trim();
  const key: SiiPseKey = SII_PSE_KEYS.has(raw as SiiPseKey)
    ? (raw as SiiPseKey)
    : 'noop';
  switch (key) {
    case 'openfactura':
      return openfacturaAdapter;
    case 'simpleapi':
      return simpleApiAdapter;
    case 'bsale':
      return bsaleAdapter;
    case 'libredte':
      return libredteAdapter;
    case 'noop':
    default:
      return noopSiiAdapter;
  }
}

// Re-export the public surface so callers don't have to reach into the
// individual files. Mirrors `src/services/billing/` and `pricing/` modules.
export {
  bsaleAdapter,
  calculateDteTotals,
  libredteAdapter,
  noopSiiAdapter,
  openfacturaAdapter,
  SiiAdapterError,
  SiiNotImplementedError,
  simpleApiAdapter,
};
export type { SiiAdapter } from './types';
export type {
  DteHeader,
  DteLineItem,
  DtePaymentInfo,
  DteRequest,
  DteResponse,
  DteTotals,
  DteType,
} from './types';
export {
  CHILE_IVA_RATE,
  PRAEVENTIO_EMISOR_GIRO_DEFAULT,
  PRAEVENTIO_EMISOR_RAZON_SOCIAL_DTE_DEFAULT,
  PRAEVENTIO_EMISOR_RUT_DTE,
} from './types';
