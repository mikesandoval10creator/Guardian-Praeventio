# DEEP — B2 Riesgo & IPER · 2026-06-02
**Archivos revisados:** 89 (45 fuente + 44 tests/firestore-tests). El detalle por archivo lista los de fuente; los `*.test.ts(x)` se agrupan al final.

Bloque "columna vertebral preventiva": motor IPER 5×5, 9 dominios de cómputo de riesgo
(risk-ranking, shift-risk, pre-shift-risk, residual-risk, risk-radar, bowtie, JSA,
critical-controls, maturity, findings-heatmap) más sus rutas HTTP, hooks, components y pages.

---

## 1. Lo que YA HACE (implementado y real)

- **Motor IPER puro y bien cableado.** `src/services/protocols/iper.ts:109` `calculateIper()`
  es una función pura determinística: matriz 5×5 `IPER_MATRIX` (`iper.ts:53`),
  `rawScore = P×S` (`iper.ts:114`), color y recomendación por nivel, reducción residual por
  `controlEffectiveness` (`iper.ts:95` `reduceLevel`). Sin side-effects, sin Firestore, valida
  rango `[1,5]` y lanza (`iper.ts:101`). Consumido por 10 sitios reales: `routes/protocols.ts`,
  `useProtocols.ts`, `geminiBackend.ts`, `gemini/suggestions.ts`, `safety/iperAssessments.ts`,
  components `IperMatrixCard`/`IPERCMatrix`/`IPERCAnalysis` y pages `Risks.tsx`/`Matrix.tsx`/
  `SafetyFeed.tsx`. Es el único engine del bloque con consumo UI productivo masivo.

- **9 engines de cómputo puros, mutation-test-grade.** Todos sin side-effects (los únicos
  "signals" son `now` inyectable con default `new Date()`, p.ej. `bowtieAnalysisBuilder.ts:155`,
  `controlRobustness.ts:206`, `repeatingRiskRadar.ts:360` — testeables/deterministas):
  `riskRankingEngine.ts` (166), `residualRiskEngine.ts` (227), `preventionMaturityIndex.ts` (394),
  `repeatingRiskRadar.ts` (416), `jobSafetyAnalysis.ts` (381), `bowtieAnalysisBuilder.ts` (245),
  `controlRobustness.ts` (291), `criticalControlsLibrary.ts` (131), `findingsHeatmapBuilder.ts` (189).
  Cada uno con su `*.test.ts` hermano.

- **Rutas mensurables y montadas.** Todas las rutas B2 están importadas y montadas bajo
  `/api/sprint-k` en `server.ts:1003-1135` (riskRadar:1003, residualRisk:1005, maturity:1006,
  riskRanking:1009, shiftRiskPanel:1010, preShiftRisk:1014, jsa:1057, bowtie:1058,
  criticalControls:1135). Todas usan `verifyAuth` + `assertProjectMember` (patrón `guard()`).
  El test `serverMountOrder.test.ts:133` documenta que riskRanking/shiftRiskPanel ya fueron
  rescatadas del estado "implementado pero no montado".

- **Pages productivas con cableado real:**
  - `ResidualRisk.tsx` (639) ← `useResidualRisks` ← `residualRisk.ts` (única ruta del bloque que
    **persiste**: `docRef.set(payload,{merge:true})` en `residualRisk.ts:378` + audit
    `residualRisk.create`/`.accept` en `:380`/`:429`). CRUD real + GET listados.
  - `MaturityIndicator.tsx` (489) ← `usePreventionMaturity` ← `maturity.ts` GET (compute-only).
  - `PreShiftRisk.tsx` (419) ← `usePreShiftRisk` ← `preShiftRisk.ts` GET `:89` (lee Firestore
    workers/incidentes/permits y compone en vivo con `composeShiftRiskPanel`; los `.set()` en
    `:349-350` son `Map.set`, no escrituras).
  - `FindingsHeatMap.tsx` (355) usa `findingsHeatmapBuilder` directamente (acepta findings de
    entrada; el fetch desde Zettelkasten aún es manual, ver §2).
  - `CriticalControlsView.tsx` (296) usa `criticalControlsLibrary` + `controlValidationsStore.ts`
    (persistencia client-side `saveControlValidation`/`subscribeControlValidations`). Ruta en
    `RiskRoutes.tsx:33`.
  - `RepeatingRisks.tsx` ← `RepeatingRiskRadarCard` ← riskRadar engine; ruta `App.tsx:299`.
  - `B2dAdminPanel.tsx` ← `ChurnCohortHeatmap`; ruta `App.tsx:510`.

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- **B2-D1 — CONFIRMADO. `useRiskRanking` GET stubs idle.** `src/hooks/useRiskRanking.ts:140`
  `useRiskTimeseries`, `:157` `useTopRisks`, `:174` `useWeakControls` devuelven
  `idleResult()` (`useRiskRanking.ts:122`: `{data:null, loading:false, error:null, refetch:NOOP}`)
  — **no hacen fetch**. Faltan 3 endpoints **GET** pull-based:
  `risk-ranking/timeseries`, `risk-ranking/top-risks`, `risk-ranking/weak-controls`
  (documentado en `useRiskRanking.ts:134-179` + comentario `:99-112`). La ruta
  `riskRanking.ts` solo expone 4 endpoints **POST push-based** (caller provee records):
  risks `:79`, weak-controls `:118`, zones `:154`, tasks `:191`. El patrón push no encaja con
  los dashboards pull. Tracked TODO §13 + `docs/stubs-inventory.md`.

- **B2-D2 — CONFIRMADO. `useShiftRiskPanel` sin consumidor UI.** `src/hooks/useShiftRiskPanel.ts:41`
  `composeShiftRiskPanelApi` no tiene **ningún** consumidor `.tsx` (grep: solo la mención en
  `serverMountOrder.test.ts:135`). Su ruta `shiftRiskPanel.ts:105` (POST `/shift-risk-panel/compose`)
  está montada pero huérfana. **Fue superseded** por `usePreShiftRisk` (`usePreShiftRisk.ts:23`) +
  ruta GET `preShiftRisk.ts:89`, que es lo que realmente usa `PreShiftRisk.tsx:92`. Ambos comparten
  el mismo engine `preShiftRiskComposer`. → `useShiftRiskPanel.ts` + `shiftRiskPanel.ts` son
  duplicado muerto candidato a borrado.

- **Cluster de components huérfanos (compilan, 0 consumidores en todo `src`):**
  - `riskRanking/`: `TopRisksDashboardCard.tsx`, `WeakControlsDashboardCard.tsx`,
    `RiskTimeseriesChart.tsx` — solo se consumen entre sí o envuelven a `TopRisksWidget`/
    `WeakControlsWidget`, pero **ninguno está montado en ninguna page/route**. Dependen además de
    los hooks idle de B2-D1, así que aunque se montaran renderizarían estado vacío.
  - `TopRisksWidget.tsx`, `WeakControlsWidget.tsx`: puros (records-in/list-out), solo usados por
    las DashboardCards huérfanas. El comentario `WeakControlsWidget.tsx:7` afirma "Used in:
    ProjectDetail right sidebar" — **falso/aspiracional**, no existe ese import.
  - `vulnerability/VulnerabilityHeatmap.tsx` (139), `heatmap/FindingsHeatmapPreview.tsx` (171),
    `maturity/MaturityIndexCard.tsx` (184), `shiftRiskPanel/PreShiftRiskCard.tsx` (190),
    `pymeOnboarding/PymeMaturityWizard.tsx` (130), `riskMatrix/RiskMatrix5x5.tsx` (208) +
    `RiskMatrix5x5Lazy.tsx` (27), `residualRisk/ResidualRiskCard.tsx` (141): **cero consumidores**.
    Nota: `ResidualRisk.tsx` define su PROPIO `ResidualRiskCardItem` interno (`ResidualRisk.tsx:86`)
    en vez de usar el component compartido → el standalone está muerto.

- **Hooks sin consumidor UI:** `useBowtie.ts` (99), `useCriticalControls.ts` (201) — ningún `.tsx`
  los importa. `CriticalControlsView` va por `controlValidationsStore`+`library` directo, no por
  el hook. Los engines bowtie/JSA tienen ruta HTTP pero **ninguna page** (`useBowtie`/`useJsa`/
  `bowtieAnalysisBuilder`/`jobSafetyAnalysis` → 0 consumidores `.tsx`).

- **`FindingsHeatMap.tsx:48`** documenta inline que el fetch desde el grafo Zettelkasten es
  pendiente; la page hoy acepta findings manuales.

---

## 3. Tabla por archivo (TODOS)

Estados: ✅ implementado+cableado · 🟡 implementado, cableado parcial/incompleto · 🏚️ huérfano (0 consumidores) · 🔵 stub/idle declarado · 🔑 seguridad/persistencia crítica

| Archivo | LOC | Estado | Cableado | Propósito real + hallazgo file:line |
|---|---|---|---|---|
| services/protocols/iper.ts | 135 | ✅🔑 | 10 consumidores | Motor IPER 5×5 puro. `calculateIper` iper.ts:109; matriz :53; residual :95 |
| services/riskRanking/riskRankingEngine.ts | 166 | ✅ | ruta + hook (push) | rankRisks/WeakControls/Zones/Tasks puros. Sin side-effects |
| services/residualRisk/residualRiskEngine.ts | 227 | ✅ | page ResidualRisk | Engine puro de riesgo residual |
| services/maturity/preventionMaturityIndex.ts | 394 | ✅ | page Maturity | Índice de madurez preventiva, puro |
| services/riskRadar/repeatingRiskRadar.ts | 416 | ✅ | page RepeatingRisks | Radar de riesgos recurrentes; `now` inyectable :360 |
| services/jsa/jobSafetyAnalysis.ts | 381 | 🟡 | ruta sí, page no | Engine JSA puro; sin consumidor UI |
| services/bowtie/bowtieAnalysisBuilder.ts | 245 | 🟡 | ruta sí, page no | Bowtie puro; `now` inyectable :155; sin UI |
| services/criticalControls/controlRobustness.ts | 291 | ✅ | engine | Robustez de controles; `nowIso` default :206 |
| services/criticalControls/criticalControlsLibrary.ts | 131 | ✅ | CriticalControlsView | Librería + validatePreTask, consumida por la page |
| services/criticalControls/controlValidationsStore.ts | 77 | ✅🔑 | CriticalControlsView | Persistencia client-side `collection()` :56 (save/subscribe) |
| services/heatmap/findingsHeatmapBuilder.ts | 189 | ✅ | page FindingsHeatMap | Builder de heatmap puro |
| server/routes/riskRanking.ts | 211 | 🟡 | montada :1009 | 4 POST compute-only (risks:79/weak:118/zones:154/tasks:191). Faltan 3 GET (B2-D1) |
| server/routes/shiftRiskPanel.ts | 126 | 🏚️ | montada :1010, hook huérfano | POST compose :105 compute-only. Superseded por preShiftRisk (B2-D2) |
| server/routes/preShiftRisk.ts | 457 | ✅🔑 | page PreShiftRisk | GET :89 lee Firestore y compone en vivo. `.set` :349-350 son Map, no escrituras |
| server/routes/residualRisk.ts | 439 | ✅🔑 | page ResidualRisk | **Única ruta persistente**: set :378 + audit create:380/accept:429. GET :231/:278 |
| server/routes/maturity.ts | 405 | ✅ | page Maturity | 1 GET :82 compute-only, sin escrituras/audit |
| server/routes/criticalControls.ts | 371 | 🟡 | montada :1135 | 9 POST compute-only (:110..:351). Persistencia vive en store client-side |
| server/routes/jsa.ts | 168 | 🟡 | montada :1057, sin page | 3 POST compute-only (:81/:109/:140) |
| server/routes/bowtie.ts | 237 | 🟡 | montada :1058, sin page | 3 POST compute-only (:145/:189/:217) |
| server/routes/riskRadar.ts | 285 | ✅ | page RepeatingRisks | 1 GET :145 compute (lee findings). `.set` :207-208 son Map |
| hooks/useRiskRanking.ts | 180 | 🔵 | 4 mutators ok / 3 GET idle | **B2-D1**: useRiskTimeseries:140, useTopRisks:157, useWeakControls:174 → idleResult:122 |
| hooks/useShiftRiskPanel.ts | 50 | 🏚️ | sin consumidor | **B2-D2**: composeShiftRiskPanelApi:41 nunca importado en .tsx |
| hooks/usePreShiftRisk.ts | 38 | ✅ | page PreShiftRisk | GET hook real :23; reemplaza a useShiftRiskPanel |
| hooks/useResidualRisk.ts | 122 | ✅ | page ResidualRisk | useResidualRisks consumido por ResidualRisk.tsx |
| hooks/useMaturityIndex.ts | 36 | ✅ | page Maturity | usePreventionMaturity consumido por MaturityIndicator.tsx |
| hooks/useBowtie.ts | 99 | 🏚️ | sin consumidor | Hook bowtie sin ningún import .tsx |
| hooks/useCriticalControls.ts | 201 | 🏚️ | sin consumidor | Page usa store/library directo, no este hook |
| pages/ResidualRisk.tsx | 639 | ✅ | App.tsx:288 | CRUD residual real; define ResidualRiskCardItem interno :86 |
| pages/MaturityIndicator.tsx | 489 | ✅ | App.tsx:296 | Madurez preventiva, GET |
| pages/PreShiftRisk.tsx | 419 | ✅ | App.tsx:304 | Panel pre-turno via usePreShiftRisk :92 |
| pages/FindingsHeatMap.tsx | 355 | 🟡 | App.tsx:317 | Heatmap; fetch Zettelkasten pendiente :48 |
| pages/CriticalControlsView.tsx | 296 | ✅ | RiskRoutes.tsx:33 | Controles críticos + validación + persistencia store |
| components/protocols(*)/IperMatrixCard etc | — | ✅ | Risks/Matrix | (fuera de ledger B2 pero consumen iper.ts) |
| components/criticalControls/BarrierAnalysisCard.tsx | 135 | ✅ | CriticalControlsView, LessonsLearned | Análisis de barreras, consumido |
| components/riskRadar/RepeatingRiskRadarCard.tsx | 90 | ✅ | RepeatingRisks.tsx | Card radar, consumida |
| components/admin/ChurnCohortHeatmap.tsx | 91 | ✅ | B2dAdminPanel.tsx | Heatmap churn (admin), consumida |
| components/riskRanking/TopRisksWidget.tsx | 88 | 🏚️ | solo DashboardCard huérfana | Comentario "ProjectDetail sidebar" :7 es falso |
| components/riskRanking/WeakControlsWidget.tsx | 76 | 🏚️ | solo DashboardCard huérfana | Idem, sin montaje real |
| components/riskRanking/TopRisksDashboardCard.tsx | 117 | 🏚️🔵 | 0 consumidores | Usa useTopRisks idle (B2-D1), no montada |
| components/riskRanking/WeakControlsDashboardCard.tsx | 121 | 🏚️🔵 | 0 consumidores | Usa useWeakControls idle (B2-D1), no montada |
| components/riskRanking/RiskTimeseriesChart.tsx | 169 | 🏚️🔵 | 0 consumidores | Usa useRiskTimeseries idle (B2-D1), no montada |
| components/residualRisk/ResidualRiskCard.tsx | 141 | 🏚️ | 0 consumidores | Page usa su propio item interno, este muerto |
| components/maturity/MaturityIndexCard.tsx | 184 | 🏚️ | 0 consumidores | Sin import en page Maturity |
| components/shiftRiskPanel/PreShiftRiskCard.tsx | 190 | 🏚️ | 0 consumidores | Page PreShiftRisk no lo usa |
| components/heatmap/FindingsHeatmapPreview.tsx | 171 | 🏚️ | 0 consumidores | Preview huérfano |
| components/vulnerability/VulnerabilityHeatmap.tsx | 139 | 🏚️ | 0 consumidores | Heatmap vulnerabilidad huérfano |
| components/pymeOnboarding/PymeMaturityWizard.tsx | 130 | 🏚️ | 0 consumidores | Wizard de madurez PYME no montado |
| components/riskMatrix/RiskMatrix5x5.tsx | 208 | 🏚️ | 0 consumidores | Matriz 5×5 UI huérfana |
| components/riskMatrix/RiskMatrix5x5Lazy.tsx | 27 | 🏚️ | 0 consumidores | Wrapper lazy del anterior, huérfano |
| **Tests (44)** | — | ✅ | — | `__tests__/server/*.test.ts` (7: bowtie, criticalControls, jsa, maturity, preShiftRisk, residualRisk, riskRadar), `routes/*.test.ts` (10), `services/**/*.test.ts` (11), `components/**/*.test.tsx` (8), `pages/*.test.tsx` (5), `controlValidationsStore.firestore.test.ts`, `iper.test.ts`. Cubren los engines y rutas reales |

**Compute-only (POST stateless, sin persistencia ni audit):** riskRanking (4), shiftRiskPanel (1),
criticalControls (9), jsa (3), bowtie (3), maturity GET (1).
**Read-compute (GET, lee Firestore y computa, no escribe):** preShiftRisk, riskRadar.
**Persistentes (escriben Firestore + audit):** residualRisk (set+audit create/accept).
**Persistencia client-side SDK:** controlValidationsStore (CriticalControlsView).

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **B2-D2 duplicado muerto.** `useShiftRiskPanel.ts` + `server/routes/shiftRiskPanel.ts` están
  superseded por `usePreShiftRisk` + `preShiftRisk.ts` (mismo engine `preShiftRiskComposer`).
  ¿Borrar el par huérfano o reasignarlo a un caso distinto (compose ad-hoc sin Firestore)?

- ❓ **Cluster riskRanking dashboards (B2-D1).** Decisión de diseño: ¿implementar los 3 GET
  pull-based (`timeseries`/`top-risks`/`weak-controls`) y montar las DashboardCards en
  ProjectDetail/Home, o eliminar las 3 cards + 2 widgets + 3 hooks idle? Hoy son ~570 LOC de UI
  muerta dependiente de stubs. Comentario engañoso "Used in: ProjectDetail" en
  `WeakControlsWidget.tsx:7` debería corregirse en cualquier caso.

- ❓ **8 components huérfanos sin relación con stubs** (ResidualRiskCard, MaturityIndexCard,
  PreShiftRiskCard, FindingsHeatmapPreview, VulnerabilityHeatmap, PymeMaturityWizard,
  RiskMatrix5x5(+Lazy)): ~1190 LOC. Sus pages hermanas existen y funcionan con UI propia/inline.
  ¿Adoptarlos en las pages (DRY) o eliminarlos? RiskMatrix5x5 es candidato fuerte a reuso en
  ResidualRisk/Risks.

- ⚠️ **Engines bowtie + JSA tienen ruta HTTP montada pero ninguna page** (useBowtie también
  huérfano). Funcionalidad de cómputo lista pero invisible al usuario. ¿Page pendiente o cómputo
  solo-API intencional? Si es intencional, falta marcar/feature-flag por directiva #13.

- ✅ **No hay violaciones de pureza** en los 10 engines del bloque (los `new Date()` son defaults
  inyectables). El motor IPER cumple directiva #9.
