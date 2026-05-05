# Auditoría Completa Multi-Bucket — Guardian Praeventio

**Fecha**: 2026-05-05
**Método**: 6 agentes paralelos (backend services / frontend components / server-API / tests-CI-observability / docs-ADRs / cross-cutting integrations).
**Cobertura**: 1058 archivos TS/TSX, 456 archivos test, 14 ADRs, ~38 .md raíz, ~50 dominios de servicios, ~110 páginas, ~216 componentes.
**Sesgo**: hallazgos verificados con grep en código real; cita `file:line` cuando aplica. No es un sweep mecánico — es un audit de palanca, busca **deuda silenciosa + interconexiones desperdiciadas**.

Este doc **no supersede** [`PRAEVENTIO_HONEST_STATE_2026-05-05.md`](PRAEVENTIO_HONEST_STATE_2026-05-05.md) — lo **profundiza** con hallazgos de granularidad fina. Lo que HONEST_STATE reporta como "% E2E por dominio", este doc revela como "qué wires faltan, qué oportunidades emergen, qué deuda es invisible".

---

## TL;DR Ejecutivo

**Estado real consolidado**: ~67% E2E ponderado (confirmado vs HONEST_STATE). Pero la auditoría revela un patrón estructural más importante:

> **El proyecto sufre de "potencia construida sin consumir"**. Hay 16+ servicios `*Backend.ts`, todo el stack `iot/`, todo `mesh/`, todo `ml/`, ~10 generadores Bernoulli/Euler — **construidos, testeados, sin UI consumer ni endpoint expuesto**. Es deuda invisible: parece progreso porque el código existe, pero no entrega valor al usuario final.

Tres ejes de riesgo:

1. **Wires faltantes alto-impacto bajo-esfuerzo** (estimo 15-20 features de palanca alta cabledeables en S/M sprints). Ejemplo: SOS auto-relay con XP, REBA→folio SUSESO, MQTT→Bernoulli→alerta predictiva.
2. **i18n hardcoded en 107/110 páginas** + dark mode real ~50% — **bloqueador para Play Store/iOS mundial**. La app NO está lista para lanzamiento global como se planeó.
3. **Tests E2E críticos en `continue-on-error: true`** (SOS, fall, offline). El gating de CI está engañando: el merge entra aunque los flows que salvan vidas estén rotos.

---

## 1. Hallazgos Bucket-by-Bucket

### 1.1 Backend Services (`src/services/`)

**Calidad interna**:
- **16+ servicios `*Backend.ts` huérfanos**: `chemicalBackend`, `medicineBackend`, `comiteBackend`, `psychosocialBackend`, `eppBackend`, `inventoryBackend`, `trainingBackend`, `seedBackend`, `predictionBackend`, `coachBackend`, `shiftBackend`, `susesoBackend`, `legalBackend`, `networkBackend`, `routingBackend`, `environmentBackend`. Solo `safetyEngineBackend` y `gamificationBackend` están wired. Todos duplican guard `if (!API_KEY) throw` (centralizable).
- **Stacks completos huérfanos**: `src/services/iot/` (cero imports fuera del subdir), `src/services/mesh/` (cero), `src/services/ml/vertexTrainer.ts` (stub que tira "not yet implemented").
- **75+ usos de `: any`**, **44 TODO/FIXME** activos, **`emergency/autoTrigger.ts:243` `catch {}` vacío**.
- **Cobertura Sentry desigual**: 0 refs en `iot/`, `mesh/`, `ml/`, `euler/*`, `gamification/`, `physics/bernoulliEngine`.

**Wires faltantes verificados** (10 críticos):
| # | Wire | Impacto |
|---|---|---|
| W1 | `emergency/autoTrigger` → `notifications/fcmAdapter` (no dispara push) | Alto/S |
| W2 | `iot/ingestRuleEngine.evaluateSample` → `emergency.pushCompanyEmergency` | Alto/S |
| W4 | Eventos de dominio → `gamification/positiveXp.awardXp` (cero hooks desde incidents/medical/cphs/curriculum) | Alto/M |
| W6 | `normativa/locationNormativa` → `compliance/ds67ds76` (no consulta país) | Alto/M |
| W10 | `mesh/transportFacade` → `emergency/autoTrigger` (emergencia offline no rebroadcast) | Alto/L |

### 1.2 Frontend Components (`src/components/`, `pages/`)

**Hallazgos críticos (bloqueador lanzamiento global)**:
- **i18n hardcoded en 107/110 páginas**. Solo Settings, Login, Analytics usan `useTranslation`. Lanzamiento Play Store/iOS multi-país imposible así.
- **Dark mode real ~50%**: 57/110 páginas sin variantes `dark:` (incluye Driving, Emergency, HazmatMap, Gamification, Ergonomics).
- **Mode coverage 5/110**: solo 5 páginas leen `useAppMode`. `Emergency.tsx` (565 LOC) no respeta el modo. Sistema 4-modos parcialmente roto.
- **Keyboard nav nula**: solo 5 archivos en `components/` con `onKeyDown`/`tabIndex`. WCAG 2.1.1 fail.
- **Touch targets sub-44px**: 51 ocurrencias `h-6/8 w-6/8 p-1/2` en `components/emergency/*` (vida o muerte). `components/driving/` cero `min-h-[44px]`. WCAG 2.5.5 + Apple HIG fail.
- **216 componentes — 178 sin test (82%)**, **110 páginas — 102 sin test (93%)**. Confirma 184/207 reportado.

**UI ↔ servicios desperdiciados**:
- `services/ml/vertexTrainer` sin UI consumer.
- `services/euler/*` (eulerianPath, polyhedronAchievements, eulerLagrange, fftAnalyzer, criticalLoad, graphConnectivity) — solo `Medal3DViewer`, `NormativeQuiz`, `EmergencySimulator` los consumen. Los otros, huérfanos.
- **9 componentes engineering completamente listos pero sin mount** (`ConfinedSpacePanel`, `HidranteFireNetworkPanel`, `SlopeStabilityPanel`, etc. ya consumen Bernoulli engines). `CalculatorHub.tsx` puede montarlos en una tarde.
- `Dashboard.tsx` (home) NO consume `useZettelkastenIntelligence` ni muestra señales del grafo.
- `Emergency.tsx` no llama `setMode('emergency')` cuando el humano entra manualmente.
- Pages que hacen `setInterval` polling cuando hay `onSnapshot` disponible: Telemetry, WearablesIntegration, IoTEdgeFiltering, CoastalEmergencyMap, Gamification, DigitalTwinFaena, CQRSArchitecture.

### 1.3 Server / API (Express + routes/)

**Seguridad P0**:
- **`POST /api/telemetry/ingest` sin Zod validate, sin audit, fallback HMAC con malleability** (`telemetry.ts:74,120,162`).
- **`POST /api/ai/feedback` sin replay protection** (`aiFeedback.ts:181`) — un atacante puede cambiar `up`↔`down` con misma `messageId` por `set({merge:true})` sin transaction.
- **`POST /api/emergency/notify-brigada` inline en `server.ts:691`** duplica lógica con `routes/emergency.ts` y reintroduce el bug H7 ya cerrado: lee `data.fcmToken` (singular) en vez de `users/{uid}.fcmTokens`. Resultado: `notified: 0` casi siempre. **Crítico — vida humana**.

**P1 / wires**:
- **MQTT IoT adapter sin endpoint ni boot** (`mqttAdapter.ts` no se importa en `server.ts`). ADR 0015 declara la arquitectura, pero solo existe el archivo aislado.
- **`aggregateAiFeedback.ts` job sin endpoint expuesto** — el comentario dice "Cloud Scheduler weekly" pero no hay route con `verifySchedulerToken`.
- **Cron jobs vía `setInterval` sin lock distribuido** (server.ts:650). Cloud Run con N réplicas → cada una corre el interval independientemente.
- **`Stripe` aún importado y enrutado** en `billing.ts:66,542-549` pese a estar descartado por business decision (memoria 2026-05-03).
- **No hay event bus interno** — emergency emite, nadie escucha (zettelkasten, wisdom-capsule, SSE supervisor todos podrían suscribirse).

**Oportunidades**:
- Auto-OpenAPI desde Zod schemas → cierra `API_B2D_SPEC.md` con código.
- Idempotency-Key middleware tipo Stripe (cliente offline mobile lo necesita).
- SSE applicable a más endpoints (billing invoice status, telemetry ack, emergency fan-out).

### 1.4 Tests / CI / Observabilidad

**Gating CI engañoso** (top quick win):
- **`e2e-full-stack` corre con `continue-on-error: true`** (`.github/workflows/e2e.yml:70`). 4 specs críticos (`sos-button`, `fall-detection-toggle`, `process-lifecycle`, `offline-resilience`) saltean si `E2E_FULL_STACK !== '1'`. Resultado: **los flows que salvan vidas no bloquean merge**.
- `sos-button.spec.ts:37` usa `page.waitForTimeout(3200)` (flaky, no event-based).
- 4 specs en `accessibility.spec.ts` con `test.skip` por allowlist.

**Test coverage por dominio**:
- **24 de ~30 server routes sin test directo**. Falta crítico: `billing.ts`, `emergency.ts`, `dte.ts`, `ds67ds76.ts`, `suseso.ts`, `oauthGoogle.ts`, `subscription.ts`, `push.ts`.
- 10+ tests `vi.mock('firebase/firestore')` cuando emulador disponible — cobertura inflada.
- E2E críticos sin spec: SOS push delivery, Apple SSN replay, EPP scan, DIAT/DIEP firma, billing webhook replay.

**Stryker / Lighthouse**:
- Stryker Linux **aún NO está en `ci.yml`** (Sprint 33 plan). Windows crash bloquea local.
- Lighthouse budgets en `warn`, nunca `error` (sin enforcement real).
- size-limit comenta PR pero no falla build.

**Observabilidad**:
- 10 archivos server con `console.error` en lugar de Sentry capture: `billing.ts`, `gemini.ts`, `oauthGoogle.ts`, `projects.ts`, `reports.ts`, `healthVault.ts`, `misc.ts`, `verifyAuth.ts`, `triggers/backgroundTriggers.ts`, `triggers/healthCheck.ts`.
- **OTel solo en 4 archivos** — sin spans en server routes, triggers, jobs.
- **Logging estructurado = 0** (cero pino/winston/bunyan). Todo `console.*`.
- Background jobs con `.test.ts` pero **ningún error path reporta a Sentry**. En prod, fallos silenciosos.
- **Dashboards Grafana**: cero JSON committed. `MONITORING.md`/`OBSERVABILITY.md` describen pero no existen artefactos.

### 1.5 Docs / ADRs

**ADRs vs código** — 12 OK, 2 con drift:
- **ADR 0013 Mesh BLE**: drift fuerte — engine puro existe (`packages/capacitor-mesh/` Kotlin+Swift+web), pero HONEST_STATE admite 40% E2E (sin transport nativo wired). Reconciliation contradice el HONEST_STATE.
- **ADR 0015 MQTT IoT**: drift fuerte — el ADR pinta arquitectura completa pero solo existe `mqttAdapter.ts` (1 archivo). Marcar status "accepted (target Sprint 32 TT)".

**ADRs faltantes** para decisiones que SÍ están en código:
- CQRS / Redis (TODO.md dice `[x]` pero HONEST_STATE dice SHELL — contradicción documental).
- SLM offline strategy (28 archivos en `services/slm/`, sin ADR).
- Photogrammetry pipeline (COLMAP + Modal adapters listos).
- Webpay/MP/Khipu/Apple/GooglePlay decisión (Stripe out).

**Top 5 docs urgentes a actualizar**:
1. **`README.md` línea 9-10** — badge `end-to-end-99%` falso (real ~67%); badge `tests-866+` desactualizado.
2. **`TODO.md` línea 55-57** — desmarcar `[x]` en MQTT y CQRS/Redis (contradicen HONEST_STATE).
3. **ADR 0015 MQTT** — añadir status "target Sprint 32 TT" inline.
4. **`docs/i18n-coverage.md` línea 14-15** — recalibrar `en`/`pt-BR` "Production-ready ~100%" (HONEST_STATE dice 65%).
5. **`AUDIT.md` línea 164 + `INFORME_ESTADO_2026-04-29.md` línea 16** — tachar inline "production-ready" pese al banner HISTÓRICO.

**Falta `docs/INDEX.md`** — los 81 archivos de `docs/` no tienen árbol navegable.

---

## 2. Top 15 Features Cross-Cutting (Flow Infinito 3-fases)

Features de **alta palanca** que conectan 2-5 módulos existentes sin código nuevo significativo. Verificadas con grep en `src/services/`. Todas pasan ≥2 fases del Flow Infinito (Detección Predictiva → Respuesta Adaptativa → Consolidación de Conocimiento).

| # | Feature | Conecta | Fases | Esf | Imp | Tier |
|---|---|---|---|---|---|---|
| 1 | **SOS auto-relay con XP a quien rebroadcasteó** | emergency/autoTrigger + mesh/meshRelayQueue + gamification/positiveXp + notifications/fcmAdapter | 1+2+3 | S | Alto | B2C |
| 2 | **REBA/RULA → folio SUSESO automático** | ergonomics/{reba,rula} + safety/ergonomicAssessments + suseso/folioGenerator + zettelkasten | 1+2+3 | S | Alto | B2C |
| 3 | **Driving + GPS + Article 22 = jornada legal auto-tracked** | driving/commuteSession + calendar/legalObligations + compliance/ds67Service | 1+2+3 | M | Alto | B2C+B2B |
| 4 | **MQTT IoT → Bernoulli → predictive alert + folio** | iot/{mqttAdapter,ingestRuleEngine} + physics/bernoulliEngine + 12 generators + suseso/folioGenerator | 1+2+3 | M | Alto | B2C+B2D |
| 5 | **Photogrammetry → Eulerian path → Evacuación A* + polyhedron badge** | digitalTwin/photogrammetry + euler/{eulerianPath,polyhedronAchievements} + routingBackend (A*) | 1+2+3 | M | Alto | B2C |
| 6 | **Zettelkasten huérfanos → curriculum personalizado** | zettelkasten/families + curriculum/historyAggregator + coach/normativeRag + slm/guardianOffline | 1+2+3 | M | Alto | B2C+B2D |
| 7 | **Climate coupling → DS76 alerta proactiva** | zettelkasten/climateRiskCoupling + bernoulli/{slope,wind} + compliance/ds76Service | 1+2+3 | S | Alto | B2C+B2D |
| 8 | **FFT vibración (HAVS) + IPER + ergonomic** | euler/fftAnalyzer + useFrequencyAnalysis + health/occupationalContext + protocols/iper | 1+2+3 | M | Alto | B2C |
| 9 | **Incident RAG → auto-write Zettelkasten node post-mortem** | incidents/incidentRagService + zettelkasten/persistence + zettelkasten/families + coach | 3 | S | Alto | B2D |
| 10 | **SLM offline + mesh + emergency = asesor sin red** | slm/guardianOffline + slm/orchestrator + mesh/transportFacade + emergency/autoTrigger | 1+2 | M | Alto | B2C |
| 11 | **CPHS sessions → claim horas formativas + XP** | cphs/cphsService + curriculum/claims + gamification/positiveXp + suseso/reminders | 3 | S | Medio | B2C |
| 12 | **Hygiene metabolicRate + shift window = fatiga predictiva** | hygiene/metabolicRate + health/shiftWindow + predictiveAlerts/windowedTrigger | 1+2 | M | Medio | B2C |
| 13 | **Multi-jurisdicción + DPIA + B2D API tier** | normativa/countryPacks + privacy/{regimes,dpiaTemplate} + b2d/apiKeyService | 3 | M | Alto | B2D |
| 14 | **MediaPipe pose + AR overlay correctivo + XP** | useMediaPipePose + ergonomics/landmarksToScore + ar/usdzConverter + gamification | 1+2+3 | M | Medio | B2C |
| 15 | **Calendar predictions + crew/process auto-asignación** | calendar/{legalObligations,predictions} + predictiveAlerts + organic/{crewService,processService} | 1+2+3 | S | Medio | B2C+B2B |

**TOP 5 para próximo Sprint** (decisión de palanca):
1. **#1 SOS auto-relay con XP** — S, alto, narrativa de marca poderosa.
2. **#2 REBA/RULA → folio SUSESO** — S, demo legal tangible.
3. **#7 Climate coupling → DS76** — S, encaja con prioridad China/Taiwan/Russia (regulatory pattern reusable).
4. **#4 MQTT → Bernoulli generators** — M, desbloquea inversión hecha (12 generators sub-utilizados).
5. **#6 Zettelkasten huérfanos → curriculum** — M, abre vector B2D limpio sin exponer Zettelkasten.

---

## 3. Estado Honesto E2E Recalibrado

Ajustes propuestos al `HONEST_STATE` basados en hallazgos:

| Dominio | HONEST_STATE actual | Ajuste auditoría | Razón |
|---|---|---|---|
| AI offline (SLM) | 70% | **65%** | Hook listo pero solo `AsesorChat` lo consume; Driving/Emergency/Evacuation/InhospitableGuide sin fallback offline |
| Mesh BLE/WiFi Direct | 40% | **35%** | Engine + capacitor plugin OK, pero CERO consumer en `src/`. Drift vs ADR 0013 |
| Bernoulli generators | 60% | **45%** | 12 generators en código, pero la mayoría sin UI consumer (3 panels engineering huérfanos) |
| Tests unit + integration + E2E | 55% | **50%** | E2E críticos en `continue-on-error: true`; mocks inflan unit; 102/110 pages sin test |
| i18n | 65% | **45%** | 107/110 páginas hardcoded — coverage real de strings traducibles muy debajo |
| Native plugins | 30% | **30%** (estable) | Bloqueador externo (cuentas dev) |
| **Promedio ponderado E2E** | **~67%** | **~62%** | Recalibración de 5 dominios baja 5pp |

> El número honesto de cara a Day-1 mundial: **~62%, no 67%**. La brecha hacia 95% (meta) es de ~33pp, no 28pp.

---

## 4. Roadmap Priorizado (post-auditoría)

### P0 — Esta semana (1 sprint, ~30-40 SP)

1. **Fix `notify-brigada` inline** (`server.ts:691`) → migrar a `routes/emergency.ts` y unificar fan-out FCM. **Vida humana**.
2. **Quitar `continue-on-error: true`** en `e2e.yml:70` (1 línea). Gating real de SOS/fall/offline.
3. **Reemplazar `page.waitForTimeout(3200)`** en SOS spec por `expect.poll`.
4. **Wire W1**: `emergency/autoTrigger` → `notifications/fcmAdapter` (push real al disparo).
5. **Wire W4 mínimo**: hooks `awardXp` desde incidents/cphs/curriculum (3-4 hooks, tarde).
6. **Sentry capture** en los 10 archivos server con `console.error`.
7. **Update `README.md` badges** (99% → ~62%) + `TODO.md` desmarcar MQTT/CQRS.
8. **Ajustar HONEST_STATE** con los 5 % recalibrados.

### P1 — Próximas 2-3 semanas (Sprint 33, ~80-100 SP)

9. **Feature #1 SOS auto-relay con XP** (cross-cutting, S).
10. **Feature #2 REBA/RULA → folio SUSESO** (S).
11. **Feature #7 Climate → DS76 alerta proactiva** (S).
12. **Engineering CalculatorHub** (montar 5 panels huérfanos, S).
13. **Stryker job Linux en `ci.yml`**.
14. **Idempotency-Key middleware server** (mobile offline lo necesita).
15. **Cron jobs → lock distribuido** (Firestore lease) o migrar a Cloud Scheduler con `verifySchedulerToken`.
16. **Tests para 8 routes server críticas** (billing, emergency, dte, ds67ds76, suseso, oauthGoogle, subscription, push).

### P2 — Sprint 34-36 (~150-200 SP, foundation Day-1 mundial)

17. **i18n sweep masivo**: extraer strings ES de 107 páginas → `i18n/locales/`. **Bloqueador Play Store mundial**.
18. **Dark mode sweep**: completar `dark:` variants en 57 páginas.
19. **Mode coverage**: `useAppMode` en surfaces críticas (Emergency, Evacuation, HazmatMap, etc.).
20. **Touch target sweep**: `min-h-11 min-w-11` en `components/{emergency,driving}/*` (WCAG 2.5.5).
21. **Keyboard nav**: `onKeyDown`/`tabIndex` sweep WCAG 2.1.1.
22. **Feature #4 MQTT → Bernoulli generators** (M).
23. **Feature #6 Zettelkasten huérfanos → curriculum** (M).
24. **Feature #5 Photogrammetry → Eulerian → Evacuation** (M, highlight técnico Euler).
25. **OpenAPI auto-gen desde Zod** → cierra API_B2D_SPEC con código real.
26. **ADRs faltantes**: CQRS, SLM, Photogrammetry, Billing tier-segmentation.
27. **Logging estructurado**: pino o winston en server + jobs + triggers.

### P3 — Sprint 37+ (deuda larga / pre-launch hardening)

28. **OTel tracing** en server routes / triggers / jobs.
29. **Dashboards Grafana / Cloud Monitoring** committeados a `infra/`.
30. **Apple Watch / WearOS apps nativas** (Sprint 33+ del HONEST_STATE).
31. **CQRS + Redis productivo** (decidir: ADR "deferred" o build).
32. **E2E specs faltantes**: Apple SSN replay, EPP scan, DIAT firma, billing webhook replay.

---

## 5. Métricas de Auditoría (verificación)

- **Archivos analizados (muestreo dirigido)**: ~150 servicios + ~80 componentes + ~40 routes + 14 ADRs + 38 .md raíz.
- **Greps efectuados (suma agentes)**: ~200.
- **Hallazgos verificados con cita `file:line`**: 80+.
- **Falsos positivos eliminados durante synthesis**: ~5 (verificados con re-grep).

---

**Próxima decisión del operador**: ejecutar P0 esta sesión (puedo dispatchear 4-5 agentes a aplicar los fixes en paralelo + auto-commit per-bucket + abrir PR), o aguantar y arrancar Sprint 33 con #1+#2+#7 cross-cutting.
