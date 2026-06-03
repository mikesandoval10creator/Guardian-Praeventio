# DEEP-EXI-25 — Lote #25 (I-I18N)

**Atestación:** 18/18 archivos de la categoría `I-I18N` leídos / analizados línea por
línea (config `src/i18n/*` + locales `src/i18n/locales/*`). Deriva: `ledger.json`
filtrado por `category==="I-I18N"`, ordenado por `path`, slice `[0:18]` (= todos).

Método: lectura completa de `index.ts`, `rtl.ts`, `es` y `en` (referencias, ~2.9k
líneas c/u); el resto verificado con análisis estructural (aplanado de claves,
paridad, parser de duplicados, escaneo de voseo / interpolación / TODO / formato
CLP·RUT). Conteos de claves aplanadas: `es`=2335, `en`=2335, `pt-BR`=2276,
`es-AR`/`es-MX`/`es-PE`=126 c/u (overrides parciales con fallback a `es`),
stubs (`ar de fr it ja ko hi`)=27-28, (`ru zh-CN zh-TW`)=46.

## Tabla de hallazgos

| # | Sev | Archivo(s) : línea | Hallazgo |
|---|-----|--------------------|----------|
| 1 | 🔴 | `es/common.json` (246, 249, 250, 875, 1383, 2427, 2433, 2462, 2509, 2571, 2604, 2637, 2648, 2651, 2673, 2677, 2694, 2756, 2816, 2847, 2879, 2938, 2940, 2943, 2953) | **Voseo es-AR filtrado en la referencia es-CL.** Imperativos `Reintentá`, `Seleccioná`, `registrá`, `Ingresá` (1297→`Ingresa` ok), `usá`, conjugaciones `activás`, y literal `(vos sos el worker)` (2433). Viola CLAUDE.md Regla #2 (es-CL = "tú", nunca "vos"). `es-MX` y `es-PE` están limpios; `es-AR` usa voseo correctamente. |
| 2 | 🔴 | `pt-BR/common.json` | **Paridad de claves rota (Regla #18).** Faltan 59 claves presentes en `es`: bloques completos `incident_report.*` (30), `lone_worker.*` (15), `oc.*` (14). Locale de lanzamiento → debe estar a paridad con `es`/`en`. `en` SÍ está a paridad exacta (2335=2335, 0 faltantes / 0 extra). |
| 3 | 🟡 | `es/common.json` (1997-2000) `landing.pricing.plans.*.price` | Precios `$0`, `$10/mes`, `$30/mes`, `Desde $50/mes` — aspecto USD/placeholder, NO formato CLP `$1.234` con punto de miles. Planes reales chilenos son miles de pesos. `es-MX/PE/AR` no sobrescriben → mismo valor en toda LATAM. |
| 4 | 🟡 | `es/common.json:2346` · `en/common.json:2358` `…todoNote` | Cadena con forma de TODO en copy de usuario: "…PDF formal pendiente Sprint K §177." / "…formal PDF pending Sprint K §177." Anti-stub-disfrazado adyacente (Regla #13) expuesto al usuario. |
| 5 | 🟡 | `es/common.json` (`lone_worker.platform_web` "Web / iOS (no-op)", `lone_worker_page.action.checkin_ok` "Check-in OK", `stoppages.history.audit_trail_link` "Audit Trail", `landing.problem.before_excel/email`) | Anglicismos / cadenas en inglés sin traducir dentro de la referencia es-CL. (61 valores es==en en total; la mayoría son cognados/marca legítimos — Total, Material, Email, Stock, Dashboard, Offline, Near-miss — pero estos puntuales son copy de UI.) |
| 6 | 🔵 | `*/common.json` `pricing.currency_clp` | Nombre de clave engañoso: `currency_clp` contiene `ARS/PEN/MXN/BRL/USD` según locale. Funciona, pero el nombre miente (en `en` la clave "clp" vale "USD"). Smell de nomenclatura. |
| 7 | 🔵 | stubs `ar de fr it ja ko hi zh-CN zh-TW ru` | Namespaces de claves divergentes del de referencia: usan `errors.network`, `errors.permission`, `medical.disclaimer`, `items.count`, `auth.forgot_password`, `nav.team`… que **no existen en `es`**. Son claves huérfanas (la UI real usa el namespace de `es`); estos stubs solo cubren una fracción. Fuera de scope de la Regla #18 por diseño (fallback en→es), pero indica que los stubs nunca resolverán contra la UI productiva. |
| 8 | 🔵 | `index.ts` (19-21) vs (117-136) | Doc drift menor: el comentario dice `pt-BR → pt → en` pero `fallbackChains['pt-BR']=['en','es']` (sin raíz `pt`). El resto de la cadena (`es-MX/PE/AR→es→en`, `en→es`, `zh-TW→zh-CN→en→es`, `default→es`) es coherente con el código. |

## Verificaciones limpias (sin hallazgos)

- **Interpolación:** 0 desajustes de tokens `{{...}}` entre `es` y `en` (2335 claves). ✅
- **Claves duplicadas:** 0 en los 16 archivos (parser `object_pairs_hook`). ✅
- **JSON válido:** 16/16 archivos parsean. ✅
- **Paridad LATAM:** `es-AR`/`es-MX`/`es-PE` idénticos en set de claves (126 c/u, diff vacío). ✅
- **Paridad `en` vs `es`:** exacta (0 faltantes, 0 extra). ✅
- **`en` paridad:** ✅ (solo `pt-BR` falla — hallazgo #2).
- **RUT:** placeholders correctos formato chileno `76.123.456-7` (1675), `RUT *` (718). ✅
- **`rtl.ts`:** lógica RTL correcta (subtag-match, idempotente, SSR-safe, `RTL_LOCALES=ar/he/fa/ur`). ✅
- **`index.ts` lazy-load / fallback:** `loadLocale` y `fallbackChains` correctos; `load:'currentOnly'`, `supportedLngs` completo, `escapeValue:false` (React escapa). ✅

## Resumen

Lote #25 (I-I18N), 18/18 archivos atestados. Dos hallazgos rojos: (1) **voseo
argentino filtrado en la referencia es-CL** en ~25 cadenas (`Reintentá`,
`Seleccioná`, `usá`, `vos sos el worker`) — viola la Regla #2 (es-CL = tú); y
(2) **`pt-BR` rompe la paridad de la Regla #18** con 59 claves faltantes
(`incident_report`, `lone_worker`, `oc` completos) — `en` sí está a paridad
exacta. Amarillos: precios landing con aspecto USD/placeholder (no CLP dot-grouped),
`todoNote` con forma de TODO en copy de usuario, y anglicismos puntuales sin
traducir. Azules: nombre de clave `currency_clp` engañoso, stubs con namespaces
huérfanos divergentes del de referencia, y un drift menor doc↔código en la cadena
de fallback de `pt-BR`. Verificaciones limpias: 0 desajustes de interpolación,
0 duplicados, 16/16 JSON válidos, paridad LATAM y `en`↔`es` perfecta, RUT/RTL/
lazy-load correctos. Doc-only, sin commit.
