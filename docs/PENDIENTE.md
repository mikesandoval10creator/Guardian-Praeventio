# PENDIENTE — registro único de lo que falta para "app real y conectada"

**Esta es la ÚNICA fuente de verdad de lo pendiente.** Se trabaja SOLO desde aquí; al cerrar un ítem se actualiza aquí (con `file:line` del PR); los **gates** impiden que entre deuda nueva escondida. Consolidado el 2026-06-17 de: triage de huérfanos (workflow), discovery de honestidad, `docs/stubs-inventory.md` y `docs/PLAN-MAESTRO-HACER-REAL-2026-06-17.md`. Reemplaza el andar en círculos entre listas separadas.

**Honestidad sobre el alcance:** no es omnisciencia perfecta (el código es enorme). Es un ledger de las dimensiones conocidas, cada una con su nivel de confianza + gate. Lo que NO está medido-con-gate se marca explícito como "medir" — esa es una lista finita, no un redescubrir infinito.

---

## Contador maestro

> **Re-verificado 2026-06-21** (auditoría de 8 bloques recomputada contra el código + app viva). Las cifras del 06-19 ya estaban viejas (decían 89/61); reales abajo. App **viva y sana** en https://guardian-praeventio-dhmmqy7oaq-tl.a.run.app (`/api/health` 200, firestore ok). Detalle nuevo en la sección "Reconciliación 2026-06-21".

| # | Dimensión | Cantidad (verificada 06-19) | Medido | Gate |
|---|---|---|---|---|
| A | Huérfanos (construido, sin montar) | **39** (era 126→89→39; capture waves) | ✅ ratchet recomputado 06-21 | ✅ `connectivity-ratchet` (baseline 39) |
| B | Datos fabricados en pantallas montadas | **0 confirmados** (el `WisdomCapsule` era falso positivo — ver detalle); pantallas montadas honestas | ✅ sweep completo + verificado en fuente | ❌ gate honestidad opcional (debe distinguir decorativo de dato-fabricado) |
| C | Stubs / placeholders | 86 inventario → **~9 accionables** (3 REAL-NEEDED · 3 fail-soft legítimo · 1 bloqueado-externo · 3 entradas STALE) | ✅ triado | 🟡 `stub-guard` (forma, no conexión) |
| D | Pipelines backend sin construir | 3 | ✅ explícito | ❌ |
| E | Routers sin test conductual | **10 / 205** (195 verificados; era 61/204) | ✅ ratchet recomputado 06-21 | ✅ `router-test-ratchet` (baseline 10) |
| F | Decisiones del fundador | **6 RESUELTAS 2026-06-20** (RUT F1 confirmado 78.231.119-0) | ✅ resuelto | n/a (decisión) |
| B0 | Índice de rutas (`api-routes.md`) | **viejo: 43 de 204 rutas** (del 2026-04-28). Generador+gate pendiente | ✅ medido (~1501 decl. de ruta) | ❌ falta generador |

### Hallazgos de la re-verificación 06-19 (detalle)
- **B (honestidad) — RE-VERIFICADO EN FUENTE 2026-06-20: limpio (0 fabricaciones).** El supuesto `WisdomCapsule` era **falso positivo**: `MorningRoutine.tsx:160-184` YA hace fetch a `GET /api/wisdom-capsule/today` y muestra la cápsula **real** (agregada de findings/crews del proyecto) cuando hay proyecto. El quote Sun Tzu de `WisdomCapsule.tsx` solo aparece como fallback **sin proyecto** (`{!selectedProject?.id && ...}`) y en el splash `ConsciousnessLoader` — un quote genérico **atribuido** es decorativo, no dato fabricado presentado como métrica real. F6 (cablear capsules reales) ya satisfecho. Lección aplicada: revisar la FUENTE, no el render. Lo demás ya estaba real (cierres #966-#982).
- **C (stubs) REAL-NEEDED (3):** (1) `src/server/jobs/runB2dMrrSnapshot.ts:15` job sin cron (backend listo) · (2) `src/hooks/useGeofenceWithEvents.ts` hook real sin consumer (panel admin geocercas) · (3) Wi-Fi Direct nativo `packages/capacitor-mesh/.../MeshPlugin.kt:552` + `Plugin.swift:350` (BLE ya real; falta WifiP2pManager/MultipeerConnectivity).
- **C STALE (3) — quitar del inventario:** SLM mock (ya runtime real), criticalPermitValidators (ya ruteado), SystemEngineProvider (ya montado).
- **B0 (índice):** OpenAPI registry solo cubre 34 paths (superficie pública B2D, intencional). El catálogo interno real son ~1501 decl. de ruta en 204 routers → mano imposible, requiere generador determinista + gate de frescura.

---

## Reconciliación 2026-06-21 — Auditoría de 8 bloques (código + app viva)

Auditoría profunda (8 sub-agentes, reconciliando código real vs PENDIENTE A–F + TODO.md §2.32–34 + PHASE5 B1–B18 + stubs-inventory). **La app está viva y su núcleo es real; la deuda restante es mayormente comercial/hygiene + claves de consola.** Detalle conversacional con `file:line` en el output del workflow del 06-21.

### Decisiones del fundador (F): MAYORMENTE CONSTRUIDAS, no solo decididas
- **incidentFlow** → ✅ DONE: hub dedicado `/incident-flow` montado, lista real (`IncidentFlowHub.tsx`).
- **Ley Karin** → 🟡 PARCIAL: página `ConfidentialReports` montada (`/confidential-reports`), anonimato real, SLA Ley 21.643. **GAP: falta la notificación al project lead** (hoy solo audita + inbox de polling) — `confidentialReports.ts:248`.
- **Driving** → 🟡 PARCIAL: módulo `/driving` + speed-trigger real (`DrivingSuggestion`) + voz real (`SafeDrivingMode`/`GuardianVoiceAssistant`). **GAP: botones del dock son toast-stub** (persistencia delegada al `SafeDrivingMode` embebido) + `/driving` no está en ningún menú — `Driving.tsx`.
- **Risk hub** → 🟡 PARCIAL: `/hub/risks` unifica los dirs con guía inductiva IA real. **GAP: stats/equipos/responsabilidades son data DEMO hardcodeada** — `ModuleHub.tsx:47-69,116-119` (esto es dato fabricado en pantalla montada = dimensión B).
- **3D twin / wisdomCapsules** → 🟡 PARCIAL: `/digital-twin` + `/digital-twin/ar` reales, anchors Firestore reales, cápsulas ZK reales (Sun Tzu solo fallback). **GAP: el link de menú "Gemelo Digital 3D" apunta a `/hub/operations/digital-twin` que NO existe → cae al catch-all (Dashboard); las rutas reales no están en ningún menú** — `sidebarMenuGroups.ts:362`.

### Deuda real ABIERTA por severidad
**🔴 VIDA-LEGAL**
- **Crons de re-escalación man-down/lone-worker → ✅ RESUELTO 06-21.** Faltaban (deploy los creaba con SA inexistente + `continue-on-error` → fallo silencioso). Creados manualmente en cowork: SA `climate-scan-sa` + grant tokenCreator al agente de Scheduler + 2 jobs HTTP OIDC en us-central1 (man-down `* * * * *`, lone-worker `*/5`). **Verificado 200 en logs Cloud Run** (21:24/21:25). PENDIENTE follow-up: codificarlos en `infrastructure/terraform/scheduler.tf` para que un re-deploy/DR no dependa de creación manual.
- F1 Ley Karin notificación al lead (arriba). F4 Driving dock persistencia (arriba).
- e2e `offline-resilience` + `process-lifecycle` siguen `describe.fixme` (offline en faena = safety) — `tests/e2e/*`.
- DTE/SII sin claves Bsale → pagos cobrados quedarían sin boleta/factura (solo aplica al cobrar).

**🟠 SEGURIDAD**
- **App Check ausente** (0 refs; CLAUDE.md lo cita como defensa pero no existe) — `[código]`.
- **Runtime SA = compute por defecto** (rol Editor, no least-privilege) — `deploy.yml` sin `--service-account` — `[IAM cowork]`.
- P8 RAG nodos global/community sin gate (self-poisoning) — `networkBackend.ts:62-65`.
- guard-hang → ✅ resuelto en PR #1107 (falta merge).

**🟡 COMERCIAL** (cuando se venda): MercadoPago (`MP_ACCESS_TOKEN` falta + montar en deploy + `MP_ENV=prod`); Webpay/Khipu en sandbox (faltan claves prod + flags `WEBPAY_ENV`/`KHIPU_ENV`); Apple IAP (iOS in scope, 4 claves); Google Play SA JSON vacío (bloqueado hasta publicar app); pipelines D-SLO y D-compliance-snapshot sin construir; ~17 huérfanos comerciales + 10 routers sin test.

**⚪ HYGIENE**: 39 huérfanos (6 falsos positivos a limpiar del baseline: TaxIdInput, ProjectScopedPage, useSubmit, TwinSceneInstancedLazy, +); any-ratchet 155; tests huecos co-located redundantes (cada router vida-safety YA tiene companion conductual real); 3 `JSON.parse` crudos en `services/gemini/*`.

### Correcciones de doc-drift (esto causaba la incertidumbre)
- TODO.md header llama "phantom mount" a 3 dashboards → **FALSO**: re-homed a `SafetyMetrics.tsx:314/498/611`, renderizados + ruteados.
- "cascarón CphsModule.tsx:825" → **FALSO**: container real con handlers cableados.
- D4 ContractorPerformance "no construido / rama descartada" → **FALSO**: feed real existe (`contractors.ts:235-304,417-485`, montado + test).
- B11 driving_incidents "sin regla", ClimateRoutes "Calcular Ruta" sin cablear, B10 horometer "bloquea", B13 CriticalRoleCoverageCard "huérfano" → **todos ya resueltos** en código.
- Secretos: `VITE_FIREBASE_VAPID_KEY` y 18+ secretos = **reales** (verificado en Secret Manager); `RESEND_API_KEY` inválido (len 6) y `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` vacío `{}`.
- **OJO validate-env NO corre en boot** (sin `prestart`, entrypoint Dockerfile = `tsx server.ts`): el drift deploy.yml↔validate-env NO tumba el arranque (la app vive); solo deja features en fail-closed.

---

## Actualización 2026-06-19 — Auditoría de la ola MiMo (#1000+) + 2 auditorías externas

Auditoría cruzada (5 sub-agentes ponytail/impacto + 2 PDFs línea-por-línea de 40k LOC en `docs/audits/archive/` + review de 24 PRs abiertos). MiMo (IA Xiaomi) cableó huérfanos; **mayoría real, pero con fallos sistémicos** (no tenía specs ni merge-gate). Detalle en memoria `project_mimo_pr_wave_1000_2026-06-19` y plan `PLAN-MAESTRO-HACER-REAL`.

### Cerrado
- ✅ **#1069** — regresión #1039 revertida: fingerprint Android `assetlinks.json` restaurado + 245 `.claude/skills/` destrackeados (rompían ESLint gate) + main desbloqueado.
- ✅ **6 routers VIDA/LEGAL** (evacuation/fatigue/refuges/expirations/criticalRoles/driving) — ya tienen test conductual real (bucket E baja a verificar con `--write`).
- ✅ **Datos fabricados** (bucket B alto impacto) — confirmados cerrados y vigentes por el verificador.

### Nuevo pendiente (de la ola MiMo)
- **3 MOUNTS FANTASMA vida-safety** — `safetyMetrics/SafetyMetricsDashboard` (#1038), `spi/SpiDashboard` (#1039), `orgMetrics/OperationalPressureGauge` (#1034). Confirmado 2026-06-20: solo se referencian en sus tests (no renderizan), siguen huérfanos. **RECLASIFICADO: NO es un re-mount — es Bucket D (pipeline de agregación).** Los 3 endpoints (`safetyMetrics`/`safetyPerformance`/`org-metrics`) son **calculadoras puras** (reciben los inputs en el body, no leen Firestore); los componentes computan client-side. Montarlos = necesitan **inputs reales agregados** que en parte NO tienen fuente: SafetyMetrics necesita `exposure` (horas-hombre trabajadas — sin fuente real hoy); OperationalPressureGauge necesita `overtimeHoursWeekTotal` + `absenteeismRate` (sin fuente). Derivables sí: `minorIncidentsLast7d`/lagging (de `incidents`), `totalActiveWorkers` (de `/roster` #1071), leading (de inspecciones/capacitaciones). **Decisión fundador (2026-06-20): destino = PÁGINA DE MÉTRICAS DEDICADA** una vez exista la agregación. Montar con ceros/inventado = cascarón (lo que pasó en #1034/38/39). → primero construir agregadores de inputs (define fuentes faltantes), luego la página.
- **CASCARÓN CphsModule → ✅ RESUELTO** (verificado 2026-06-20): `CphsModule.tsx:733` usa `useProjectRoster(projectId)` y `:827` pasa `candidateMembers={roster}` (lista real vía `/roster` #1071). La nota original (`candidateMembers={[]}`) era de un snapshot pre-fix. El comité paritario SÍ se constituye con datos reales.
- **CASCARONES menores**: `src/pages/Glossary.tsx:152` (`faqs={[]}`), `B2dAdminPanel.tsx:312` (`cohorts={[]}`, honest-empty documentado, necesita job de snapshot — bucket D).
- **PRs problemáticos — estado 2026-06-20 (drain):** #1051 useAdoption **✅ YA REAL** (de-fabricado: usa `projects.length` + `isPremium||isEnterprise` reales; entró en bundle #1075). #1059 useRoiScenario **⛔ cascarón, bloqueado** (fetch descartado, no renderiza). #1055 useVendorOnboarding **⛔ cascarón, bloqueado** (`compliance:[]`/`requirements:[]`). #1049 useProjectComparator (verificar estado — usar `useMultiProject` si sigue abierto). #1036 SupervisorBriefingCard (arrays vacíos — verificar).
- **Drain de la ola 2026-06-20:** 9 montajes verificados-reales mergeados en bundle #1074 (connectivity 89→81); #1075 (adoption real + read-pipeline docs) en CI. Los 9 PRs individuales (#1064/1062/1061/1063/1065/1066/1067/1068/1053) cerrados/superados.

### Gates a construir (cierran las dimensiones sin gate)
- **render-ratchet** (cierra B y los mounts fantasma): exigir que el símbolo aparezca en JSX, no solo importado. El connectivity-ratchet actual cuenta cualquier aparición textual → no detecta fantasmas.
- **coverage-gate** bloqueante (hoy `check-coverage-ratchet.cjs` es report-only sin `coverage-floors.json`).
- **scope-gate anti-#1039**: rechazar PR cuyo título "mount X" toca off-limits (assetlinks/firestore.rules/.claude/.env/baselines).

### Bloat ponytail (limpieza, ~2.170 LOC + 3-5 deps)
5 `*Backend.ts` muertos (chemical/training/prediction/medicine/safetyEngine, supersedidos por `gemini/*`), 3 AI files muertos, 2 cards muertas (ResidualRiskCard/MaturityIndexCard), deps (`@mediapipe/camera_utils`, `@playcanvas/react`, `@pinecone` SDK, `d3`→`d3-force`), 6 scripts one-shot, 4 Dockerfiles muertos. NO tocar `packages/capacitor-mesh` (BLE real, refutado).

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

## D. Pipelines de backend sin construir (3: D1 SLO + D2 snapshot ABIERTOS · D3 EPP blocked-external · D4 ✅ construido)

1. **SLO error-budget**: la lectura real `slo_metrics` existe; falta el job Sentry→`slo_metrics` (Cloud Function/cron). (SloErrorBudget hoy muestra "sin métricas" honesto.)
2. **Snapshot diario de cumplimiento**: para que ExecDash tenga tendencia de cumplimiento real (colección + cron + reglas + ≥5 rules-tests).
3. **Detección EPP real**: bloqueado-externo (no hay modelo EPP; COCO/MediaPipe no tiene clases EPP). El detector por color + disclaimer es el estado honesto interino (WP-I7).
4. **Feed `ContractorPerformance` → ✅ CONSTRUIDO** (verificado 2026-06-21; la nota 2026-06-20 abajo era STALE doc-drift — el feed real se construyó *después*). El feed real existe end-to-end:
   - `POST /:projectId/contractors/exposure` (`contractors.ts:235-236`) captura man-hours reales por contratista en la colección **`contractor_exposure_hours`** (`contractors.ts:257`, server-stamped `recordedBy`/`recordedAt`, `audit_logs` awaited, role-gated).
   - `GET /:projectId/contractors/performance` (`contractors.ts:417-418`) lee incidentes **reales** por `contractorId` y corre el motor OSHA (`classifyIncidents` `:472` + `buildSafetyMetricsReport` `:473`) → TRIR/LTIFR por contratista con empty-state honesto.
   - Montado: `server.ts:374` (import) + `server.ts:1183` (`app.use('/api/sprint-k', contractorsRouter)`). Cliente: `useContractorPerformance`. Renderizado: `ContractorPerformanceDashboard.tsx:41` + `MiningContractors.tsx:335`. Test conductual: `contractors.test.ts` (supertest, 15 `request()`).
   - ~~`ContractorRankingTable`/`contractorKpiService` calculadora-pura, sin agregación, rama `feat/mount-contractor-ranking` descartada~~ → STALE (esa era la situación pre-feed; ya superada).

---

## E. Routers sin test conductual  ·  MEDIDO + GATE: router-test-ratchet

Medido: **204 routers reales · 137 verificados** (un test importa el router real — por path `../../server/routes/x` **o** relativo co-locado `./x` — + usa supertest `request()`) · **67 sin cobertura** · solo 4 `router.stack` hollow (el "~144" del plan ya estaba limpiado). **Los 137 verificados = el inventario "qué funciona verificado (server)"** — el espejo positivo de este registro. Gate: `check-router-test-ratchet.cjs` (baseline 67, solo baja; router nuevo sin test → FAIL).

> Corrección de exactitud (2026-06-18): el ratchet contaba 76/128 por un **falso negativo** — solo detectaba imports por path completo y no los co-locados `./x`. Tras resolver imports relativos contra el dir del test, 9 routers ya cubiertos dejaron de aparecer como "sin cobertura": `loto`, `medicalAptitude`, `health`, `cad`, `openapi`, `b2d/{climate,hazmat,normativa,suite}`. El inventario ahora es honesto.

**Prioridad 1 — 6 routers VIDA/LEGAL sin test conductual** (escribir `*.router.test.ts` real: 401/200/400):
`evacuation` · `fatigue` · `refuges` · `expirations` · `criticalRoles` · `driving`. (`loto`, `medicalAptitude`, `health` y `b2d/hazmat` ya estaban cubiertos — eran falsos negativos del ratchet, ver corrección arriba.) Los 61 restantes (hygiene) en `scripts/router-test-ratchet-baseline.json`.

Nota: el gate detecta "tiene test real-router o no", NO un test que importa+request pero no asierta nada (hollow). Eso es un refinamiento posterior.

---

## F. Decisiones del fundador — RESUELTAS 2026-06-20

- **F1 · SII:** Praeventio emite **boleta O factura** (según pida el cliente) **al contratarse el servicio**, asociada al RUT de la empresa. **NO** somos PSE de los trámites del cliente — solo emitimos el documento de NUESTRO servicio; todo lo que escape de eso no es nuestro. **RUT empresa: `78.231.119-0`** (confirmado 2026-06-20, DV válido). 1 solo PSE, sin 2º.
- **F2 · Ley Karin:** inbox de denuncia = **sección propia montada**. **Anonimato del denunciante es requisito duro.** Flujo: denuncia → **notificación a la persona a cargo del proyecto** → al tocar la notificación lo lleva al menú Ley Karin. Diseñar con cuidado para no filtrar identidad del denunciante.
- **F3 · incidentFlow:** **hub/página dedicada.** Menú interactivo con los incidentes ocurridos; si no hay, mostrar incidentes mensuales/anuales — info accionable para gestionar y decidir (incidente → potencial accidente/costo/gasto de respuesta).
- **F4 · Driving:** **módulo propio.** + (a) si el teléfono detecta velocidad sobre umbral plausible-humano (según funciones/tareas del usuario) → **notificación** para activar modo conducción segura; (b) entrada también desde el **botón de modo** (junto a dark/light) para elegirlo manualmente; (c) **control por voz** (cross-cutting): "Oye Guardián, voy a manejar / activa conducción segura" → Guardián ejecuta botón/menú/info. Manos-libres ya pensado para Man-Down — extender. **Solo si es factible dentro de lo ya implementado**, no inventar capacidad nueva.
- **F5 · Risk hub:** **UNIFICAR** los 7 dirs en **un menú** de todo-sobre-riesgos. NO son duplicados → son **complementarios**; preservar la variedad. Incluir riesgos fuera del rubro propio + **guía inductora** (cómo cuidarse, p.ej. tarea con componente químico). Menú interactivo bien distribuido/entendible.
- **F6 · 3D twin / wisdomCapsules:** **CABLEAR DE VERDAD, no descartar.** AR sobre maquinaria estática (no se mueve por costo/gestión/mantenimiento): muestra cómo funciona + condensa los nodos ZK clave para novatos. Registros geolocalizados → futuro con gafas de seguridad (cápsulas localizadas). → **Esto cambia B: `WisdomCapsule` NO se borra; se cablea a contenido real (colección `capsules`/nodos ZK).**

Detalle ampliado en PLAN-MAESTRO.

---

## Orden de ejecución por factibilidad técnica (T0→T6)

Estructura de trabajo: cada bloque se cierra dejando su **gate** (no se revisita). Honesto = real + testeado + gateado. Cada bloque lleva 4 etiquetas: 🔌 fuente de dato real (de `api-routes.md`; si no está → ficticio, no cablear) · 🛠️ skill que lo implementa · 🛡️ anti-regresión al cerrar · 📦 frontera de archivos (paralelo sin merge: bloques disjuntos en paralelo; compartidos — `server.ts`, routes config, i18n — serializados por el merge-gate humano).

| Fase | Qué | De dónde | 🛠️ Skill | 🛡️ Anti-regresión |
|---|---|---|---|---|
| **T0** | Cimiento: generador `api-routes.md` (204) + gate de frescura · refrescar este doc (✅ hecho) · gate honestidad (B) | código | `backend-patterns` / script | gate freshness CI + gate anti-`Math.random` en componentes montados |
| **T1** | Montar vida/legal (24 A1) — backend real, falta wiring 1 paso | engine ya real | `frontend-design` | baja `connectivity-ratchet` + test de montaje |
| **T2** | Diseñar+cablear needs_design (35 A3) — servicio real, falta página fetch+props | servicio ya real | `frontend-design` · `ui-ux-pro-max` · `web-design-guidelines` | baja ratchet + test |
| **T3** | Des-fabricar (B: WisdomCapsule) + construir gate honestidad | colección `capsules` o empty-state | `silent-failure-hunter` | gate honestidad (cierra dimensión B) |
| **T4** | Tests conductuales vida/legal (6 routers): `evacuation, fatigue, refuges, expirations, criticalRoles, driving` | router real | `tdd` · `pr-test-analyzer` | baja `router-test-ratchet` |
| **T5** | Pipelines backend (D, 3): SLO job · snapshot cumplimiento cron · (EPP bloqueado-externo) + 3 stubs REAL-NEEDED (C) | construir | `backend-patterns` · `database-migrations` | rules-tests + gate stub |
| **T6** | Hygiene: montables A2 (33) + consolidar duplicados A4 (10) + cortes ponytail | — | `code-simplifier` | ratchet |

**Bloqueadores → F: RESUELTOS 2026-06-20** (ver sección F). Targets de montaje definidos: Ley Karin = sección propia (notif→project lead→menú, anonimato duro) · incidentFlow = hub dedicado · Driving = módulo propio (+voz cross-cutting) · Risk hub = unificar 7 dirs en un menú (complementarios, +guía inductora) · 3D twin/wisdomCapsules = cablear real (AR sobre maquinaria estática). **Cero provisional. Cero bloqueadores** (RUT F1 confirmado 78.231.119-0).

**Regla de paralelo sin colisión:** 1 bloque = 1 dominio = 1 set de archivos disjunto. Antes de lanzar agentes en paralelo, asignar fronteras disjuntas; los archivos compartidos pasan por el merge-gate humano uno a uno. Estándar de calidad por cada incorporación: review adversarial (`code-reviewer` / `security-reviewer`) antes de merge — CI-verde no basta para vida/seguridad.

## Gates activos (capa de medición que impide deuda nueva)

`connectivity-ratchet` (huérfanos A, #983) · `router-test-ratchet` (cobertura conductual E) · `any-ratchet` (155) · `i18n-parity` · `convention-guard` · `stub-guard` · `allowbackup-guard` · `medical-guard`. **Pendiente de construir:** gate de honestidad (B — anti-dato-fabricado en componentes montados).

## Regla anti-círculos

1. Todo lo pendiente vive AQUÍ. No abrir listas paralelas.
2. Al cerrar: marcar aquí con el PR + regenerar el baseline del ratchet correspondiente.
3. Antes de "descubrir" algo, buscarlo aquí primero.
4. Las dimensiones sin gate (B, E) se cierran construyendo su gate — entonces dejan de poder regresar.
