# PENDIENTE — registro único de lo que falta para "app real y conectada"

**Esta es la ÚNICA fuente de verdad de lo pendiente.** Se trabaja SOLO desde aquí; al cerrar un ítem se actualiza aquí (con `file:line` del PR); los **gates** impiden que entre deuda nueva escondida. Consolidado el 2026-06-17 de: triage de huérfanos (workflow), discovery de honestidad, `docs/stubs-inventory.md` y `docs/PLAN-MAESTRO-HACER-REAL-2026-06-17.md`. Reemplaza el andar en círculos entre listas separadas.

**Honestidad sobre el alcance:** no es omnisciencia perfecta (el código es enorme). Es un ledger de las dimensiones conocidas, cada una con su nivel de confianza + gate. Lo que NO está medido-con-gate se marca explícito como "medir" — esa es una lista finita, no un redescubrir infinito.

---

## Contador maestro

| # | Dimensión | Cantidad | Medido | Gate |
|---|---|---|---|---|
| A | Huérfanos (construido, sin montar) | **126** (≈92 reales) | ✅ completo | ✅ `connectivity-ratchet` (#983) |
| B | Datos fabricados en pantallas montadas | ~38 hallados, **casi todos cerrados** | 🟡 parcial | ❌ falta gate |
| C | Stubs / placeholders | **86** | ✅ inventario | 🟡 `stub-guard` (forma, no conexión) |
| D | Pipelines backend sin construir | 3 | ✅ explícito | ❌ |
| E | Routers sin test conductual | **67 / 204** (137 verificados) | ✅ completo | ✅ `router-test-ratchet` |
| F | Decisiones del fundador | 6 | ✅ explícito | n/a (decisión) |

---

## A. Huérfanos — construido pero sin montar  ·  GATE: connectivity-ratchet (baseline 126)

El gran bloque de "trabajo hecho que no es real porque no está conectado". El detalle por archivo en `docs/BASELINE-CONECTIVIDAD-2026-06-17.md`. Corregido: de 126, ~18 son falsos positivos (utils/ya-montados) y ~10 duplicados → **~92 huérfanos reales**.

### A1. Montables YA — VIDA/LEGAL (24) — prioridad 1 (montar = hacerlo real)
Cada uno: la feature existe, su backend/motor es real, falta montarla. Una por PR, con review, bajando el contador del ratchet.

| Componente/Hook | Montar en | Esf. |
|---|---|---|
| `cphs/CphsCommitteeStatusCard` | CphsModule | M |
| `criticalRoles/CriticalRoleCoverageCard` | nueva CriticalRoles / staffing | M |
| `changeMgmt/ChangeDeclarationForm` + `MOCStatusPanel` + `AcknowledgmentBanner` | nueva ChangeManagement (MOC) | M |
| `correctiveActions/ActionBalanceCard` | CorrectiveActions | S |
| `compliance/ComplianceTrafficLight` | header Dashboard / ProjectDetail | S |
| `lineOfFire/LineOfFireValidationCard` | planificación de tarea | M |
| `hazmat/HazmatStorageManager` (DS 43/2016) | HazmatStorage / nueva HazmatInventory | M |
| `expirations/ExpirationsListPanel` | dashboard prevencionista | S |
| `useLegalObligations` | calendario legal (5 endpoints) | M |
| `privacy/PrivacyRegimeCard` | cumplimiento / Settings | M |
| `projectClosure/ProjectClosureCard` | ProjectClosure (page ya ruteada) | M |
| `evidenceChain/CustodyChainTimelineCard` | investigación de incidente | M |
| `regulatory/Iso45001Catalog` | cumplimiento / risk wizard | S |
| `euler/BucklingCalculatorCard` | auditoría estructural | S |
| `internalTransit/VehiclePreOpChecklistCard` | pre-uso de vehículo | M |
| `escalation/SlaWatchPanel` | dashboard prevencionista | M |
| `pinSign/PinSignModal` | firma no-biométrica (cierre/sign-off) | M |
| `workerHistory/PortableHistoryPreview` | historial portable | S |
| `useDocumentVersioning` | gestión documental | M |
| `useMicrotraining` | módulo microcapacitación | M |
| `useVulnerability` | mapa de vulnerabilidad | S |
| `useWaste` | inventario de residuos | S |

### A2. Montables YA — otros (33, hygiene)
audit/AuditExpressButton · climateAware/ClimatePlanAdjustment · coach/DomainPromptCatalog · cost/CostScenarioCard · costCalculator/PreventionROIWidget · culturePulse/CulturePulseDashboard · dashboard/RoleAwareDashboard · digital-twin/GaussianSplatViewer · documentHygiene/DocConfidenceCard + DocumentHygienePanel · excelImport/ExcelImportPreview · explainability/ExplainedRecommendationCard · fiveS/FiveSAuditForm · heatmap/FindingsHeatmapPreview · horometro/HorometroEntryForm + MaintenanceTaskList · identity/TaxIdInput · incidentFlow/AssignedMicrotrainingCard · knowledgeBase/KnowledgeBaseSearch · lessonsLearned/LessonSuggestionsCard · orgMetrics/OperationalPressureGauge · pdca/PdcaSummaryCard · positiveObservations/PositiveObservationsBoard · predictiveAlerts/PredictiveAlertsList · pricingCalculator/ROICalculatorWidget + TierComparatorWidget · protocols/IperMatrixCard · shared/ProjectScopedPage · vulnerability/VulnerabilityHeatmap · workerReadiness/WorkerReadinessCard · hooks: useAggregateTelemetry, useControlComparator, useStreamedGuardian

### A3. needs_design (35) — construido + servicio real, falta página/fetch o endpoint
La mayoría son presentadores puros cuyo servicio YA es real (SpofPanel, ContractorRankingTable, WasteInventoryPanel, HeatStressCard/WBGT, AirQualityPanel/CO2, GlossarySearchPanel, DeviationRadarPanel, NonConformityListPanel, MeetingPack, MonthlyClientReportPanel, LegalDocGeneratorForm, SafetyMetricsDashboard, SpiDashboard, EppInspectionForm, etc.). Falta una pieza de cableado de 1 paso (page que hace fetch + pasa props, o endpoint a exponer). Lista completa en BASELINE-CONECTIVIDAD.

### A4. duplicados (10) — consolidar (no montar, ya existen inline)
Revisar contra la pantalla que ya los renderiza; consolidar preservando capacidades.

### (no-deuda: 18 falsos positivos — NO re-investigar)
annualReview/*, apprenticeship/ApprenticeshipBoard, auditPortal/ExternalAuditPortalCard, digital-twin/RePositionConfirmDialog, adoption/ChurnRiskPanel, agenda/AgendaDigestCard, behaviorObservation/BbsProfileCard, cargo/CargoCogPanel, riskMatrix/RiskMatrix5x5Lazy, safetyMetrics/SafetyTrendChartLazy, maturity/MaturityIndexCard, measurements/MeasurementQualityCard, mentalLoad/MentalLoadSurveyForm, safety/SafetyCapsules, useSubmit, emergency/asesorPrompt (utils / ya referenciados vía lazy/barrel).

---

## B. Datos fabricados en pantallas montadas  ·  falta gate

Discovery encontró ~38; **lo de alto impacto se cerró esta sesión** (no re-listar):
- ✅ twin fantasma → posiciones reales (#966/#969) · curriculum "próximamente" → real (#967) · Simular-IoT inyección → demo aislada (#974/#976) · GamifiedHUD juego → gas real (#978) · trends Analytics fabricados → quitados/reales (#980/#982) · ClimateRoutes pines falsos → eventos EONET reales (#981) · audit-log 500 falsos (#979).

**Pendiente de confirmar cero:** correr un sweep de honestidad acotado SOLO de superficies montadas para confirmar que no queda dato fabricado, y luego construir un gate (regla anti-`Math.random`/sentinel-ignorado en componentes). Confianza media hasta entonces.

---

## C. Stubs / placeholders (86)  ·  GATE parcial: stub-guard

Inventario en `docs/stubs-inventory.md`. `precommit-stub-guard` valida la FORMA (TODO+503+test+registro) pero no que se conecten. Pendiente: triar los 86 → cuáles deben volverse reales vs son fail-soft legítimos.

---

## D. Pipelines de backend sin construir (3)

1. **SLO error-budget**: la lectura real `slo_metrics` existe; falta el job Sentry→`slo_metrics` (Cloud Function/cron). (SloErrorBudget hoy muestra "sin métricas" honesto.)
2. **Snapshot diario de cumplimiento**: para que ExecDash tenga tendencia de cumplimiento real (colección + cron + reglas + ≥5 rules-tests).
3. **Detección EPP real**: bloqueado-externo (no hay modelo EPP; COCO/MediaPipe no tiene clases EPP). El detector por color + disclaimer es el estado honesto interino (WP-I7).

---

## E. Routers sin test conductual  ·  MEDIDO + GATE: router-test-ratchet

Medido: **204 routers reales · 137 verificados** (un test importa el router real — por path `../../server/routes/x` **o** relativo co-locado `./x` — + usa supertest `request()`) · **67 sin cobertura** · solo 4 `router.stack` hollow (el "~144" del plan ya estaba limpiado). **Los 137 verificados = el inventario "qué funciona verificado (server)"** — el espejo positivo de este registro. Gate: `check-router-test-ratchet.cjs` (baseline 67, solo baja; router nuevo sin test → FAIL).

> Corrección de exactitud (2026-06-18): el ratchet contaba 76/128 por un **falso negativo** — solo detectaba imports por path completo y no los co-locados `./x`. Tras resolver imports relativos contra el dir del test, 9 routers ya cubiertos dejaron de aparecer como "sin cobertura": `loto`, `medicalAptitude`, `health`, `cad`, `openapi`, `b2d/{climate,hazmat,normativa,suite}`. El inventario ahora es honesto.

**Prioridad 1 — 6 routers VIDA/LEGAL sin test conductual** (escribir `*.router.test.ts` real: 401/200/400):
`evacuation` · `fatigue` · `refuges` · `expirations` · `criticalRoles` · `driving`. (`loto`, `medicalAptitude`, `health` y `b2d/hazmat` ya estaban cubiertos — eran falsos negativos del ratchet, ver corrección arriba.) Los 61 restantes (hygiene) en `scripts/router-test-ratchet-baseline.json`.

Nota: el gate detecta "tiene test real-router o no", NO un test que importa+request pero no asierta nada (hollow). Eso es un refinamiento posterior.

---

## F. Decisiones del fundador pendientes (6)

SII (bsale-only vs 2º PSE) · Ley Karin inbox (montar vs inline) · incidentFlow (cluster vs inline) · Driving (superficie de lanzamiento) · Risk hub (unificar 7 dirs) · 3D twin / wisdomCapsules (vivo vs descartar). Detalle en PLAN-MAESTRO.

---

## Gates activos (capa de medición que impide deuda nueva)

`connectivity-ratchet` (huérfanos A, #983) · `router-test-ratchet` (cobertura conductual E) · `any-ratchet` (155) · `i18n-parity` · `convention-guard` · `stub-guard` · `allowbackup-guard` · `medical-guard`. **Pendiente de construir:** gate de honestidad (B — anti-dato-fabricado en componentes montados).

## Regla anti-círculos

1. Todo lo pendiente vive AQUÍ. No abrir listas paralelas.
2. Al cerrar: marcar aquí con el PR + regenerar el baseline del ratchet correspondiente.
3. Antes de "descubrir" algo, buscarlo aquí primero.
4. Las dimensiones sin gate (B, E) se cierran construyendo su gate — entonces dejan de poder regresar.
