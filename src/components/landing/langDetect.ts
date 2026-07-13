/**
 * Landing geodetection — privacy-first language pick for the PUBLIC landing.
 *
 * No permission prompts, no external IP-geolocation API: the IANA timezone
 * (already exposed by the browser) maps country → most-spoken language, with
 * `navigator.languages` as fallback when the timezone is unknown. Chile → es,
 * Brasil → pt-BR, EEUU → en, resto → the locale most spoken in that country
 * that we actually ship (see src/i18n/index.ts fallback chains).
 *
 * Pure function → unit-tested in langDetect.test.ts. The impure wrapper
 * (applied once per browser via a localStorage flag) lives in
 * LandingPage.tsx so the manual selector always wins afterwards.
 */

/** Locales the product ships (eager + lazy) — keep aligned with src/i18n/index.ts. */
export const LANDING_SUPPORTED_LOCALES = [
  'es',
  'es-MX',
  'es-PE',
  'es-AR',
  'pt-BR',
  'en',
  'fr',
  'de',
  'it',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW',
  'hi',
  'ar',
  'ru',
] as const;

export type LandingLocale = (typeof LANDING_SUPPORTED_LOCALES)[number];

/** One-shot flag so geodetection never overrides a manual choice. */
export const LANDING_GEO_FLAG_KEY = 'pv_landing_geo_applied';

/**
 * localStorage key the i18next LanguageDetector caches to (see
 * src/i18n/index.ts `detection.lookupLocalStorage`). If it exists, the
 * visitor (or the app's LanguageProvider) already chose — geodetection
 * must stand down.
 */
export const APP_LOCALE_STORAGE_KEY = 'praeventio_locale';

/**
 * Timezone → locale rules, ordered by specificity. City names are IANA zone
 * fragments. A country's rule returns the language MOST SPOKEN there among
 * the locales we ship.
 */
const TZ_RULES: ReadonlyArray<readonly [RegExp, LandingLocale]> = [
  // Chile primero — la casa.
  [/Santiago|Punta_Arenas|Easter/, 'es'],
  // Brasil (all IANA Brazilian zones).
  [
    /Sao_Paulo|Bahia|Fortaleza|Recife|Manaus|Belem|Boa_Vista|Campo_Grande|Cuiaba|Maceio|Porto_Velho|Rio_Branco|Santarem|Araguaina|Eirunepe|Noronha/,
    'pt-BR',
  ],
  // Variantes regionales de español que ya despachamos.
  [/Argentina|Buenos_Aires|Cordoba|Mendoza|Ushuaia/, 'es-AR'],
  [/Mexico_City|Cancun|Chihuahua|Hermosillo|Matamoros|Mazatlan|Merida|Monterrey|Ojinaga|Tijuana|Bahia_Banderas/, 'es-MX'],
  [/Lima/, 'es-PE'],
  // Resto de Hispanoamérica + España → es base.
  [
    /Bogota|Caracas|Montevideo|La_Paz|Asuncion|Guayaquil|Panama|Costa_Rica|El_Salvador|Guatemala|Tegucigalpa|Managua|Santo_Domingo|Havana|San_Juan|Madrid|Canary|Ceuta/,
    'es',
  ],
  // Norteamérica anglófona + UK/IE/AU/NZ.
  [
    /New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Adak|Honolulu|Detroit|Boise|Juneau|Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|London|Dublin|Sydney|Melbourne|Brisbane|Perth|Auckland/,
    'en',
  ],
  // Portugal → pt-BR (el portugués que despachamos).
  [/Lisbon|Madeira|Azores/, 'pt-BR'],
  // Europa occidental.
  [/Paris|Brussels|Geneva|Zurich|Monaco|Luxembourg/, 'fr'],
  [/Berlin|Vienna|Busingen/, 'de'],
  [/Rome|Malta|San_Marino|Vatican/, 'it'],
  // Asia.
  [/Tokyo/, 'ja'],
  [/Seoul/, 'ko'],
  [/Taipei/, 'zh-TW'],
  [/Shanghai|Chongqing|Urumqi|Macau/, 'zh-CN'],
  [/Kolkata|Calcutta/, 'hi'],
  // Mundo árabe (zonas donde el árabe es el idioma más hablado).
  [/Riyadh|Dubai|Kuwait|Qatar|Bahrain|Muscat|Baghdad|Amman|Damascus|Beirut|Cairo|Khartoum|Tripoli|Algiers|Tunis|Casablanca|Aden/, 'ar'],
  // Rusia.
  [
    /Moscow|Volgograd|Yekaterinburg|Novosibirsk|Vladivostok|Kaliningrad|Samara|Omsk|Krasnoyarsk|Irkutsk|Yakutsk|Magadan|Kamchatka|Saratov|Ulyanovsk|Kirov|Astrakhan|Barnaul|Chita|Tomsk|Anadyr|Srednekolymsk|Novokuznetsk|Khandyga|Ust-Nera|Sakhalin/,
    'ru',
  ],
];

/** navigator.language prefix → shipped locale. */
const NAV_PREFIX_RULES: ReadonlyArray<readonly [RegExp, LandingLocale]> = [
  [/^es-AR/i, 'es-AR'],
  [/^es-MX/i, 'es-MX'],
  [/^es-PE/i, 'es-PE'],
  [/^es/i, 'es'],
  [/^pt/i, 'pt-BR'],
  [/^en/i, 'en'],
  [/^fr/i, 'fr'],
  [/^de/i, 'de'],
  [/^it/i, 'it'],
  [/^ja/i, 'ja'],
  [/^ko/i, 'ko'],
  [/^zh-TW|^zh-Hant/i, 'zh-TW'],
  [/^zh/i, 'zh-CN'],
  [/^hi/i, 'hi'],
  [/^ar/i, 'ar'],
  [/^ru/i, 'ru'],
];

/**
 * Pure resolver: timezone rules first (country wins over browser language,
 * per spec: a visitor standing in Chile reads Spanish), then browser
 * languages, then English as the global default.
 */
export function detectLandingLocale(
  timeZone: string | undefined,
  navLanguages: readonly string[],
): LandingLocale {
  const tz = timeZone ?? '';
  for (const [pattern, locale] of TZ_RULES) {
    if (pattern.test(tz)) return locale;
  }
  for (const lang of navLanguages) {
    for (const [pattern, locale] of NAV_PREFIX_RULES) {
      if (pattern.test(lang)) return locale;
    }
  }
  return 'en';
}
