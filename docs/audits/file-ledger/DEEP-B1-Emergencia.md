# DEEP REVIEW — Bloque B1: Emergencia & Respuesta 🛟

- **Bloque:** B1 (Emergencia & Respuesta) — el más crítico para la vida.
- **Fecha:** 2026-06-02
- **Archivos revisados a fondo (code-first):** 103 archivos de feature
  (14 server routes/jobs · 24 services · 16 hooks · 33 components · 14 pages · 1 routes module · + `gridAStar.ts` y `geofenceToSos.ts` leídos como dependencias de vida).
- **Método:** se abrió y leyó cada archivo. Evidencia citada como `file:line`. No se infirió del nombre.

---

## 1. Resumen ejecutivo

### Lo que está REAL y bien construido (mayoría del bloque)
El **backbone server-side de emergencia es sólido y de producción**. Todos los routers
B1 están montados en `server.ts` (verificado: `emergency` en `server.ts:940`,
`evacuationHeadcount` en `server.ts:1133`, `loneWorker`/`refuges` en `server.ts:1157-1158`,
`restrictedZones` en `server.ts:1159`, etc.). El patrón canónico es uniforme y correcto:
`verifyAuth → idempotencyKey() → validate(zod) → assertProjectMember → handler`, con
`captureRouteError`, error bodies que NO filtran internals, y `auditServerEvent` awaiteado.

- **SOS (`emergency.ts`)**: REAL. Audita (`emergency.ts:258`), rate-limita 10/min por uid
  (`emergency.ts:52-60`), fan-out FCM cross-collection con cache TTL
  (`emergency.ts:151-207`) **y fallback email** cuando push falla o no hay tokens
  (`emergency.ts:306-354`). El bug histórico H7 (notified siempre 0) está corregido y documentado.
- **A\* de evacuación**: REAL (`src/services/routing/gridAStar.ts`) — min-heap, heurística
  admisible Manhattan/Octile, devuelve `null` honesto si inalcanzable (`gridAStar.ts:219-220`).
  Consumido por `EvacuationRoutes.tsx` + `useRouting` + `routes/routing.ts`.
- **ManDown / Fall detection**: REAL y battle-tested. `useManDownDetection.ts` usa jerk-based
  detection (orientación-invariante), alarma sostenida ≥30 s, black box offline-first.
  `FallDetectionMonitor.tsx` escala vía `triggerEmergency('fall')` (Firestore + FCM).
- **Lone worker anti-blame**: REAL. Engine puro + cron idempotente con retry-hasta-notificar
  (`runLoneWorkerEscalation.ts:119-134`); el worker solo puede check-in por sí mismo
  (`loneWorker.ts:124-129`).
- **Restricted zones / no-bloqueo**: REAL. Directiva fundador "nunca bloquear" implementada
  literalmente — `entry-event` persiste incluso `allowed:false` y devuelve 200
  (`restrictedZones.ts:363-481`), con re-evaluación server-side anti-tamper.

### Riesgos de VIDA (top hallazgos)
1. **🛟 P0 — ManDown no hace push FCM directo.** `useManDownDetection.triggerAlert`
   (`useManDownDetection.ts:188-296`) escribe `mandown_events` + `emergency_messages` +
   risk node, pero **NO llama `/api/emergency/sos` ni `notify-brigada`**, y **NO existe
   ningún Firestore trigger** sobre esas colecciones (verificado: `grep` en
   `src/server/triggers` → 0 resultados para `mandown_events`/`emergency_alerts`/`emergency_messages`).
   ⇒ La alerta a supervisores depende EXCLUSIVAMENTE de que el supervisor tenga la app
   abierta con un `onSnapshot` activo. **Sin push, un trabajador caído inconsciente no
   despierta el teléfono del supervisor.** (Contraste: `FallDetectionMonitor` SÍ usa
   `triggerEmergency`, que sí fan-outea.)
2. **🛟 P1 — EmergencyOverlay "Estoy a Salvo" y Triage NO persisten.** El handler
   `handleSafeClick` (`EmergencyOverlay.tsx:280-290`) y `handleTriage`
   (`EmergencyOverlay.tsx:292-295`) tienen comentarios "Here we would normally update
   Firebase…" y NO escriben nada. En una evacuación real el tablero de headcount NO recibe
   el estado "a salvo" desde este overlay (sí lo recibe vía `/scan-qr` por otra ruta, pero
   el botón gigante del overlay es deadweight de persistencia).
3. **⚠️ DynamicEvacuationMap NO usa el A\* real.** `DynamicEvacuationMap.tsx:18,49` consume
   `calculateDynamicEvacuationRoute` (Gemini, whitelisted en `gemini.ts:166`) y renderiza
   `VectorialEvacuationMap`, cuyas rutas verdes son **paths SVG hardcodeados**
   (`VectorialEvacuationMap.tsx:47-48`), no salida del A\*. El A\* real solo vive en
   `EvacuationRoutes.tsx`. No es un fake oculto (el texto es honesto), pero el "mapa
   dinámico" más visible NO calcula geometría real.

### Huérfanos / sin-hogar (🏚️ — engine+UI construidos, nunca cableados a una page)
- **6 componentes** con CERO referencias fuera de su propio archivo/test:
  `EmergencyBrigadePanel`, `FirstResponderDispatchPanel`, `LoneWorkerAdminPanel`,
  `LoneWorkerCheckInWidget`, `RestrictedZonesMapOverlay`, `DrillResultReviewCard`.
- **6 hooks** sin consumidor en pages/components (solo tests, o ni eso):
  `useComms`, `useCommsDrill`, `useContingencySimulation`, `useFirstResponderMap`,
  `useGeofencePermissions`, `useRefuges` (este último solo aparece en un mount-order test).
- **Refuges**: la page `MountainRefuges.tsx:18-22` importa el servicio DIRECTAMENTE
  (`findNearestRefuges` client-side) ⇒ tanto el hook `useRefuges` como el router
  `/api/sprint-k/.../refuges` quedan redundantes para la UI actual.

Estos huérfanos NO son stubs: son código real y completo que simplemente nunca fue
importado por una page. Riesgo: deuda invisible + features de seguridad que el usuario
cree disponibles pero no tienen punto de entrada.

### Privacidad 🔐
- SOS y todos los `:projectId` routes aplican `assertProjectMember` (anti cross-tenant).
- `tenantId` NUNCA del body; se resuelve desde `projects/{id}.tenantId` (patrón uniforme).
- Biometría/cámara: `EvacuationQRScanner` usa `html5-qrcode` on-device (decodifica
  `workerUid`, no sube frames). `FallDetectionMonitor`/ManDown procesan acelerómetro on-device.
- `meshFallback` envía placeholders honestos `lat/lng=0, accuracyM=-1` cuando no hay GPS
  (`meshFallback.ts:96-102`) — no inventa "null island" como ubicación real.

---

## 2. Tabla por archivo

Estado: ✅ real · 🟡 parcial · 🏚️ sin hogar (huérfano) · 🔵 stub · 🔑 key (life-critical)
Cableado: route mount / page importer / consumer.

### SERVER (routes + jobs)

| Ruta | LOC | Propósito real (verificado) | Estado | Cableado | Hallazgo clave |
|---|---|---|---|---|---|
| `src/server/routes/emergency.ts` | 488 | POST `/sos` + `/notify-brigada`; audit + rate-limit + FCM cross-collection + email fallback | ✅🔑 | `server.ts:940` `/api/emergency` | Audita en `:258`; rate-limit `:52`; fan-out+email `:151,:306`. Sólido. |
| `src/server/routes/loneWorker.ts` | 281 | 5 endpoints sobre engine puro; anti-blame self-checkin | ✅🔑 | `server.ts:1157` `/api/sprint-k` | Self-checkin gate `:124`; audita help `:134`. |
| `src/server/routes/evacuation.ts` | 202 | 4 endpoints stateless headcount (compute/scan/end/postmortem); `scannedByUid` forzado server | ✅ | `server.ts:1131` `/api/sprint-k` | `record-scan` fuerza caller `:132-134`. Pure compute. |
| `src/server/routes/evacuationHeadcount.ts` | 449 | CRUD persistente drill (start/scan-qr/status/end) + adapter Firestore + Gate 3 supervisor | ✅🔑 | `server.ts:1133` `/api/evacuation` | Gate scan `:274`; idempotente end `:414-422`; worker debe estar en roster `:299`. |
| `src/server/routes/restrictedZones.ts` | 548 | define/check/entry-event/permissions; no-bloqueo + re-eval anti-tamper | ✅🔑 | `server.ts:1159` `/api/zones` | Entry persiste `allowed:false`→200 `:472`; role gate write `:219`; self-declare `:387`. |
| `src/server/routes/emergencyBrigade.ts` | 514 | snapshot + members + resources + inspect; readiness level | ✅ | `server.ts:1018` `/api/sprint-k` | Role gate `:137`; empty inventory cuenta como gap `:283`; batch+audit `:483`. |
| `src/server/routes/drillsManager.ts` | 380 | list/get/plan/execute simulacros + score determinístico | 🟡 | `server.ts:1011` `/api/sprint-k` | **Sin role gate** en plan/execute (cualquier project member). Audita OK. |
| `src/server/routes/commsDrill.ts` | 228 | 4 endpoints stateless drill comunicación | ✅ | `server.ts:1062` `/api/sprint-k` | Pure compute; sin persistencia (caller persiste). |
| `src/server/routes/comms.ts` | 252 | 5 endpoints mapa comunicación/escalamiento/contactabilidad | ✅ | `server.ts:305` `/api/sprint-k` | Pure compute. Bien validado. |
| `src/server/routes/contingencySimulation.ts` | 249 | build-scenario/list/count/evaluate-tabletop | ✅ | `server.ts:1070` `/api/sprint-k` | 400 limpio en kind/scenario mismatch `:139,:239`. |
| `src/server/routes/firstResponderMap.ts` | 184 | build-dispatch-plan + analyze-coverage | ✅ | `server.ts:1129` `/api/sprint-k` | Pure compute determinístico. |
| `src/server/routes/geofencePermissions.ts` | 100 | decide-ux permisos geofence (SSR/preview) | ✅ | `server.ts:1076` `/api/sprint-k` | Pure compute. Directiva no-bloqueo en header. |
| `src/server/routes/refuges.ts` | 169 | list-catalog/find-nearest/availability sobre catálogo CONAF | ✅ | `server.ts:1158` `/api/sprint-k` | Funciona, pero la page consume el servicio directo (route redundante p/UI). |
| `src/server/jobs/runLoneWorkerEscalation.ts` | 155 | cron 5min escala overdue/help; idempotente por (sesión,nivel,día) | ✅🔑 | dep `loneWorkerService` | **Retry-hasta-notificar**: no persiste marker si notify falla `:119-134`. Excelente. |

### SERVICES

| Ruta | LOC | Propósito real | Estado | Cableado | Hallazgo clave |
|---|---|---|---|---|---|
| `src/services/emergency/sosOrchestrator.ts` | 263 | Engine puro: arma plan SOS (mesh+outbox+breadcrumbs+números país+disclaimer) | ✅🔑 | EmergencyContext/capacitor | Disclaimer "no detenemos maquinaria" `:114-117` (Directiva 2). Pure. |
| `src/services/emergency/autoTrigger.ts` | 424 | Predicados auto-trigger (sismo 0.6g/300ms, clima, company) + cross-check USGS | ✅🔑 | `EmergencyAutoBridge` | `blockOperation:false` siempre `:237,:309`; debounce 60s; USGS solo enriquece severity. |
| `src/services/emergency/meshFallback.ts` | 137 | SOS offline → mesh BLE/WiFi rebroadcast cuando red caída | ✅🔑 | EmergencyContext | Placeholder GPS honesto `:96-102`; fire-and-forget. |
| `src/services/emergency/sosOutbox.ts` | 184 | Outbox offline-first SOS con backoff exponencial | ✅🔑 | sosOrchestrator | "SOS no puede depender de red". |
| `src/services/emergency/gpsBreadcrumbTracker.ts` | 163 | Rolling window de migas GPS p/anexar al SOS | ✅ | sosOrchestrator | Engine puro. |
| `src/services/emergency/emergencyNumbers.ts` | 228 | Números emergencia país-aware (coords/región) | ✅ | sosOrchestrator | Fallback Chile siempre. |
| `src/services/loneWorker/loneWorkerService.ts` | 118 | derive-status + decide-escalation (supervisor→brigada→SAMU) | ✅🔑 | route + cron | Determinístico; `help` → emergency_services. |
| `src/services/loneWorker/manDownTimer.ts` | 301 | Timer graduado pre→L1→L2→L3 con skip-on-fall | ✅🔑 | (engine; ver gap consumer) | L3 canal voice `:177`; cancel≠resolve (false positive) `:223`. |
| `src/services/loneWorker/loneWorkerStore.ts` | 42 | Zustand store project-scoped (factory) | ✅ | useLoneWorker | Refactor factory OK. |
| `src/services/evacuation/evacuationHeadcount.ts` | 162 | Engine puro: status/scan/end/postmortem | ✅🔑 | 2 routes | Determinístico. |
| `src/services/evacuation/evacuationFirestoreAdapter.ts` | 119 | Persistencia drill + subcol scans idempotente (docId=workerUid) | ✅ | evacuationHeadcount route | Idempotencia natural `:58-71`. |
| `src/services/firstResponderMap/firstResponderMap.ts` | ~300 | Dispatch responder más cercano (haversine 3D) + coverage gaps | ✅ | route (UI huérfana) | Roles por incidente + SIF cert `:66-82`. |
| `src/services/comms/communicationMap.ts` | 198 | Best-channel/dead-zones/escalation/failover | ✅ | route (hook huérfano) | Pure. |
| `src/services/commsDrill/commsDrillEngine.ts` | 305 | Scripts + score + schedule drills comunicación | ✅ | route (hook huérfano) | Pure. |
| `src/services/contingencySimulation/contingencyScenarioBuilder.ts` | 674 | 10 plantillas escenario × severidad × industria | ✅ | route (hook huérfano) | Throw "Sin plantilla" → 400. |
| `src/services/contingencySimulation/tabletopExerciseEngine.ts` | 240 | Evalúa intento tabletop vs escenario | ✅ | route | Scenario mismatch → 400. |
| `src/services/drillsManager/drillsManager.ts` | 246 | `evaluateDrillResult` readiness scoring | ✅ | route + 2 hooks/comp | Determinístico. |
| `src/services/emergencyBrigade/emergencyBrigadeService.ts` | 184 | Coverage report + resource readiness + gaps | ✅ | route + panel huérfano | Pure. |
| `src/services/geofence/permissionUXDecision.ts` | 335 | Decisión UX permisos (no bloquea maquinaria) | ✅ | route (hook huérfano) | Pure, sin I/O. |
| `src/services/geofence/polygonUtils.ts` | 275 | Point-in-polygon ray-casting + viz | ✅ | useGeofence | Ray-casting determinístico `:8`. |
| `src/services/refuges/mountainRefuges.ts` | 398 | Catálogo refugios reales (CONAF/Club Andino) verificado OSM | ✅🔑 | page directo + route | Reemplazó refugios ficticios Alfa/Beta/Gamma. |
| `src/services/zones/restrictedZonesEngine.ts` | 99 | checkZoneEntry (EPP/training/permit) — recomienda, no bloquea | ✅🔑 | route | Pure. |
| `src/services/systemEngine/policies/geofenceToSos.ts` | 79 | Política: entrada HAZMAT/RESTRICTED → trigger_emergency + notify | ✅🔑 | `SystemEngineProvider.tsx:53` | Registrada y activa; skip si emergencia activa `:25`. |
| `src/services/systemEngine/adapters/emergencyContextAdapter.ts` | 64 | Observa isEmergencyActive → emite `sos_triggered` al bus | ✅ | SystemEngine | Read-only del context. |
| `src/services/gemini/emergency.ts` | 186 | 3 funciones planificación emergencia (Gemini) | ✅ | geminiBackend + whitelist | `generateEmergencyPlan` en `gemini.ts:127`. |

### HOOKS

| Ruta | LOC | Propósito | Estado | Cableado | Hallazgo |
|---|---|---|---|---|---|
| `src/hooks/useManDownDetection.ts` | 400 | Detección caída/inactividad jerk-based + alarma + Firestore | ✅🔑 | dashboard/ManDownSupervisorWidget | **NO llama /api/emergency/sos** (ver Hallazgo H1). Tiene test (0%→cubierto `:46`). |
| `src/hooks/useGeofence.ts` | ~210 | GPS + point-in-polygon + onZoneEntry alarma | ✅🔑 | GeofenceAlert | Sin emitir evento systemEngine (esa parte está en useGeofenceWithEvents). |
| `src/hooks/useGeofenceWithEvents.ts` | ~90 | Drop-in que SÍ emite `geofence_crossed` al bus | ✅ | (drop-in) | `:78` emite evento → geofenceToSos. |
| `src/hooks/useFallDetectionPreference.ts` | — | Pref opt-in detección caída | ✅ | 3 comp/pages | Default OFF (batería). |
| `src/hooks/useLoneWorker.ts` | — | Cliente HTTP lone-worker | ✅ | 2 pages | Cableado. |
| `src/hooks/useEmergencyBrigade.ts` | — | Snapshot brigada | ✅ | EmergencyBrigade page | Cableado. |
| `src/hooks/useDrillsManager.ts` | — | Cliente drills | ✅ | DrillsManager page | Cableado. |
| `src/hooks/useRestrictedZones.ts` | — | Cliente zonas | ✅ | 2 comp | Cableado. |
| `src/hooks/useEvacuation.ts` | — | Cliente evacuación (tiene test) | ✅ | EvacuationDashboard | Cableado. |
| `src/hooks/useEvacuationHeadcount.ts` | — | Cliente headcount (tiene test) | ✅ | EvacuationDashboard | Cableado. |
| `src/hooks/useComms.ts` | — | Cliente comms map | 🏚️ | **0 consumidores** | Huérfano. |
| `src/hooks/useCommsDrill.ts` | — | Cliente comms drill | 🏚️ | **0 consumidores** | Huérfano. |
| `src/hooks/useContingencySimulation.ts` | — | Cliente contingencia | 🏚️ | **0 consumidores** | Huérfano. |
| `src/hooks/useFirstResponderMap.ts` | — | Cliente dispatch responder | 🏚️ | **0 consumidores** | Huérfano (life-critical sin entrada). |
| `src/hooks/useGeofencePermissions.ts` | — | Cliente decide-ux | 🏚️ | **0 consumidores** | Huérfano. |
| `src/hooks/useRefuges.ts` | — | Cliente refugios | 🏚️ | solo mount-order test | Huérfano (page usa servicio directo). |

### COMPONENTS

| Ruta | LOC aprox | Propósito | Estado | Cableado | Hallazgo |
|---|---|---|---|---|---|
| `components/emergency/SOSButton.tsx` | 229 | Botón SOS long-press 3s + geo + tel: fallback | ✅🔑 | mode==='emergency' | Funciona aún sin auth `:108`; analytics tras 200 `:138`. |
| `components/emergency/FallDetectionMonitor.tsx` | 203 | Modal caída + countdown 15s → triggerEmergency | ✅🔑 | RootLayout-class | Escala vía EmergencyContext `:59-65` (sí fan-outea). |
| `components/emergency/EmergencyAutoBridge.tsx` | 183 | Puente React→autoTrigger; rutea auto-trigger a triggerEmergency | ✅🔑 | RootLayout | Capacitor Motion + DeviceMotion `:129`. |
| `components/shared/EmergencyOverlay.tsx` | 469 | Takeover sismo/clima/company + voz + triage + "a salvo" | 🟡🔑 | App shell | **"Estoy a salvo" y triage NO persisten** `:285,:294`. Sismo SÍ persiste `:85`. |
| `components/emergency/TriageBeacon.tsx` | — | Baliza QR triage (wake-lock) p/rescatistas | ✅ | useManDownDetection (1) | Real. |
| `components/emergency/DynamicEvacuationMap.tsx` | 228 | "Rutas dinámicas" vía Gemini + mapa estático | 🟡 | (1 importer) | **No usa A\* real**; rutas hardcodeadas en VectorialEvacuationMap. |
| `components/emergency/VectorialEvacuationMap.tsx` | 101 | SVG ilustrativo + dead-reckoning real | 🟡 | DynamicEvacuationMap | Rutas verdes hardcodeadas `:47-48`; dead-reckoning sí es real. |
| `components/emergency/CrisisChat.tsx` | ~350 | Chat crisis Firestore | ✅ | (1) | Real. |
| `components/emergency/Asesor.tsx` | — | Asesor IA emergencia | ✅ | 10 importers | Real, muy usado. |
| `components/emergency/EmergencyCheckIn.tsx` | — | Check-in masa workers (onSnapshot+batch) | ✅ | (1) | Firestore real. |
| `components/emergency/EmergencyDashboard.tsx` | — | Dashboard emergencia | ✅ | Emergency page | Cableado. |
| `components/emergency/EmergencySquadManager.tsx` | — | Gestión escuadra | ✅ | (1) | Real. |
| `components/emergency/FirstAidCards.tsx` | — | Tarjetas primeros auxilios | ✅ | 2 | Real (sin diagnóstico). |
| `components/emergency/GeofenceAlert.tsx` | — | Alerta geofence (usa useGeofence) | ✅ | (1) | Cableado. |
| `components/emergency/IncidentInvestigation.tsx` | — | Investigación incidente | ✅ | (1) | Real. |
| `components/emergency/SkillTree.tsx` | — | Árbol habilidades emergencia | ✅ | 3 | Real. |
| `components/emergency/SurvivalMode.tsx` | — | Modo supervivencia | ✅ | (1) | Real. |
| `components/emergency/TacticalSimulation3D.tsx` | — | Simulación táctica 3D (routing dep) | ✅ | (1) | Real. |
| `components/ai/EmergencyPlanGenerator.tsx` | — | Generador plan (Gemini) | ✅ | EmergencyGenerator | Cableado. |
| `components/ai/EmergencySimulator.tsx` | — | Simulador escenarios | ✅ | 2 | Cableado. |
| `components/dashboard/ManDownSupervisorWidget.tsx` | — | Widget supervisor ManDown | ✅ | 2 | Cableado. |
| `components/drillsManager/DrillsCompliancePanel.tsx` | — | Panel cumplimiento simulacros | ✅ | (1) | Cableado. |
| `components/drillsManager/DrillResultReviewCard.tsx` | 169 | Review post-drill | 🏚️ | **0** | Huérfano (real, sin page). |
| `components/emergencyBrigade/EmergencyBrigadePanel.tsx` | 159 | Panel readiness brigada | 🏚️ | **0** | Huérfano (page usa hook directo). |
| `components/firstResponderMap/FirstResponderDispatchPanel.tsx` | 287 | Visualiza dispatch plan + gaps | 🏚️ | **0** | Huérfano life-critical. |
| `components/loneWorker/LoneWorkerCard.tsx` | — | Card sesión lone worker | ✅ | 4 (pages) | Cableado. |
| `components/loneWorker/LoneWorkerAdminPanel.tsx` | 281 | Panel admin sesiones + escalation | 🏚️ | **0** | Huérfano. |
| `components/loneWorker/LoneWorkerCheckInWidget.tsx` | 179 | Widget check-in móvil | 🏚️ | **0** | Huérfano. |
| `components/evacuation/EvacuationDashboard.tsx` | — | Dashboard evacuación | ✅ | EvacuationDashboard page | Cableado. |
| `components/evacuation/EvacuationQRScanner.tsx` | — | Scanner QR punto encuentro (html5-qrcode on-device) | ✅🔐 | 5 | No sube frames; decodifica workerUid. |
| `components/evacuation/EvacuationStatusBoard.tsx` | — | Tablero estado safe/missing | ✅ | (1) | Cableado. |
| `components/layout/EmergencyAlertBanner.tsx` | — | Banner alerta sísmica (useSeismicMonitor) | ✅ | 2 | Cableado. |
| `components/zones/RestrictedZonesMapOverlay.tsx` | 349 | Overlay polígonos zonas sobre Google Maps | 🏚️ | **0** | Huérfano; referencia `<ZoneEntryGate/>` (verificar también). |

### PAGES

| Ruta | Propósito | Estado | Cableado | Hallazgo |
|---|---|---|---|---|
| `pages/Emergency.tsx` | Hub emergencia (EmergencyDashboard) | ✅ | `EmergencyRoutes.tsx:36` | Cableado. |
| `pages/EmergencyGenerator.tsx` | Generador plan emergencia | ✅ | `EmergencyRoutes.tsx:37` | Cableado. |
| `pages/Evacuation.tsx` | Evacuación (tiene slm test) | ✅ | `EmergencyRoutes.tsx:38` | Cableado. |
| `pages/EvacuationRoutes.tsx` | **Rutas A\* reales** (gridAStar) | ✅🔑 | `EmergencyRoutes.tsx:48` | Único consumidor real del A\*. |
| `pages/EvacuationDashboard.tsx` | Dashboard headcount drill | ✅🔑 | `EmergencyRoutes.tsx:50` | Wire explícito Sprint K. |
| `pages/LoneWorkerMonitor.tsx` | Monitor lone worker (LoneWorkerCard) | ✅🔑 | `EmergencyRoutes.tsx:52` | Usa server admin-overview. |
| `pages/LoneWorker.tsx` | Page worker lone (LoneWorkerCard) | ✅ | (router app) | Usa LoneWorkerCard (no el widget huérfano). |
| `pages/MountainRefuges.tsx` | Refugios montaña | ✅ | `EmergencyRoutes.tsx:44` | Importa servicio DIRECTO `:18-22` (no hook/route). |
| `pages/EmergencyBrigade.tsx` | Brigada (useEmergencyBrigade) | ✅ | (router) | Usa hook, NO el panel huérfano. |
| `pages/DrillsManager.tsx` | Gestor simulacros | ✅ | (router) | Cableado (tiene test). |
| `pages/EmergenciaAvanzada.tsx` | Emergencia avanzada | ✅ | `EmergencyRoutes.tsx:47` | Cableado. |
| `pages/CoastalEmergencyMap.tsx` | Mapa emergencia costera (tsunami) | ✅ | `EmergencyRoutes.tsx:46` | Tipo 'tsunami' en enum `emergency.ts:402`. |
| `pages/NationalParksEmergency.tsx` | Emergencia parques nacionales | ✅ | `EmergencyRoutes.tsx:45` | Cableado. |
| `pages/CuadrillasDashboard.tsx` | **Cuadrillas/procesos (NO emergencia)** | ✅ | (router) | Dominio crews/Gantt, no B1; sin componente emergencia. |
| `routes/EmergencyRoutes.tsx` | 16 rutas lazy de emergencia | ✅ | App router | Todas las pages montadas `:35-53`. |

---

## 3. Hallazgos y deuda B1 (detalle `file:line`)

### H1 — 🛟 P0: ManDown sin push FCM directo ni trigger Firestore
- `src/hooks/useManDownDetection.ts:188-296` (`triggerAlert`) escribe únicamente Firestore:
  risk node (`:226`), `emergency_messages` (`:244-253`), `mandown_events` (`:275-278`).
  No hay `fetch('/api/emergency/sos')` ni `triggerEmergency()`.
- Verificado: `grep` en `src/server/triggers` → **0** referencias a `mandown_events`,
  `emergency_alerts`, `emergency_messages`. No existe trigger server que convierta esa
  escritura en push.
- Impacto: si el supervisor no tiene la app abierta con listener activo, **no recibe
  notificación**. Para un trabajador inconsciente esto anula la cadena de rescate.
- Contraste correcto: `FallDetectionMonitor.tsx:59-65` SÍ usa `triggerEmergency('fall')`,
  que persiste + fan-outea por `/api/emergency/notify-brigada`.

### H2 — 🛟 P1: EmergencyOverlay no persiste "Estoy a salvo" ni triage
- `src/components/shared/EmergencyOverlay.tsx:285` — comentario "Here we would normally
  update Firebase: users/uid/status = 'safe'"; el handler solo hace feedback visual.
- `src/components/shared/EmergencyOverlay.tsx:294` — `handleTriage` solo setea estado local
  ("Here we would send the triage report to Firebase").
- El overlay sísmico SÍ persiste (`:85` `tenants/{tid}/seismic_events`), así que la falta
  es específica del estado de personas en evacuación company-mode.

### H3 — ⚠️ DynamicEvacuationMap no usa el A\* real
- `src/components/emergency/DynamicEvacuationMap.tsx:18,49` consume Gemini
  (`calculateDynamicEvacuationRoute`).
- `src/components/emergency/VectorialEvacuationMap.tsx:47-48` — rutas `<motion.path d="…">`
  con coordenadas literales (no calculadas).
- El A\* real (`src/services/routing/gridAStar.ts`) solo lo usa `EvacuationRoutes.tsx`.
  No es fake oculto (texto honesto), pero conviene unificar: el "mapa dinámico" debería
  alimentarse del A\* sobre la grilla del twin.

### H4 — 🏚️ Huérfanos sin page (engine+UI listos, nunca importados)
Componentes (0 referencias externas, confirmado por grep):
`components/drillsManager/DrillResultReviewCard.tsx`,
`components/emergencyBrigade/EmergencyBrigadePanel.tsx`,
`components/firstResponderMap/FirstResponderDispatchPanel.tsx`,
`components/loneWorker/LoneWorkerAdminPanel.tsx`,
`components/loneWorker/LoneWorkerCheckInWidget.tsx`,
`components/zones/RestrictedZonesMapOverlay.tsx`.
Hooks sin consumidor: `useComms`, `useCommsDrill`, `useContingencySimulation`,
`useFirstResponderMap`, `useGeofencePermissions`, `useRefuges`.
- **Riesgo life-critical específico:** `FirstResponderDispatchPanel` + `useFirstResponderMap`
  exponen el dispatch del respondedor más cercano (paramédico/brigada). El engine
  (`firstResponderMap.ts`) y el route están vivos, pero **no hay punto de entrada UI** ⇒
  la función de "despachar al más cercano" no es alcanzable por un usuario hoy.

### H5 — 🟡 drillsManager sin role gate
- `src/server/routes/drillsManager.ts:236-282` (`/plan`) y `:297-378` (`/execute`) solo
  exigen `assertProjectMember`, sin el patrón `callerCanWrite*` que SÍ aplican
  `emergencyBrigade.ts:137` y `restrictedZones.ts:219`. Cualquier worker puede planificar
  o "ejecutar" (registrar resultado de) un simulacro. Audita, pero la autoridad de acción
  es laxa comparada con sus pares del bloque.

### H6 — Refuges: route + hook redundantes para la UI
- `pages/MountainRefuges.tsx:18-22` importa `findNearestRefuges`/`refugeAvailability`
  directo del servicio (cómputo client-side sobre catálogo bundleado). El router
  `/api/sprint-k/.../refuges` y `useRefuges` quedan sin consumidor de UI. No es un bug,
  pero es superficie duplicada (decidir cuál es canónica).

### Observaciones positivas dignas de registro
- `runLoneWorkerEscalation.ts:119-134`: **no marca idempotente si la notificación falla** —
  reintenta cada 5 min hasta notificar. Diseño correcto para vida.
- `emergency.ts:296-304`: fallo de FCM NO aborta la escritura del SOS (audit + alert doc
  persisten para que un dispatcher humano tome el caso).
- `autoTrigger.ts:237,309,343`: `blockOperation:false` invariante — Directiva fundador
  "nunca bloquear maquinaria" respetada incluso con confirmación USGS sísmica.
- `restrictedZones.ts:402-423`: re-evaluación server-side anti-tamper (el `allowed` del
  servidor gana sobre el del cliente, pero igual persiste el evento).

---

## 4. Para decisión del usuario (❓/⚠️)

1. **⚠️ H1 (P0 vida): ¿ManDown debe disparar push?** Recomendación: que
   `useManDownDetection.triggerAlert` llame `triggerEmergency('man_down', projectId)` (mismo
   path que FallDetectionMonitor) **o** crear un Firestore trigger sobre `mandown_events`
   que invoque `sendToProjectSupervisors`. Hoy un trabajador inconsciente no despierta el
   teléfono del supervisor si la app no está abierta. ¿Confirmas que esto es un gap real
   (no hay otro path que me haya perdido) y lo priorizamos?

2. **⚠️ H2 (P1): ¿Persistir "Estoy a salvo" + triage del EmergencyOverlay?** Hoy el botón
   gigante de la pantalla de emergencia no escribe a Firestore (`EmergencyOverlay.tsx:285,294`).
   ¿Cableamos `users/{uid}.status='safe'` + `triage_reports` para que el headcount del
   supervisor refleje el overlay, o se considera cubierto por el QR scan y el botón es solo UX?

3. **❓ H4 (huérfanos): ¿wire o retire?** 6 componentes + 6 hooks reales están sin page.
   Especialmente `FirstResponderDispatchPanel`/`useFirstResponderMap` (despacho del
   respondedor más cercano) son life-critical sin entrada de usuario. ¿Quieres que se
   cableen a una page (sprint de "wire huérfanos B1") o que se documenten como diferidos en
   `docs/stubs-inventory.md`? Hoy no cumplen la directiva #13 (no están feature-flag-gated
   ni registrados como diferidos — simplemente están muertos en el árbol).

4. **❓ H3: ¿Unificar DynamicEvacuationMap con el A\* real?** El mapa más visible usa Gemini +
   SVG estático; el A\* real solo vive en `EvacuationRoutes`. ¿Migramos DynamicEvacuationMap a
   consumir `findPathAStar` sobre la grilla del twin?

5. **❓ H5: ¿Añadir role gate a drillsManager plan/execute?** Para igualar el rigor de
   `emergencyBrigade`/`restrictedZones`. ¿Es deliberado que cualquier member planifique
   simulacros?

6. **❓ H6: ¿Cuál es la fuente canónica de refugios** — el servicio client-side (page actual)
   o el route `/api/.../refuges`? Conviene retirar la redundante.
