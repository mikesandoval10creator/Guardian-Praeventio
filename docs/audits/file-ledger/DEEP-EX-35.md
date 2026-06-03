# DEEP-EX-35 — Pasada exhaustiva línea-por-línea (Lote #35)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "B18-Analitica"`,
ordenado por `path`, slice `[55:110]`.
**Universo:** 125 archivos `FEAT`/`B18-Analitica`; este lote cubre el slice
`[55:110]` (55 archivos): jobs (climate scan, weekly digest), las 21 routes
"sprint-k/analítica" (adoption, dataConfidence, confidentialReports, inbox,
insights, portableHistory, predictiveAlerts, reputationalAlerts, roiScenario,
costCalculator, climateAwareScheduling, waste, orgMetrics, projectComparator,
reports, reportsAutomation, safetyMetrics, safetyPerformance, cspReport),
el pipeline `analytics/*` (adapter, serverAdapter, sinks, queue, b2dMetrics,
types), engines puros (dataConfidence, karin, clientReporting,
climateAwareScheduling, costCalculator, financialAnalytics, inboxAggregator,
hvac), los adapters `external/*` (EONET, NASA POWER, USGS), `environmentBackend`
(server + client), y la page `WorkerPortableHistory.tsx`.
**Foco:** filtrado PII en telemetría, inyección en `dataConfidence`, dashboards
con datos falsos como reales, lectura cross-tenant, colecciones sin regla,
`Math.random` IDs (#15), auth/audit faltante (#3/#14), 5xx-leak (#8),
gemini-whitelist (#5), stubs (#13), doc-drift.
**No repite:** `DEEP-B18-Analitica.md` (ya cubrió la tabla LOC + huérfanos 🔵 +
RMW-sin-tx de confidentialReports + `assertNoPII` exportado-pero-no-llamado en
`telemetry/aggregator.ts`).

## Atestación 55/55

Los 55 archivos del slice fueron leídos. Las 21 routes y los 2 jobs se leyeron
completos línea-por-línea; engines puros y adapters externos completos;
`analytics/*` completo; la page `WorkerPortableHistory.tsx` leída en su totalidad
(header + render). Cruces verificados con `firestore.rules` (cobertura de
colecciones top-level que consume `insights.ts`), `src/server/middleware/auditLog.ts`
(contrato no-throw de `auditServerEvent`), `scripts/precommit-stub-guard.cjs`
(scope `src/server/` del ban `Math.random`), y `dataConfidencePanel.ts` (servicio
puro vs. el route que lo alimenta).

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🟡 | `src/server/routes/dataConfidence.ts:302` (+ `:301-304`, `dataConfidencePanel.ts:179-194`) | **Dimensión `concordance` hardcodeada a "perfecta" — score inflado presentado como real.** El route arma `inputs.concordance = { inconsistenciesCount: 0, totalEntitiesScanned: ... }` con **`inconsistenciesCount` SIEMPRE 0**. El servicio puro entonces calcula `concordance.score = 100 - (0/total)*1000 = 100` invariablemente. `concordance` pesa 15% del `overallScore` (`DIMENSION_WEIGHTS.concordance: 0.15`). El "Panel de Confianza de Datos" — cuyo propósito explícito es *"ayudar al prevencionista a no creer ciegamente en IA si los datos son malos"* — reporta 1 de sus 5 dimensiones como literalmente perfecta sin escanear nada. Es exactamente el patrón "dashboard con dato falso mostrado como real" + roza anti-stub-disfrazado (#13): no hay `// TODO`, ni flag, ni nota de que el consistency-auditor no está cableado. El doc del servicio (`:16` "Concordancia — ¿hay contradicciones detectables?") promete una verificación que el cableado real no ejecuta. |
| 2 | 🟡 | `src/server/routes/insights.ts:77-78, 108-126, 191-226` | **Lectura sobre colecciones TOP-LEVEL sin tenantId y sin regla — modelo de datos inconsistente / dashboard fantasma.** `risk-ranking`, `safety-talks` y `role-view` consultan `db.collection('risks'|'controls'|'incidents'|'tasks'|'findings'|'corrective_actions'|'epp_assignments'|'trainings')` filtrando **solo** por `where('projectId','==',projectId)`, sin el prefijo tenant-scoped `tenants/{tid}/projects/{pid}/...` que usan el resto de las routes del lote (dataConfidence, confidentialReports, portableHistory, waste). En `firestore.rules` esas colecciones **no tienen match top-level** (`controls`/`epp_assignments` solo existen *anidadas* bajo `/projects/{projectId}/`, líneas 324-325; `risks`/`incidents`/`findings`/`corrective_actions`/`trainings` no tienen match raíz). Como `admin.firestore()` bypassa rules, no es un read cross-tenant explotable por cliente, pero significa que estos widgets leen un modelo de datos paralelo que el app tenant-scoped no escribe → datos vacíos/stale presentados como insights reales, y un único `projectId` como clave de aislamiento (sin tenantId) si un día se escribiera allí. Anomalía única en el lote — todas las demás routes resuelven `tenantId` primero. |
| 3 | 🟡 | `src/server/routes/portableHistory.ts:231` | **Export PII (Ley 19.628) lee colección `incidents` top-level no tenant-scoped.** En `buildPortableHistoryBundle`, cuando `consent.includesIncidents`, hace `safeReadDocs([`${base}/incidents`, 'incidents'])` — el 2º path `'incidents'` es la colección **raíz** filtrada por `where('workerUid','==',workerUid)`. Un mismo `workerUid` presente en varios tenants podría arrastrar incidentes fuera del tenant del bundle hacia un export descargable (PDF/JSON con checksum). El path tenant-scoped (`${base}/incidents`) es el correcto; el fallback top-level rompe el aislamiento en la ruta más sensible (datos personales del trabajador, finalidad de disposición externa). Mismo anti-patrón que #2 pero en superficie PII. |
| 4 | 🟡 | `src/server/routes/reports.ts:61, 66, 102` | **Route acepta `projectId` sin `assertProjectMember` (conv. #6).** `POST /api/reports/generate-pdf` declara `projectId` e `incidentId` opcionales en el schema y emite `auditServerEvent('reports.pdf_generated', { incidentId })`, pero solo aplica `verifyAuth` — **no** llama `assertProjectMember(uid, projectId, db)`. CLAUDE.md #6: *"Routes accepting `projectId` MUST call `assertProjectMember` before any write."* Mitigante real: el PDF se renderiza desde `content`/`metadata` del body (no se leen datos del proyecto desde Firestore) y no hay escritura de dominio, así que no hay fuga cross-tenant de contenido. Pero la traza de audit queda asociada a un `incidentId`/`projectId` cuya pertenencia nunca se verificó. |
| 5 | 🟡 | `src/services/environmentBackend.client.ts:34, 117-119` | **API key de OpenWeather embebida en el bundle del navegador.** `const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY` — toda variable `VITE_*` se inlinea en el JS servido al cliente, exponiendo la clave del 3er-party a cualquiera que abra DevTools. La key viaja además en la query string del `fetch` directo a `api.openweathermap.org` (`:119`). El archivo lo documenta como decisión deliberada (mismo patrón que `orchestratorService`), pero es exposición de secreto de tercero (riesgo de abuso de cuota/billing del proveedor). El sibling server-side (`environmentBackend.ts:11`) usa correctamente `process.env.OPENWEATHER_API_KEY` no-`VITE`. Recomendación: proxiar `/weather` por el backend en vez de exponer la key al cliente. |
| 6 | 🟡 | `src/services/financialAnalytics/eppBudgetTracker.ts:118-129` | **Fallback silencioso "primer rol a todos" distorsiona presupuesto presentado como cifra CLP autoritativa.** Cuando falta la distribución por rol, el cálculo aplica `eppRequiredByRole[firstRole]` a **todos** los `workersCount` (`:119`). El número resultante (gasto EPP esperado en CLP) se muestra sin marca de "estimación degradada", pudiendo divergir órdenes de magnitud del real si el primer rol es atípico. Sin `// TODO` ni flag → mismo espíritu que #1 (default no-honesto en superficie financiera). Ya marcado 🟡 en B18 por LOC; aquí se documenta la causa-raíz. |
| 7 | 🔵 | `src/services/analytics/serverAdapter.ts:203`, `src/services/analytics/queue.ts:77` | **`Math.random()` en ID-gen, fuera del scope del guard (conv. #15, solo texto).** Ambos `newId()` hacen `crypto.randomUUID()` y caen a `aq_${Date.now()}_${Math.random().toString(36).slice(2,10)}` **solo** si `crypto.randomUUID` no existe. En Node ≥20 / navegadores modernos el fallback nunca corre. CLAUDE.md #15 dice "any ID-generation code → `randomId()`", pero `precommit-stub-guard.cjs` solo escanea `src/server/` (estos viven en `src/services/`), así que no lo atrapa. Riesgo práctico nulo (rama muerta); documentado para descartar falso positivo y por la letra de la convención. |
| 8 | 🔵 | `src/server/routes/confidentialReports.ts:248,363,433` (+ `dataConfidence.ts:499`, `portableHistory.ts:328`) | **`auditServerEvent` no envuelto en try/catch — pero el helper es no-throw, así que NO viola #14.** Verificado en `src/server/middleware/auditLog.ts:58-92`: `auditServerEvent` captura internamente y **retorna `boolean`** (`true`/`false`), nunca lanza (comentario `:33` "use the no-throw signature so an audit failure cannot 5xx"). Por tanto las llamadas `await auditServerEvent(...)` sin try/catch en estas routes están bien (no pueden convertir un create/respond/close exitoso en 500). Sub-nota observabilidad: estas routes **ignoran** el `boolean` de retorno, a diferencia de `reports.ts:106` que hace `.then((ok) => if(!ok) sentryCapture('audit_write_failed'))` — un gap de audit silencioso (no se reporta a Sentry) pero no un #14. Descartado como hallazgo de severidad; documentado para corregir el falso positivo natural de "audit sin try/catch". |

## Limpios (sin hallazgos)

- **Routes compute-puro (verifyAuth + `assertProjectMember` vía `guard()` + Zod
  estricto con caps + 5xx `internal_error` sin leak):** `adoption.ts`,
  `climateAwareScheduling.ts`, `costCalculator.ts`, `roiScenario.ts`,
  `predictiveAlerts.ts` (`finiteNumber`+cap 240), `reputationalAlerts.ts`,
  `orgMetrics.ts`, `reportsAutomation.ts`, `safetyMetrics.ts`,
  `safetyPerformance.ts`, `projectComparator.ts`. Todas con `validate(schema)`,
  arrays capados (`.max(...)`), enums cerrados, sin escrituras Firestore.
  `projectComparator.ts:88` devuelve `err.message` **solo** para
  `ProjectComparatorError` tipado en un **400** (código de validación del engine,
  no internals) — no viola #8 (scoped a 5xx).
- **`dataConfidence.ts`** (salvo #1) — guard role-gated para dismiss (`:158-170`,
  set cerrado de roles), `issueId` validado contra `^[a-z_]+\.[a-z_]+$` (`:477`,
  defense-in-depth anti-doc-id-arbitrario), audit awaited en dismiss (`:499`),
  `tenantId` resuelto del proyecto (`:104-118`), reads con `limit(2000)` y
  fallback graceful. **Nota:** el GET snapshot persiste
  `data_confidence_snapshots/{date}` (`:422-428`) sin audit — es un upsert de
  caché idempotente de un score derivado (no estado de dominio), aceptable bajo
  #3 como telemetría interna, pero queda anotado.
- **`confidentialReports.ts`** (Ley Karin 21.643) — `reporterAnonHash` SHA-256
  estable (`:183-187`, no expone uid), identidad re-derivada server-side
  siempre (`:239`, nunca confía en `reporterUid` del client), IDs con
  `randomUUID()` (`:221`, 128 bits), gate de handler-role en list/respond/close,
  reporter ve solo lo propio (`:298-301`), audit awaited en los 3 mutadores.
- **`inbox.ts` + `inboxAggregator.ts`** — engine 100% determinístico, quick-actions
  clonadas por item (anti-leak de mutación compartida, `:147-149`), dedup por
  `responsibleUid` (`:124-133`), `import()` lazy. Sin escrituras.
- **`portableHistory.ts`** (salvo #3) — gate `isOwnerOrAdmin` (`:101-103`),
  hard-gate consent para export (`403 consent_required_for_export`, `:370`),
  identidad `[REDACTED]` si sin consent (`:239-241`), checksum SHA-256 sobre JSON
  canónico, audit awaited en consent, PDF degradado a 503 si `pdfkit` ausente
  (anti-stub correcto, #13).
- **`waste.ts`, `cspReport.ts`** — waste: read-only vía adapter tenant-scoped.
  cspReport: público a propósito (browsers no-confiables), `originAndPath()`
  scrubea query/hash de `blocked-uri` antes de Sentry (anti-PII), 204
  incondicional, nunca lanza.
- **`reports.ts`** (salvo #4) — schema con caps (`content` 64kB), audit no-bloqueante
  vía `.then()` con Sentry-capture del gap, 5xx `"Internal server error"`
  genérico (#8 OK).
- **Pipeline `analytics/*`** — `serverAdapter.ts`: PII-guard sobre keys
  top-level prohibidas (`email/phone/rut/name/address/lat/lng`, `:54-64`),
  drop+Sentry-breadcrumb del evento con PII (`:333-340`), `track` nunca lanza,
  queue ring-buffer acotado (max 1000, drop-oldest). `sinks.ts` (noop/console/
  sentry, nunca lanzan), `b2dMetrics.ts` (read defensivo de `b2d_api_keys`,
  `safeTierPrice` tolera tier desconocido), `adapter.ts`, `index.ts`, `types.ts`.
  *Limitación conocida (no nueva):* el PII-guard solo inspecciona keys de primer
  nivel — PII anidada no se filtra (mismo comportamiento que el adapter browser).
- **Adapters `external/*`** — `usgsEarthquakeAdapter.ts`, `eonetAdapter.ts`,
  `nasaPowerAdapter.ts`: URL construida con `URL`+`searchParams` (SSRF-safe,
  baseUrl fija), `fetch` inyectable (DI), retry 2× backoff, validación Zod
  `safeParse` con throw tipado, cache TTL, `getErrorTracker().captureException`
  en fallo terminal. `recommendationBuilder.ts`, los `types.ts`, `index.ts`
  puros.
- **Engines puros** — `karinReportingEngine.ts` (validación + assignInvestigator
  independencia + retaliation 90d; B18 ya lo marcó 🔵 sin consumidores),
  `climateAwareScheduling.ts`, `monthlyClientReport(+Builder).ts`,
  `chileClimatology.ts` (modelo real de normales climatológicas, NO `Math.random`
  — el comentario `:6,:200` lo declara explícito), `hvac/thermalModel.ts`,
  `roiCalculator.ts`, `purchaseOrderSuggester.ts`, `dataConfidencePanel.ts`,
  `adoptionAnalytics.ts`, `calendar/predictions.ts`. Determinísticos, `now`/`nowIso`
  inyectable, sin IO.
- **Jobs** — `dailyClimateRiskScan.ts` (deps 100% DI, per-project isolation no
  aborta el resto, `safeAudit` no-throw, idempotencia vía SHA-256 en writeNodes),
  `weeklyDigest.ts` (per-collection isolation + `queryErrors`→`partial:true` para
  distinguir cero real de error tragado, ventana Mon..Sun computada). *Nota menor:*
  `weeklyDigest.ts:308` cae a `tenantId = data?.tenantId || projectId` — si un
  project doc no trae `tenantId`, lee `tenants/{projectId}/...` (path inexistente
  → agregados en cero), pero sin fuga cross-tenant.
- **`confidentialReportsService.ts`, `confidentialReportsFirestoreAdapter.ts`,
  `wasteFirestoreAdapter.ts`, `environmentBackend.ts`** (server) — adapter
  tenant-scoped, `detectRetaliation` puro, `getForecast` API-key server-side con
  degradación graceful (`[]` si falta key / upstream falla / JSON malformado),
  nunca lanza.
- **`WorkerPortableHistory.tsx`** — gating cliente espeja el server (no-admin no
  ve selector; el endpoint igual rechaza 403), banner Ley 19.628, toggles consent
  default-off, errores de hook mostrados sin leak. Sin `dangerouslySetInnerHTML`,
  sin `apiKey` cliente.

## Resumen

Cubiertos los 55 archivos del slice `FEAT`/`B18-Analitica[55:110]`. Las 21 routes
de analítica son sólidas en el patrón canónico (verifyAuth + `assertProjectMember`
vía `guard()` + Zod con caps + 5xx no-filtrante), y los engines puros, jobs DI y
adapters `external/*` (SSRF-safe, schema-validados, retry) están limpios. Hallazgo
principal **🟡 #1**: el "Panel de Confianza de Datos" alimenta la dimensión
`concordance` con `inconsistenciesCount: 0` hardcodeado, produciendo siempre
score 100 en 1 de 5 dimensiones (15% del peso) — un dato falso mostrado como real
en el panel cuya razón de ser es advertir sobre datos malos. Tres 🟡 de aislamiento
de tenant por lectura de colecciones **top-level sin tenantId** desde el Admin SDK:
`insights.ts` (#2, dashboards sobre un modelo de datos paralelo sin reglas →
widgets potencialmente vacíos/stale) y `portableHistory.ts` (#3, fallback a
`incidents` raíz en una ruta de export PII Ley 19.628). `reports.ts` acepta
`projectId` sin `assertProjectMember` (#4, conv. #6; mitigado porque el contenido
es client-supplied). `environmentBackend.client.ts` expone la API key de
OpenWeather en el bundle del navegador (#5, secreto de tercero). `eppBudgetTracker`
aplica un fallback "primer rol a todos" que distorsiona el presupuesto CLP sin
marca (#6). Dos 🔵: `Math.random()` en ramas-muertas de ID-gen fuera del scope del
guard (#7), y la **corrección de un falso positivo** (#8) — `auditServerEvent` es
no-throw por contrato (`auditLog.ts:82-92`), así que las llamadas sin try/catch en
confidentialReports/dataConfidence/portableHistory **no** violan #14. Sin
prompt-injection, sin acción Gemini fuera de whitelist (#5), sin `JSON.parse`
server sin try/catch, ni colecciones cliente sin regla detectados en este lote.
