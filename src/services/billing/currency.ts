// Praeventio Guard — LATAM currency formatting.
//
// Locale-aware money formatting for the seven currencies our billing
// surface supports today (Chile + ROW USD + 5 LATAM countries on
// MercadoPago). Implemented on top of `Intl.NumberFormat` so we get
// correct thousand/decimal separators per locale without hand-rolling.
//
// Design notes:
//   • Output always ends in the ISO 4217 code (" CLP", " USD", " PEN" …).
//     This is intentional redundancy — Chilean and Argentine pesos both
//     use "$" so the suffix disambiguates on screens that aggregate
//     multi-tenant invoices.
//   • CLP and COP have no minor units. PEN/ARS/MXN/BRL/USD do, but we
//     defer to Intl's per-locale default fraction digits (e.g. PEN→2,
//     MXN→2, BRL→2). USD is forced to 0 decimals to match the
//     pricing-tier ladder (whole dollars in `tiers.ts`).
//   • We deliberately throw on unknown currencies. Silently routing an
//     unsupported code through Intl with a guessed locale would mis-
//     bill customers — fail-closed at the boundary instead.

export type LatamCurrency =
  | 'CLP'
  | 'USD'
  | 'PEN'
  | 'ARS'
  | 'COP'
  | 'MXN'
  | 'BRL';

interface CurrencyConfig {
  /** BCP-47 locale tag passed to Intl.NumberFormat. */
  locale: string;
  /** Minimum/maximum fraction digits override; undefined = Intl default. */
  fractionDigits?: number;
}

/**
 * Per-currency Intl.NumberFormat configuration. Locales chosen to match
 * the country where each currency is the legal tender so the displayed
 * grouping/decimal punctuation matches the user's expectations.
 */
const CURRENCY_CONFIG: Record<LatamCurrency, CurrencyConfig> = {
  // Chilean peso — whole pesos, dot thousands.
  CLP: { locale: 'es-CL', fractionDigits: 0 },
  // US dollar — whole dollars (matches `tiers.usdRegular`).
  USD: { locale: 'en-US', fractionDigits: 0 },
  // Peruvian sol — soles & céntimos (2 decimals).
  PEN: { locale: 'es-PE', fractionDigits: 2 },
  // Argentine peso — dot thousands, comma decimals; Intl default
  // fractionDigits (2 in es-AR) is correct here.
  ARS: { locale: 'es-AR' },
  // Colombian peso — whole pesos.
  COP: { locale: 'es-CO', fractionDigits: 0 },
  // Mexican peso — pesos & centavos (2 decimals).
  MXN: { locale: 'es-MX', fractionDigits: 2 },
  // Brazilian real — reais & centavos (2 decimals).
  BRL: { locale: 'pt-BR', fractionDigits: 2 },
};

const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_CONFIG) as LatamCurrency[];

/**
 * Format an amount in the given LATAM currency.
 *
 * Returns `"<currency-glyph><number> <ISO code>"` — e.g. `"$11.990 CLP"`,
 * `"S/49,90 PEN"`, `"R$75,00 BRL"`.
 *
 * Throws if `currency` is not one of the supported codes. Negative
 * amounts pass through (used by the refund display path).
 */
export function formatCurrency(amount: number, currency: LatamCurrency): string {
  const config = CURRENCY_CONFIG[currency];
  if (!config) {
    throw new Error(
      `formatCurrency: unsupported currency "${currency}". Supported: ${SUPPORTED_CURRENCIES.join(', ')}.`,
    );
  }

  const formatter = new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency,
    // Intl's `currencyDisplay: 'symbol'` is the default; we keep the
    // symbol so screens with mixed CLP/ARS rows are visually distinct,
    // and append the ISO code ourselves for disambiguation.
    currencyDisplay: 'symbol',
    minimumFractionDigits: config.fractionDigits,
    maximumFractionDigits: config.fractionDigits,
  });

  const formatted = formatter.format(amount);
  return `${formatted} ${currency}`;
}

/** True iff the given string is a supported LATAM currency code. */
export function isLatamCurrency(value: unknown): value is LatamCurrency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as string[]).includes(value);
}

/**
 * MercadoPago `currency_id` values, keyed by ISO 4217 code. MP uses the
 * ISO code directly — see https://www.mercadopago.com.ar/developers/en/reference/preferences/_checkout_preferences/post.
 * Exported so the server endpoint can validate the (country, currency)
 * tuple before calling the adapter.
 */
export const MP_CURRENCY_BY_COUNTRY: Record<string, LatamCurrency> = {
  PE: 'PEN',
  AR: 'ARS',
  CO: 'COP',
  MX: 'MXN',
  BR: 'BRL',
};

/** Country codes routed through MercadoPago. */
export const MP_COUNTRY_CODES = Object.keys(MP_CURRENCY_BY_COUNTRY) as Array<
  keyof typeof MP_CURRENCY_BY_COUNTRY
>;
