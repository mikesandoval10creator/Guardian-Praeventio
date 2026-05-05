// Sprint 31 Bucket SS — Cultural conventions framework.
//
// Centraliza convenciones culturales que difieren entre locales y que
// no se reducen a traducción de strings: orden de fecha, orden de
// nombre familia/nombre, honoríficos y estándares de pictogramas de
// seguridad.
//
// Filosofía: cada locale declara explícitamente sus convenciones en
// vez de heredar las del idioma globalmente. Por ejemplo, `ja` y
// `zh-CN` comparten orden family-first pero usan honoríficos distintos
// (さん vs 先生/女士). El módulo nunca asume — siempre consulta el
// mapping.

import type { JurisdictionCode } from '../regulatory/types.js';

/** Formato de fecha según locale. Strings token-style estilo dayjs. */
export type DateFormatPattern =
  | 'DD/MM/YYYY' // ES, FR, IT, AR, RU, BR, AU, IN
  | 'MM/DD/YYYY' // EN-US, US-OSHA
  | 'YYYY-MM-DD' // ISO 8601 baseline (default cuando no hay convención)
  | 'YYYY年MM月DD日' // ZH-CN, ZH-TW, JA
  | 'DD.MM.YYYY'; // DE, RU también acepta esta variante

const DATE_FORMAT_BY_LOCALE: Record<string, DateFormatPattern> = {
  es: 'DD/MM/YYYY',
  'es-MX': 'DD/MM/YYYY',
  'es-PE': 'DD/MM/YYYY',
  'es-AR': 'DD/MM/YYYY',
  'pt-BR': 'DD/MM/YYYY',
  en: 'MM/DD/YYYY',
  'en-US': 'MM/DD/YYYY',
  'en-GB': 'DD/MM/YYYY',
  fr: 'DD/MM/YYYY',
  it: 'DD/MM/YYYY',
  de: 'DD.MM.YYYY',
  ru: 'DD.MM.YYYY',
  ar: 'DD/MM/YYYY',
  hi: 'DD/MM/YYYY',
  ja: 'YYYY年MM月DD日',
  ko: 'YYYY-MM-DD',
  'zh-CN': 'YYYY年MM月DD日',
  'zh-TW': 'YYYY年MM月DD日',
};

/**
 * Devuelve el patrón de fecha preferido para un locale. Cae a
 * `YYYY-MM-DD` (ISO 8601) cuando el locale no está mapeado.
 */
export function getDateFormat(locale: string): DateFormatPattern {
  return DATE_FORMAT_BY_LOCALE[locale] ?? 'YYYY-MM-DD';
}

/**
 * Orden del nombre humano. `family-first` significa apellido primero
 * (China, Japón, Corea, Hungría); `given-first` es el orden occidental
 * mayoritario.
 */
export type NameOrder = 'family-first' | 'given-first';

const NAME_ORDER_BY_LOCALE: Record<string, NameOrder> = {
  ja: 'family-first',
  ko: 'family-first',
  'zh-CN': 'family-first',
  'zh-TW': 'family-first',
  hu: 'family-first',
};

/**
 * Devuelve el orden de nombre habitual para un locale. Default
 * `given-first` para locales no mapeados (convención occidental).
 */
export function getNameOrder(locale: string): NameOrder {
  return NAME_ORDER_BY_LOCALE[locale] ?? 'given-first';
}

/**
 * Honorífico por defecto para el locale. `null` para locales donde no
 * existe convención formal universal (occidente moderno).
 *
 * Nota: solamente cubrimos honoríficos genéricos formales. Nunca
 * inferimos honoríficos religiosos, profesionales (Dr., Prof.) o de
 * rango — la app no debe asumirlos por nombre.
 */
export type Gender = 'female' | 'male' | 'unspecified';

const HONORIFIC_BY_LOCALE: Record<string, Partial<Record<Gender, string>>> = {
  'zh-CN': { male: '先生', female: '女士', unspecified: '先生/女士' },
  'zh-TW': { male: '先生', female: '女士', unspecified: '先生/女士' },
  ja: { male: 'さん', female: 'さん', unspecified: 'さん' },
  ko: { male: '님', female: '님', unspecified: '님' },
  ru: { male: 'господин', female: 'госпожа', unspecified: 'господин/госпожа' },
};

export function getHonorific(locale: string, gender: Gender = 'unspecified'): string | null {
  const entry = HONORIFIC_BY_LOCALE[locale];
  if (!entry) return null;
  return entry[gender] ?? entry.unspecified ?? null;
}

export interface PersonName {
  given: string;
  family: string;
}

/**
 * Formatea un nombre completo según la convención del locale.
 * - `family-first`: "Wang Wei" / "山田 太郎" / "김 민준"
 * - `given-first`: "Daho Sandoval"
 *
 * El honorífico se anexa al final cuando existe convención y se pasa
 * `gender` (en zh-CN/ja/ko/ru). Nunca se anexa para locales occidentales.
 */
export function formatPersonName(
  name: PersonName,
  locale: string,
  options: { gender?: Gender; withHonorific?: boolean } = {},
): string {
  const order = getNameOrder(locale);
  const base = order === 'family-first'
    ? `${name.family} ${name.given}`
    : `${name.given} ${name.family}`;
  if (!options.withHonorific) return base;
  const honor = getHonorific(locale, options.gender ?? 'unspecified');
  return honor ? `${base} ${honor}` : base;
}

/**
 * Estándar de pictogramas de seguridad por jurisdicción regulatoria.
 *
 *  - ISO 7010: estándar internacional (default fuera de US y CN).
 *  - ANSI Z535: US-OSHA usa esta familia (colores y formas distintas).
 *  - GB 2893 / GB 2894: estándar nacional chino, derivado pero
 *    no idéntico a ISO 7010.
 *
 * Las apps en jurisdicciones GB-2893 deben renderizar pictogramas
 * compatibles con la norma local; ISO 7010 puede coexistir como
 * etiqueta secundaria pero no sustituye la primaria.
 */
export type PictogramStandard = 'ISO-7010' | 'ANSI-Z535' | 'GB-2893';

const PICTOGRAM_STANDARD_BY_JURISDICTION: Partial<Record<JurisdictionCode, PictogramStandard>> = {
  'US-OSHA': 'ANSI-Z535',
  CN: 'GB-2893',
  // Resto cae en ISO 7010 vía default.
};

export function getPictogramStandard(jurisdiction: JurisdictionCode): PictogramStandard {
  return PICTOGRAM_STANDARD_BY_JURISDICTION[jurisdiction] ?? 'ISO-7010';
}
