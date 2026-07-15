# Inventario — escrituras Firestore directas de cliente (trazabilidad server-side)

> Tarea Notion **[P0/P1] Trazabilidad server-side de mutaciones críticas**.
> Producto regulado (Ley 16.744): la auditoría inmutable NO puede depender de
> que cada pantalla escriba bien. Este inventario es el paso 1 del spec
> (inventariar + clasificar por riesgo); la migración va por dominio, vidas/legal
> primero.

## Alcance y método

`src/**` excluyendo `src/server/**` y `*.test.ts(x)`. Se buscaron todas las
llamadas a `addDoc / setDoc / updateDoc / deleteDoc / writeBatch` del SDK
cliente `firebase/firestore` — las que **saltan** el camino auditado `/api/*`.

## Resumen

| Bucket | Archivos | Escrituras (call sites) |
|---|---|---|
| **P0 — vidas/legal** | ~39 | ~83 |
| **P1 — operacional/regulado** | ~26 | ~39 |
| **P2 — conveniencia/baja** | ~21 | ~37 |
| **Total** | ~86 | ~159 |

(El ~314 del conteo bruto incluye los `batch.set/update/delete` internos de cada
`writeBatch` y archivos de test/rules excluidos aquí.)

**Superficie de mayor riesgo:** `src/components/OfflineSyncManager.tsx` — cola de
replay offline **genérica** cuya `action.collection` es dinámica: puede escribir
a CUALQUIER colección P0 (workers, findings, documents, emergency) sin auditar.
Los factories genéricos `csvAdapter.ts` y `createProjectScopedStore.ts` tienen el
mismo problema de amplitud.

## P0 — vidas/legal (por dominio)

### Emergencia / SOS / evacuación / brigada
- `pages/EmergenciaAvanzada.tsx:231,247,260,283,292,309,327` — emergency_events / emergency_chat / emergency_safety
- `pages/EmergencyGenerator.tsx:141,172,246,250,263` — documents / emergency_protocols / brigade_config / emergency_events
- `pages/Emergency.tsx:197` — projects/{id} (isEmergencyActive)
- `pages/Evacuation.tsx:240,284` — emergency_plans / emergency_messages
- `pages/FirstResponderMap.tsx:115` — emergency_chat
- `contexts/EmergencyContext.tsx:131,219` — emergency_events
- `components/emergency/EmergencyCheckIn.tsx:91,115,124` — emergency_checkins (+ writeBatch)
- `components/emergency/CrisisChat.tsx:105,165,186` — emergency_messages
- `components/shared/EmergencyOverlay.tsx:101,334` — seismic_events / emergency_checkins
- `components/ai/EmergencyPlanGenerator.tsx:184,347` — documents / emergency_plans

### Man-Down / lone-worker / GPS
- `hooks/useManDownDetection.ts:144,304,335` — mandown_events / emergency_messages
- `components/dashboard/ManDownSupervisorWidget.tsx:68` — mandown_events (ack)
- `hooks/useGeolocationTracking.ts:116` — locations (GPS PII)

### DEA / AED (paro cardíaco)
- `pages/DEAZones.tsx:164,169,228,238` — deas/{id}/inspections / deas/{id} / dea_locations (mirror público)

### Trabajadores / personal (PII)
- `components/workers/AddWorkerModal.tsx:106` — create
- `components/workers/MassImportModal.tsx:62` — bulk create
- `components/workers/EditWorkerModal.tsx:58` — update  ✅ **MIGRADO** (PATCH /api/projects/:pid/workers/:id)
- `components/workers/LaborManagementModal.tsx:79` — update (odiSigned, digitalSignatureStatus)
- `components/workers/EPPModal.tsx:53` — update (eppIds)
- `components/workers/AccessControlModal.tsx:44` — update (permisos/acceso)

### Hallazgos / grafo de riesgo (`nodes`)
- `pages/BioAnalysis.tsx:519` — findings
- `contexts/UniversalKnowledgeContext.tsx:155,224,239,240` — nodes

### Documentos (evidencia legal)
- `pages/SusesoReports.tsx:159` — documents (reporte SUSESO)
- `components/ai/ReportGenerator.tsx:179`, `pages/PTSGenerator.tsx:292` — documents
- `components/documents/AddDocumentModal.tsx:121`, `EditDocumentModal.tsx:75` — documents
- `pages/Documents.tsx:92` — documents (**delete**)
- `components/projects/ProjectDocuments.tsx:102,130` — project_documents
- `components/workers/DocsModal.tsx:134,175` — workers/{id}/documents (archive = soft-delete, nunca deleteDoc)

### EPP
- `components/epp/EPPVerificationModal.tsx:77` — epp_verifications
- `components/epp/AssignEPPModal.tsx:88,107,121` — epp_assignments / documents / epp_items

### Médico / salud
- `components/hygiene/VitalityMonitor.tsx:83` — clinical_alerts

### Evaluaciones firmadas (IPER / ergonomía)
- `services/safety/iperAssessments.ts:109,166` — iper_assessments (emite audit event, pero la escritura Firestore es directa y **no atómica** con el audit)
- `services/safety/ergonomicAssessments.ts:154,267` — ergonomic_assessments (mismo caveat)

### Permisos / authz / provisioning
- `contexts/FirebaseContext.tsx:139,157` — users/{uid} (rol en primer login)
- `contexts/SubscriptionContext.tsx:147` — users/{uid} (planId; el server es canónico, CLAUDE.md #11)

### Replay offline genérico (multi-dominio — MÁXIMO RIESGO)
- `components/OfflineSyncManager.tsx:44,193,210,230,263,268,323,327,331,335,363` — colección dinámica (create/update/**delete**/merge)

## P1 — operacional/regulado (resumen)

Training/curriculum (`Training.tsx`, `TrainingRecommendations.tsx`, `WebXR.tsx`),
calendario/eventos/tasks (`useAutoCalendarEvents`, `useObjectLifecycle`,
`Projects.tsx`, `AddEventModal`, `EventDetailsModal` [delete], `Matrix.tsx`),
asistencia (`Attendance.tsx`, `MorningCheckIn.tsx` — declaración jurada EPP,
borderline P0), inspecciones/auditorías (`ISOManagement`, `LightPollutionAudit`,
`controlValidationsStore`), inventario/activos (`MaquinariaManager`,
`VehicleDocsTab`, `EPP.tsx`), blueprints, evidencia de incidentes
(`readReceiptStore`, `rootCauseStore`, `siteBookStore`,
`createProjectScopedStore` [factory]), trayecto Ley 16.744
(`commuteSession.ts`), import genérico (`csvAdapter.ts` — importa PII de
workers), planes (`PersonalizedSafetyPlan`), geocercas (`GeofenceAlert`).

## Legítimas de cliente (exclusiones)

Doc propio del usuario / caché offline / on-device / conveniencia: FCM token
mirror (`usePushNotifications` — server canónico), `useSurvivalPing` (ping vital,
debe correr offline), `Settings.tsx` (appPreferences propias), `MorningRoutine`,
`focusBlocks`, `useGamification` (rol NO se escribe cliente), `SunTracker`,
juegos (`PoolGame`, `ClawMachine`), `AsesorChat` (telemetría), feed social
(`SafetyFeed`, `MuralDinamico`), AR anchors, digital-twin (on-device), seeding de
plantillas, `systemEngine/eventLog.ts` (**espeja a audit_logs** vía /api/audit-log).
`etl/organicCsvSync.ts` ya enruta al server (match era comentario).

## Orden de migración propuesto (vidas/legal primero)

1. **Trabajadores** — endpoint auditado `PATCH /projects/:pid/workers/:id` (✅ este PR: EditWorkerModal). Sigue: Add/MassImport/EPP/AccessControl/LaborManagement.
2. **OfflineSyncManager** — el replay debe enrutar por endpoints server auditados por dominio (hoy el flush `syncBatchToNetwork` solo persiste `nodes`/`vector_store`, sin audit).
3. **Documentos** (evidencia legal) y **Emergencia**.
4. IPER/ergonomía — hacer atómica la escritura + audit (hoy la fila puede quedar sin audit si el evento falla).
5. P1 por lotes.
