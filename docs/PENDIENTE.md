# PENDIENTE — registro único de lo que falta para "app real y conectada"

**Esta es la ÚNICA fuente de verdad de lo pendiente.** Se trabaja SOLO desde aquí; al cerrar un ítem se actualiza aquí (con `file:line` del PR); los **gates** impiden que entre deuda nueva escondida. Consolidado el 2026-06-17 de: triage de huérfanos (workflow), discovery de honestidad, `docs/stubs-inventory.md` y `docs/PLAN-MAESTRO-HACER-REAL-2026-06-17.md`. Reemplaza el andar en círculos entre listas separadas.

**Honestidad sobre el alcance:** no es omnisciencia perfecta (el código es enorme). Es un ledger de las dimensiones conocidas, cada una con su nivel de confianza + gate. Lo que NO está medido-con-gate se marca explícito como "medir" — esa es una lista finita, no un redescubrir infinito.

---

## Contador maestro

> **Re-verificado 2026-06-19** (recomputado contra el código, no contra el doc). Varias cifras estaban viejas — corregidas abajo. Método: ratchets recomputados + 3 auditorías de verificación (honestidad de pantallas montadas, triage de stubs, catálogo de rutas).

| # | Dimensión | Cantidad (verificada 06-19) | Medido | Gate |
|---|---|---|---|---|
| A | Huérfanos (construido, sin montar) | **89** (era 126; −37 cerrados) | ✅ ratchet recomputado | ✅ `connectivity-ratchet` (baseline 89) |
| B | Datos fabricados en pantallas montadas | **1 confirmado** (`WisdomCapsule` citas hardcodeadas en /hygiene); resto honesto | ✅ sweep completo | ❌ falta gate honestidad |
| C | Stubs / placeholders | 86 inventario → **~9 accionables** (3 REAL-NEEDED · 3 fail-soft legítimo · 1 bloqueado-externo · 3 entradas STALE) | ✅ triado | 🟡 `stub-guard` (forma, no conexión) |
| D | Pipelines backend sin construir | 3 | ✅ explícito | ❌ |
| E | Routers sin test conductual | **61 / 204** (143 verificados; era 67/137) | ✅ ratchet recomputado | ✅ `router-test-ratchet` (baseline 61) |
| F | Decisiones del fundador | **6 RESUELTAS 2026-06-20** (RUT F1 confirmado 78.231.119-0) | ✅ resuelto | n/a (decisión) |
| B0 | Índice de rutas (`api-routes.md`) | **viejo: 43 de 204 rutas** (del 2026-04-28). Generador+gate pendiente | ✅ medido (~1501 decl. de ruta) | ❌ falta generador |

### Hallazgos de la re-verificación 06-19 (detalle)
- **B (honestidad):** sweep de superficies montadas → solo 1 dato fabricado vivo: `src/components/shared/WisdomCapsule.tsx:10-18` (7 citas hardcodeadas vía `Math.random` cuando no hay cápsula real; se renderiza como si fuera contenido real en `/hygiene`). Fix: empty-state honesto o cablear a colección `capsules`. Lo demás ya está real (cierres #966-#982).
- **C (stubs) REAL-NEEDED (3):** (1) `src/server/jobs/runB2dMrrSnapshot.ts:15` job sin cron (backend listo) · (2) `src/hooks/useGeofenceWithEvents.ts` hook real sin consumer (panel admin geocercas) · (3) Wi-Fi Direct nativo `packages/capacitor-mesh/.../MeshPlugin.kt:552` + `Plugin.swift:350` (BLE ya real; falta WifiP2pManager/MultipeerConnectivity).
- **C STALE (3) — quitar del inventario:** SLM mock (ya runtime real), criticalPermitValidators (ya ruteado), SystemEngineProvider (ya montado).
- **B0 (índice):** OpenAPI registry solo cubre 34 paths (superficie pública B2D, intencional). El catálogo interno real son ~1501 decl. de ruta en 204 routers → mano imposible, requiere generador determinista + gate de frescura.

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
