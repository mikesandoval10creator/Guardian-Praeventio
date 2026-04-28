# Impacto — Round 13 (polish + observability real)

## TL;DR

La ronda cierra cinco frentes acotados (hooks defensivos, ARIA del modal de actividad predicha, deep-link de RiskNetwork, NIT de Pricing + hardening de geocoding, y observabilidad real con Sentry SDK + histograma Webpay) sin agregar deuda nueva. El proyecto pasa de 542 a 585 tests verdes, gana emisión real de telemetría en `/billing/webpay/return` y deja a SLO #2 efectivamente medible una vez se aplique Terraform. La barra de calidad se sostiene: `tsc -b` exit 0, `vitest run` 585 passed, build PWA con 209 entradas precache y bundle main 257 KB gzip dentro de presupuesto.

## Cambios por área

### Hardening de hooks

- `src/hooks/useInvoicePolling.ts:120` introduce `tokenGraceUsed` como bandera one-shot: el primer `getToken() → null` durante el poll se interpreta como Firebase Auth aún hidratando, se reagenda con backoff y recién la segunda observación nula emite `error: 'sin sesión'`. Antes una hidratación lenta hacía caer al usuario inmediatamente al estado de error tras volver de Webpay.
- `src/hooks/useInvoicePolling.ts:115-119` documenta que la gracia se llava al CONTEO de tokens nulos, no al número de intento — una sesión que expira a mitad del poll también recibe un reintento silencioso.
- `src/hooks/useInvoicePolling.ts:186-190` cubre los 4xx ajenos (no 401, no 404) emitiendo `error: 'respuesta inválida (NNN)'` en vez de seguir poleando indefinidamente sobre un 422.
- `src/hooks/useInvoicePolling.test.ts` suma 3 tests (test 11 sobre el 422, test 12 sobre la gracia happy-path, test 12b verificando que la gracia es de un solo uso); el test 6b se actualizó a `mockResolvedValue(null)` para reflejar el nuevo contrato.

### UX de pánico (modal accesible + sync conflicts puros)

- `src/components/projects/PredictedActivityModal.tsx:26-45` exporta `attachEscapeHandler(target, active, onEscape)` y lo conecta vía `useEffect`: presionar Escape ahora cierra el modal, requisito ARIA básico para usuarios de teclado y lectores de pantalla.
- `src/components/projects/PredictedActivityModal.test.tsx` (NUEVO, 5 tests) valida el contrato sobre el helper puro sin dependencia de jsdom.
- `src/components/shared/syncConflictRoutes.ts` (NUEVO, 60 LOC) extrae `routeForCollection(collection, docId)` con switch puro sobre las 7 colecciones conocidas (`iper_nodes`, `nodes`, `audits`, `workers`, `documents`, `projects`, `findings`) y `encodeURIComponent` interno del id.
- `src/components/shared/syncConflictRoutes.test.ts` (NUEVO, 10 tests) cubre las 7 colecciones más casos borde (colección desconocida, id con caracteres especiales).
- `src/components/layout/RootLayout.tsx` reemplaza el route map inline de 24 LOC por una llamada a `routeForCollection` — el layout deja de cargar la lógica de mapeo, el helper queda aislado y testeable.
- `src/components/shared/SyncConflictBanner.tsx` actualiza JSDoc para documentar el contrato `onOpenRecord` ahora que el wiring vive en `RootLayout`.

### Observabilidad real (Sentry SDK + server)

- `package.json` instala `@sentry/node@^10.50.0` y `@sentry/react@^10.50.0`; `package-lock.json` actualizado.
- `src/services/observability/sentryAdapter.ts` se reescribe completo (179 LOC) sobre el SDK real. `init()` degrada en silencio si no hay DSN (`console.warn` en vez de `logger` para no recursar la capa de observabilidad), `beforeSend` saca `authorization`/`cookie` headers antes de enviar a Sentry, y todos los métodos están envueltos en `try/catch` para no romper el request path.
- `src/services/observability/sentryAdapter.test.ts` (NUEVO, 10 tests) usa `vi.mock('@sentry/node')` para verificar init con/sin DSN, captureException, captureMessage, breadcrumbs, setUser y flush.
- `src/services/observability/observability.test.ts` reemplaza 2 aserciones que esperaban el throw del stub previo por smoke checks positivos.
- `server.ts` suma 91 LOC: `Sentry.init(...)` al boot, middleware terminal de errores con 4 argumentos para que Express delegue al handler Sentry, y la integración con el flujo Webpay (ver siguiente sección).
- `src/__smoke__/critical-paths.smoke.test.ts` sube su timeout de 5 s a 15 s para absorber el peso de import de `@sentry/node`.
- `OBSERVABILITY.md` agrega 89 LOC: la sección Round 2 queda marcada DONE y se documenta el histograma Webpay.

### Telemetría Webpay (histograma medible)

- `src/services/billing/webpayMetrics.ts` (NUEVO, 73 LOC) expone `recordWebpayReturnLatency({ outcome, latencyMs })`. Emite contra `praeventio/webpay/return_latency_ms` vía `getMetrics().histogram(...).observe(ms)` con label `outcome ∈ { 'success' | 'failure' | 'invalid' }` (cardinalidad 3, NUNCA per-userId/per-tokenWs). El cuerpo entero está en `try/catch` con degradación a `logger.warn` — el path de pago jamás puede romperse por telemetría.
- `src/services/billing/webpayMetrics.test.ts` (NUEVO, 6 tests) verifica las 3 outcomes, multi-observation, valores fraccionarios y la degradación cuando `getMetrics()` falla.
- `server.ts:2476`, `2505-2506`, `2514`, `2568-2569`, `2578` cablean los 5 puntos de salida del handler `/billing/webpay/return`: token inválido, dedupe (lock con outcome previo), commit success, commit con outcome explícito y catch terminal. El helper `histogramOutcomeFor(...)` (`server.ts:2495`) traduce los outcomes internos del Webpay adapter al label de baja cardinalidad.

### Hardening Terraform (alarma de datos ausentes)

- `infrastructure/terraform/monitoring.tf:415-...` agrega un segundo `google_monitoring_alert_policy` `webpay_return_latency_absent_data` con ventana 600 s, severidad p2 y `condition_absent` sobre el mismo histograma. Razón: la alerta p95 existente reporta "no data" silenciosamente cuando el pipeline cae; ahora cualquiera de las dos fallas (latencia alta O emisión muerta) produce señal.
- `infrastructure/terraform/monitoring.tf:179` corrige la descripción del label `outcome` del descriptor `webpay_return_latency` a `success | failure | invalid` (antes listaba incorrectamente `AUTHORIZED | REJECTED | FAILED`, mismatch detectado por el reviewer pre-commit).
- Los alert policies se mantienen como recursos separados (no dos `conditions {}` en una sola política) para poder silenciarlos independientemente durante mantenimientos.

### NITs cerrados

- `src/pages/Pricing.tsx:469` agrega `logger.warn('webpay_return_banner_unexpected_status', ...)` en la rama settled-pero-status-no-reconocido, cerrando el silencio observado por el reviewer.
- `src/services/normativa/locationNormativa.ts:226-247` endurece la URL de `countryFromCoordsAsync` con `encodeURIComponent(lat.toFixed(6))` y mismo trato para `lng`, evitando inyección de query y locales con coma decimal.
- `src/services/normativa/locationNormativa.test.ts` suma 1 test TDD que verifica la URL final (28 tests totales en el archivo).
- `src/pages/RiskNetwork.tsx:31-43` define `resolveSelectedNodeIdFromSearch(params, knownIds)` puro y exportado; `src/pages/RiskNetwork.tsx:62-80` lo conecta vía `useSearchParams` y expone el id en `data-selected-node-id`. Foundation lista; el wire-through como prop controlada al `KnowledgeGraph` queda pendiente para Round 14 (ver Pendientes).
- `src/pages/RiskNetwork.test.tsx` (NUEVO, 8 tests) cubre el helper puro: param ausente, vacío, con whitespace, no presente en el set, y los happy-paths.

## Métricas de calidad

- `npx tsc -b`: exit 0.
- `npx vitest run`: 39 archivos, 585 passed + 24 skipped (609 total). Baseline Round 12 estaba en 542 + 24 = 566.
- `npm run build`: succeeds, PWA 209 precache entries.
- Vendor chunks dentro de presupuesto (`.size-limit.json`): vendor-react, vendor-firebase, vendor-motion, vendor-gantt verdes; main bundle 257 KB gzip (cap 280); RiskNetwork lazy 201 KB gzip (cap 250).

## Round 13 vs Round 12

- Tests: 542 → 585 (+43). Desglose: +3 useInvoicePolling, +15 PredictedActivityModal/syncConflictRoutes, +8 RiskNetwork helper, +1 locationNormativa URL hardening, +6 webpayMetrics, +10 sentryAdapter — total 43 nuevos sobre la baseline. Math sanity: 542 + 3 + 15 + 8 + 1 + 16 (E5: 6 webpayMetrics + 10 sentry) = 585.
- Archivos: 7 nuevos (`syncConflictRoutes.ts` + `.test.ts`, `PredictedActivityModal.test.tsx`, `RiskNetwork.test.tsx`, `webpayMetrics.ts` + `.test.ts`, `sentryAdapter.test.ts`).
- LOC: ~+91 en `server.ts`, +89 en `OBSERVABILITY.md`, +179 en `sentryAdapter.ts` (rewrite), +73 en `webpayMetrics.ts`, +60 en `syncConflictRoutes.ts`, más helpers/tests asociados.
- Round 12 cerró 7 TODOs específicos (idempotency helper, GET invoice, polling real, vendor split, geocoding); Round 13 cierra 4 MEDIUMs del reviewer + 3 NITs + 2 iniciativas grandes (Sentry SDK real + histograma Webpay).

## Pendientes (Round 14 candidates)

1. `src/pages/RiskNetwork.tsx` — propagar `selectedNodeId` como prop controlada al componente `KnowledgeGraph` (HIGH-acceptable; foundation lista, wire-through pendiente porque `KnowledgeGraph` lo posee otro agente).
2. `src/main.tsx` — montar `Sentry.ErrorBoundary` con fallback UI Spanish-CL (diferido de Round 13 por requerir pasada de diseño copy).
3. `src/__smoke__/critical-paths.smoke.test.ts` — calibrar el timeout de 15 s contra cold-start real medido en Cloud Run, no estimado.
4. Instalar `jsdom` (devDependency) y restaurar el environment para los `.test.tsx` que actualmente operan vía helpers puros (`PredictedActivityModal.test.tsx`, `RiskNetwork.test.tsx`).
5. Pricing — añadir scaffolding de RTL (Testing Library) cuando jsdom esté disponible para cubrir el banner Webpay end-to-end, no sólo el hook.
6. ESM `.js` extension styling: imports como `from "./src/services/billing/webpayMetrics.js"` en `server.ts:33` — alinear con la convención del repo (resolver/no-resolver) en una pasada de consistencia.
7. Caching/throttling para Google Maps Geocoding (Round 12 dejó guidance en JSDoc, no implementación) antes de habilitar tenants masivos.

## Por qué importa

Hasta esta ronda, la cadena de error tracking del proyecto era un stub: `getErrorTracker()` resolvía a un adaptador que tiraba `ObservabilityNotImplementedError`. Cualquier caída en producción quedaba sólo en `logger.error()` — útil para grep manual, inútil para alertas automáticas, agregación por release o triage. El swap a `@sentry/node` real con `beforeSend` que limpia `authorization`/`cookie`/`set-cookie` headers cierra esa brecha sin filtrar PII y sin cambiar las firmas que ya consumen los call sites. Operaciones gana señal, el equipo de ingeniería gana tiempo y el cliente enterprise gana un argumento concreto en pitch sobre auditoría externa de incidentes.

El histograma Webpay convierte SLO #2 (p95 < 5 s en `/billing/webpay/return`) de un objetivo declarativo en una métrica medible. Antes Terraform tenía el descriptor pero ningún punto del código emitía observaciones — la alerta era estructuralmente incapaz de disparar. Ahora los 5 puntos de salida del handler emiten con el outcome correcto, el reviewer ya validó el match runtime↔descriptor (corregido pre-commit), y la nueva alarma absent-data nos avisa si el pipeline cae. Una vez aplicado Terraform, el equipo puede medir contra datos reales: si Transbank degrada, lo sabremos por p95 sostenido, no porque un usuario reporte que "el banner se queda cargando".

El resto del scope — hooks defensivos contra hidratación de Firebase, ARIA en el modal, deep-link foundation en RiskNetwork — son la disciplina de no acumular fricción microscópica. Cada uno cierra un hallazgo explícito del reviewer Round 12/13 con TDD verde y archivo:línea citable. La regla sigue siendo la misma: el bundle no creció, los tests no se debilitaron, ninguna degradación silenciosa, y todo lo deferido está nombrado y rankeado en la sección de Pendientes para que Round 14 herede contexto, no debt.
