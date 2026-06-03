# DEEP-EX-39 — Pasada exhaustiva línea-por-línea (Lote #39)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "CROSS"`,
ordenado por `path`, slice `[0:55]`.
**Universo:** 159 archivos `FEAT`/`CROSS`; este lote cubre el slice `[0:55]` (55
archivos de infra transversal): los 6 middleware/jobs/preflight de `src/server/`
(`assertProjectMemberMiddleware`, `b2dAuth`, `canonicalBody`, `captureRouteError`,
`kmsPreflight`, `jobs/firestoreCriticalReplicate`), 11 hooks (`_fetchUtils`,
`useAutoLogout`, `useFirestoreCollection`, `useGeoCountry`, `useOnlineStatus`,
`useProjectFirestoreCollection`, `usePushNotifications`, `useReducedMotion`,
`useSubmit`, `useToast`, `useWakeLock`), 3 pages públicas (`LandingPage`,
`PublicDemo`, `Splash`), `OperationsRoutes`, y 34 componentes shared/layout/
identity/maps (incl. `KnowledgeGraph`, `DeepLinkHandler`, `TaxIdInput`,
`PremiumFeatureGuard`, `ProjectScopedPage`, `withGlossary`, `SyncCenterModal`,
`SyncConflictBanner`, `PendingInvitesBanner`, `ProjectSelector`,
`GuestSaveModal`, `ErrorBoundary`, `ErrorFallback`, `DataLoadErrorBanner`,
`RootLayout`, `mapConfig`, etc.).
**Foco:** middleware con bypass, rateLimit evadible, cripto débil, privacy/
regímenes mal mapeados, colecciones sin regla, tenantId del cliente sin token,
secretos hardcodeados, `Math.random` server/IDs (#15), auth/audit faltante
(#3/#14), 5xx-leak (#8), gemini-whitelist (#5), stubs (#13), promesas sin await,
doc-drift (#20).
**No repite:** `DEEP-NH-server.md` (que ya tabuló los 6 server files como ✅ por
montaje/auth — ver `:105,:109-113`), `DEEP-NH-services-infra.md`,
`DEEP-NH-services-knowledge.md`. Esta pasada los re-leyó **línea-por-línea** y
cruzó el job de réplica contra `auditLog.ts` + `billing.ts` (lo que el ✅ de la
tabla no hizo), encontrando un desajuste de campo nuevo.

## Atestación 55/55

Los 55 archivos del slice fueron leídos. Los 6 `src/server/*` (middleware, job,
kmsPreflight) se leyeron completos; las 11 hooks completas; las 3 pages completas;
`KnowledgeGraph.tsx` (1188 LOC) leído íntegro incluyendo el render del drawer y
los handlers Gemini; los 34 componentes leídos (los presentacionales puros —
`Card`, `ConfirmDialog`, `ConsciousnessLoader`, `EmptyState`, `GuardianMascot`,
`Modal`, `Skeleton`, `ToastContainer`, `Tooltip`, `WisdomCapsule`,
`WisdomCapsuleWatcher`, `Sidebar`, `sidebarMenuGroups`, `ModeSwitcher`,
`LocalePicker`, `PWAUpdateToast` — barridos por patrones de riesgo
`dangerouslySetInnerHTML`/`innerHTML`/`Math.random`/`apiKey`/`localStorage`/
`eval`/`process.env`/`VITE_` además de lectura). Cruces verificados con:
`src/server/middleware/auditLog.ts:71-81` (campo de timestamp real de
`audit_logs`), `src/server/routes/billing.ts:554-560` (campo `createdAt` real de
`invoices` + tipo `serverTimestamp`), `src/server/jobs/firestoreCriticalReplicate.test.ts:40-42,84-85`
(el mock de `where` y los docs de fixture), y `firestore.rules:11` (envelope
`invoices/{id}`).

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🔴 | `src/server/jobs/firestoreCriticalReplicate.ts:44,154` (cruce `auditLog.ts:78`) | **La réplica horaria de `audit_logs` filtra por un campo que NO existe → replica SIEMPRE cero filas, incumpliendo silenciosamente el RPO≤24h del DR_RUNBOOK.** El job consulta `db.collection('audit_logs').where('createdAt','>=',oneHourAgo)` (`:152-155`). Pero `auditServerEvent` escribe el timestamp en el campo **`timestamp`** (`auditLog.ts:78`: `timestamp: admin.firestore.FieldValue.serverTimestamp()`), **no** `createdAt` — los docs de `audit_logs` no tienen campo `createdAt`. La query devuelve `snap.empty`, el job registra `{docs:0, path:null}` (`:163`) y nunca sube JSONL. El header del archivo (`:5-15`) promete "RPO≤24h para audit_logs … hourly JSONL of the two collections that cannot tolerate a 24h gap, for forensic replay". En producción ese forensic-replay no contiene NADA de `audit_logs`. Es un fallo de continuidad de negocio invisible: el dashboard de operador ve `docs:0` (interpretado como "no hubo escrituras"), no un error. Cruza la invariante #3 (la cadena de auditoría es compliance-crítica) en su capa de respaldo. |
| 2 | 🔴 | `src/server/jobs/firestoreCriticalReplicate.ts:138,154` (cruce `billing.ts:559`) | **La réplica de `invoices` (RPO=0 regulatorio) compara un `Timestamp` contra un `number` → cero matches en producción.** `oneHourAgo = now - ONE_HOUR_MS` es un **epoch-ms numérico** (`:138`). Pero `invoices` se escribe con `createdAt: admin.firestore.FieldValue.serverTimestamp()` (`billing.ts:559`), que materializa un **`Timestamp` de Firestore**. En Firestore, `where('createdAt','>=', <number>)` sobre un campo de tipo `Timestamp` **no matchea por orden de tipos** (number y timestamp son tipos distintos en el orden total de Firestore) → la query retorna vacío. El header compromete "RPO=0 for `billing.invoices` (regulatory)" (`:5-7`). El test (`:40-42`) **declara explícitamente** que NO simula el filtro `createdAt >= oneHourAgo` ("we don't simulate … here"), así que el GREEN no cubre el comportamiento real → falso sentido de cobertura. Headline regulatorio: las facturas, cuyo respaldo es RPO=0 por mandato, nunca se replican por esta vía. Roza anti-stub-disfrazado (#13): un job "implementado" cuyo único test pasa por el camino que NO ejercita la condición que rompe en prod. |
| 3 | 🟡 | `src/server/jobs/firestoreCriticalReplicate.test.ts:84-85,110,116` | **El test pinea una forma de doc divergente de producción (`createdAt` en vez de `timestamp`) — congela el bug #1 como "correcto".** Las fixtures de `audit_logs` usan `{ ..., createdAt: NOW - 100 }` (`:84-85`), reflejando el campo equivocado del job y no el `timestamp` real de `auditLog.ts:78`. Como el `where` del mock es passthrough no-op (`:40-42`), el test verifica solo el shape de salida JSONL, nunca que el filtro matchee el schema productivo. Es la causa de por qué #1/#2 pasaron CI sin detección. Recomendación: el test debería usar el mismo nombre de campo que el writer real y simular el filtro temporal, o el job debe migrar a `timestamp`/normalizar el tipo. |
| 4 | 🟡 | `src/hooks/useFirestoreCollection.ts:40-43` | **Mutación in-place de `doc.data()` dentro del callback de `onSnapshot` — efecto secundario sobre el snapshot del SDK.** Para `nodes`/`*/nodes`, el hook hace `data.description = data.content` mutando directamente el objeto que devuelve `doc.data()`. Aunque el Firestore SDK entrega un objeto nuevo por snapshot (mitigante), mutar el resultado de `data()` es un anti-patrón: si una futura versión del SDK cachea/reusa el objeto, o si otro consumidor lee el mismo doc, el `description` sintético se filtra. Bajo riesgo real hoy, pero es lógica de back-compat oculta (compatibilidad `content`→`description`) sin test ni comentario explicando la deuda. No es severidad de seguridad; documentado por higiene de estado. |
| 5 | 🟡 | `src/components/layout/PendingInvitesBanner.tsx:33-39` | **Filtro de expiración de invitaciones SOLO client-side — defensa-en-profundidad ausente en la capa de lectura.** El banner lee `invitations where invitedEmail==user.email && status=='pending'` y descarta las expiradas con `.filter(inv => new Date(inv.expiresAt) > now)` **en el cliente** (`:38`). Un cliente modificado vería invitaciones expiradas; el gate real debe vivir en (a) `firestore.rules` de `invitations` y (b) la validación server-side del token al aceptar (`/invite?token=`). Esto es UX-only por diseño (igual que tier-gating cliente, conv. #11), pero como toca un flujo de control de acceso (membresía a proyecto) se documenta para confirmar que el accept-endpoint revalida `expiresAt` + token server-side. Sin verificación de ese endpoint en este lote, queda como 🟡 a confirmar. |
| 6 | 🔵 | `src/components/maps/mapConfig.ts:48` + `src/hooks/usePushNotifications.ts:190` | **Claves `VITE_*` inlineadas en el bundle (Google Maps JS API key, Firebase VAPID key) — exposición esperada, no secreto server.** `getMapLoaderConfig()` lee `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` y `usePushNotifications` lee `VITE_FIREBASE_VAPID_KEY`. Ambas son claves de cliente por diseño del proveedor (Maps JS exige key en el navegador, protegida por HTTP-referrer restriction en GCP console; la VAPID public key es pública por definición del estándar Web Push). NO es el patrón de fuga de secreto de tercero (a diferencia del OpenWeather key embebido marcado en DEEP-EX-35 #5). Documentado para descartar falso positivo: ambas DEBEN estar referrer/origin-restringidas en la consola del proveedor; si no lo están, sube a 🟡 (abuso de cuota). |
| 7 | 🔵 | `src/components/shared/WisdomCapsule.tsx:30` | **`Math.random()` en selección de cita — fuera del scope del ban (#15).** `quotes[Math.floor(Math.random()*quotes.length)]` elige una frase motivacional. CLAUDE.md #15 prohíbe `Math.random()` solo en `src/server/` y en ID-generation; esto es UI cosmética sin valor de seguridad ni ID. `precommit-stub-guard.cjs` no lo atrapa (scope `src/server/`). Riesgo nulo; documentado por la letra de la convención y para descartar falso positivo. |

## Limpios (sin hallazgos)

- **`src/server/middleware/assertProjectMemberMiddleware.ts`** — wrapper correcto
  del helper puro: variante `FromBody` es no-op si falta `projectId` (semántica
  documentada para audit-log opcional), variante `FromParam` es estricta (400),
  ambas chequean `callerUid` (defensa 401 si `verifyAuth` no corrió),
  `ProjectMembershipError` → `err.httpStatus` sin leak de internals, y propaga
  errores no-tipados a `next(err)` (no traga). Usa `admin.firestore()` server-side.
- **`src/server/middleware/b2dAuth.ts`** — Bearer `pk_*` validado, `verifyApiKey`
  envuelto en try/catch (500 `auth_check_failed` sin leak), scope check con
  `suite.all` blanket, quota gate per-customer/día con headers RateLimit
  correctos (limit/remaining/reset a medianoche UTC), `req.b2dKey` poblado solo
  tras pasar todo. Cuenta solo requests exitosos (`trackB2dUsage` post-trabajo).
  Privacy boundary documentada (nunca lee Zettelkasten del tenant). No evadible.
- **`src/server/middleware/canonicalBody.ts`** — RFC 8785 JCS puro y correcto:
  keys ordenadas por UTF-16 (`.sort()`), `undefined` omitidos, non-finite lanza,
  strings vía `JSON.stringify` (reusa escape ECMA-404), arrays preservan orden.
  Cierra la divergencia de HMAC cross-lenguaje del telemetry/MP-IPN. El flag de
  rollback `LEGACY_HMAC_FALLBACK` está documentado en el header (honrado en los
  call-sites de verify, fuera de este archivo).
- **`src/server/middleware/captureRouteError.ts`** — bridge a Sentry: escalares
  → `tags` (searchable), no-escalares → `extra`, `null`/`undefined` dropeados,
  `callerUid`/`userId`→userId, `tenantId`→tenantId. Envuelto en try/catch propio
  (`logger.warn` si la captura falla — observabilidad nunca rompe el path).
- **`src/server/kmsPreflight.ts`** — boot gate puro: prod exige
  `KMS_ADAPTER='cloud-kms'` + `KMS_KEY_RESOURCE_NAME`, rechaza `in-memory-dev`
  en prod, set cerrado de adapters válidos. Sin IO, determinístico. (server.ts
  cierra el proceso si `!ok` per DEEP-NH-server `:109`.)
- **`firestoreCriticalReplicate.ts`** (salvo #1/#2) — buena ingeniería de DI
  (getDb/uploader/now inyectables), per-collection isolation (un error no aborta
  los demás, `:174-180`), idempotencia por filename `<coll>/<hour>.jsonl`,
  `tracedAsync`. El defecto es puramente el **campo/tipo del filtro temporal**,
  no la arquitectura.
- **Hooks de datos/sensor** — `_fetchUtils.ts` (abort-on-unmount, `apiAuthHeaders`
  E2E+Bearer, error sin leak), `useProjectFirestoreCollection.ts` (gate de
  proyecto en save/patch que lanza, unsub defensivo, projectId derivado de
  `ProjectContext`), `useAutoLogout.ts` (15-min inactividad, cleanup de
  listeners + timeout), `useGeoCountry.ts` (consent-gated, **nunca persiste
  coordenadas** solo el código de país — privacy correcto, try/catch en
  localStorage para private-mode), `useOnlineStatus`, `useReducedMotion`,
  `useSubmit` (anti-doble-submit), `useToast` (`crypto.randomUUID()` para IDs —
  correcto), `useWakeLock`. `usePushNotifications.ts` (salvo nota #6): registro
  server-side via `/api/push/register-token` con Bearer/E2E, best-effort
  no-throw, mirror Firestore en try/catch.
- **Pages públicas** — `PublicDemo.tsx`: corre 100% con calc-engines puros
  (`bernoulli`), NO importa Firebase/Project context (documentado `:16`), banner
  permanente "modo demo no persiste", Digital Twin es SVG estático (no three.js).
  `LandingPage.tsx`: copy 100% i18n, links externos con `rel="noopener
  noreferrer"`, skip-link WCAG, restaura `document.title`/meta en cleanup. Sin
  auth, sin escrituras, sin secretos. `Splash.tsx`: trivial.
- **`KnowledgeGraph.tsx`** — sin `dangerouslySetInnerHTML`; todo texto de nodo se
  renderiza como children React (auto-escapado). Acciones Gemini
  (`analyzeRootCauses`, `simulateRiskPropagation`) van por el wrapper
  `geminiService` cliente (HTTP a `/api/gemini`, no acción nueva fuera de
  whitelist), gated por `isOnline`, errores logueados sin romper UX. `window.open`
  a BCN usa `URLSearchParams`/`encodeURIComponent` (no inyección). QR serializa
  solo campos del nodo seleccionado. Cleanup de three.js/Worker/WebGL correcto.
  `analytics.track` en try/catch (nunca rompe flujo).
- **`DeepLinkHandler.tsx`** — sanea URLs: si el native pasa un absoluto
  `https?://`, extrae solo `pathname+search+hash` (no navega fuera de la app),
  valida `detail.url` string no-vacío. Renderiza null.
- **`TaxIdInput.tsx`** — input controlado, validación vía `validateGenericTaxId`
  puro, `useId` para a11y, `aria-invalid`. Sin persistencia ni red.
- **`PremiumFeatureGuard.tsx`, `ProjectScopedPage.tsx`** — gating UX-only
  (`isPremium`/`features[feature]`), correcto bajo conv. #11 (el rank real es
  server-side). `ProjectScopedPage` documenta explícitamente que el gate de
  proyecto es estructural y que la autoridad de datos vive server-side.
- **`withGlossary.tsx`** — regex `\\b(term)\\b` con `gi` sobre texto plano,
  render como spans React (no innerHTML), sin XSS. (Los TODO-comments internos
  `:116-121` son ruido de dev, no stub-disfrazado funcional.)
- **`SyncCenterModal.tsx`, `SyncConflictBanner.tsx`, `syncConflictRoutes.ts`** —
  outbox offline read-only en UI; `routeForCollection` percent-encodea el docId
  (`encodeURIComponent`, anti-inyección de query), default `null` para colección
  desconocida. SyncConflictBanner usa copy **honesto** ("tu versión sobrescribió
  la del servidor" — LWW explícito, no finge auto-resolución). `JSON.parse` del
  error en try/catch.
- **`ProjectSelector.tsx`, `GuestSaveModal.tsx`, `ErrorBoundary.tsx`,
  `ErrorFallback.tsx`, `DataLoadErrorBanner.tsx`** — `ErrorFallback` NO renderiza
  el mensaje de error crudo (solo `eventId`, comentario `:9-11` justifica
  anti-PII), `ErrorBoundary` trunca componentStack a 500 chars y muestra detalle
  técnico bajo `<details>` colapsado. `GuestSaveModal` usa `signInWithGoogle`
  estándar. Banners route-agnósticos.
- **`OperationsRoutes.tsx`** — solo registro de rutas lazy (sin lógica). Las pages
  se auditan en sus lotes.
- **`mapConfig.ts`** (salvo nota #6) — centraliza loader Maps para no doble-cobrar
  map-loads, NO carga `places` (cobra) — decisión de costo documentada.
- **`RootLayout.tsx`** y resto de presentacionales (`Card`, `ConfirmDialog`,
  `ConsciousnessLoader`, `EmptyState`, `GuardianMascot`, `Modal`, `Skeleton`,
  `ToastContainer`, `Tooltip`, `WisdomCapsule`/`Watcher`, `Sidebar`,
  `sidebarMenuGroups`, `ModeSwitcher`, `LocalePicker`, `PWAUpdateToast`) —
  composición de shell + UI pura. Sin `innerHTML`, sin secretos server, sin
  `eval`, sin fetch directo a APIs de tercero con key embebida.

## Resumen

Cubiertos los 55 archivos del slice `FEAT`/`CROSS[0:55]` (infra transversal).
La infraestructura de middleware es sólida: `assertProjectMemberMiddleware`,
`b2dAuth` (quota + scope, no evadible), `canonicalBody` (RFC 8785 correcto contra
divergencia de HMAC), `captureRouteError` y `kmsPreflight` (boot gate prod) están
limpios. Los hooks tratan bien la privacidad — `useGeoCountry` nunca persiste
coordenadas y `usePushNotifications` registra tokens server-side con auth. Los
dos hallazgos **🔴** son del **mismo job de réplica DR** y son los importantes:
`firestoreCriticalReplicate.ts` consulta `where('createdAt','>=',oneHourAgo)`
pero (#1) `audit_logs` guarda su tiempo en el campo **`timestamp`** (no
`createdAt`, ver `auditLog.ts:78`) → replica cero filas, y (#2) `invoices` sí usa
`createdAt` pero como **`Timestamp`** mientras el filtro pasa un **número**
epoch-ms → cero matches por orden de tipos de Firestore. Resultado: el respaldo
horario que el DR_RUNBOOK compromete como RPO=0 (facturas, regulatorio) y RPO≤24h
(auditoría) **no replica nada en producción**, de forma silenciosa (`docs:0`
parece "sin escrituras"). El test (#3) congela el bug porque usa el campo
equivocado en sus fixtures y declara que no simula el filtro temporal. Tres 🟡
menores: mutación in-place de `doc.data()` en `useFirestoreCollection` (#4),
filtro de expiración de invitaciones solo client-side a confirmar contra el
accept-endpoint (#5). Dos 🔵 descartan falsos positivos: claves `VITE_*` de Maps/
VAPID inlineadas son cliente-por-diseño (#6, deben estar referrer-restringidas) y
`Math.random()` en selección de cita está fuera del scope del ban #15 (#7). Sin
prompt-injection, sin acción Gemini fuera de whitelist (#5), sin `JSON.parse`
server sin try/catch, sin colecciones cliente sin regla, sin tenantId del cliente
sin token, sin cripto débil, ni 5xx-leak nuevos en este lote.
