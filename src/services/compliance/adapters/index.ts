// Praeventio Guard — Bloque 7 frontend orquestador: registro de adapters.
//
// Re-export centralizado de los 7 adapters jurisdiccionales por ADR-0017.
// El consumidor (frontend/UI/Coach IA) usa `getJurisdictionMeta(country)`
// para conocer regulator + framework + deadlines del país seleccionado,
// y `getAdapterFor(country)` para acceder a generators concretos.
//
// Status implementación (2026-05-20):
//   - CL: ✅ COMPLETO (Sprint 28-38, DTE + DS67 + DS76 + SUSESO + Aptitude)
//   - UK: 🟡 ESQUELETO (Bloque 7 frontend HOY, generators pendientes)
//   - CA: 🟡 ESQUELETO
//   - AU: 🟡 ESQUELETO
//   - JP: 🟡 ESQUELETO
//   - KR: 🟡 ESQUELETO
//   - IN: 🟡 ESQUELETO
//
// Cuando una jurisdicción esqueleto sea elegida y caller invoque
// generators, `JurisdictionNotSupportedError` se lanza con mensaje
// indicando "pendiente Sprint X" — la UI puede:
//   1. Mostrar tarjeta "Próximamente — Plan Enterprise Global incluirá X"
//   2. Caer a flujo manual (export JSON) hasta implementación
//   3. Sugerir contactar contacto@praeventio.net

import { UK_JURISDICTION_META } from './uk/index.js';
import { CA_JURISDICTION_META } from './ca/index.js';
import { AU_JURISDICTION_META } from './au/index.js';
import { JP_JURISDICTION_META } from './jp/index.js';
import { KR_JURISDICTION_META } from './kr/index.js';
import { IN_JURISDICTION_META } from './in/index.js';

export type SupportedCountry = 'CL' | 'UK' | 'CA' | 'AU' | 'JP' | 'KR' | 'IN';

/**
 * Status de implementación del adapter por país.
 *
 * - `full`: generators completos, listo para producción.
 * - `scaffold`: metadata real + generators que lanzan JurisdictionNotSupportedError.
 *   La UI debe ramificar (mostrar "Próximamente" o caer a flujo manual JSON).
 */
export type AdapterStatus = 'full' | 'scaffold';

export const ADAPTER_STATUS: Record<SupportedCountry, AdapterStatus> = {
  CL: 'full',
  UK: 'scaffold',
  CA: 'scaffold',
  AU: 'scaffold',
  JP: 'scaffold',
  KR: 'scaffold',
  IN: 'scaffold',
} as const;

const CL_META = {
  country: 'CL' as const,
  regulator: 'SUSESO + Mutualidades + SII',
  language: 'es-CL',
  currency: 'CLP',
  reportingFramework: 'DS44-2024 + Ley-16744 + DS-109 + DTE',
  references: {
    SUSESO: 'https://www.suseso.cl/',
    DS44: 'https://www.bcn.cl/leychile/navegar?idNorma=1199063',
    Ley16744: 'https://www.bcn.cl/leychile/navegar?idNorma=28650',
    DS109: 'https://www.bcn.cl/leychile/navegar?idNorma=187632',
  },
  reportingDeadlines: {
    fatalInjury: 'PT24H',
    seriousInjury: 'PT24H',
    minorInjury: 'P5D',
    occupationalDisease: 'P5D',
  },
} as const;

export const JURISDICTION_META_BY_COUNTRY = {
  CL: CL_META,
  UK: UK_JURISDICTION_META,
  CA: CA_JURISDICTION_META,
  AU: AU_JURISDICTION_META,
  JP: JP_JURISDICTION_META,
  KR: KR_JURISDICTION_META,
  IN: IN_JURISDICTION_META,
} as const;

/**
 * Devuelve metadata jurisdiccional para el país especificado. Útil para
 * que la UI muestre regulator + deadlines + URLs oficiales sin tener
 * que importar adapters específicos.
 */
export function getJurisdictionMeta<T extends SupportedCountry>(
  country: T,
): typeof JURISDICTION_META_BY_COUNTRY[T] {
  return JURISDICTION_META_BY_COUNTRY[country];
}

/**
 * ¿Adapter listo para producción para este país?
 */
export function isAdapterFullyImplemented(country: SupportedCountry): boolean {
  return ADAPTER_STATUS[country] === 'full';
}

/**
 * Lista de países con implementación completa (filtrable para UI:
 * "Países disponibles ahora" vs "Próximamente").
 */
export function getFullyImplementedCountries(): SupportedCountry[] {
  return (Object.keys(ADAPTER_STATUS) as SupportedCountry[]).filter(
    (c) => ADAPTER_STATUS[c] === 'full',
  );
}

export function getScaffoldedCountries(): SupportedCountry[] {
  return (Object.keys(ADAPTER_STATUS) as SupportedCountry[]).filter(
    (c) => ADAPTER_STATUS[c] === 'scaffold',
  );
}

// Re-export de adapters individuales para uso directo cuando el caller
// sabe el país al compile time.
export * as cl from './cl/index.js';
export * as uk from './uk/index.js';
export * as ca from './ca/index.js';
export * as au from './au/index.js';
export * as jp from './jp/index.js';
export * as kr from './kr/index.js';
export * as in_ from './in/index.js';

export { AdapterNotImplementedError } from './jurisdictionErrors.js';
