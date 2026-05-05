# i18n Coverage

Sprint 28 B2 — global launch foundation.

Praeventio Guard ships a hierarchical fallback chain so that partial
translations never produce empty UI. The base locale is `es` (Spanish-CL,
1158 lines). Every other locale falls back through `es` and then `en`.

## Status by locale

| Locale  | Native name           | Status     | Lines | Coverage vs es | Notes                                       |
| ------- | --------------------- | ---------- | ----- | -------------- | ------------------------------------------- |
| `es`    | Español               | Base       | 1158  | 100%           | Source of truth. Every key MUST exist here. |
| `en`    | English               | Complete   | 1158  | ~100%          | Production-ready.                           |
| `pt-BR` | Português             | Complete   | 1158  | ~100%          | Production-ready.                           |
| `es-MX` | Español (México)      | Variant    | ~170  | ~14% explicit  | Rest cascades to `es`.                      |
| `es-AR` | Español (Argentina)   | Variant    | ~170  | ~14% explicit  | Rest cascades to `es`. Uses voseo.          |
| `es-PE` | Español (Perú)        | Variant    | ~170  | ~14% explicit  | Rest cascades to `es`.                      |
| `fr`    | Français              | Stub       | ~40   | ~3%            | Lazy-loaded. Falls back to `en`.            |
| `de`    | Deutsch               | Stub       | ~40   | ~3%            | Lazy-loaded. Falls back to `en`.            |
| `it`    | Italiano              | Stub       | ~40   | ~3%            | Lazy-loaded. Falls back to `en`.            |
| `ja`    | 日本語                | Stub       | ~40   | ~3%            | Lazy-loaded. Falls back to `en`.            |
| `zh-CN` | 中文                  | Stub       | ~40   | ~3%            | Lazy-loaded. Falls back to `en`.            |
| `ar`    | العربية               | Stub + RTL | ~40   | ~3%            | Lazy-loaded. RTL `<html dir="rtl">`.        |

## Fallback chain

```
es-MX → es → en
es-PE → es → en
es-AR → es → en
pt-BR → en → es
en    → es
fr    → en → es
de    → en → es
it    → en → es
ja    → en → es
zh-CN → en → es
ar    → en → es
```

Configured in `src/i18n/index.ts` via i18next's
[`fallbackLng`](https://www.i18next.com/principles/fallback) map.

## Lazy loading

Launch locales (`es`, `es-MX`, `es-PE`, `es-AR`, `pt-BR`, `en`) are
bundled statically at boot. Stub locales are imported on demand:

```ts
// src/i18n/index.ts
const lazyLoaders = {
  fr: () => import('./locales/fr/common.json'),
  de: () => import('./locales/de/common.json'),
  it: () => import('./locales/it/common.json'),
  ja: () => import('./locales/ja/common.json'),
  'zh-CN': () => import('./locales/zh-CN/common.json'),
  ar: () => import('./locales/ar/common.json'),
};
```

`LanguageProvider` calls `loadLocale(tag)` before `i18n.changeLanguage(tag)`
so the bundle is in the resource store when the first render runs.

## RTL

`src/i18n/rtl.ts` exposes `RTL_LOCALES` and `applyHtmlDir(tag)`. The
provider invokes `applyHtmlDir` on every locale change. Currently RTL:

- `ar` (Arabic) — shipped as a stub.
- `he`, `fa`, `ur` — listed in `RTL_LOCALES`; add a `locales/<tag>/`
  directory + supportedLngs entry to ship.

## How to add a new locale (target: <1h for a translator)

1. Create `src/i18n/locales/<tag>/common.json`. Start by copying
   `src/i18n/locales/en/common.json` and translating top-down.
2. Add the tag to `SUPPORTED_LOCALES` and `LOCALE_DISPLAY` in
   `src/contexts/LanguageProvider.tsx`.
3. If the tag is RTL, add it to `RTL_LOCALES` in `src/i18n/rtl.ts`.
4. Decide eager vs lazy:
   - **Eager** (top-priority launch market): import in
     `resources` at the top of `src/i18n/index.ts`.
   - **Lazy** (everything else): add an entry to `lazyLoaders`,
     `LAZY_LOCALES`, the `fallbackChains` map, and `supportedLngs`.
5. Run `npm run build` and confirm the chunk appears in `dist/assets/`
   with a name like `common-<tag>-<hash>.js`.
6. Add a row to the table above with the line count and coverage.

The fallback chain means a brand-new locale with only ~30 keys is shippable
from day one — every untranslated string falls through to `en` (or `es`)
automatically.

## Priority key sets for partial translations

When a translator has limited time, prioritise these top-level objects in
this order:

1. `emergency.*` — life-safety strings, must never fall back.
2. `medical.*` — disclaimer copy (regulatory requirement).
3. `auth.*` — login flow + session expired messages.
4. `common.*` — primary buttons (Save/Cancel/Delete/Confirm/Back).
5. `errors.*` — network/auth/permission/timeout messages.
6. `nav.*` — top-level navigation.
7. The rest (dashboard, audits, findings, ...) — comfortable fallback.
