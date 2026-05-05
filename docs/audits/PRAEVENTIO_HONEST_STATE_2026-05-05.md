# Praeventio Guard — Estado Honesto 2026-05-05

**Auditoría comparativa**: ideas del producto + audit técnico 2026-05-05 + commits realizados Sprints 27-28.

Este documento **supersede** la métrica optimista del `STATE_OF_FUNCTIONALITY_2026-05-04.md` (que reportaba 99%). El audit técnico independiente del 2026-05-05 reveló brechas materiales — la cobertura E2E real estaba en ~60%, no 99%. Este doc es la nueva fuente de verdad.

**Filosofía:** "Crear soluciones donde otros ven problemas, nosotros vemos desafíos." La app debe ser revolucionaria a escala global desde el día del lanzamiento mundial Play Store / iOS.

---

## Resumen ejecutivo — % de implementación por dominio

Cada dominio se mide así:
- **🟢 E2E:** flujo completo cableado, persistencia, tests, env vars usables
- **🟡 PARCIAL:** lógica existe pero falta wire crítico / secret / sensor / test
- **🔴 SHELL:** UI sin backing real

| Dominio | % E2E | % PARCIAL | % SHELL | Tendencia |
|---|---|---|---|---|
| **Auth / RBAC** | 95% | 5% | 0% | ✅ estable |
| **Multi-tenant** | 80% | 15% | 5% | ⬆️ Sprint 27 (rules tenants) |
| **Emergencia (SOS / Fall / Push)** | 90% | 10% | 0% | ⬆️ Sprint 27 (H6 + H7) |
| **Billing (Webpay / MP / Khipu / Google Play / Apple)** | 85% | 15% | 0% | ⬆️ Sprint 27-28 (Apple SSN + audit replays) |
| **AI / Gemini / Vertex** | 75% | 20% | 5% | ⬆️ Sprint 27 (Vertex real) |
| **AI offline (SLM)** | 70% | 30% | 0% | ⬆️ Sprint 26 ZZ (Guardian Offline) |
| **Compliance Chile (DS54/594/109/132 + Ley 16.744)** | 70% | 25% | 5% | ⬆️ Sprint 28 (CPHS + DIAT/DIEP) |
| **Compliance global (ISO 45001 + US/EU/MX/BR)** | 25% | 0% | 75% | ⬆️ Sprint 28 B1 (foundation; sin wire UI) |
| **i18n** | 65% | 25% | 10% | ⬆️ Sprint 28 B2 (12 locales + RTL; faltan traducciones humanas) |
| **Health Vault (ADR 0012)** | 80% | 20% | 0% | ✅ Sprint 26 |
| **CPHS Comité Paritario** | 50% | 50% | 0% | ⬆️ Sprint 28 (service + UI presentational; falta wire container) |
| **DIAT/DIEP SUSESO** | 60% | 40% | 0% | ⬆️ Sprint 28 (PDF + folio + firma; falta WebAuthn ceremony real + recordatorios) |
| **Mesh BLE/WiFi Direct (ADR 0013)** | 40% | 30% | 30% | ⬆️ Sprint 25-26 (engine puro; sin transport nativo) |
| **PWA / Offline / Sync** | 90% | 10% | 0% | ✅ estable |
| **Native plugins (HealthKit / HealthConnect)** | 30% | 40% | 30% | ⏸ bloqueado por keystore + cuentas dev |
| **Photogrammetry (COLMAP / Modal)** | 60% | 40% | 0% | ⏸ falta Cloud Run worker deployado |
| **Digital Twin (3D mesh + AR)** | 65% | 25% | 10% | ⬆️ Sprint 26 YY (TwinAccessGuard) |
| **Object lifecycle + ZK persistence** | 75% | 20% | 5% | ✅ Sprint 25-26 |
| **Bernoulli generators** | 60% | 40% | 0% | 12 sin UI consumer |
| **Telemetry / Wearables** | 70% | 25% | 5% | ⏸ falta plugins nativos |
| **Tests unit + integration + E2E** | 55% | 35% | 10% | 184/207 componentes sin test |
| **Stryker mutation** | 72% global / 3% limiters | — | — | ⏸ Windows crash bloquea limiters |
| **Observability (Sentry + OTel)** | 85% | 15% | 0% | ⏸ falta DSN prod |
| **Mobile build pipeline** | 30% | 50% | 20% | ⏸ falta Fastlane + GHA |
| **CI/CD (GitHub Actions)** | 90% | 10% | 0% | ✅ stable |

**Promedio ponderado E2E: ~67%** (vs 99% reportado optimistamente).
**Meta Day-1 lanzamiento mundial: 95%+** en todos los dominios excepto los que dependen de input del usuario (secrets/cuentas/keystores).

---

## Lo que se hizo en Sprints 27-28 (cierre de auditoría 2026-05-05)

### Sprint 27 — P0 fixes (8 hallazgos cerrados)

- ✅ **H2** Apple Server-to-Server Notifications v2 webhook (signature verify + idempotency + audit)
- ✅ **H6** FallDetectionMonitor wired a `useEmergency().triggerEmergency('fall')`
- ✅ **H7** SOS push usa cross-collection lookup `users/{uid}.fcmTokens` (antes leía path inexistente)
- ✅ **H8** firestore.rules con matcher para `tenants/{tenantId}` + subcoll
- ✅ **H9** verificado falso positivo (queries single-field)
- ✅ **H14** `verifySchedulerToken` middleware gate del maintenance reaper
- ✅ **H15** `/api/environment/forecast` con verifyAuth + erpSyncLimiter
- ✅ **H20** `maintenance.ts` montado en server.ts
- ✅ **H4 P1** Vertex AI adapter real con `@google-cloud/vertexai 1.12` + `getAiAdapterFor({dataResidency, strict})`
- ✅ **H10 P1** `setInterval` ambiental con `clearInterval` en SIGTERM
- ✅ **H12 P1** AsesorChat sin fallback Santiago (sin coords → no fetcha clima/sismo)

**68 tests nuevos verdes en Sprint 27.**

### Sprint 28 — Global foundation + P1 (11 hallazgos / features cerrados)

- ✅ **B1** ADR 0014 Regulatory Framework Abstraction + ISO 45001 baseline (10 controles) + 5 jurisdicciones (Chile, US-OSHA, EU, México, Brasil) — 20 tests
- ✅ **B2** i18n global: 12 locales (es, en, pt-BR, es-MX/AR/PE, fr, de, it, ja, zh-CN, ar) + RTL + lazy loading + LocalePicker — 15 tests
- ✅ **B3** `validate(schema)` middleware Zod transversal + 5 endpoints críticos cubiertos (cierra H17) — 19 tests
- ✅ **B4** auditServerEvent en 5 webhooks billing (cierra H18) + TierDowngradeModal con archive flow (cierra H25) + checkExpiredPpe job (cierra H26) — 8 tests
- ✅ **B5** Módulo CPHS service + UI presentational + firestore rules immutables post-firma (cierra H29) — 25 tests
- ✅ **B6** DIAT/DIEP PDF real con folio atómico + firma electrónica + verify público (cierra H28) — 36 tests

**+ Tests nuevos en Sprint 28: ~123 verdes.**

### Total Sprint 27 + 28: 191 tests nuevos. Cierre: 7 P0 + 9 P1 + foundation global.

---

## Lo que SIGUE PENDIENTE

### Pendientes urgentes (deben cerrarse antes de Day-1 mundial)

#### Bloqueados por input del usuario (no código)

| Item | Sprint candidato | Bloqueador real |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` real | inmediato | usuario activa cuenta GCP Maps |
| `VITE_FIREBASE_VAPID_KEY` | inmediato | Firebase Console FCM |
| `GOOGLE_CLIENT_ID/SECRET` Calendar/Fit | inmediato | OAuth consent screen |
| `IOT_WEBHOOK_SECRET` | inmediato | generar + Secret Manager |
| `MP_IPN_SECRET` | inmediato | MercadoPago dashboard |
| `GOOGLE_PLAY_*` (3 keys) | inmediato | Play Console |
| `SENTRY_DSN` prod + rotar leak histórico | inmediato | Sentry proyecto |
| `KMS_KEY_RESOURCE_NAME` prod | inmediato | GCP KMS |
| `SCHEDULER_SHARED_SECRET` | inmediato | generar + Cloud Scheduler config |
| `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` | inmediato | activar Vertex AI Latam |
| Apple Developer Program | Sprint 30 | $99/yr — usuario decide |
| Google Play Console keystore | Sprint 30 | usuario genera |
| Apple Root CA G3 PEM (full-chain SSN verify) | Sprint 29 | descarga oficial Apple |
| ODA File Converter binary (DWG) | bloqueado | license comercial — pivotar a LibreDWG |

#### Pendientes de código (P1/P2 audit + features)

**P1 audit restantes:**
- H31 Stryker en CI Linux + ratchet automático (Windows crash)
- H33 Tests unitarios para 184 componentes sin test (priorizar emergency, billing, compliance)

**P2 audit (10 ítems — Sprint 29):**
- H1 Doc DWG desfasada
- H3 Stripe pre-flight messaging
- H5 SII pre-flight messaging
- H11 Geofence in-place edit (geometryHash en deps)
- H19 KnowledgeGraph `as any` x18 cleanup
- H22 KnowledgeGraph virtualización + Web Worker
- H23 backgroundTriggers concurrency
- H24 Code splitting eager (KG, Site25D, PortableCurriculum a React.lazy)
- H27 Geofence permission UX surface
- H32 Seeds determinísticos en 8 archivos test

**P3 audit:**
- H16 CSP nonce regex robustness
- H30 verificar `/processing-activities` no fugue por tenantId

**Roadmap features (48 SP — Sprint 29-30):**
- F-A CalculatorHub — 12 generadores Bernoulli sin UI consumer (gas dispersion, confined-space HVAC, respirator fatigue, pulmonary altitude, slope stability, dike hydrostatic, gas leak, misting dust, micro-wind, SLAM photogrammetry, hidrante fire network, scaffold wind suction)
- F-B RAG NL sobre incidentes históricos del tenant
- F-C ✅ parcial — Auto-fill DIAT desde audit_logs (Sprint 28 B6 cubrió la base; el wire automático queda follow-up)
- F-D Gamification × salud (días sin incidentes, awards)
- F-E Predictive Alerts × Calendar (pre-warnings tareas críticas)
- F-F WebAuthn UI Settings (backend completo, falta UI)
- F-G ✅ parcial — CPHS Module (Sprint 28 B5 service + UI; falta wire container con auth/firestore)

#### Foundation global pendiente (Sprint 29+)

- Catálogos UK + Canadá + Australia + Japón + Korea + India en `src/services/regulatory/jurisdictions/`
- Wire features → registry regulatorio (citaciones dinámicas en UI; hoy son strings hardcoded)
- Compliance gap audit por jurisdicción (GDPR vs CCPA vs LGPD vs Ley 19.628 vs ANPD Brasil vs PIPEDA Canadá)
- Tier "Global" en pricing (multi-jurisdicción simultáneo)
- Traducciones humanas reales fr/de/it/ja/zh-CN/ar (hoy stubs ~40 keys cada uno)
- Demo project sintético abierto Day-1 (`demo-faena-praeventio` ya existe pero requiere login)

#### Funcionalidades del producto que quedaron de lado (revisar idea por idea)

Compilado del chat de la sesión + roadmap + TODO.md:

**MENCIONADAS PERO SIN IMPLEMENTAR:**

1. **MQTT Broker IoT total** (TODO.md Prioridad 12) — telemetría masiva sin colapsar Firestore. Pendiente: broker, jerarquía de tópicos, ingesta inteligente, X.509, heartbeat, WSS, payload binario.

2. **WebXR `immersive-ar` real** — el repo tiene `pages/WebXR.tsx` overlay 2D sobre `<video>`. Audit menciona Android-only (iOS Safari NO soporta WebXR; falta ARKit Quick Look fallback con `.usdz`).

3. **Object lifecycle Calendar wire** — `useObjectLifecycle` hook que dispare CalendarEventSpec a Google Calendar real cuando un PlacedObject pasa a `installed`. Existe `/api/calendar/sync` OAuth pero falta wire del CalendarEventSpec del orchestrator.

4. **Geo-anchored ZK retrieval** — hook `useGeoAnchoredNodes(projectId, lat, lng, radiusM)` que filtre nodos ZK por distancia (Haversine + Firestore range query lat/lng box).

5. **Digital Twin Faena** — página existe (`DigitalTwinFaena.tsx`) con Canvas R3F + tabs Reconstrucción/Site2.5D + upload video, pero está marcado "Vista previa" porque el backend COLMAP no está deployado. Foundation existe (Sprint 24 commit bff8726).

6. **Predictive Alerts × Calendar (F-E)** — pre-warnings de tareas críticas según wind/seismic conectando con calendar.list. Existe alertScheduler + oauthGoogle pero sin wire combinado.

7. **CalculatorHub** — 12 generadores Bernoulli sin UI consumer (services existen, falta página con tabs reusando shape de HazmatStorageDesigner).

8. **CSV ETL universal** (Sprint 24) — existe pero falta hub con detección automática de schema + import wizard guiado.

9. **Onboarding wizard** (Sprint 24) — endpoint backend listo, falta UI step-by-step.

10. **Coach IA por dominio** (Sprint 24) — concepto: Asesor Chat especializado por módulo (medicina ocupacional vs ergonomía vs SST general). Hoy es un Asesor único.

11. **DS 67/76 reports** (Sprint 24) — referencias en commits, faltan los formatos PDF reales (similar a DIAT/DIEP de Sprint 28 B6).

12. **CLI + migration registry + SLO dashboard** (Sprint 24) — mencionado, falta verificar implementación.

13. **Twin triple-gate auth** (ADR 0011, Sprint 25-26) — implementado, falta wire en TODOS los lugares donde se muestre digital-twin (hoy solo Site25DPanel y DigitalTwinFaena).

14. **Mesh BLE/WiFi Direct nativo** (ADR 0013, Sprint 25-26) — engine puro 100% testeable, falta plugin Capacitor `@praeventio/capacitor-mesh` (BLE GATT Kotlin/Swift).

15. **SLM offline TinyLlama 1.1B Q4** (Sprint 26 ZZ) — service existe, falta CDN bundle del modelo + activar `SLM_OFFLINE_ENABLED` en prod.

16. **HealthVault QR sharing** (Sprint 26 VV) — implementado, falta UI de timeline médico paciente histórico.

17. **AnatomyLibrary + DifferentialDiagnosis + DrugInteractions** — hardcoded sin data real. Pendiente: bundlear OpenMedicalData CC0 + DrugBank + HCPCS.

18. **VitalityMonitor** — UI sin backend. Pendiente: wire a healthFacade native plugins + métricas catalog Sprint 25 PP.

19. **WearablesPanel BLE/HealthConnect/HealthKit nativo** — UI listo, falta dance real fuera de Telemetry.tsx.

20. **MediaPipe Pose en AIPostureAnalysisModal** — hoy usa Gemini-vision; debería usar MediaPipe local (deps disponibles).

21. **MorningRoutine slot persistencia** — UI existe, falta persistir las respuestas del trabajador.

22. **Modales workers/medicine sin tests** — ~15 componentes (AddWorkerModal, EditWorkerModal, MassImportModal, AccessControlModal, TraceabilityModal, QRCodeModal, LaborManagementModal, DocsModal, AddMedicineModal, AptitudeCertificateForm, VigilanciaScheduler, AIPostureAnalysisModal, AddErgonomicsModal, AddPsychosocialModal, AddHygieneModal).

23. **EmergencyOverlay sin test** — `components/shared/EmergencyOverlay.tsx`.

24. **DynamicEvacuationMap / Coastal / Volcanic Maps** — placeholder Maps key.

25. **Apple Pay / Google Play Billing UI** — webhooks server listos (Sprint 27 Apple SSN), falta UI frontend Capacitor plugin para checkout nativo.

**MENCIONADAS Y PARCIALMENTE IMPLEMENTADAS (necesitan completar):**

- **Bsale SII DTE multi-proveedor** (Sprint 23) — Bsale parcial; LibreDTE + OpenFactura + SimpleAPI lanzan SiiNotImplementedError.
- **Stripe USD international** — TYPED STUB; `npm i stripe` no instalado.
- **Khipu adapter** — implementado base Sprint 21+ pero requiere validación de cuenta del usuario.

---

## Roadmap propuesto Sprint 29-32

### Sprint 29 — Cierre P2/P3 + features F-A/F-B + native bridges (~80 SP)

| Bucket | Scope | SP |
|---|---|---|
| AA | F-A CalculatorHub + F-B RAG NL incidentes | 17 |
| BB | H22 KnowledgeGraph worker + H24 lazy splitting + H19 type cleanup | 13 |
| CC | H17 cleanup typeof legacy + H33 tests unitarios prioridad 1 (5 modales emergency/billing/compliance críticos) | 13 |
| DD | F-D Gamification × salud + F-E Predictive × Calendar + F-G CPHS container wire | 13 |
| EE | UK + Canada + Australia jurisdictions en regulatory framework + wire UI citation snippets | 13 |
| FF | H11 + H27 + H1 + H3 + H5 + H32 (deuda P2 menor) | 11 |

### Sprint 30 — Mobile Day-1 readiness (~70 SP)

| Bucket | Scope | SP |
|---|---|---|
| GG | Fastlane + GHA mobile signing pipeline (Android keystore + iOS provisioning) | 13 |
| HH | HealthConnect Android + HealthKit iOS plugins nativos | 13 |
| II | Capacitor BLE/WiFi Direct plugin (`@praeventio/capacitor-mesh`) — closes ADR 0013 transport | 21 |
| JJ | ARKit Quick Look fallback iOS + WebXR Android improvements | 13 |
| KK | F-F WebAuthn Settings UI + Apple Pay / Google Play Billing native UI | 8 |
| LL | Demo project sintético abierto sin login (Day-1) | 5 |

### Sprint 31 — Compliance global gap closure (~60 SP)

| Bucket | Scope | SP |
|---|---|---|
| MM | GDPR vs CCPA vs LGPD vs Ley 19.628 vs ANPD vs PIPEDA gap audit + closure | 21 |
| NN | Japón, Korea, India jurisdictions + wire UI + traducciones humanas (ja, ko, hi) | 21 |
| OO | Tier "Global" en pricing multi-jurisdicción + cobranza por país | 13 |
| PP | DS 67 / DS 76 PDF reports + RUT validators país-específicos | 5 |

### Sprint 32 — Polishing pre-Day-1 (~50 SP)

| Bucket | Scope | SP |
|---|---|---|
| QQ | H31 Stryker Linux ratchet + bump mutation 60% global / 60% limiters | 8 |
| RR | H33 tests unitarios sweep (cubrir 60+ componentes restantes) | 21 |
| SS | Lighthouse > 95 en mobile + bundle split aggressive + critical CSS | 13 |
| TT | E2E Playwright sweep multilingüe (validar es/en/pt-BR/fr/de end-to-end) | 8 |

---

## Convenciones para mantener este doc

1. Cada sprint que toque audit items → actualizar columna "% E2E" del dominio.
2. Cuando un % cambie ≥5pp, añadir nota one-line en "Lo que se hizo".
3. Cuando descubras hallazgo nuevo durante sprint → añadir a "Lo que SIGUE pendiente" con sprint candidato.
4. PR body siempre referencia este doc: `Cierra hallazgos: [H##, H##]` o `Implementa: [F-X, ...]`.
5. Al llegar a 95%+ promedio ponderado → abrir issue "Day-1 readiness checklist" cruzando esto + secrets + cuentas.

**Próxima revisión: post-Sprint 29 (estimada 2026-05-12).**
