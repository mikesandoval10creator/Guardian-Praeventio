# DEEP — B18 Analítica / Reportes / Dashboards / KPIs · 2026-06-02
**Archivos revisados:** 140 (ledger `block==="B18-Analitica"`) + 4 colaterales fuera del bloque (`aggregateTelemetry.ts`, `telemetry/aggregator.ts`, `telemetry/eventCollector.ts`, `predictive/AlertSchedulerMount.tsx`).

Auditoría code-first. Cada hallazgo lleva `file:line` real. Los engines puros y los routers HTTP están en muy buen estado; la deuda concentrada del bloque es de **cableado UI** (componentes/hooks construidos y testeados pero huérfanos) y un par de invariantes defensivos no conectados.

---

## 1. Lo que YA HACE (implementado y real)

### Routers HTTP (todos montados en `server.ts` bajo `/api/sprint-k`)
Verificado el montaje en `server.ts:996-1099`. Todos llevan `verifyAuth` + `assertProjectMember`/guard y devuelven `{ error: 'internal_error' }` sin filtrar internals.

- **orgMetrics** (`src/server/routes/orgMetrics.ts`, 266 LOC) — 5 endpoints stateless sobre el engine puro. Zod estricto con caps (`max(50_000)` arrays, enums cerrados `ADMIN_PROCESSES`/`GAP_KINDS`). `guard()` en `orgMetrics.ts:55-70`. Sin escrituras Firestore — compute puro. ✅
- **dataConfidence** (`dataConfidence.ts`, 613 LOC) — snapshot + dismiss (role-gated) + recommendations. Dismiss zod-validado `reason: z.string().min(1).max(2000)` (`:454`), role-gate `DATA_CONFIDENCE_DISMISS_ROLES` (`:146-167`), `auditServerEvent` **await-eado** (`:499-506`). El `reason` se persiste, NO se interpola en prompt → sin superficie de inyección. ✅
- **portableHistory** (`portableHistory.ts`, 448 LOC) — consent + export. Gate owner-or-admin `isOwnerOrAdmin` (`:101`), export bloqueado sin consent → `403 consent_required_for_export` (`:370-371`), audit await-eado en consent-update (`:328`). Ley 19.628 contemplada (disclaimer `:59`). ✅
- **confidentialReports** (`confidentialReports.ts`, 535 LOC) — Ley Karin 21.643. Anonimato vía `hashReporterAnon` SHA (`:183`), IDs vía `crypto.randomUUID()` (`:25`), handlers role-gated `isHandlerRole` (`:174`), audit await-eado en create/respond/close (`:248,:363,:433`). Historial append-only en subcolección `audit/`. ✅
- **predictiveAlerts** (`predictiveAlerts.ts`, 158 LOC) — `should-fire-windowed` + `evaluate-probes`. Zod con `finiteNumber` refine + `MAX_FORECAST_WINDOW=240` (`:53-83`). Reconstruye la closure `ForecastFn` server-side desde `forecastValues[]`. ✅
- **safetyMetrics** (205), **safetyPerformance** (133), **projectComparator** (97), **reportsAutomation** (178) — mismo patrón, compute puro sobre engines. ✅
- **aggregateTelemetry** (`aggregateTelemetry.ts`, 178 LOC — fuera del ledger pero núcleo de B18) — `GET /telemetry/aggregate` + `/tenants/:id/telemetry/rollup`. El rollup exige membership en CADA proyecto solicitado (`:142-153`). **Nunca retorna PII por construcción**: `eventCollector.projectionToEvent` (`eventCollector.ts:64-84`) es whitelist y solo emite `{id,kind,occurredAt,projectId,tenantId,severity}` — los campos personales jamás se leen. ✅

### Engines puros (sin side-effects, `now` inyectable, sin Math.random/firestore)
- `orgMetrics/organizationalMetrics.ts` (301), `dataConfidence/dataConfidencePanel.ts` (275, `now` inyectable `:216`), `predictiveAlerts/{windowedTrigger,alertScheduler,calendarPreWarn}.ts`, `reportsAutomation.ts` (198, `nowIso`/`new Date()` inyectable `:140`), `safetyMetrics/osha.ts` (319), `safetyPerformance/safetyPerformanceIndex.ts` (156), `projectComparator/projectComparator.ts` (324), `telemetry/aggregator.ts` (209). Todos compute puro. ✅

### Dashboards/Pages reales (cableados y enrutados)
- **Analytics.tsx** (633) — Recharts reales (Bar/Line/Pie/Radar) sobre `useRiskEngine` nodes + `generateExecutiveSummary` (Gemini) + export PDF (`html2canvas`+`jsPDF`). ✅
- **ExecutiveDashboard.tsx** (479) — Recharts sobre `useUniversalKnowledge` nodes, tier-gated `canAccessExecutiveDashboard`, export PDF. ✅
- **Dashboard.tsx** (346) — monta `PredictiveAlertWidget`, `RealTimeStatusWidget`, `AIInsightsModal`. ✅
- **DataConfidence / ConfidentialReports / WorkerPortableHistory** — enrutadas en `App.tsx:289/308/311` y consumen sus hooks (`useDataConfidence`, `useConfidentialReports`, `usePortableHistory`) con UI inline propia. ✅
- `PredictiveAlertWidget.tsx` (156) — alertas predictivas vía Gemini `predictGlobalIncidents` con caché offline (`:49-51`). Real. ✅
- `AlertSchedulerMount.tsx` — montado en `RootLayout.tsx:464`, polling 60s, dedupe 30min, analytics `risk.detected.predictive`, ack→XP. Lógica real. ✅ (pero ver §2 — alimentado con probes vacíos).

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

1. **🏚️ AlertSchedulerMount alimentado con `probes={[]}` hardcoded** — `RootLayout.tsx:467` pasa array vacío con comentario *"inject probes via a future context"* (`:435-437`). El `useEffect` hace early-return si `probes.length === 0` (`AlertSchedulerMount.tsx:119`). **El pipeline de alertas predictivas Bernoulli está dormido en producción.** El engine, ruta, hook y mount existen y se testean, pero ningún probe real los alimenta. La función "predictiva" que SÍ ve el usuario es la de Gemini (`PredictiveAlertWidget`), un sistema paralelo distinto.

2. **🔵 Componentes dashboard/report huérfanos (construidos + testeados, NO importados en ninguna page/route):**
   - `safetyMetrics/SafetyMetricsDashboard.tsx` (275), `SafetyTrendChart(.Lazy).tsx`
   - `safetyPerformance/SpiDashboard.tsx` (97)
   - `orgMetrics/OperationalPressureGauge.tsx`
   - `reportsAutomation/ReportTemplatePreview.tsx`
   - `clientReporting/MonthlyClientReportPanel.tsx`, `monthlyClientReport/MonthlyClientReportCard.tsx`
   - `workerHistory/PortableHistoryPreview.tsx`, `confidentialReports/ConfidentialReportInbox.tsx`
   Confirmado: grep de cada nombre fuera de su `.test` da 0 importadores. Las pages routed (DataConfidence/ConfidentialReports/WorkerPortableHistory) usan UI inline, no estos componentes → posibles duplicados/sustitutos.

3. **🔵 Hooks huérfanos (HTTP wrappers reales, 0 consumidores):** `usePredictiveAlerts`, `useOrgMetrics`, `useProjectComparator`, `useReportsAutomation`, `useSafetyMetrics`, `useSafetyPerformance`. Solo `useDataConfidence`, `usePortableHistory`, `useConfidentialReports` tienen consumidores (2 cada uno). No son stubs — son fetch wrappers funcionales sin UI que los llame.

4. **🟡 `assertNoPII` exportado y testeado pero NUNCA invocado en producción** — `aggregator.ts:199`. El comentario `aggregateTelemetry.ts:13` lo llama *"the last line of defense"* y `eventCollector.ts:9` *"second line of defense"*, pero no hay ninguna llamada `assertNoPII(...)` en código no-test. La privacidad real la garantiza la proyección whitelist (eso es sólido), así que es defensa muerta, no un agujero — pero el comentario miente sobre el cableado.

5. **🟡 Engines `projectComparator` duplicados** — existen `services/projectComparator/projectComparator.ts` (324) y `services/multiProject/projectComparator.ts` (325), ambos exportan `compareProjects`. La ruta `projectComparator.ts` usa uno; el otro lo consume `multiProject`. Posible divergencia/confusión — verificar cuál es canónico.

6. **🟡 `karinReportingEngine.ts` (239) y `clientReporting/monthlyClientReportBuilder.ts` (387) sin consumidores** — engines construidos y testeados pero 0 importadores fuera de sus tests. La ruta `confidentialReports.ts` implementa su propia lógica de retaliation (`:493-516`) sin invocar `karinReportingEngine`.

7. **🟡 `confidentialReports respond/close`: read-modify-write sin `runTransaction`** — `respond` hace `docRef.get()` (`:332`) seguido de `docRef.set(merge)` (`:353`). Es 1 get + 1 set (CLAUDE.md #19 exige transacción con ≥2 gets), técnicamente bajo el umbral, pero hay race last-write-wins benigna en `status`/`respondedAt`. Mismo patrón en `close`.

---

## 3. Tabla por archivo (representativa — 140 archivos; agrupada por subsistema)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/orgMetrics.ts | 266 | ✅ | server.ts:1089 | 5 endpoints puros, zod+caps, guard `:55` |
| src/server/routes/dataConfidence.ts | 613 | ✅ | server.ts:996 | Snapshot/dismiss role-gate `:146`, audit await `:499` |
| src/server/routes/portableHistory.ts | 448 | ✅ | server.ts:999 | Consent-gated export 403 `:370`, audit `:328` |
| src/server/routes/confidentialReports.ts | 535 | ✅⚠️ | server.ts:1000 | Karin: anonHash `:183`, audit `:248`; RMW sin tx `:332-353` |
| src/server/routes/predictiveAlerts.ts | 158 | ✅ | server.ts:1095 | finiteNumber+cap240 `:53`; engine alimentado vacío en prod |
| src/server/routes/safetyMetrics.ts | 205 | ✅ | server.ts:1093 | OSHA TRIR/LTIFR sobre engine puro |
| src/server/routes/safetyPerformance.ts | 133 | ✅ | server.ts:1099 | SPI sobre engine puro |
| src/server/routes/projectComparator.ts | 97 | ✅ | server.ts:1094 | compute puro |
| src/server/routes/reportsAutomation.ts | 178 | ✅ | server.ts:1092 | compute puro, `now` inyectable |
| src/server/routes/reports.ts | 215 | ✅ | server.ts | export reportes |
| src/server/routes/cspReport.ts | 137 | ✅ | server.ts | CSP violation sink (público a propósito) |
| src/server/routes/aggregateTelemetry.ts | 178 | ✅ | server.ts:1049 | NO PII por proyección whitelist; rollup multi-membership `:142` |
| src/services/telemetry/aggregator.ts | 209 | ✅🟡 | usado por ruta | `assertNoPII` `:199` exportado pero nunca llamado |
| src/services/telemetry/eventCollector.ts | 191 | ✅ | usado por ruta | Proyección whitelist `:64-84` — garante real de no-PII |
| src/services/orgMetrics/organizationalMetrics.ts | 301 | ✅ | ruta | Engine puro |
| src/services/dataConfidence/dataConfidencePanel.ts | 275 | ✅ | ruta+page | `now` inyectable `:216` |
| src/services/predictiveAlerts/windowedTrigger.ts | 108 | ✅ | ruta+mount | Engine Bernoulli puro |
| src/services/predictiveAlerts/alertScheduler.ts | 98 | ✅ | mount `:18` | evaluateProbes/buildPushPayload |
| src/services/predictiveAlerts/calendarPreWarn.ts | 361 | ✅ | — | Pre-warning calendario |
| src/services/projectComparator/projectComparator.ts | 324 | ✅🟡 | ruta | Duplicado con multiProject/ |
| src/services/multiProject/projectComparator.ts | 325 | ✅🟡 | b2dMetrics | Duplicado con projectComparator/ |
| src/services/reportsAutomation/reportsAutomation.ts | 198 | ✅ | ruta | Puro, `nowIso` inyectable `:140` |
| src/services/safetyMetrics/osha.ts | 319 | ✅ | ruta+dashboard | TRIR/LTIFR/severity puro |
| src/services/safetyPerformance/safetyPerformanceIndex.ts | 156 | ✅ | ruta | SPI puro |
| src/services/confidentialReports/karinReportingEngine.ts | 239 | 🔵 | 0 consumidores | Engine sin cablear; ruta no lo usa |
| src/services/clientReporting/monthlyClientReportBuilder.ts | 387 | 🔵 | 0 consumidores | Builder sin cablear |
| src/services/clientReporting/monthlyClientReport.ts | 137 | 🟡 | — | Reporte mensual cliente |
| src/services/workerHistory/portableHistoryExporter.ts | 474 | ✅ | usado por ruta | PDF/JSON exporter |
| src/services/financialAnalytics/roiCalculator.ts | — | ✅ | 5 files | ROI |
| src/services/financialAnalytics/purchaseOrderSuggester.ts | — | ✅ | 6 files | PO sugeridas |
| src/services/financialAnalytics/eppBudgetTracker.ts | — | 🟡 | 1 file | Budget EPP |
| src/services/adoption/adoptionAnalytics.ts | — | ✅ | 5 files | Adopción |
| src/services/analytics/{adapter,index,queue,sinks,serverAdapter,b2dMetrics}.ts | — | ✅ | 15+ files | Pipeline analytics catalog-driven |
| src/services/inbox/inboxAggregator.ts | — | ✅ | 5 files | Agregador inbox |
| src/pages/Analytics.tsx | 633 | ✅ | App.tsx | Recharts reales + Gemini + PDF; TODO benchmark `:92` |
| src/pages/ExecutiveDashboard.tsx | 479 | ✅ | App.tsx | Recharts + tier-gate + PDF |
| src/pages/Dashboard.tsx | 346 | ✅ | App.tsx | Widgets reales |
| src/pages/DataConfidence.tsx | — | ✅ | App.tsx:289 | Consume useDataConfidence `:334` |
| src/pages/ConfidentialReports.tsx | — | ✅ | App.tsx:308 | Consume useConfidentialReports `:180` |
| src/pages/WorkerPortableHistory.tsx | — | ✅ | App.tsx:311 | Consume usePortableHistory |
| src/components/dashboard/PredictiveAlertWidget.tsx | 156 | ✅ | Dashboard:251 | Gemini predictGlobalIncidents `:49` |
| src/components/predictive/AlertSchedulerMount.tsx | 182 | 🏚️ | RootLayout:464 | Real pero `probes={[]}` → dormido |
| src/components/safetyMetrics/SafetyMetricsDashboard.tsx | 275 | 🔵 | 0 importadores | Dashboard huérfano |
| src/components/safetyPerformance/SpiDashboard.tsx | 97 | 🔵 | 0 importadores | Dashboard huérfano |
| src/components/orgMetrics/OperationalPressureGauge.tsx | — | 🔵 | 0 importadores | Gauge huérfano |
| src/components/reportsAutomation/ReportTemplatePreview.tsx | — | 🔵 | 0 importadores | Preview huérfano |
| src/components/clientReporting/MonthlyClientReportPanel.tsx | — | 🔵 | 0 importadores | Panel huérfano |
| src/components/monthlyClientReport/MonthlyClientReportCard.tsx | — | 🔵 | 0 importadores | Card huérfano |
| src/components/workerHistory/PortableHistoryPreview.tsx | — | 🔵 | 0 importadores | Preview huérfano (page usa UI inline) |
| src/components/confidentialReports/ConfidentialReportInbox.tsx | — | 🔵 | 0 importadores | Inbox huérfano (page usa UI inline) |
| src/components/predictiveAlerts/PredictiveAlertsList.tsx | — | 🔵 | solo self | No es el widget del Dashboard |
| src/hooks/usePredictiveAlerts.ts | — | 🔵 | 0 consumidores | HTTP wrapper real, sin UI |
| src/hooks/useOrgMetrics.ts | — | 🔵 | 0 consumidores | HTTP wrapper real, sin UI |
| src/hooks/useProjectComparator.ts | — | 🔵 | 0 consumidores | idem |
| src/hooks/useReportsAutomation.ts | — | 🔵 | 0 consumidores | idem |
| src/hooks/useSafetyMetrics.ts | — | 🔵 | 0 consumidores | idem |
| src/hooks/useSafetyPerformance.ts | — | 🔵 | 0 consumidores | idem |
| src/hooks/{useDataConfidence,usePortableHistory,useConfidentialReports}.ts | — | ✅ | 2 cada uno | Consumidos por sus pages |
| src/services/zettelkasten/families/aiAnalyticsNodeRegistry.ts | 63 | ✅ | registry | Registro nodos AI-analytics |
| infrastructure/terraform/dashboards/business.json | 179 | ✅ | terraform | Cloud Monitoring dashboard |
| infrastructure/terraform/dashboards/operational.json | 233 | ✅ | terraform | Cloud Monitoring dashboard |
| docs/reports-cl.md | — | 🔵 | doc | Spec reportes CL |
| (28 archivos `.test.ts(x)` del bloque) | — | ✅ | vitest | Cobertura routes/services/components |

Leyenda: ✅ implementado y real · 🟡 funcional con deuda/observación · 🏚️ presente pero inerte en prod · 🔵 construido+testeado pero sin cablear (huérfano) · 🔑 secreto/cripto · 🔴 roto.

---

## 4. Para decisión del usuario (❓/⚠️)

- **⚠️ Alertas predictivas Bernoulli dormidas:** ¿se debe inyectar el contexto de probes real en `RootLayout.tsx:467` (hoy `probes={[]}`), o se considera reemplazado por el sistema Gemini (`PredictiveAlertWidget`)? Hay dos sistemas "predictivos" paralelos; conviene decidir cuál es canónico y deprecar/cablear el otro. Si el Bernoulli queda dormido a propósito, debería gatearse por feature flag y registrarse en `docs/stubs-inventory.md` (CLAUDE.md #13).
- **⚠️ ~16 componentes/hooks B18 huérfanos** (SafetyMetricsDashboard, SpiDashboard, OperationalPressureGauge, ReportTemplatePreview, Monthly*Report*, PortableHistoryPreview, ConfidentialReportInbox, y 6 hooks `use*`). ¿Se enrutan en nuevas pages (parece la intención: rutas/engines existen) o se eliminan como código muerto? Hoy son superficie de mantenimiento sin valor de usuario.
- **❓ `assertNoPII` muerto:** ¿conectar la guarda en `aggregateFeed`/`collectEvents` (defensa en profundidad real) o eliminar la función + corregir los comentarios que afirman que es "the last line of defense"? La privacidad ya está garantizada por la proyección whitelist; es cuestión de honestidad del comentario.
- **❓ `projectComparator` duplicado** (`services/projectComparator/` vs `services/multiProject/`): unificar a un canónico.
- **❓ Engines sin cablear `karinReportingEngine` y `monthlyClientReportBuilder`:** la ruta confidentialReports reimplementa retaliation sin usar el engine. ¿Migrar la ruta al engine o eliminar el engine?
- **⚠️ confidentialReports respond/close RMW:** considerar `runTransaction` para eliminar el race en `status` aunque esté bajo el umbral literal de CLAUDE.md #19.
