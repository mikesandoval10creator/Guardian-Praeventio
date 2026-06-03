# DEEP-EX-34 — Pasada exhaustiva línea-por-línea · Lote #34 · 2026-06-03

**Filtro ledger:** `category` empieza con `FEAT` && `block === "B18-Analitica"`,
ordenado por `path`, slice `[0:55]`. (125 archivos coinciden con el filtro; este
lote cubre los primeros 55.)

**Atestación: 55/55 archivos leídos completos, línea por línea.**

Code-first. No se repiten los hallazgos ya documentados en
`DEEP-B18-Analitica.md` (AlertScheduler con `probes={[]}`, ~16 componentes/hooks
huérfanos genéricos, `assertNoPII` muerto, `projectComparator` duplicado). Aquí
sólo van hallazgos **nuevos** o con detalle file:line adicional.

Severidad: 🔴 crítico · 🟡 medio · 🔵 menor/informativo.

---

## 1. Hallazgos NUEVOS

### 🔴 H1 — `SloErrorBudget` (`/admin/slo`) muestra datos SLO **fabricados** como reales
`src/pages/SloErrorBudget.tsx:95-118` (`fetchSloSamples`).
- El adapter intenta leer Firestore `slo_metrics/{sloId}/daily` (`:65-90`) y, si
  está vacío, **cae a un dataset sintético** generado con `Math.sin(i*0.7)` como
  ruido alrededor del target, más `totalSamples: 10_000` hardcoded (`:96-117`).
- Con esos números sintéticos calcula `computeBurn` → burn-rate, sparkline y
  badge **"On track / Warning / Alerting"** sin ningún indicador visual de que
  son sintéticos. Un admin que mire el dashboard de fiabilidad creerá que la
  producción está sana basándose en cifras inventadas.
- **Agravante (lo vuelve permanente):**
  1. La colección `slo_metrics` **no tiene regla** en `firestore.rules`
     (default-deny) → el `getDocs` del cliente **siempre** es denegado/vacío.
  2. **No existe ningún writer server-side** de `slo_metrics` en todo el repo
     (`grep -rln slo_metrics src server.ts` → solo la página).
  → La rama "producción" descrita en el comentario (`:57-61`, "Production
  replaces it with a Cloud Function…") es **inalcanzable**. El dashboard
  renderiza **siempre** datos falsos. El comentario de cabecera es honesto
  ("intentionally optimistic / synthetic"), pero el UID final no lo es.

### 🔴 H2 — `ReportGenerator` "Guardar en la Nube" sube a un path de Storage default-denegado
`src/components/ai/ReportGenerator.tsx:172-176`.
- Sube el PDF a `ai_reports/${selectedProject.id}/${fileName}` vía `uploadBytes`.
- `storage.rules` no tiene match para `ai_reports/**`; cae en el terminal
  **default-deny** `match /{allPaths=**} { allow read, write: if false }`
  (`storage.rules:159-160`).
- → El upload **siempre** es rechazado por reglas; el `catch` (`:196`) muestra
  "Error — Reintentar". La función "Guardar en la Nube" está rota en producción
  (la descarga local de PDF `handleDownloadPDF` sí funciona). El "Generar con IA"
  + render markdown también funcionan; sólo la persistencia cloud está muerta.

### 🟡 H3 — `ProjectsCompare` enrutado **siempre vacío**: comparador inalcanzable
`src/pages/ProjectsCompare.tsx:34-50` + `src/App.tsx:320,506`.
- La página depende 100% del prop `snapshots?` (default `{}`); el comentario dice
  "Caller server-side los pre-agrega" (`:35-38`).
- Pero en `App.tsx` se monta como `<ProjectsCompare />` **sin props** (líneas 320
  y 506). → `eligibleProjects` siempre vacío → **siempre** renderiza el empty
  state ("Sin proyectos con KPIs disponibles para comparar", `:80-103`).
- La tabla de ranking/KPIs nunca es alcanzable en producción. Feature enrutada
  pero UX muerta. (Distinto del hallazgo B18 de "engines duplicados"; esto es la
  página consumidora cableada en vacío.)

### 🟡 H4 — `CQRSArchitecture`: fachada demo in-memory presentada como "métricas en vivo"
`src/pages/CQRSArchitecture.tsx`.
- Tras el refactor ya NO usa `Math.random()` para los números (bien), pero el
  store es `InMemoryEventStore` (proceso-local, se reinicia) y todo el flujo del
  botón usa `tenantId:'demo-tenant'`, `issuedByUid:'demo-user'`,
  `projectId:'demo-project'` hardcoded (`:90-98`). El header "Event Store +
  Read Models — métricas en vivo" / "métricas REALES del store" sobrevende un
  sandbox de demostración.
- `generateDemoId()` usa **`Math.random()`** para IDs (`:49`). Es UI/demo (la
  regla #15 scoping es `src/server/` + ID-gen), pero es literalmente generación
  de IDs; preferible `randomId()`.

### 🟡 H5 — `WeatherBulletin` muestra UV/AQI **estimados** como datos factuales de seguridad
`src/components/dashboard/WeatherBulletin.tsx:54-111,148-149`.
- `estimateUVI` y `estimateAQI` son heurísticas hardcoded para Santiago
  (`SANTIAGO_ALT_MSNM=567` `:27`; tabla AQI por mes invernal `:71`) derivadas de
  un string de condición. Se renderizan como "Calidad del aire: Mala/Pésima"
  (`:202-207`) y alimentan recomendaciones de EPP (`:100-103`).
- El label "Ubicación simulada" sólo aparece cuando `weather` es `undefined`
  (`:181`); con `weather` presente, los UV/AQI estimados se muestran **sin
  disclaimer** de que son estimaciones, no medidas. Un trabajador puede tomar
  decisiones de EPP sobre AQI fabricado.

### 🟡 H6 — `SlopeStabilityPanel`: escritura Firestore en fase de render (anti-patrón React)
`src/components/engineering/SlopeStabilityPanel.tsx:57-62`.
- Dentro de un `useMemo` se llama `writeNodesDebounced([node], { projectId })`
  (`:60`) — side effect en render. En cada recompute/re-render (cualquier cambio
  de input o del padre) puede persistir nodos geotécnicos duplicados. Debe ir en
  `useEffect`. UI con strings en español hardcoded (no i18n), aceptable por ser
  panel de cálculo.

### 🟡 H7 — Drift de enum Ley Karin: hook+ruta usan `harassment`; servicio+componente usan `harassment_sexual`
- `src/hooks/useConfidentialReports.ts:13-19` declara `ConfidentialReportKindApi`
  = `harassment | safety | discrimination | violence | conflict_of_interest |
  other` (coincide con `src/server/routes/confidentialReports.ts:40` `'harassment'`).
- Pero `src/components/confidentialReports/ConfidentialReportInbox.tsx:22-30`
  consume `ConfidentialReportKind` de
  `services/confidentialReports/confidentialReportsService.ts:27-28`
  (`harassment_sexual`, `harassment_workplace`, `unsafe_behavior`…).
- → El componente huérfano está cableado a un **enum distinto** del API real,
  confirmando que no comparte tipo con la ruta viva. Riesgo si alguien lo cablea
  sin notar el desajuste.

### 🟡 H8 — `RealTimeStatusWidget.getRecommendation` por rama muerta (industry GP-* vs labels ES)
`src/components/dashboard/RealTimeStatusWidget.tsx:14,41-56`.
- `industry = selectedProject?.industry` y el `switch` compara contra
  `'Minería'`, `'Construcción'`, etc. Pero el resto del código (EPPRequiredWidget,
  AdviceBanner) usa prefijos `GP-MIN`/`GP-CONS`. Si `industry` es un código GP-*,
  el switch **siempre** cae al `default`. Recomendación sectorial inerte.
  (`challengeUtils.industryChallenges` también usa keys ES — mismo riesgo si la
  fuente real es GP-*.)

### 🔵 H9 — Imports muertos de `auth` en 4 hooks del lote
`auth` importado pero 0 usos (`auth.*`):
`src/hooks/useConfidentialReports.ts:6`, `src/hooks/useDataConfidence.ts:6`,
`src/hooks/usePortableHistory.ts:8`, `src/hooks/useWaste.ts:7`. También
`src/pages/ImportData.tsx:15` (`apiAuthHeader` se importa dinámico; `auth` queda
muerto). Lint/dead-code menor.

### 🔵 H10 — Huérfanos NUEVOS no enumerados en `DEEP-B18-Analitica.md`
0 importadores no-test (confirmado por grep):
- `src/components/dashboard/RoleAwareDashboard.tsx` — **además** su doc miente:
  cabecera dice *"Used in: Dashboard.tsx top section, replacing static widget
  mix"* (`:7`) pero `grep RoleAwareDashboard|buildRoleView src/pages/Dashboard.tsx`
  → 0. Doc-drift + huérfano.
- `src/components/dashboard/QuickActions.tsx` — el Dashboard importa
  `DashboardQuickActions`, no este. Huérfano (su propio comentario lo admite,
  `DashboardQuickActions.tsx:3-6`).
- `src/components/dashboard/EPPCharacter.tsx` — sólo mencionado en comentarios de
  `EPPRequiredWidget.tsx:3,50`, nunca importado. Además muestra EPP siempre
  "completo y verificado" (`:23`) sin estado real (cosmético).
- `src/components/excelImport/ExcelImportPreview.tsx` — 0 importadores.
- `src/components/safetyMetrics/SafetyTrendChartLazy.tsx` — 0 importadores
  (transitivo: `SafetyTrendChart` sólo lo usa `SafetyMetricsDashboard`, ya huérfano).
- `src/hooks/useAdoption.ts`, `src/hooks/useMultiProject.ts`,
  `src/hooks/useWaste.ts` — 0 consumidores (HTTP wrappers reales sin UI).

---

## 2. Tabla por archivo (55/55)

| # | Archivo | LOC | Estado | Cableado | Hallazgo (file:line) |
|---|---|---|---|---|---|
| 1 | components/ai/ReportGenerator.tsx | 456 | 🔴 | App/AI hub (1) | Cloud-save a `ai_reports/**` default-denegado en storage.rules → siempre falla (`:172`) |
| 2 | components/clientReporting/MonthlyClientReportPanel.tsx | 146 | 🔵 | 0 | Huérfano (B18) |
| 3 | components/confidentialReports/ConfidentialReportInbox.tsx | 153 | 🔵 | 0 | Huérfano; enum distinto al API (H7) |
| 4 | components/dashboard/AIInsightsModal.tsx | 103 | ✅ | App+Dashboard (2) | Presentacional real |
| 5 | components/dashboard/AdviceBanner.tsx | 105 | ✅ | Dashboard (1) | Tip diario determinista |
| 6 | components/dashboard/DashboardHero.tsx | 83 | ✅ | Dashboard (1) | Greeting time-aware |
| 7 | components/dashboard/DashboardQuickActions.tsx | 41 | ✅ | Dashboard (1) | Real |
| 8 | components/dashboard/EPPCharacter.tsx | 46 | 🔵 | 0 | Huérfano (H10); "verificado" cosmético |
| 9 | components/dashboard/EPPRequiredWidget.tsx | 82 | ✅ | Dashboard (2) | Industry-aware real |
| 10 | components/dashboard/ModuleGroupsGrid.tsx | 177 | ✅ | Dashboard (1) | Marquee + drawer real |
| 11 | components/dashboard/PlannerModal.tsx | 160 | ✅ | Dashboard (1) | Real |
| 12 | components/dashboard/PredictiveAlertWidget.tsx | 156 | ✅ | Dashboard (1) | Gemini real (B18) |
| 13 | components/dashboard/QuickActions.tsx | — | 🔵 | 0 | Huérfano (H10) |
| 14 | components/dashboard/RealTimeStatusWidget.tsx | 122 | 🟡 | Dashboard (1) | Rama getRecommendation muerta GP-* (H8) |
| 15 | components/dashboard/RoleAwareDashboard.tsx | 83 | 🔵 | 0 | Huérfano + doc miente (H10) |
| 16 | components/dashboard/WeatherBulletin.tsx | 332 | 🟡 | (4) | UV/AQI estimados como reales sin disclaimer (H5) |
| 17 | components/dashboard/challengeUtils.ts | 166 | ✅ | Dashboard/Planner | Puro; keys ES (ver H8) |
| 18 | components/dashboard/moduleGroups.ts | 244 | ✅ | ModuleGroupsGrid | Taxonomía de rutas |
| 19 | components/engineering/SlopeStabilityPanel.tsx | 142 | 🟡 | (1) | writeNodes en render (H6) |
| 20 | components/etl/CsvImportExportModal.tsx | 415 | ✅ | (3) | ETL CSV real |
| 21 | components/excelImport/ExcelImportPreview.tsx | 130 | 🔵 | 0 | Huérfano (H10) |
| 22 | components/monthlyClientReport/MonthlyClientReportCard.tsx | 137 | 🔵 | 0 | Huérfano (B18) |
| 23 | components/orgMetrics/OperationalPressureGauge.tsx | 87 | 🔵 | 0 | Huérfano (B18) |
| 24 | components/predictiveAlerts/PredictiveAlertsList.tsx | 78 | 🔵 | 0 | Huérfano (B18) |
| 25 | components/projects/PredictedActivityModal.tsx | 291 | ✅ | (1) | Modal real, Escape testeable |
| 26 | components/reportsAutomation/ReportTemplatePreview.tsx | 132 | 🔵 | 0 | Huérfano (B18) |
| 27 | components/safetyMetrics/SafetyMetricsDashboard.tsx | 275 | 🔵 | 0 | Huérfano (B18) |
| 28 | components/safetyMetrics/SafetyTrendChart.tsx | 186 | 🔵 | sólo #27 | Transitivo huérfano |
| 29 | components/safetyMetrics/SafetyTrendChartLazy.tsx | 25 | 🔵 | 0 | Huérfano (H10) |
| 30 | components/safetyPerformance/SpiDashboard.tsx | 97 | 🔵 | 0 | Huérfano (B18) |
| 31 | components/workerHistory/PortableHistoryPreview.tsx | 125 | 🔵 | 0 | Huérfano (B18); muestra fullName+rutHash por props |
| 32 | hooks/useAdoption.ts | 129 | 🔵 | 0 | HTTP wrapper sin consumidor (H10) |
| 33 | hooks/useCalendarPredictions.ts | 160 | ✅ | (4) | Fetch + engines puros, auth header |
| 34 | hooks/useConfidentialReports.ts | 146 | ✅🔵 | (2) | Real; import `auth` muerto (H9) |
| 35 | hooks/useDataConfidence.ts | 117 | ✅🔵 | (2) | Real; import `auth` muerto (H9) |
| 36 | hooks/useMultiProject.ts | 95 | 🔵 | 0 | Wrapper sin consumidor (H10) |
| 37 | hooks/useOrgMetrics.ts | 140 | 🔵 | 0 | Wrapper sin consumidor (B18) |
| 38 | hooks/usePortableHistory.ts | 142 | ✅🔵 | (2) | Real; import `auth` muerto (H9) |
| 39 | hooks/usePredictiveAlerts.ts | 89 | 🔵 | 0 | Wrapper sin consumidor (B18) |
| 40 | hooks/useProjectComparator.ts | 47 | 🔵 | 0 | Wrapper sin consumidor (B18) |
| 41 | hooks/useReportsAutomation.ts | 88 | 🔵 | 0 | Wrapper sin consumidor (B18) |
| 42 | hooks/useSafetyMetrics.ts | 99 | 🔵 | 0 | Wrapper sin consumidor (B18) |
| 43 | hooks/useSafetyPerformance.ts | 76 | 🔵 | 0 | Wrapper sin consumidor (B18) |
| 44 | hooks/useWaste.ts | 89 | ✅🔵 | 0 | Wrapper; import `auth` muerto (H9) + sin consumidor (H10) |
| 45 | pages/Analytics.tsx | 633 | ✅ | App | Recharts+Gemini+PDF reales (B18) |
| 46 | pages/CQRSArchitecture.tsx | 366 | 🟡 | App | InMemory demo vendido como "en vivo" + Math.random ID (H4) |
| 47 | pages/ConfidentialReports.tsx | 1248 | ✅ | App | allowsIdentity/reporterUid bien gestionado (`:721`) |
| 48 | pages/Dashboard.tsx | 346 | ✅ | App | Widgets reales (B18); NO usa RoleAwareDashboard |
| 49 | pages/DataConfidence.tsx | 636 | ✅ | App | Consume useDataConfidence; sin mock |
| 50 | pages/ExecutiveDashboard.tsx | 479 | ✅ | App | Recharts + tier-gate (B18) |
| 51 | pages/History.tsx | 238 | ✅ | App | milestones estáticos + reports Firestore scoped |
| 52 | pages/ImportData.tsx | 487 | ✅🔵 | App | Wizard real auth+server; import `auth` muerto (H9) |
| 53 | pages/IoTEdgeFiltering.tsx | 488 | 🔵 | App | MQTT real; default broker público HiveMQ (demo, tier-gated) |
| 54 | pages/ProjectsCompare.tsx | 323 | 🟡 | App (sin props) | Siempre empty state — comparador inalcanzable (H3) |
| 55 | pages/SloErrorBudget.tsx | 289 | 🔴 | App `/admin/slo` | Datos SLO sintéticos como reales; sin regla ni writer (H1) |

---

## 3. Limpios / sólidos (sin hallazgo material)

Engines/pages reales y bien construidos: `Analytics`, `ExecutiveDashboard`,
`Dashboard`, `DataConfidence`, `ConfidentialReports` (manejo correcto de
anonimato/identidad), `History`, `ImportData` (validate+commit server-side con
auth y cap 5MB), `CsvImportExportModal`, `PredictedActivityModal`,
`ModuleGroupsGrid`, `PlannerModal`, `AdviceBanner`, `DashboardHero`,
`AIInsightsModal`. Todos los hooks HTTP-wrapper usan `apiAuthHeaders()`/`Bearer`
y propagan errores sin filtrar internals. Los componentes huérfanos son
presentacionales reales (no stubs), gated por props.

---

## 4. Resumen ejecutivo (6-10 líneas)

Lote #34 (55/55 leídos). Dos hallazgos 🔴 de "datos falsos / función rota
presentada como real": **(H1)** `SloErrorBudget` (`/admin/slo`) renderiza
burn-rates y badges "On track/Alerting" **sintéticos** (`Math.sin` + 10k samples
hardcoded) — y es permanente porque `slo_metrics` no tiene regla Firestore
(default-deny) ni writer server-side, así que la rama "producción" del comentario
es inalcanzable; **(H2)** el "Guardar en la Nube" de `ReportGenerator` sube a
`ai_reports/**`, un path sin match en `storage.rules` que cae en el default-deny
→ siempre falla. Dos 🟡 de UX muerta/fachada: **(H3)** `ProjectsCompare` se monta
sin el prop `snapshots`, por lo que el comparador siempre queda en empty state;
**(H4)** `CQRSArchitecture` es un sandbox in-memory con tenant/user/project demo
hardcoded vendido como "métricas en vivo" (+ `Math.random()` para IDs). Otros 🟡:
`WeatherBulletin` muestra UV/AQI estimados sin disclaimer (H5), `SlopeStabilityPanel`
escribe Firestore en fase de render (H6), drift de enum Ley Karin hook-vs-servicio
(H7), rama muerta GP-* en `RealTimeStatusWidget` (H8). Menores: 5 imports `auth`
muertos (H9) y huérfanos nuevos —`RoleAwareDashboard` (con doc que miente que está
en Dashboard), `QuickActions`, `EPPCharacter`, `ExcelImportPreview`,
`SafetyTrendChartLazy`, `useAdoption/useMultiProject/useWaste` (H10). El resto del
lote es código real y sólido; los huérfanos son componentes presentacionales, no
stubs.
