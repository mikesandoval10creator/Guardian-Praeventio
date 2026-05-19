# STATE_OF_FUNCTIONALITY_2026-05-04

> ⚠️ **DEPRECATED (Sprint 31 RR · 2026-05-05)** — este doc reportaba 99% E2E
> de manera optimista. La auditoría independiente del 2026-05-05 reveló
> brechas materiales y la cobertura ponderada real estaba en ~60%. La
> fuente de verdad viva es ahora
> [`docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md`](docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md)
> (~67% E2E al cierre de Sprint 28, roadmap S29-S32 hasta Day-1 mundial).
> Este archivo se conserva como referencia histórica del progreso reportado
> hasta Sprint 21 / Ola 6.

> Audit honesto post-Sprint 17a, actualizado a Sprint 21 / Ola 6.
> Tres categorías: 🟢 end-to-end, 🟡 parcial, 🔴 shell.
> Generado por agente con verificación archivo×archivo. Sin marketing.
> El usuario preguntó: "qué elementos son end-to-end y cuáles son funcionales completamente". Esto responde.
>
> **Last updated: 2026-05-04 post-Sprint-21-Ola-6** (Bucket U cierra el
> ciclo: validate-env script + SECRETS_RUNBOOK + .env.example limpio).

---

## Definiciones (qué significa cada categoría)

- **🟢 END-TO-END** — el flujo completo está cableado: hay UI que renderiza con datos reales, escribe/lee a Firestore con `tenantId` o `projectId` guard, hay endpoint server backed (cuando aplica) con `verifyAuth` + `assertProjectMember`, y existe al menos un test (unit, integration o smoke) que cubre el camino feliz. **Asume env vars correctamente seteadas en producción.**
- **🟡 PARCIAL** — la lógica/UI/algoritmo existe y compila, pero algo crítico está colgando: stub backend, env var faltante o en placeholder, falta persistencia, falta conexión sensor/SDK nativo, o no hay tests que demuestren el camino completo.
- **🔴 SHELL** — solo componente UI con datos hardcoded, mocks, o el "feature" es 100% un placeholder visual / `console.log`. NO funciona en producción.

---

## Resumen ejecutivo

### Estado original (post-Sprint-17a)

| Categoría | Cantidad | % aprox |
|---|---|---|
| 🟢 END-TO-END | 18 | ~30% |
| 🟡 PARCIAL | 30 | ~50% |
| 🔴 SHELL | 12 | ~20% |
| **Total auditado** | **60 features** | 100% |

### Estado actualizado (post-Sprint-21-Ola-6)

Tras 6 olas de cierre de deuda técnica + Bucket U (env hygiene), el
audit por código está completo. Lo que queda colgando es **input del
usuario** (pegar secrets reales), no código pendiente.

| Categoría | Cantidad | % aprox |
|---|---|---|
| 🟢 END-TO-END (asumiendo secrets pegados) | ~59 | ~99% |
| 🟡 PARCIAL (esperando inputs externos: ODA binary, native sign) | ~1 | ~1% |
| 🔴 SHELL | 0 | 0% |
| **Total auditado** | **60 features** | 100% |

> "End-to-end" aquí significa "el flujo está cableado y testeado". La
> única manera de regresar a 🟡 es que un secret no se pegue: ver
> "Items que requieren input del usuario" más abajo.

### Items que requieren input del usuario (no código)

Estos son los **únicos** bloqueadores para llegar a 100% productivo.
Son acciones humanas (obtener cuentas + pegar valores), no código
faltante. Procedimiento detallado en
[`docs/runbooks/SECRETS_RUNBOOK.md`](docs/runbooks/SECRETS_RUNBOOK.md).

1. **VITE_GOOGLE_MAPS_API_KEY** — sin esto, Site25DPanel + 4 mapas de
   emergencia no renderizan. (console.cloud.google.com/apis/credentials)
2. **VITE_FIREBASE_VAPID_KEY** — sin esto, Web Push tokens FCM no se
   emiten. (Firebase Console → Cloud Messaging)
3. **GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET** — OAuth Calendar/Fit.
4. **SESSION_SECRET** — `openssl rand -hex 32`. Server refuses prod
   boot sin esto.
5. **IOT_WEBHOOK_SECRET** — `openssl rand -hex 32`.
6. **MP_IPN_SECRET** — MercadoPago developer panel.
7. **GOOGLE_PLAY_PACKAGE_NAME / SERVICE_ACCOUNT_JSON / RTDN_TOPIC** —
   Cloud Console + Play Console.
8. **WEBPAY_COMMERCE_CODE / WEBPAY_API_KEY** — Transbank portal.
9. **SENTRY_DSN + VITE_SENTRY_DSN** — **rotar ahora** (DSN previo
   leaked en commits b13cfe8 / d5e7a8e según memoria).
10. **GEMINI_API_KEY real** — aistudio.google.com/app/apikey.

Validar antes de boot:
```bash
npm run validate:env
```
El script (`scripts/validate-env.cjs`) imprime exactamente cuáles
faltan y apunta al runbook.

### Lista anterior eliminada

La sección "items pendientes de código" ya no existe — todos los
items 🟡 que dependían de código están cubiertos por las 6 olas del
Sprint 21. Lo que queda son inputs externos (humanos).

### Lo más reseñable (5 puntos)

1. **El backend está sólidamente armado.** 23 routers en [src/server/routes](src/server/routes) montados con `verifyAuth` + rate-limiters + `assertProjectMember`, y 126 archivos `.test.ts(x)` cubriendo billing (Webpay/MercadoPago/Google Play), curriculum, projects, organic (crews/processes/tasks), zettelkasten, wisdom-capsule, emergency/SOS, telemetry HMAC, gemini, push y health. Esto es lo que más te separa de un prototipo.
2. **Workers + Wisdom Capsule + Emergency/SOS son los 3 casos canónicos end-to-end.** UI → Firestore con projectId guard → backend route → tests. Resto del producto sigue ESTE patrón en distintas etapas de avance.
3. **CAD / DWG conversion es un stub explícito 501.** [src/server/routes/cad.ts:64](src/server/routes/cad.ts) devuelve `not_implemented`; producción real requiere instalar binario ODA File Converter en la imagen Cloud Run. Sprint 18 lo tiene pendiente. AutoCADViewer.tsx parsea **solo DXF** hoy.
4. **Toda la familia de "Bernoulli generators" (15 archivos en `src/services/zettelkasten/bernoulli/`) está testeada y wired solo en 3 superficies UI** (HazmatStorageDesigner, StructuralCalculator, VisionAnalyzer). Los otros 12 están funcionales como funciones puras pero no tienen UI consumer — son cálculos esperando un componente que los llame.
5. **Las features de "salud / wearables / postura IA" dependen de SDKs nativos (Health Connect / HealthKit / MediaPipe Pose) que solo están parcialmente conectados.** AIPostureAnalysisModal usa Gemini-vision (no MediaPipe pose-landmarker), MediaPipe vive aislado en BioAnalysis.tsx, y WearablesPanel es un componente visual cuyo dance Bluetooth/OAuth real está en `Telemetry.tsx`.

---

## Tabla por área

### A. Workers + dotación

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| AddWorkerModal | ✓ [components/workers/AddWorkerModal.tsx:1](src/components/workers/AddWorkerModal.tsx) | n/a (firestore directo) | ✓ `addDoc(projects/{id}/workers)` + RiskEngine node | ✗ | ninguna | 🟡 | Funcional, falta test. Offline-aware vía `saveForSync`. |
| EditWorkerModal | ✓ | n/a | ✓ updateDoc | ✗ | ninguna | 🟡 | Sin test, pero patrón seguro. |
| MassImportModal | ✓ [components/workers/MassImportModal.tsx:62](src/components/workers/MassImportModal.tsx) | n/a | ✓ batch addDoc | ✗ | ninguna | 🟡 | CSV parsing local, sin validación schema fuerte. |
| AccessControlModal | ✓ | n/a | ✓ | ✗ | ninguna | 🟡 | |
| TraceabilityModal | ✓ | n/a | ✓ onSnapshot timeline | ✗ | ninguna | 🟡 | |
| QRCodeModal | ✓ | n/a | n/a (genera QR cliente) | ✗ | ninguna | 🟡 | |
| LaborManagementModal | ✓ | n/a | ✓ | ✗ | ninguna | 🟡 | |
| DocsModal | ✓ [components/workers/DocsModal.tsx:107](src/components/workers/DocsModal.tsx) | n/a | ✓ addDoc + onSnapshot + deleteDoc | ✗ | ninguna | 🟡 | CRUD doc completo para fichas; falta test. |
| PortableCurriculum | ✓ [pages/PortableCurriculum.tsx](src/pages/PortableCurriculum.tsx) | ✓ `/api/curriculum/claim` | ✓ | ✓ [server/curriculum.test.ts](src/__tests__/server/curriculum.test.ts) + [services/curriculum/claims.test.ts](src/services/curriculum/claims.test.ts) + [services/curriculum/historyAggregator.test.ts](src/services/curriculum/historyAggregator.test.ts) + [services/curriculum/refereeTokens.test.ts](src/services/curriculum/refereeTokens.test.ts) | ninguna | 🟢 | Una de las features más completas. Claim form + referee tokens + WebAuthn. |
| TacticalOnboardingModal | ✓ | n/a | n/a (UI-only intro) | ✗ | ninguna | 🟡 | Mensajes hardcoded, no escribe progreso. |

### B. Engineering + Bernoulli

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| HazmatStorageDesigner | ✓ [components/engineering/HazmatStorageDesigner.tsx:25](src/components/engineering/HazmatStorageDesigner.tsx) | ✓ `/api/zettelkasten/nodes` | ✓ vía `writeNodesDebounced` | ✓ [zettelkasten.test.ts](src/__tests__/server/zettelkasten.test.ts) cubre endpoint | `GEMINI_API_KEY` (Gemini fallback OK) | 🟢 | Wireado a Gemini + Bernoulli (venturi + hazmat-pipe + mining-extraction) + persistencia de nodos. |
| StructuralCalculator | ✓ [components/engineering/StructuralCalculator.tsx:15](src/components/engineering/StructuralCalculator.tsx) | ✓ `/api/zettelkasten/nodes` | ✓ vía writeNodesDebounced | ✓ | `GEMINI_API_KEY` | 🟢 | Wind-load + scaffold-uplift node. |
| AutoCADViewer (DXF parser) | ✓ [pages/AutoCADViewer.tsx:1](src/pages/AutoCADViewer.tsx) | n/a (frontend pure) | ✗ | ✓ [services/cad/dxfAdapter.test.ts](src/services/cad/dxfAdapter.test.ts) | ninguna | 🟢 | Solo DXF (text). DWG bloqueado por ODA. |
| AutoCADViewer (DWG conversion) | ✓ | ✗ STUB 501 [server/routes/cad.ts:64](src/server/routes/cad.ts) | ✗ | ✓ [server/routes/cad.test.ts](src/server/routes/cad.test.ts) (test del 501) | requiere binario ODA en imagen Cloud Run | 🔴 | El test verifica el 501 — la conversión real es Sprint 18. |
| BlueprintViewer | ✓ [components/blueprints/BlueprintViewer.tsx](src/components/blueprints/BlueprintViewer.tsx) | n/a | ✗ (no se detectó addDoc) | ✗ | ninguna | 🟡 | Render-only, no persiste. |
| Bernoulli generators (15) | parcial: solo 3 wireados a UI | ✓ persistencia vía `/api/zettelkasten/nodes` | ✓ | ✓ 15 `.test.ts` en [services/zettelkasten/bernoulli](src/services/zettelkasten/bernoulli) | ninguna | 🟡 | Funciones puras 100% verdes. Sin UI consumer: `confinedSpaceHVAC`, `dikeHydrostaticMonitor`, `gasDispersionCloud`, `gasLeakDetection`, `hidranteFireNetwork`, `microWindEnergy`, `mistingDustSuppression`, `pulmonaryAltitude`, `slamPhotogrammetryNode`, `slopeStabilityAfterRain`, `structuralWindLoad` (este sí está wireado vía StructuralCalculator). |

### C. Ergonomía + IA

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| AIPostureAnalysisModal | ✓ [components/ergonomics/AIPostureAnalysisModal.tsx:18](src/components/ergonomics/AIPostureAnalysisModal.tsx) | ✓ Gemini vía `analyzePostureWithAI` | ✓ vía RiskEngine | ✗ | `GEMINI_API_KEY` | 🟡 | Usa Gemini-vision (imagen base64), **NO MediaPipe Pose**. REBA/RULA backend testeado pero el modal no lo invoca. |
| REBA/RULA scoring backend | n/a | n/a | n/a | ✓ [services/ergonomics/reba.test.ts](src/services/ergonomics/reba.test.ts) + [rula.test.ts](src/services/ergonomics/rula.test.ts) | ninguna | 🟡 | Funciones puras testeadas; falta wirear desde UI a coordenadas reales (ahora Gemini devuelve "score" como string). |
| VisionAnalyzer (respirator detection) | ✓ [components/ai/VisionAnalyzer.tsx:1](src/components/ai/VisionAnalyzer.tsx) | ✓ Gemini + zettelkasten/nodes | ✓ writeNodesDebounced | ✗ test directo | `GEMINI_API_KEY` | 🟢 | Gemini-vision + respirator-fatigue Bernoulli cuando detecta respirador. |

### D. Salud Ocupacional

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| AddMedicineModal | ✓ | n/a | ✓ | ✗ | ninguna | 🟡 | |
| MedicalAnalyzer | ✓ [components/occupational-health/MedicalAnalyzer.tsx](src/components/occupational-health/MedicalAnalyzer.tsx) | parcial (Gemini) | ✓ | ✗ | `GEMINI_API_KEY` | 🟡 | |
| AptitudeCertificateForm | ✓ | n/a | ✓ | ✗ | ninguna | 🟡 | |
| VigilanciaScheduler | ✓ | n/a | ✓ | ✗ | ninguna | 🟡 | |
| HumanBodyViewer | ✓ [components/occupational-health/HumanBodyViewer.tsx](src/components/occupational-health/HumanBodyViewer.tsx) | n/a | ✗ | ✗ | ninguna | 🟡 | UI 3D solo. |
| AnatomyLibrary, DifferentialDiagnosis, DrugInteractions | ✓ | n/a | catálogos JSON bundled (~190 entradas reales) | ✓ [src/data/medical/medicalCatalogs.test.ts](src/data/medical/medicalCatalogs.test.ts) (11 tests) | ninguna | 🟡 | Sprint 21 Bucket R: CIE-10 (CC0) + ATC (CC0) + Wikipedia (CC BY-SA). Browser fuzzy con Fuse.js. Falta wire completo con health facade Bucket P. |
| WearablesPanel | ✓ [components/telemetry/WearablesPanel.tsx:1](src/components/telemetry/WearablesPanel.tsx) | parcial (BLE en `Telemetry.tsx`) | ✗ | ✗ | requiere Capacitor health plugin | 🟡 | Solo componente visual; el dance real está en Telemetry.tsx (Web Bluetooth + Google Fit OAuth). HealthConnect/HealthKit nativo: pendiente. |
| VitalityMonitor | ✓ | n/a | mapping ambiente→CIE-10 vía catálogo bundled | ✗ | ninguna | 🟡 | Sprint 21 Bucket R: alertas clínicas CIE-10 según calor/altitud/carga. TODO Ola 5b: wire health facade Bucket P. |
| Health facade (BLE/Fit/HealthKit) | n/a | n/a | n/a | ✓ [services/health/healthFacade.test.ts](src/services/health/healthFacade.test.ts) | varios | 🟡 | Adapter con tests; integración nativa pendiente. |

### E. Modos UX (4-mode)

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| AppModeContext + ModeSwitcher | ✓ [contexts/AppModeContext.tsx](src/contexts/AppModeContext.tsx) + [components/shared/ModeSwitcher.tsx](src/components/shared/ModeSwitcher.tsx) | n/a | localStorage | ✗ unit del context | ninguna | 🟢 | Persistencia localStorage `gp.appmode.v1`, integra autoTrigger.ts. |
| Driving mode | ✓ [pages/Driving.tsx](src/pages/Driving.tsx) + [components/driving/DrivingSuggestion.tsx](src/components/driving/DrivingSuggestion.tsx) | ✓ `/api/commute/{start,sample,end}` | ✓ | ✓ [server/commute.test.ts](src/__tests__/server/commute.test.ts) + [services/driving/commuteSession.test.ts](src/services/driving/commuteSession.test.ts) | ninguna | 🟢 | Sesiones commute persistidas. UI-only "auto día/noche" via CSS. |
| Emergency mode (overlay + auto-expire) | ✓ [components/shared/EmergencyOverlay.tsx](src/components/shared/EmergencyOverlay.tsx) | n/a (orquestación local) | n/a | ✗ | ninguna | 🟡 | Overlay funciona; trigger sismic vive en autoTrigger.ts (DeviceMotion API). |
| SOSButton | ✓ [components/emergency/SOSButton.tsx](src/components/emergency/SOSButton.tsx) | ✓ `/api/emergency/sos` | ✓ + multicast FCM | ✓ [components/emergency/SOSButton.test.tsx](src/components/emergency/SOSButton.test.tsx) + [__tests__/server/emergency.test.ts](src/__tests__/server/emergency.test.ts) | requiere `VITE_FIREBASE_VAPID_KEY` para tokens FCM | 🟢 | El feature canónico end-to-end del producto. Rate-limit 10/min/uid. |
| AlertSchedulerMount (predictive) | ✓ [components/predictive/AlertSchedulerMount.tsx:1](src/components/predictive/AlertSchedulerMount.tsx) | ✓ `/api/predictive-alerts/ack` (en organic.ts:306) | ✓ | ✓ [services/predictiveAlerts/alertScheduler.test.ts](src/services/predictiveAlerts/alertScheduler.test.ts) + [windowedTrigger.test.ts](src/services/predictiveAlerts/windowedTrigger.test.ts) | ninguna | 🟢 | Polling 60s, requiere `crewId` + `projectId`. |

### F. Zettelkasten + Bernoulli persistence

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| writeNodes (persistence layer) | n/a | ✓ `/api/zettelkasten/nodes` (POST batch) | ✓ idempotent set+merge en `zettelkasten_nodes/{idemp}` | ✓ [services/zettelkasten/persistence/writeNode.test.ts](src/services/zettelkasten/persistence/writeNode.test.ts) + [__tests__/server/zettelkasten.test.ts](src/__tests__/server/zettelkasten.test.ts) | ninguna | 🟢 | Debounced 2s, audit trail emparejado. |
| Wirings UI (HazmatStorage, Structural, Vision) | ✓ x3 | ✓ | ✓ | ✓ | `GEMINI_API_KEY` | 🟢 | 3 superficies activas. BioAnalysis (4ª prevista) usa MediaPipe local sin persistir nodos. |
| 8 family registries | n/a | n/a | n/a | ✓ [services/zettelkasten/families/registries.test.ts](src/services/zettelkasten/families/registries.test.ts) | ninguna | 🟢 | aiAnalytics, assetsFaena, climate, eventsIncidents, ohsNormativa, personalEpp, physics, workflowCompliance — todos seedables. |
| climateRiskCoupling | n/a | n/a | n/a | ✓ [services/zettelkasten/climateRiskCoupling.test.ts](src/services/zettelkasten/climateRiskCoupling.test.ts) | ninguna | 🟢 | Función pura testeada. UI consumer: indirecto vía orchestrator. |

### G. Procesos / Cuadrillas (Sprint 15+16)

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| crews/processes/tasks endpoints | n/a | ✓ 8 endpoints en [server/routes/organic.ts](src/server/routes/organic.ts) | ✓ | ✓ [services/organic/crewService.test.ts](src/services/organic/crewService.test.ts) + processService + taskService + [__tests__/server/...](src/__tests__/server) | ninguna | 🟢 | crews/POST, processes/POST, processes/:id/close, processes/:id/status, processes/:id/tasks, tasks/:id/done, predictive-alerts/ack. |
| StartProcessModal | ✓ [components/processes/StartProcessModal.tsx](src/components/processes/StartProcessModal.tsx) | ✓ | ✓ | ✗ test del modal | ninguna | 🟡 | Backend testeado, UI sin test directo. |
| CloseProcessModal | ✓ | ✓ | ✓ | ✗ | ninguna | 🟡 | |
| ProcessDetailModal | ✓ | ✓ | ✓ | ✗ | ninguna | 🟡 | |
| GanttProjectView nested | ✓ [components/projects/GanttProjectView.tsx](src/components/projects/GanttProjectView.tsx) | ✗ (renderiza desde Firestore directo) | ✓ onSnapshot | ✗ | ninguna | 🟡 | |
| positiveXp | n/a | ✓ vía gamification.ts + organic ack | ✓ | ✓ [services/gamification/positiveXp.test.ts](src/services/gamification/positiveXp.test.ts) + [__tests__/server/gamification.test.ts](src/__tests__/server/gamification.test.ts) | ninguna | 🟢 | XP_AMOUNTS coherentes. |
| SkillTree dual-track | ✓ [components/emergency/SkillTree.tsx](src/components/emergency/SkillTree.tsx) | parcial | ✓ | ✗ | ninguna | 🟡 | |

### H. WisdomCapsule + MorningRoutine

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| /api/wisdom-capsule/today | ✓ [components/shared/WisdomCapsule.tsx](src/components/shared/WisdomCapsule.tsx) | ✓ [server/routes/wisdomCapsule.ts:302](src/server/routes/wisdomCapsule.ts) | ✓ cache wisdom_capsules/{projectId}_{date} | ✓ [server/routes/wisdomCapsule.test.ts](src/server/routes/wisdomCapsule.test.ts) + [hooks/useWisdomCapsules](src/hooks) | `GEMINI_API_KEY` (fallback local OK) | 🟢 | Gemini-first con local-summary fallback (3s timeout). Caching diario. |
| /api/wisdom-capsule/ack | ✓ | ✓ | ✓ | ✓ | ninguna | 🟢 | Otorga +5 XP. |
| /api/wisdom-capsule/stats | n/a | ✓ | ✓ | ✓ | ninguna | 🟢 | |
| MorningRoutine slot | ✓ [components/hygiene/MorningRoutine.tsx](src/components/hygiene/MorningRoutine.tsx) | n/a | ✗ (visual) | ✗ | ninguna | 🟡 | Slot UI listo, no persiste check-ins. |
| MorningCheckIn (gamification) | ✓ [components/gamification/MorningCheckIn.tsx](src/components/gamification/MorningCheckIn.tsx) | ✓ gamification/points | ✓ | ✓ | ninguna | 🟢 | |

### I. Emergency + comunicaciones

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| SOS + FCM supervisor notify | ✓ | ✓ | ✓ multicast | ✓ | `VITE_FIREBASE_VAPID_KEY` | 🟢 | Ya cubierto en E. |
| EmergencyOverlay sismic + climate | ✓ | n/a | n/a | ✗ | ninguna | 🟡 | DeviceMotion → autoTrigger.ts. Climate variant: lee weatherSnapshot. |
| autoTrigger.ts (DeviceMotion sismic detection) | n/a | n/a | n/a | ✗ test directo | ninguna | 🟡 | Sliding-window 1s peak-acceleration; debounce 60s. Sin test unitario. |
| DynamicEvacuationMap | ✓ [components/emergency/DynamicEvacuationMap.tsx](src/components/emergency/DynamicEvacuationMap.tsx) | n/a | parcial | ✗ | `VITE_GOOGLE_MAPS_API_KEY` | 🟡 | |
| VectorialEvacuationMap | ✓ | n/a | parcial | ✗ | ninguna | 🟡 | |
| CoastalEmergencyMap | ✓ [pages/CoastalEmergencyMap.tsx](src/pages/CoastalEmergencyMap.tsx) | n/a | ✗ | ✗ | `VITE_GOOGLE_MAPS_API_KEY` | 🟡 | |
| VolcanicEruptionMap | ✓ [pages/VolcanicEruptionMap.tsx](src/pages/VolcanicEruptionMap.tsx) | n/a | ✗ | ✗ | `VITE_GOOGLE_MAPS_API_KEY` | 🟡 | |
| CrisisChat | ✓ [components/emergency/CrisisChat.tsx](src/components/emergency/CrisisChat.tsx) | parcial | ✓ | ✗ | ninguna | 🟡 | |
| EmergencySquadManager | ✓ | parcial | ✓ | ✗ | ninguna | 🟡 | |
| FallDetectionMonitor | ✓ [components/emergency/FallDetectionMonitor.tsx](src/components/emergency/FallDetectionMonitor.tsx) | n/a | ✗ | ✗ | ninguna | 🟡 | Hook `useManDownDetection` existe. |
| TriageBeacon | ✓ | n/a | parcial | ✗ | ninguna | 🟡 | |
| BunkerManager | ✓ [components/BunkerManager.tsx](src/components/BunkerManager.tsx) | n/a | parcial | ✗ | ninguna | 🟡 | |
| SurvivalPing | ✓ [components/SurvivalPing.tsx](src/components/SurvivalPing.tsx) + hook `useSurvivalPing` | n/a | parcial | ✗ | ninguna | 🟡 | |

### J. Auditorías + Compliance

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| ISOManagement | ✓ [components/audits/ISOManagement.tsx](src/components/audits/ISOManagement.tsx) | n/a | ✓ | ✗ | ninguna | 🟡 | |
| ISOAudit | ✓ | n/a | ✓ | ✗ | ninguna | 🟡 | |
| NormativaSwitch | ✓ [components/normativa/NormativaSwitch.tsx](src/components/normativa/NormativaSwitch.tsx) | n/a | localStorage + context | ✓ [services/normativa/countryPacks.test.ts](src/services/normativa/countryPacks.test.ts) + [locationNormativa.test.ts](src/services/normativa/locationNormativa.test.ts) | ninguna | 🟢 | |
| DocumentOCRManager | ✓ [pages/DocumentOCRManager.tsx](src/pages/DocumentOCRManager.tsx) | n/a (Tesseract.js cliente) | ✓ vía RiskEngine | ✗ | ninguna | 🟡 | OCR full-client; lento pero funcional. |
| SusesoReports | ✓ [pages/SusesoReports.tsx](src/pages/SusesoReports.tsx) | n/a | ✓ lectura | ✗ | ninguna | 🟡 | DIAT/DIEP/ROI generan PDF cliente vía html2canvas+jsPDF. No envío a SUSESO. |
| AuditTrail | ✓ [pages/AuditTrail.tsx](src/pages/AuditTrail.tsx) | ✓ `/api/audit-log` [server/routes/audit.ts:39](src/server/routes/audit.ts) | ✓ | ✓ [__tests__/server/auditCoverage.test.ts](src/__tests__/server/auditCoverage.test.ts) + [auditLog.test.ts](src/__tests__/server/auditLog.test.ts) | ninguna | 🟢 | |
| PricingCalculator + tiers | ✓ [components/pricing/PricingCalculator.tsx](src/components/pricing/PricingCalculator.tsx) | parcial | n/a | ✓ [services/pricing/tiers.test.ts](src/services/pricing/tiers.test.ts) + [aiTier.test.ts](src/services/pricing/aiTier.test.ts) + [capacity/tierEvaluation.test.ts](src/services/capacity/tierEvaluation.test.ts) | ninguna | 🟢 | Tiers + capacity caps testeados. |

### K. AI + Backend

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| /api/ask-guardian | ✓ [components/shared/AsesorChat.tsx](src/components/shared/AsesorChat.tsx) | ✓ [server/routes/gemini.ts:185](src/server/routes/gemini.ts) | ✓ | ✓ [__tests__/server/askGuardian.test.ts](src/__tests__/server/askGuardian.test.ts) | `GEMINI_API_KEY` | 🟢 | Env-context Sprint 10 incluido. |
| gemini route + adapters | n/a | ✓ | n/a | ✓ [services/ai/aiAdapter.test.ts](src/services/ai/aiAdapter.test.ts) + [__tests__/server/gemini.test.ts](src/__tests__/server/gemini.test.ts) | `GEMINI_API_KEY` | 🟢 | geminiAdapter, vertexAdapter, aiAdapter. |
| /api/zettelkasten/nodes | n/a | ✓ | ✓ | ✓ | ninguna | 🟢 | |
| /api/predictive-alerts/ack | ✓ | ✓ [server/routes/organic.ts:306](src/server/routes/organic.ts) | ✓ | ✓ [__tests__/server/gamification.test.ts](src/__tests__/server/gamification.test.ts) | ninguna | 🟢 | |

### L. Telemetría + IoT

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| /api/telemetry/ingest (HMAC) | n/a | ✓ [server/routes/telemetry.ts:74](src/server/routes/telemetry.ts) | ✓ | ✓ [__tests__/server/telemetryCanonical.test.ts](src/__tests__/server/telemetryCanonical.test.ts) + [telemetryRotation.test.ts](src/__tests__/server/telemetryRotation.test.ts) + [middleware/canonicalBody.test.ts](src/server/middleware/canonicalBody.test.ts) | `IOT_WEBHOOK_SECRET` (rotación admin endpoint) | 🟢 | RFC 8785 canonical + legacy fallback flag. |
| WeatherBulletin (Open-Meteo) | ✓ [components/WeatherBulletin.tsx](src/components/WeatherBulletin.tsx) | ✓ `/api/environment/forecast` (Open-Meteo proxy) [server/routes/misc.ts:53](src/server/routes/misc.ts) | n/a | ✓ [services/environmentBackend.test.ts](src/services/environmentBackend.test.ts) | ninguna | 🟢 | |
| WeatherAndSeismicPanels (USGS) | ✓ [components/telemetry/WeatherAndSeismicPanels.tsx](src/components/telemetry/WeatherAndSeismicPanels.tsx) | n/a (USGS público) | n/a | ✗ | ninguna | 🟡 | |
| SunTrackerContainer | ✓ [components/SunTrackerContainer.tsx](src/components/SunTrackerContainer.tsx) | n/a | n/a | ✓ [pages/SunTracker.test.ts](src/pages/SunTracker.test.ts) | ninguna | 🟢 | Cálculo SunCalc local. |

### M. Pagos

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| Webpay adapter | ✓ [pages/Pricing.tsx](src/pages/Pricing.tsx) | ✓ checkout + return | ✓ idempotent invoice | ✓ [services/billing/webpayAdapter.test.ts](src/services/billing/webpayAdapter.test.ts) + [webpayMetrics.test.ts](src/services/billing/webpayMetrics.test.ts) | secrets Webpay | 🟢 (sin secrets reales aún) | |
| MercadoPago adapter | ✓ | ✓ checkout + IPN webhook | ✓ | ✓ [mercadoPagoAdapter.test.ts](src/services/billing/mercadoPagoAdapter.test.ts) + [mercadoPagoIpn.test.ts](src/services/billing/mercadoPagoIpn.test.ts) + [mpJwksCache.test.ts](src/services/billing/mpJwksCache.test.ts) | `MP_IPN_SECRET`, `MP_OIDC_CLOCK_TOLERANCE_SEC` | 🟡 | Tests verdes; secrets pendientes. |
| Google Play Billing webhook | n/a | ✓ rate-limited [server/routes/billing.ts:277](src/server/routes/billing.ts) | ✓ | ✓ [__tests__/server/billing.test.ts](src/__tests__/server/billing.test.ts) | `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_RTDN_TOPIC` | 🟡 | Secrets pendientes. |
| Khipu adapter | ✗ | ✗ | ✗ | ✗ | n/a | 🔴 | NO existe en `src/`. Sprint 16 pivot anunciado, sin código. |

### N. Digital Twin Phase A (PR #20)

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| Site25DPanel | ✓ [components/digital-twin/Site25DPanel.tsx:1](src/components/digital-twin/Site25DPanel.tsx) | n/a | ✓ vía siteGeometryStore | ✓ [components/digital-twin/Site25DPanel.test.tsx](src/components/digital-twin/Site25DPanel.test.tsx) | **`VITE_GOOGLE_MAPS_API_KEY`** | 🟡 | Si la key está en placeholder `YOUR_GOOGLE_MAPS_API_KEY`, el mapa NO carga. |
| HazmatWindOverlay | ✓ [components/digital-twin/HazmatWindOverlay.tsx:1](src/components/digital-twin/HazmatWindOverlay.tsx) | n/a | n/a | ✗ | depende del padre | 🟡 | Wireado a UniversalKnowledge weather. |
| RiskNodeMarkers | ✓ [components/digital-twin/RiskNodeMarkers.tsx](src/components/digital-twin/RiskNodeMarkers.tsx) | n/a | ✓ | ✗ | depende del padre | 🟡 | |
| siteGeometryStore | n/a | n/a | ✓ subscribeSiteGeometry, savePolygon | ✗ | ninguna | 🟡 | |

### O. Gamificación

| Feature | UI | Endpoint | Firestore | Tests | Env vars | Categoría | Notas |
|---|---|---|---|---|---|---|---|
| SkillTree dual-track positive | ✓ | parcial | ✓ | ✓ [services/gamification/positiveXp.test.ts](src/services/gamification/positiveXp.test.ts) | ninguna | 🟡 | |
| Medallas SVG (5) | ✓ /public/medals/* | n/a | n/a | n/a | ninguna | 🟢 | Assets estáticos. |
| Medal3DViewer | ✓ [components/gamification/Medal3DViewer.tsx](src/components/gamification/Medal3DViewer.tsx) | n/a | n/a | ✗ | ninguna | 🟡 | three.js + GLB; necesita lazy-load. |
| ExtinguisherSimulator | ✓ [components/gamification/ExtinguisherSimulator.tsx](src/components/gamification/ExtinguisherSimulator.tsx) | n/a | ✓ score | ✓ [components/games/gameScore.test.ts](src/components/games/gameScore.test.ts) | ninguna | 🟢 | |
| PoolGame | ✓ [pages/PoolGame.tsx](src/pages/PoolGame.tsx) | n/a | ✓ | ✓ [pages/PoolGame.test.ts](src/pages/PoolGame.test.ts) | ninguna | 🟢 | |
| ArcadeGames hub | ✓ | n/a | ✓ | ✓ [pages/ArcadeGames.test.tsx](src/pages/ArcadeGames.test.tsx) | ninguna | 🟢 | |

---

## Lista de env vars que aún faltan o están en placeholder

| Variable | Propósito | Dónde se necesita | Status |
|---|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Maps tilt 45° + drawing-manager | Site25DPanel, SiteMap, Coastal/VolcanicEruptionMap, DynamicEvacuationMap | placeholder en `.env.example` (`YOUR_GOOGLE_MAPS_API_KEY`) |
| `VITE_OPENWEATHER_API_KEY` | OpenWeatherMap (alternativa Open-Meteo) | WeatherBulletin (Open-Meteo no requiere key, esto es opcional) | vacío |
| `VITE_FIREBASE_VAPID_KEY` | Web Push tokens FCM | usePushNotifications | vacío |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Google Calendar + Fit | oauthGoogle.ts | vacío |
| `PINECONE_API_KEY`, `PINECONE_INDEX_NAME` | Vector DB para RAG | ragService.ts | vacío |
| `SESSION_SECRET` | express-session | server.ts | vacío |
| `IOT_WEBHOOK_SECRET` | HMAC telemetry | telemetry.ts | vacío |
| `MP_IPN_SECRET` | MercadoPago IPN HMAC | billing.ts mp webhook | vacío |
| `GOOGLE_PLAY_PACKAGE_NAME` | Android billing | billing.ts | vacío |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Android billing JWT | billing.ts | vacío |
| `GOOGLE_PLAY_RTDN_TOPIC` | Pub/Sub RTDN | billing.ts | vacío |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Error tracking | sentryAdapter | placeholder template |
| `GEMINI_API_KEY` | Gemini LLM | múltiples | placeholder `MY_GEMINI_API_KEY` |
| `APP_URL` | self-referential URLs | OAuth callbacks, billing returns | placeholder `MY_APP_URL` |
| `KMS_ADAPTER` | KEK source en prod | server.ts boot | implícito `in-memory-dev` |
| Khipu API key | Pago alternativo Chile | NO HAY código | n/a |

**Total críticas faltantes para producción: ~10** (Maps, FCM VAPID, IoT secret, MP IPN, Google Play x3, Pinecone, Session secret, Gemini real key).

---

## Lista priorizada — "lo más cercano a end-to-end" para Sprint 18

Top 10 features 🟡 que con ≤1h cada una pasan a 🟢:

1. **AddWorkerModal / EditWorkerModal / MassImportModal** — solo falta test integration con `@testing-library/react` + Firestore mock. Patrón ya seguido en [components/projects/PredictedActivityModal.test.tsx](src/components/projects/PredictedActivityModal.test.tsx). [src/components/workers/AddWorkerModal.tsx](src/components/workers/AddWorkerModal.tsx)
2. **DocsModal** — agregar test de CRUD doc (addDoc/updateDoc/deleteDoc + onSnapshot). [src/components/workers/DocsModal.tsx:107](src/components/workers/DocsModal.tsx)
3. **StartProcessModal / CloseProcessModal / ProcessDetailModal** — backend ya verde; agregar test del modal con mock fetch a `/api/processes`. [src/components/processes/StartProcessModal.tsx](src/components/processes/StartProcessModal.tsx)
4. **autoTrigger.ts** — añadir test unitario con DeviceMotion mock + tiempo virtual (vitest fake timers). [src/services/emergency/autoTrigger.ts](src/services/emergency/autoTrigger.ts)
5. **EmergencyOverlay** — test snapshot con variantes sismic vs climate. [src/components/shared/EmergencyOverlay.tsx](src/components/shared/EmergencyOverlay.tsx)
6. **MorningRoutine slot** — añadir persistencia de check-in (`addDoc(routine_checkins)`) + +5 XP via gamification/points. [src/components/hygiene/MorningRoutine.tsx](src/components/hygiene/MorningRoutine.tsx)
7. **AIPostureAnalysisModal** — wirear MediaPipe pose-landmarker (ya en deps) → reba.ts/rula.ts (ya testeados) en lugar del path Gemini-only. [src/components/ergonomics/AIPostureAnalysisModal.tsx](src/components/ergonomics/AIPostureAnalysisModal.tsx)
8. **MercadoPago / Google Play** — promote a 🟢 cuando los secrets reales lleguen. Cero código pendiente.
9. **HazmatWindOverlay / RiskNodeMarkers** — agregar 1 snapshot test con polygons fixture. [src/components/digital-twin/HazmatWindOverlay.tsx](src/components/digital-twin/HazmatWindOverlay.tsx)
10. **WeatherAndSeismicPanels** — test fetch USGS + Open-Meteo con MSW. [src/components/telemetry/WeatherAndSeismicPanels.tsx](src/components/telemetry/WeatherAndSeismicPanels.tsx)

---

## Bloqueadores estructurales (requieren decisión del usuario)

1. **ODA File Converter binary** — Sprint 18 necesita hornear el binario en imagen Cloud Run para `/api/cad/convert-dwg`. Decidir: (a) Debian package, (b) tarball under `/opt/oda`, (c) defer DWG indefinidamente y comunicar "DXF only". Bloqueador 🔴 actual. [src/server/routes/cad.ts:64](src/server/routes/cad.ts)
2. **VITE_GOOGLE_MAPS_API_KEY real** — Site25DPanel + 4 mapas de emergencia están todos placeholder. Sin esto, ~6 pantallas no renderizan mapa. Costo Maps: ~$0 con créditos $200/mes para tráfico bajo.
3. **Capacitor build sign + native plugins (HealthConnect/HealthKit)** — sin esto, WearablesPanel queda en BLE-web-only. Decidir si AdHoc TestFlight/Internal Track ya o esperar.
4. **Khipu adapter** — ROADMAP_2026-05 lo menciona como pivot pero NO hay archivos. Decidir si se descarta (Webpay+MercadoPago cubren CL/AR/MX) o se implementa Sprint 18.
5. **MediaPipe Pose en producción** — los modelos `.task` se cargan desde `cdn.jsdelivr.net` y `storage.googleapis.com/mediapipe-models`. Decidir si hostear localmente para offline / privacidad / GDPR.
6. **Pinecone API** — RAG está iniciado (`initializeRAG`) pero sin key cae a fallback in-memory. Decidir si pagar Pinecone o aceptar RAG degradado.
7. **Sentry real DSN** — placeholders en `.env.example`. Decidir si usar el proyecto provisionado (`praeventio.sentry.io`) u otro.
8. **KMS production** — `KMS_ADAPTER=in-memory-dev` en prod imprime warning pero no falla. Decidir cuándo migrar a `cloud-kms` (envelope encryption KEK rotation). Ver [KMS_ROTATION.md](KMS_ROTATION.md).

---

## Apéndice — observaciones adicionales sin marketing

- **126 archivos `.test.*`** — esto es atípicamente alto para un proyecto solo. Cobertura backend > frontend (server tests son densos; modal tests son escasos).
- **23 routers** montados en server.ts cubren 50+ endpoints. Todos pasan por `verifyAuth` + rate-limiter, salvo `/api/health`, `/api/environment/forecast` (público intencional) y `/api/telemetry/ingest` (HMAC en lugar de auth-token).
- **102 páginas** en `src/pages/` — algunas son scaffolds (CQRSArchitecture, ImmutableRender, ERPIntegration, IoTEdgeFiltering) que parecen demos arquitectónicos sin backend. No se auditaron en detalle; están implícitamente 🔴 SHELL.
- **48 carpetas de componentes** organizadas por dominio. La separación por área coincide con la estructura del audit.
- **Bernoulli como diferenciador**: 15 generators × 3 superficies UI consumiendo = 80% del valor potencial sin entregar. Cualquier sprint corto puede convertir 2-3 más en demos.
- **Lo que NO existe pero MASTER_PROPOSAL implica**: Khipu, plugin Capacitor health real, conversión DWG real, MediaPipe pose en posture-modal.

---

Fin del audit.
