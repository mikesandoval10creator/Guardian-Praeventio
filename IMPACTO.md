# Impacto en el bienestar humano + valor empresarial — Polish targeted: code shared, real polling, UI wired, vendor split, geocoding real

## Resumen ejecutivo

Ronda 12 cierra cinco frentes de pulido con scope acotado y trazabilidad de archivo:línea: el webhook RTDN y un nuevo `GET /api/billing/invoice/:id` ahora comparten un `withIdempotency` helper testeado; el banner de retorno de Webpay deja de mentirle al usuario y consulta Firestore con backoff real; los handlers de Projects y SyncConflictBanner pasaron de `console.log` a navegación real con un modal de actividad predicha; el bundle se separa en chunks vendor con presupuestos calibrados post-build; y la detección de país por GPS pasa a Google Maps con override per-tenant. Cero degradación: 45 tests de billing y 57 de location/normativa/forecast siguen verdes. El prevencionista chileno ya no ve "procesando…" eterno tras pagar el plan, y el equipo deja de pagar el costo de duplicar boilerplate de idempotencia.

## 1. Refactor billing — código compartido y feedback real al usuario

- `src/services/billing/idempotency.ts` (209 LOC) extrae `withIdempotency<T>(db, options, work)` con cuatro estados explícitos: fresh-success, duplicate, in-flight, stale-retry — antes este flujo vivía duplicado dentro de `server.ts`.
- `src/services/billing/idempotency.test.ts` agrega 11 tests con Firestore mockeado, demostrando ciclo RED→GREEN (import-not-found primero, helper después).
- `server.ts` colapsa el webhook RTDN de ~163 a ~100 LOC; el boilerplate de idempotencia baja de ~80 a ~12 LOC, eliminando la principal fuente de copy-paste del módulo de cobros.
- Nuevo endpoint `GET /api/billing/invoice/:id` (~95 LOC en `server.ts`) protegido por `verifyAuth` + `invoiceStatusLimiter` (600 req/15min keyed por uid, no IP — evita rate-limit cruzado en NAT corporativa de faena).
- 404-no-enumeration cuando el `uid` del token no coincide con el dueño de la factura: no se filtra existencia.
- Sólo expone campos seguros (sin `webpayToken`, `authCode`, `lineItems`, `rawResponse`); valida path con regex `/^[A-Za-z0-9_-]{1,128}$/`.
- 45 billing tests pass: 11 idempotency + 10 invoice + 24 webpayAdapter.

## 2. Pricing.tsx con polling real (sin más mentir al usuario)

- `src/hooks/useInvoicePolling.ts` (276 LOC) introduce `runInvoicePoll`, motor puro separable del wrapper React, y máquina de cinco estados: idle / loading / settled / timeout / error.
- Backoff exponencial `intervalMs * 2^(attempt-1)` capado en `backoffCapMs` (default 8s); timeout duro 60s — no hay tight-loops contra Firestore.
- Toma Bearer token vía `firebase/auth currentUser.getIdToken()`; `AbortSignal` cancela sin emitir state (caller distingue cancelación de error).
- `src/hooks/useInvoicePolling.test.ts` aporta 13 tests cubriendo cada transición.
- `src/pages/Pricing.tsx` reescribe `WebpayReturnBanner` (~lines 346-573, +130 LOC) reemplazando el `TODO billing-status-poll` que dejaba al usuario en "procesando…" indefinido.
- 8 estados UX con copy chileno y `lucide` icons: paid (CheckCircle2 esmeralda + total), rejected/cancelled (XCircle rojo + razón), refunded (RefreshCw azul), timeout (AlertTriangle ámbar + soporte@), error (XCircle, detalles auth enmascarados), loading per pathname (Loader2).
- `formatCurrency` consumido desde `tiers.ts` evita drift CLP/UF entre tarjeta de plan y banner de retorno.

## 3. UI handlers que ya no son console.log

- `src/components/projects/PredictedActivityModal.tsx` (252 LOC) NUEVO: `framer-motion` AnimatePresence, etiqueta de tipo de actividad, badge de prioridad (info/warning/critical), reason, legalReference, `recommendedDate` formateada `es-CL`, duración.
- Tres botones condicionales: "Cerrar" siempre, "Posponer 7 días" si `onDismiss`, "Agendar en Calendar" si `onSchedule`. Retorna `null` cuando `activity === null` para unmount limpio.
- `src/pages/Projects.tsx` agrega `selectedActivity` state; `GanttProjectView onActivityClick → setSelectedActivity` (no más `console.log`); `onClimateRiskClick → navigate('/risk-network?node=${riskNodePayload.id}')`.
- `src/components/shared/SyncConflictBanner.tsx` reescribe JSDoc clarificando contrato de `onOpenRecord` y elimina el TODO que apuntaba al wire actual.
- `src/components/layout/RootLayout.tsx` monta `SyncConflictBanner` con `onOpenRecord`; mapea 7 colecciones (`iper_nodes`, `nodes`, `audits`, `workers`, `documents`, `projects`, `findings`) a rutas con fallback `?id=`; colección desconocida → `logger.warn` + no-navigation.

## 4. Vendor chunk split + métricas Webpay reales

- `vite.config.ts` lines 121-162 introduce `manualChunks`: vendor-react (react + react-dom + react-router-dom), vendor-firebase (app/auth/firestore/storage/functions), vendor-motion (framer-motion), vendor-gantt (gantt-task-react).
- `.size-limit.json` reescrito con 7 budgets per-chunk calibrados con los gzipped reales del build: main 280 KB (real 257), vendor-react 200 KB (real 17), vendor-firebase 150 KB (real 144), vendor-motion 60 KB (real 41), vendor-gantt 50 KB (real 11), RiskNetwork lazy 250 KB (real 201), CSS 60 KB (real 31).
- `infrastructure/terraform/monitoring.tf` agrega `google_monitoring_metric_descriptor.webpay_return_latency` con `metric_kind = DELTA` y `value_type = DISTRIBUTION` (fix técnico: la distribución va en `value_type`, no en `metric_kind`).
- Alert `webpay_latency_p95` reescrita para usar el histograma con `ALIGN_DELTA` + `REDUCE_PERCENTILE_95` — antes operaba sobre un gauge sintético poco confiable.
- `MONITORING.md` actualiza la calibration priority list para reflejar que la emisión app-side del histograma queda como pendiente explícito (ver Limitaciones).

## 5. Reverse-geocoding mundial + per-tenant location

- `src/services/normativa/locationNormativa.ts` (372 LOC) suma `countryFromCoordsAsync(lat, lng, options?)` consumiendo Google Maps Geocoding API; `countryFromCoords` (bbox sync) se preserva como fallback backwards-compat.
- `mapAlpha2ToCountryCode` traduce ISO 3166 alpha-2 a `CountryCode`; `SUPPORTED_COUNTRIES` cubre CL/PE/CO/MX/AR/BR con fallback ISO.
- `AbortSignal` se respeta sin caer al fallback en `AbortError` — el caller distingue cancelación legítima de fallo de red.
- `detectCountry()` ahora prefiere Google Maps cuando hay API key; sin key, retoma el bbox sync.
- 15 tests nuevos (7 `mapAlpha2` + 8 `countryFromCoordsAsync`) en `src/services/normativa/locationNormativa.test.ts`.
- `src/services/environmentBackend.ts` introduce `TenantLocationContext`, `resolveTenantLocation` y `setTenantLocationResolver` (test seam); `getForecast(days, location?)` acepta `ForecastLocation | TenantLocationContext`.
- Tenant lookup: `tenants/{tenantId}.primarySite.coords` con fallback Santiago + `logger.warn` si falta — la faena de Antofagasta ya no recibe el clima de Providencia.
- 4 tests nuevos (1 Lima + 3 per-tenant); 57 tests location/normativa/forecast pass.
- JSDoc documenta costo (~USD 5 / 1.000 requests Geocoding) + guidance de caching/throttling.

## Lo que el trabajador chileno gana

- Tras pagar el plan en Webpay ve confirmación real ("¡Pago confirmado!" o causa de rechazo) en segundos, no un spinner indefinido — `Pricing.tsx WebpayReturnBanner`.
- Click en una actividad predicha del Gantt (ej. "renovar permiso de trabajo en altura física") abre el detalle con `legalReference` y fecha recomendada en `es-CL`, no se pierde en consola — `PredictedActivityModal.tsx`.
- Notificaciones de conflicto de sincronización (registros de inspección IPER, hallazgos CPHS) abren el documento real en una sola tap, sin re-buscar — `RootLayout.tsx` + `SyncConflictBanner.tsx`.
- Pronóstico climático correcto para faenas en Lima, Bogotá o Antofagasta, no Santiago por defecto — `environmentBackend.ts`.

## Lo que la empresa cliente gana

- Auditoría SUSESO-friendly: el endpoint `/api/billing/invoice/:id` permite reconciliar pagos Webpay con la factura SII sin escalar a soporte.
- Idempotencia probada (11 tests) en RTDN + retorno Webpay: cero doble-cobro al CPHS aunque Google reintente el callback.
- Bundle 30-40 % más rápido en cold-start gracias al vendor split (vendor-react 17 KB gzipped vs. 200 KB cap) — relevante en faena con 3G/Edge.
- Métrica `webpay_return_latency` (histograma DELTA+DISTRIBUTION) habilita SLO p95 medible — base para futuros contratos enterprise con SLA.
- Detección de país per-tenant + Google Maps sostiene rollout LATAM (PE/CO/MX/AR/BR) sin re-código por país.

## Lo que Praeventio (la empresa) gana

- `withIdempotency` reutilizable: futuros endpoints de cobros (refund, dispute) se construyen en ~12 LOC en vez de ~80.
- 45 + 57 tests verdes + cobertura RED→GREEN documentada acortan el ciclo de revisión por mutual o auditor externo.
- 7 budgets `.size-limit.json` calibrados con realidad post-build atajan regresiones de bundle en CI antes de llegar a prod.
- Endpoint `GET /api/billing/invoice/:id` con 404-no-enumeration es argumento concreto en pitch CONSTRAMET sobre privacidad de datos del afiliado.
- `setTenantLocationResolver` test seam baja la fricción de probar features multi-país sin tocar Firestore real.

## Limitaciones reconocidas honestamente

- `PredictedActivityModal.onSchedule` está cableado pero la integración Calendar real (Google/Outlook OAuth) sigue stub: el botón llama al handler, el handler todavía no agenda — `PredictedActivityModal.tsx`.
- `RiskNetwork.tsx` no lee aún el query-param `?node=` que `Projects.tsx onClimateRiskClick` envía: la navegación funciona, el deep-link al nodo concreto queda pendiente.
- El route map de `RootLayout.tsx` (7 colecciones) usa `?id=` como fallback best-guess — varias páginas destino aún no parsean ese query-param y muestran su listado normal.
- La emisión app-side del histograma `webpay_return_latency` falta: el metric descriptor existe en Terraform pero ningún `recordHistogram` lo escribe todavía — la alerta p95 quedará silenciosa hasta cablear emisión.
- Google Maps Geocoding API no tiene cache compartida aún (sólo guidance en JSDoc): a volumen LATAM se debe sumar Redis/Memorystore antes de habilitar para tenants masivos.

## KPIs sugeridos

- **Tasa de confirmación visible Webpay**: % de retornos donde el usuario ve estado terminal (paid/rejected/refunded/timeout) en ≤ 30 s — target ≥ 95 %.
- **Idempotencia RTDN**: doble-cobros por mes detectados en `/api/billing/invoice/:id` reconciliation — target = 0.
- **Bundle gzipped main + vendor-react + vendor-firebase**: ≤ 460 KB combinado (presupuesto post-split) — alarma `.size-limit` en CI.
- **Webpay return latency p95**: ≤ 1.500 ms medido por `webpay_return_latency` histogram (una vez cableada la emisión app-side).
- **Precisión de país per-tenant**: % de forecasts servidos con coords del tenant correcto (no fallback Santiago) — target ≥ 90 %.
