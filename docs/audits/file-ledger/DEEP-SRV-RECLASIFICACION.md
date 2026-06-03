# DEEP — Reclasificación de bloque: FEAT-server + FEAT-services (375 archivos) · 2026-06-02

**Objetivo:** cerrar la atribución de bloque de los **375 archivos FEAT sin bloque**
(`block===""` en `ledger.json`): **97 `FEAT-server` + 278 `FEAT-services`**. Ya
fueron revisados a fondo en `DEEP-NH-server.md`, `DEEP-NH-services-knowledge.md` y
`DEEP-NH-services-infra.md`; este documento sólo **etiqueta** cada uno con su bloque
final B1-B18 / `B-DigitalTwin` / `CROSS`.

**Método (code-first):** cada asignación se apoya en la evidencia ya escrita en los
tres DEEP de needs-human (router-mount, importer-grep, subsistema) y en la taxonomía
de `INDEX-CONSOLIDADO.md`. `CROSS` = infraestructura transversal sin dueño temático
(middleware genérico, eventStore/eventBus, KMS/cripto, observability, email,
privacy/regímenes, APIs de clima externas, rateLimit, sessionStore, B2D platform,
i18n, identity, scheduler, mobile/foreground, ads, seed). El mapa aplicable al ledger
vive en `srv-reclass-map.json` (mismo directorio).

> **Doc-only.** No se toca `ledger.json` aquí; `srv-reclass-map.json` es el artefacto
> que un codemod posterior puede aplicar al campo `block`.

---

## 1. Resumen

- **Archivos reclasificados:** 375 (97 server + 278 services).
- **Sin clasificar (❓):** **0**.
- **CROSS (infra transversal):** **111**.

### 1.1 Distribución por bloque

| Bloque final | Nº archivos |
|---|---|
| CROSS | 111 |
| B14-IA | 59 |
| B17-Admin | 39 |
| B-DigitalTwin | 30 |
| B18-Analitica | 29 |
| B5-Cumplimiento | 20 |
| B13-MOC | 13 |
| B2-RiesgoIPER | 10 |
| B4-Incidentes | 10 |
| B1-Emergencia | 10 |
| B6-Capacitacion | 9 |
| B7-Salud | 9 |
| B16-Offline | 9 |
| B10-EPP | 5 |
| B15-Billing | 4 |
| B9-Inspecciones | 3 |
| B11-Contratistas | 3 |
| B12-CPHS | 1 |
| B3-Ergonomia | 1 |
### 1.2 Notas de criterio

- **B14-IA (59):** absorbe todo Zettelkasten (grafo de conocimiento, Bernoulli
  generators, materializer, RAG, smart-engines huérfanos), `euler/*` (huérfano pero
  pareja matemática de Bernoulli), `ai/*` adapters, `coach/*`, `physics/bernoulliEngine`,
  `ml/vertexTrainer`, los routers `zettelkasten`/`wisdomCapsule` y los Gemini-backends
  de red/química/seed de nodos. Sub-ramas a B2/B3/B10 anotadas en evidencia.
- **B-DigitalTwin (30):** twin + AR + photogrammetry + CAD + gaussian splat — el
  subsistema coherente que `DEEP-NH-services-infra §B-DigitalTwin` propuso crear.
- **CROSS (111):** middleware server (13), triggers/rateLimit/eventStore/eventBus,
  cripto (`security/*`, kmsPreflight), privacy/regímenes (régimen legal genérico,
  no un bloque de producto), email, B2D platform (routers + apiKeyService + climate),
  MCP/OpenAPI, systemEngine bus, identity/i18n/scheduler/mobile/foreground/battery/
  proximity/uxModes/ads/seed, replicación crítica, `firestore/*` factory+reader,
  routers `iot`/`misc`/`openapi`/`push`/`systemEvents`/`privacyShield`.
- **Adapters Firestore** (p.ej. `dea/deaFirestoreAdapter`, `exposure/exposureFirestoreAdapter`)
  heredan el bloque de su servicio de dominio, no CROSS.

---

## 2. Tabla por archivo

| Archivo | Categoría | Bloque final | CROSS? | Evidencia |
|---|---|---|---|---|
| `server.ts` | FEAT-server | CROSS | ✔ | Express entrypoint, mounts 60/60 routers (DEEP-NH-server §1) |
| `src/server/jobs/checkExpiredPpe.ts` | FEAT-server | B10-EPP |  | EPP expiry sweep (DEEP-NH-server) |
| `src/server/jobs/consolidateZettelkasten.ts` | FEAT-server | B14-IA |  | ZK consolidation one-shot (DEEP-NH-server) |
| `src/server/jobs/dailyClimateRiskScan.ts` | FEAT-server | B18-Analitica |  | Daily climate risk scan (DEEP-NH-server) |
| `src/server/jobs/firestoreCriticalReplicate.ts` | FEAT-server | CROSS | ✔ | Critical data replication job (DEEP-NH-server) |
| `src/server/jobs/runB2dMrrSnapshot.ts` | FEAT-server | B15-Billing |  | B2D MRR snapshot (DEEP-NH-server) |
| `src/server/jobs/runConsistencyAudit.ts` | FEAT-server | B17-Admin |  | Consistency audit cron (DEEP-NH-server) |
| `src/server/jobs/weeklyDigest.ts` | FEAT-server | B18-Analitica |  | Weekly digest (DEEP-NH-server) |
| `src/server/kmsPreflight.ts` | FEAT-server | CROSS | ✔ | KMS boot gate (DEEP-NH-server) |
| `src/server/middleware/assertProjectMemberMiddleware.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/b2dAuth.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/canonicalBody.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/captureRouteError.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/idempotencyKey.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/largeBodyJson.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/limiters.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/safeSecretEqual.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/securityHeaders.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/stampCspNonce.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/validate.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/verifySchedulerToken.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/middleware/verifyTwinStepUp.ts` | FEAT-server | CROSS | ✔ | Cross-cutting Express middleware (DEEP-NH-server §middleware, all wired) |
| `src/server/rateLimit/firestoreRateLimitStore.ts` | FEAT-server | CROSS | ✔ | Firestore rate-limit store multi-replica (DEEP-NH-server) |
| `src/server/routes/adminBurden.ts` | FEAT-server | B17-Admin |  | router adminBurden.ts (DEEP-NH-server tabla) |
| `src/server/routes/adminJobs.ts` | FEAT-server | B17-Admin |  | router adminJobs.ts (DEEP-NH-server tabla) |
| `src/server/routes/adoption.ts` | FEAT-server | B18-Analitica |  | router adoption.ts (DEEP-NH-server tabla) |
| `src/server/routes/annualReview.ts` | FEAT-server | B5-Cumplimiento |  | router annualReview.ts (DEEP-NH-server tabla) |
| `src/server/routes/audit.ts` | FEAT-server | B17-Admin |  | router audit.ts (DEEP-NH-server tabla) |
| `src/server/routes/b2d/climate.ts` | FEAT-server | CROSS | ✔ | B2D developer-platform router (DEEP-NH-server) |
| `src/server/routes/b2d/index.ts` | FEAT-server | CROSS | ✔ | B2D developer-platform router (DEEP-NH-server) |
| `src/server/routes/b2d/normativa.ts` | FEAT-server | CROSS | ✔ | B2D developer-platform router (DEEP-NH-server) |
| `src/server/routes/b2d/suite.ts` | FEAT-server | CROSS | ✔ | B2D developer-platform router (DEEP-NH-server) |
| `src/server/routes/b2dAdmin.ts` | FEAT-server | CROSS | ✔ | B2D developer-platform router (DEEP-NH-server) |
| `src/server/routes/bcn.ts` | FEAT-server | B5-Cumplimiento |  | router bcn.ts (DEEP-NH-server tabla) |
| `src/server/routes/cad.ts` | FEAT-server | B-DigitalTwin |  | router cad.ts (DEEP-NH-server tabla) |
| `src/server/routes/climateAwareScheduling.ts` | FEAT-server | B18-Analitica |  | router climateAwareScheduling.ts (DEEP-NH-server tabla) |
| `src/server/routes/consistency.ts` | FEAT-server | B17-Admin |  | router consistency.ts (DEEP-NH-server tabla) |
| `src/server/routes/controlComparator.ts` | FEAT-server | B2-RiesgoIPER |  | router controlComparator.ts (DEEP-NH-server tabla) |
| `src/server/routes/costCalculator.ts` | FEAT-server | B18-Analitica |  | router costCalculator.ts (DEEP-NH-server tabla) |
| `src/server/routes/cphsMinute.ts` | FEAT-server | B12-CPHS |  | router cphsMinute.ts (DEEP-NH-server tabla) |
| `src/server/routes/dataQuality.ts` | FEAT-server | B17-Admin |  | router dataQuality.ts (DEEP-NH-server tabla) |
| `src/server/routes/deduplication.ts` | FEAT-server | B17-Admin |  | router deduplication.ts (DEEP-NH-server tabla) |
| `src/server/routes/documentVersioning.ts` | FEAT-server | B5-Cumplimiento |  | router documentVersioning.ts (DEEP-NH-server tabla) |
| `src/server/routes/driving.ts` | FEAT-server | B13-MOC |  | router driving.ts (DEEP-NH-server tabla) |
| `src/server/routes/drivingSafety.ts` | FEAT-server | B13-MOC |  | router drivingSafety.ts (DEEP-NH-server tabla) |
| `src/server/routes/ds67ds76.ts` | FEAT-server | B5-Cumplimiento |  | router ds67ds76.ts (DEEP-NH-server tabla) |
| `src/server/routes/efficacyVerification.ts` | FEAT-server | B4-Incidentes |  | router efficacyVerification.ts (DEEP-NH-server tabla) |
| `src/server/routes/eppFlow.ts` | FEAT-server | B10-EPP |  | router eppFlow.ts (DEEP-NH-server tabla) |
| `src/server/routes/escalation.ts` | FEAT-server | B1-Emergencia |  | router escalation.ts (DEEP-NH-server tabla) |
| `src/server/routes/eventReplay.ts` | FEAT-server | B17-Admin |  | router eventReplay.ts (DEEP-NH-server tabla) |
| `src/server/routes/expirations.ts` | FEAT-server | B5-Cumplimiento |  | router expirations.ts (DEEP-NH-server tabla) |
| `src/server/routes/expressBundle.ts` | FEAT-server | B5-Cumplimiento |  | router expressBundle.ts (DEEP-NH-server tabla) |
| `src/server/routes/fiveS.ts` | FEAT-server | B9-Inspecciones |  | router fiveS.ts (DEEP-NH-server tabla) |
| `src/server/routes/import.ts` | FEAT-server | B17-Admin |  | router import.ts (DEEP-NH-server tabla) |
| `src/server/routes/inbox.ts` | FEAT-server | B18-Analitica |  | router inbox.ts (DEEP-NH-server tabla) |
| `src/server/routes/insights.ts` | FEAT-server | B18-Analitica |  | router insights.ts (DEEP-NH-server tabla) |
| `src/server/routes/iot.ts` | FEAT-server | CROSS | ✔ | router iot.ts (DEEP-NH-server tabla) |
| `src/server/routes/knowledgeBase.ts` | FEAT-server | B6-Capacitacion |  | router knowledgeBase.ts (DEEP-NH-server tabla) |
| `src/server/routes/leadership.ts` | FEAT-server | B17-Admin |  | router leadership.ts (DEEP-NH-server tabla) |
| `src/server/routes/misc.ts` | FEAT-server | CROSS | ✔ | router misc.ts (DEEP-NH-server tabla) |
| `src/server/routes/multiProject.ts` | FEAT-server | B17-Admin |  | router multiProject.ts (DEEP-NH-server tabla) |
| `src/server/routes/multiRoleSummary.ts` | FEAT-server | B17-Admin |  | router multiRoleSummary.ts (DEEP-NH-server tabla) |
| `src/server/routes/openapi.ts` | FEAT-server | CROSS | ✔ | router openapi.ts (DEEP-NH-server tabla) |
| `src/server/routes/pdca.ts` | FEAT-server | B4-Incidentes |  | router pdca.ts (DEEP-NH-server tabla) |
| `src/server/routes/pinSign.ts` | FEAT-server | B17-Admin |  | router pinSign.ts (DEEP-NH-server tabla) |
| `src/server/routes/privacyShield.ts` | FEAT-server | CROSS | ✔ | router privacyShield.ts (DEEP-NH-server tabla) |
| `src/server/routes/projectClosure.ts` | FEAT-server | B13-MOC |  | router projectClosure.ts (DEEP-NH-server tabla) |
| `src/server/routes/projects.ts` | FEAT-server | B17-Admin |  | router projects.ts (DEEP-NH-server tabla) |
| `src/server/routes/protocols.ts` | FEAT-server | B3-Ergonomia |  | router protocols.ts (DEEP-NH-server tabla) |
| `src/server/routes/push.ts` | FEAT-server | CROSS | ✔ | router push.ts (DEEP-NH-server tabla) |
| `src/server/routes/readReceipts.ts` | FEAT-server | B6-Capacitacion |  | router readReceipts.ts (DEEP-NH-server tabla) |
| `src/server/routes/reputationalAlerts.ts` | FEAT-server | B18-Analitica |  | router reputationalAlerts.ts (DEEP-NH-server tabla) |
| `src/server/routes/retaliationProtection.ts` | FEAT-server | B17-Admin |  | router retaliationProtection.ts (DEEP-NH-server tabla) |
| `src/server/routes/returnToWork.ts` | FEAT-server | B7-Salud |  | router returnToWork.ts (DEEP-NH-server tabla) |
| `src/server/routes/roiScenario.ts` | FEAT-server | B18-Analitica |  | router roiScenario.ts (DEEP-NH-server tabla) |
| `src/server/routes/roleViews.ts` | FEAT-server | B17-Admin |  | router roleViews.ts (DEEP-NH-server tabla) |
| `src/server/routes/routeScoring.ts` | FEAT-server | B13-MOC |  | router routeScoring.ts (DEEP-NH-server tabla) |
| `src/server/routes/routing.ts` | FEAT-server | B1-Emergencia |  | router routing.ts (DEEP-NH-server tabla) |
| `src/server/routes/sif.ts` | FEAT-server | B4-Incidentes |  | router sif.ts (DEEP-NH-server tabla) |
| `src/server/routes/suppliers.ts` | FEAT-server | B11-Contratistas |  | router suppliers.ts (DEEP-NH-server tabla) |
| `src/server/routes/systemEvents.ts` | FEAT-server | CROSS | ✔ | router systemEvents.ts (DEEP-NH-server tabla) |
| `src/server/routes/upsell.ts` | FEAT-server | B15-Billing |  | router upsell.ts (DEEP-NH-server tabla) |
| `src/server/routes/vulnerability.ts` | FEAT-server | B2-RiesgoIPER |  | router vulnerability.ts (DEEP-NH-server tabla) |
| `src/server/routes/waste.ts` | FEAT-server | B18-Analitica |  | router waste.ts (DEEP-NH-server tabla) |
| `src/server/routes/wisdomCapsule.ts` | FEAT-server | B14-IA |  | router wisdomCapsule.ts (DEEP-NH-server tabla) |
| `src/server/routes/workerHistory.ts` | FEAT-server | B7-Salud |  | router workerHistory.ts (DEEP-NH-server tabla) |
| `src/server/routes/workerReadiness.ts` | FEAT-server | B7-Salud |  | router workerReadiness.ts (DEEP-NH-server tabla) |
| `src/server/routes/zettelkasten.ts` | FEAT-server | B14-IA |  | router zettelkasten.ts (DEEP-NH-server tabla) |
| `src/server/services/projectTokens.ts` | FEAT-server | B1-Emergencia |  | FCM token resolution/multicast for emergency jobs (DEEP-NH-server) |
| `src/server/services/serverZkNodeWriter.ts` | FEAT-server | B14-IA |  | Server-side ZK node writer (DEEP-NH-server) |
| `src/server/services/userLifecycle.ts` | FEAT-server | B17-Admin |  | deactivateUser revokes tokens (DEEP-NH-server) |
| `src/server/sync/distributedLock.ts` | FEAT-server | B16-Offline |  | distributedLock SyncManager (DEEP-NH-server) |
| `src/server/triggers/backgroundTriggers.ts` | FEAT-server | CROSS | ✔ | Background/systemEngine Firestore triggers (DEEP-NH-server) |
| `src/server/triggers/systemEngineTrigger.ts` | FEAT-server | CROSS | ✔ | Background/systemEngine Firestore triggers (DEEP-NH-server) |
| `src/server/triggers/zettelkastenMaterializer.ts` | FEAT-server | B14-IA |  | ZK materializer trigger flag-gated (DEEP-NH-server §2) |
| `src/server/types/express.d.ts` | FEAT-server | CROSS | ✔ | Global Request type augmentation (DEEP-NH-server) |
| `src/server/utils/fcmMulticast.ts` | FEAT-server | B1-Emergencia |  | fcmMulticast for emergency jobs (DEEP-NH-server) |
| `src/services/adService.ts` | FEAT-services | CROSS | ✔ | root Gemini/seed backend: adService |
| `src/services/adminBurden/adminBurdenTracker.ts` | FEAT-services | B17-Admin |  | dir adminBurden (DEEP-NH-services taxonomy) |
| `src/services/adminBurden/automationSuggester.ts` | FEAT-services | B17-Admin |  | dir adminBurden (DEEP-NH-services taxonomy) |
| `src/services/ai/aiAdapter.ts` | FEAT-services | B14-IA |  | AI adapter/RAG infra (DEEP-knowledge §AI infra) |
| `src/services/ai/colorBasedEppDetector.ts` | FEAT-services | B10-EPP |  | On-device EPP detector (DEEP-knowledge) |
| `src/services/ai/contextualAssistant.ts` | FEAT-services | B14-IA |  | AI adapter/RAG infra (DEEP-knowledge §AI infra) |
| `src/services/ai/eppDetectorOnDevice.ts` | FEAT-services | B10-EPP |  | On-device EPP detector (DEEP-knowledge) |
| `src/services/ai/index.ts` | FEAT-services | B14-IA |  | AI adapter/RAG infra (DEEP-knowledge §AI infra) |
| `src/services/ai/resilientAiAdapters.ts` | FEAT-services | B14-IA |  | AI adapter/RAG infra (DEEP-knowledge §AI infra) |
| `src/services/ai/vertexAdapter.ts` | FEAT-services | B14-IA |  | AI adapter/RAG infra (DEEP-knowledge §AI infra) |
| `src/services/ai/zkRagContextBuilder.ts` | FEAT-services | B14-IA |  | AI adapter/RAG infra (DEEP-knowledge §AI infra) |
| `src/services/ai/zkRagResponseValidator.ts` | FEAT-services | B14-IA |  | AI adapter/RAG infra (DEEP-knowledge §AI infra) |
| `src/services/annualReview/annualReviewFirestoreAdapter.ts` | FEAT-services | B5-Cumplimiento |  | dir annualReview |
| `src/services/annualReview/annualSgiReview.ts` | FEAT-services | B5-Cumplimiento |  | dir annualReview |
| `src/services/ar/arAnchorFirestoreAdapter.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/arAnchorService.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/arHitTest.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/arPlatformPolicy.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/arQuickLookFallback.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/posterCatalog.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/posterEmbeddings.generated.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/posterMatcher.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/usdzConverter.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/ar/webXrCapabilities.ts` | FEAT-services | B-DigitalTwin |  | dir ar (DEEP-NH-services taxonomy) |
| `src/services/audit/expressBundleBuilder.ts` | FEAT-services | B5-Cumplimiento |  | Fiscalization express bundle (DEEP-infra B17/B5) |
| `src/services/audit/tamperProofChain.ts` | FEAT-services | B17-Admin |  | dir audit (DEEP-NH-services taxonomy) |
| `src/services/auditService.ts` | FEAT-services | B17-Admin |  | root Gemini/seed backend: auditService |
| `src/services/b2d/apiKeyService.ts` | FEAT-services | CROSS | ✔ | dir b2d (DEEP-NH-services taxonomy) |
| `src/services/b2d/externalClimate.ts` | FEAT-services | CROSS | ✔ | dir b2d (DEEP-NH-services taxonomy) |
| `src/services/b2d/usage.ts` | FEAT-services | CROSS | ✔ | dir b2d (DEEP-NH-services taxonomy) |
| `src/services/battery/batteryAdvisor.ts` | FEAT-services | CROSS | ✔ | dir battery |
| `src/services/bcnService.ts` | FEAT-services | B5-Cumplimiento |  | root Gemini/seed backend: bcnService |
| `src/services/bundlePerf/bundleSizeAnalyzer.ts` | FEAT-services | CROSS | ✔ | dir bundlePerf |
| `src/services/cad/dwgAdapter.ts` | FEAT-services | B-DigitalTwin |  | dir cad (DEEP-NH-services taxonomy) |
| `src/services/cad/dwgDocumentValidator.ts` | FEAT-services | B-DigitalTwin |  | dir cad (DEEP-NH-services taxonomy) |
| `src/services/cad/dxfAdapter.ts` | FEAT-services | B-DigitalTwin |  | dir cad (DEEP-NH-services taxonomy) |
| `src/services/calendar/predictions.ts` | FEAT-services | B18-Analitica |  | dir calendar |
| `src/services/capacity/normativeAlerts.ts` | FEAT-services | B5-Cumplimiento |  | Ley16744/DS54 capacity alerts (DEEP-knowledge) |
| `src/services/capacity/tierEvaluation.ts` | FEAT-services | B15-Billing |  | Tier/capacity evaluation (DEEP-knowledge) |
| `src/services/cargo/stowageOptimizer.ts` | FEAT-services | B13-MOC |  | dir cargo |
| `src/services/chemicalBackend.ts` | FEAT-services | B14-IA |  | root Gemini/seed backend: chemicalBackend |
| `src/services/climateAwareScheduling/climateAwareScheduling.ts` | FEAT-services | B18-Analitica |  | dir climateAwareScheduling |
| `src/services/coach/normativeRag.ts` | FEAT-services | B14-IA |  | NormativeRAG coach (DEEP-knowledge B14/B5) |
| `src/services/coach/personaSelector.ts` | FEAT-services | B14-IA |  | Coach persona/RAG (DEEP-knowledge) |
| `src/services/coachBackend.ts` | FEAT-services | B6-Capacitacion |  | root Gemini/seed backend: coachBackend |
| `src/services/consistency/consistencyAuditor.ts` | FEAT-services | B17-Admin |  | dir consistency (DEEP-NH-services taxonomy) |
| `src/services/consistency/consistencyStateBuilder.ts` | FEAT-services | B17-Admin |  | dir consistency (DEEP-NH-services taxonomy) |
| `src/services/controlComparator/controlComparator.ts` | FEAT-services | B2-RiesgoIPER |  | dir controlComparator (DEEP-NH-services taxonomy) |
| `src/services/controlComparator/controlFailureLibrary.ts` | FEAT-services | B2-RiesgoIPER |  | dir controlComparator (DEEP-NH-services taxonomy) |
| `src/services/dataQuality/incompletenessScanner.ts` | FEAT-services | B17-Admin |  | dir dataQuality |
| `src/services/dataSeedService.ts` | FEAT-services | CROSS | ✔ | root Gemini/seed backend: dataSeedService |
| `src/services/dea/deaFirestoreAdapter.ts` | FEAT-services | B1-Emergencia |  | dir dea (DEEP-NH-services taxonomy) |
| `src/services/dea/deaService.ts` | FEAT-services | B1-Emergencia |  | dir dea (DEEP-NH-services taxonomy) |
| `src/services/deduplication/recordDeduplicator.ts` | FEAT-services | B17-Admin |  | dir deduplication |
| `src/services/digitalTwin/gaussianSplatFirestoreAdapter.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/gaussianSplatRegistry.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/objectPlacement/normativaRules.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/onDeviceReconstruction/frameExtractor.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/onDeviceReconstruction/glbExporter.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/onDeviceReconstruction/index.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/onDeviceReconstruction/midasDepthEstimator.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/onDeviceReconstruction/pointCloudBuilder.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/onDeviceReconstruction/usdzExporter.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/photogrammetry/mockAdapter.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/photogrammetry/onDeviceAdapter.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/photogrammetry/reconstructionJobStore.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/photogrammetry/types.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/placedObjectsStore.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/siteGeometry.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/digitalTwin/siteGeometryStore.ts` | FEAT-services | B-DigitalTwin |  | dir digitalTwin (DEEP-NH-services taxonomy) |
| `src/services/documents/documentVersioning.ts` | FEAT-services | B5-Cumplimiento |  | dir documents (DEEP-NH-services taxonomy) |
| `src/services/documents/documentVersioningFirestoreAdapter.ts` | FEAT-services | B5-Cumplimiento |  | dir documents (DEEP-NH-services taxonomy) |
| `src/services/documents/legalDocTemplates.ts` | FEAT-services | B5-Cumplimiento |  | dir documents (DEEP-NH-services taxonomy) |
| `src/services/domainEvents/domainEventStore.ts` | FEAT-services | B17-Admin |  | dir domainEvents (DEEP-NH-services taxonomy) |
| `src/services/driving/speedTrigger.ts` | FEAT-services | B13-MOC |  | dir driving |
| `src/services/drivingSafety/drivingSafetyService.ts` | FEAT-services | B13-MOC |  | dir drivingSafety |
| `src/services/efficacyVerification/efficacyVerifier.ts` | FEAT-services | B4-Incidentes |  | dir efficacyVerification |
| `src/services/email/index.ts` | FEAT-services | CROSS | ✔ | dir email (DEEP-NH-services taxonomy) |
| `src/services/email/resendService.ts` | FEAT-services | CROSS | ✔ | dir email (DEEP-NH-services taxonomy) |
| `src/services/email/templates.ts` | FEAT-services | CROSS | ✔ | dir email (DEEP-NH-services taxonomy) |
| `src/services/engineering/scratchCalculations.ts` | FEAT-services | B2-RiesgoIPER |  | dir engineering |
| `src/services/environment/chileClimatology.ts` | FEAT-services | B18-Analitica |  | dir environment |
| `src/services/environmentBackend.client.ts` | FEAT-services | B18-Analitica |  | root Gemini/seed backend: environmentBackend.client |
| `src/services/environmentBackend.ts` | FEAT-services | B18-Analitica |  | root Gemini/seed backend: environmentBackend |
| `src/services/environmental/wasteFirestoreAdapter.ts` | FEAT-services | B18-Analitica |  | dir environmental |
| `src/services/eppBackend.ts` | FEAT-services | B10-EPP |  | root Gemini/seed backend: eppBackend |
| `src/services/erp/erpAdapter.ts` | FEAT-services | CROSS | ✔ | dir erp |
| `src/services/escalation/escalationSlaEngine.ts` | FEAT-services | B1-Emergencia |  | dir escalation |
| `src/services/etl/csvAdapter.ts` | FEAT-services | B17-Admin |  | dir etl (DEEP-NH-services taxonomy) |
| `src/services/etl/schemas.ts` | FEAT-services | B17-Admin |  | dir etl (DEEP-NH-services taxonomy) |
| `src/services/euler/criticalLoad.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/eulerLagrange.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/eulerianPath.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/fftAnalyzer.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/graphConnectivity.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/index.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/inviscidFlow.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/odeIntegrator.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/polyhedronAchievements.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/euler/zettelkastenTopology.ts` | FEAT-services | B14-IA |  | dir euler (DEEP-NH-services taxonomy) |
| `src/services/eventBus/eventBus.ts` | FEAT-services | CROSS | ✔ | dir eventBus (DEEP-NH-services taxonomy) |
| `src/services/eventBus/integrations.ts` | FEAT-services | CROSS | ✔ | dir eventBus (DEEP-NH-services taxonomy) |
| `src/services/eventReplay/eventReplayAuditTool.ts` | FEAT-services | B17-Admin |  | dir eventReplay (DEEP-NH-services taxonomy) |
| `src/services/eventStore/inMemoryEventStore.ts` | FEAT-services | CROSS | ✔ | dir eventStore (DEEP-NH-services taxonomy) |
| `src/services/eventStore/types.ts` | FEAT-services | CROSS | ✔ | dir eventStore (DEEP-NH-services taxonomy) |
| `src/services/evidenceChain/custodyChainFirestoreAdapter.ts` | FEAT-services | B4-Incidentes |  | dir evidenceChain (DEEP-NH-services taxonomy) |
| `src/services/evidenceChain/custodyChainService.ts` | FEAT-services | B4-Incidentes |  | dir evidenceChain (DEEP-NH-services taxonomy) |
| `src/services/excelImport/excelImporter.ts` | FEAT-services | B17-Admin |  | dir excelImport (DEEP-NH-services taxonomy) |
| `src/services/excelImporter/deduplicator.ts` | FEAT-services | B17-Admin |  | dir excelImporter (DEEP-NH-services taxonomy) |
| `src/services/excelImporter/index.ts` | FEAT-services | B17-Admin |  | dir excelImporter (DEEP-NH-services taxonomy) |
| `src/services/excelImporter/recordValidator.ts` | FEAT-services | B17-Admin |  | dir excelImporter (DEEP-NH-services taxonomy) |
| `src/services/excelImporter/xlsxReader.ts` | FEAT-services | B17-Admin |  | dir excelImporter (DEEP-NH-services taxonomy) |
| `src/services/expirations/expirationScanner.ts` | FEAT-services | B5-Cumplimiento |  | dir expirations |
| `src/services/exposure/exposureFirestoreAdapter.ts` | FEAT-services | B7-Salud |  | Occupational exposure DS594 (DEEP-infra) |
| `src/services/exposure/exposureRegistry.ts` | FEAT-services | B7-Salud |  | Occupational exposure DS594 (DEEP-infra) |
| `src/services/exposure/thermalStressCalculator.ts` | FEAT-services | B7-Salud |  | Occupational exposure DS594 (DEEP-infra) |
| `src/services/external/eonet/eonetAdapter.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/external/eonet/types.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/external/index.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/external/nasaPower/nasaPowerAdapter.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/external/nasaPower/types.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/external/recommendationBuilder.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/external/usgs/types.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/external/usgs/usgsEarthquakeAdapter.ts` | FEAT-services | B18-Analitica |  | dir external (DEEP-NH-services taxonomy) |
| `src/services/firestore/createProjectScopedStore.ts` | FEAT-services | CROSS | ✔ | dir firestore |
| `src/services/firestore/resilientReader.ts` | FEAT-services | CROSS | ✔ | dir firestore |
| `src/services/fiveS/fiveSAudit.ts` | FEAT-services | B9-Inspecciones |  | dir fiveS |
| `src/services/focusBlocks/focusBlocks.ts` | FEAT-services | B6-Capacitacion |  | dir focusBlocks |
| `src/services/foregroundService/guardianForegroundService.ts` | FEAT-services | CROSS | ✔ | dir foregroundService |
| `src/services/glossary/glossaryEngine.ts` | FEAT-services | B6-Capacitacion |  | dir glossary |
| `src/services/governance/deviationNormalizationRadar.ts` | FEAT-services | B17-Admin |  | dir governance |
| `src/services/hvac/thermalModel.ts` | FEAT-services | B18-Analitica |  | dir hvac |
| `src/services/i18n/culturalConventions.ts` | FEAT-services | CROSS | ✔ | dir i18n |
| `src/services/identity/rutValidators.ts` | FEAT-services | CROSS | ✔ | dir identity |
| `src/services/immutable/pdfImmutableService.ts` | FEAT-services | CROSS | ✔ | dir immutable |
| `src/services/internalTransit/internalTransitService.ts` | FEAT-services | B13-MOC |  | dir internalTransit |
| `src/services/iot/edgeFilter.ts` | FEAT-services | CROSS | ✔ | dir iot (DEEP-NH-services taxonomy) |
| `src/services/iot/firestoreBridge.ts` | FEAT-services | CROSS | ✔ | dir iot (DEEP-NH-services taxonomy) |
| `src/services/iot/ingestRuleEngine.ts` | FEAT-services | CROSS | ✔ | dir iot (DEEP-NH-services taxonomy) |
| `src/services/iot/mqttAdapter.ts` | FEAT-services | CROSS | ✔ | dir iot (DEEP-NH-services taxonomy) |
| `src/services/iot/mqttClient.ts` | FEAT-services | CROSS | ✔ | dir iot (DEEP-NH-services taxonomy) |
| `src/services/iot/probabilityFailureScoring.ts` | FEAT-services | CROSS | ✔ | dir iot (DEEP-NH-services taxonomy) |
| `src/services/iot/types.ts` | FEAT-services | CROSS | ✔ | dir iot (DEEP-NH-services taxonomy) |
| `src/services/knowledgeBase/knowledgeBaseService.ts` | FEAT-services | B6-Capacitacion |  | dir knowledgeBase (DEEP-NH-services taxonomy) |
| `src/services/leadership/supervisionDecisionTrail.ts` | FEAT-services | B17-Admin |  | dir leadership |
| `src/services/legal/legalRuleEngine.ts` | FEAT-services | B5-Cumplimiento |  | dir legal |
| `src/services/legal/termsContent.ts` | FEAT-services | B5-Cumplimiento |  | dir legal |
| `src/services/legalBackend.ts` | FEAT-services | B5-Cumplimiento |  | root Gemini/seed backend: legalBackend |
| `src/services/lineOfFire/lineOfFireChecker.ts` | FEAT-services | B2-RiesgoIPER |  | dir lineOfFire |
| `src/services/mcp/stdioBoot.ts` | FEAT-services | CROSS | ✔ | dir mcp (DEEP-NH-services taxonomy) |
| `src/services/mcp/zettelkastenServer.ts` | FEAT-services | CROSS | ✔ | dir mcp (DEEP-NH-services taxonomy) |
| `src/services/mcp/zettelkastenStdioAdapter.ts` | FEAT-services | CROSS | ✔ | dir mcp (DEEP-NH-services taxonomy) |
| `src/services/measurements/measurementChain.ts` | FEAT-services | B9-Inspecciones |  | dir measurements |
| `src/services/migration/registry.ts` | FEAT-services | CROSS | ✔ | dir migration |
| `src/services/ml/vertexTrainer.ts` | FEAT-services | B14-IA |  | dir ml |
| `src/services/mobile/foregroundServiceClient.ts` | FEAT-services | CROSS | ✔ | dir mobile |
| `src/services/networkBackend.ts` | FEAT-services | B14-IA |  | root Gemini/seed backend: networkBackend |
| `src/services/nodeSeedService.ts` | FEAT-services | B14-IA |  | root Gemini/seed backend: nodeSeedService |
| `src/services/normativa/countryPacks.ts` | FEAT-services | B5-Cumplimiento |  | dir normativa |
| `src/services/normativa/locationNormativa.ts` | FEAT-services | B5-Cumplimiento |  | dir normativa |
| `src/services/notifications/fcmAdapter.ts` | FEAT-services | CROSS | ✔ | dir notifications |
| `src/services/openapi/bootstrap.ts` | FEAT-services | CROSS | ✔ | dir openapi (DEEP-NH-services taxonomy) |
| `src/services/openapi/registry.ts` | FEAT-services | CROSS | ✔ | dir openapi (DEEP-NH-services taxonomy) |
| `src/services/openapi/specGenerator.ts` | FEAT-services | CROSS | ✔ | dir openapi (DEEP-NH-services taxonomy) |
| `src/services/operationalState/faenaStateEngine.ts` | FEAT-services | B13-MOC |  | dir operationalState |
| `src/services/pdca/pdcaCycle.ts` | FEAT-services | B4-Incidentes |  | dir pdca |
| `src/services/pdca/pdcaCycleEngine.ts` | FEAT-services | B4-Incidentes |  | dir pdca |
| `src/services/physics/bernoulliEngine.ts` | FEAT-services | B14-IA |  | dir physics |
| `src/services/pinSign/pinSignService.ts` | FEAT-services | B17-Admin |  | dir pinSign |
| `src/services/predictionBackend.ts` | FEAT-services | B18-Analitica |  | root Gemini/seed backend: predictionBackend |
| `src/services/privacy/dpiaTemplate.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/152fz-ru.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/appi.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/ccpa.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/cpra.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/gdpr.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/ley19628.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/lgpd.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/pdpa.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/pipa-tw.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/pipeda.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/regimes/pipl-cn.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/registry.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacy/types.ts` | FEAT-services | CROSS | ✔ | dir privacy (DEEP-NH-services taxonomy) |
| `src/services/privacyShield/piiClassifier.ts` | FEAT-services | CROSS | ✔ | dir privacyShield (DEEP-NH-services taxonomy) |
| `src/services/projectClosure/projectClosureService.ts` | FEAT-services | B13-MOC |  | dir projectClosure |
| `src/services/proximitySensor/proximityModeDetector.ts` | FEAT-services | CROSS | ✔ | dir proximitySensor |
| `src/services/psychosocialBackend.ts` | FEAT-services | B7-Salud |  | root Gemini/seed backend: psychosocialBackend |
| `src/services/ragService.ts` | FEAT-services | B14-IA |  | root Gemini/seed backend: ragService |
| `src/services/readReceipts/readReceiptService.ts` | FEAT-services | B6-Capacitacion |  | dir readReceipts |
| `src/services/readReceipts/readReceiptStore.ts` | FEAT-services | B6-Capacitacion |  | dir readReceipts |
| `src/services/reputationalAlerts/reputationalAlertEngine.ts` | FEAT-services | B18-Analitica |  | dir reputationalAlerts |
| `src/services/retaliationProtection/retaliationDetector.ts` | FEAT-services | B17-Admin |  | dir retaliationProtection |
| `src/services/returnToWork/returnToWorkPlanner.ts` | FEAT-services | B7-Salud |  | dir returnToWork |
| `src/services/roiScenario/roiScenarioSimulator.ts` | FEAT-services | B18-Analitica |  | dir roiScenario |
| `src/services/roleViews/roleViewBuilder.ts` | FEAT-services | B17-Admin |  | dir roleViews |
| `src/services/routeScoring/criticalRouteScoring.ts` | FEAT-services | B13-MOC |  | dir routeScoring |
| `src/services/routeScoring/driverRouteMatcher.ts` | FEAT-services | B13-MOC |  | dir routeScoring |
| `src/services/routing/gridAStar.ts` | FEAT-services | B1-Emergencia |  | dir routing |
| `src/services/routing/routeClimateAssessment.ts` | FEAT-services | B1-Emergencia |  | dir routing |
| `src/services/routingBackend.ts` | FEAT-services | B1-Emergencia |  | root Gemini/seed backend: routingBackend |
| `src/services/safety/iperAssessments.ts` | FEAT-services | B2-RiesgoIPER |  | dir safety |
| `src/services/safetyEngineBackend.ts` | FEAT-services | B2-RiesgoIPER |  | root Gemini/seed backend: safetyEngineBackend |
| `src/services/scheduler/distributedLease.ts` | FEAT-services | CROSS | ✔ | dir scheduler |
| `src/services/security/browserEnvelope.ts` | FEAT-services | CROSS | ✔ | dir security (DEEP-NH-services taxonomy) |
| `src/services/security/deviceKek.ts` | FEAT-services | CROSS | ✔ | dir security (DEEP-NH-services taxonomy) |
| `src/services/security/encryptedKvStore.ts` | FEAT-services | CROSS | ✔ | dir security (DEEP-NH-services taxonomy) |
| `src/services/security/kmsAdapter.ts` | FEAT-services | CROSS | ✔ | dir security (DEEP-NH-services taxonomy) |
| `src/services/security/kmsEnvelope.ts` | FEAT-services | CROSS | ✔ | dir security (DEEP-NH-services taxonomy) |
| `src/services/seedBackend.ts` | FEAT-services | CROSS | ✔ | root Gemini/seed backend: seedBackend |
| `src/services/seedService.ts` | FEAT-services | CROSS | ✔ | root Gemini/seed backend: seedService |
| `src/services/shiftBackend.ts` | FEAT-services | B13-MOC |  | root Gemini/seed backend: shiftBackend |
| `src/services/sif/sifFirestoreAdapter.ts` | FEAT-services | B4-Incidentes |  | dir sif |
| `src/services/sif/sifPrecursorClassifier.ts` | FEAT-services | B4-Incidentes |  | dir sif |
| `src/services/socialRecognition/wallEngine.ts` | FEAT-services | B6-Capacitacion |  | dir socialRecognition |
| `src/services/suppliers/supplierQualityService.ts` | FEAT-services | B11-Contratistas |  | dir suppliers |
| `src/services/suppliers/supplierScoring.ts` | FEAT-services | B11-Contratistas |  | dir suppliers |
| `src/services/sync/conflictResolver.ts` | FEAT-services | B16-Offline |  | dir sync (DEEP-NH-services taxonomy) |
| `src/services/sync/encryptedOutboxAdapter.ts` | FEAT-services | B16-Offline |  | dir sync (DEEP-NH-services taxonomy) |
| `src/services/sync/genericOutboxEngine.ts` | FEAT-services | B16-Offline |  | dir sync (DEEP-NH-services taxonomy) |
| `src/services/sync/monotonicSync.ts` | FEAT-services | B16-Offline |  | dir sync (DEEP-NH-services taxonomy) |
| `src/services/sync/outboxBackoff.ts` | FEAT-services | B16-Offline |  | dir sync (DEEP-NH-services taxonomy) |
| `src/services/sync/syncStateMachine.ts` | FEAT-services | B16-Offline |  | dir sync (DEEP-NH-services taxonomy) |
| `src/services/sync/topologyAwarePrefetch.ts` | FEAT-services | B16-Offline |  | dir sync (DEEP-NH-services taxonomy) |
| `src/services/syncManager.ts` | FEAT-services | B16-Offline |  | root Gemini/seed backend: syncManager |
| `src/services/systemEngine/README.md` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/appModeContextAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/index.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/languageProviderAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/normativeContextAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/notificationContextAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/projectContextAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/sensorContextAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/themeContextAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/adapters/universalKnowledgeContextAdapter.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/decisionEngine.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/eventLog.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/eventTypes.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/executor.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/policies/index.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/policies/policy.types.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/policies/tierChangeReactivity.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/systemEngine/subscriber.ts` | FEAT-services | CROSS | ✔ | dir systemEngine (DEEP-NH-services taxonomy) |
| `src/services/upsell/painBasedUpsellSuggester.ts` | FEAT-services | B15-Billing |  | dir upsell |
| `src/services/uxModes/uxModeAdapter.ts` | FEAT-services | CROSS | ✔ | dir uxModes |
| `src/services/vulnerability/operationalVulnerabilityMap.ts` | FEAT-services | B2-RiesgoIPER |  | dir vulnerability |
| `src/services/vulnerability/vulnerabilityFirestoreAdapter.ts` | FEAT-services | B2-RiesgoIPER |  | dir vulnerability |
| `src/services/workerReadiness/readinessScore.ts` | FEAT-services | B7-Salud |  | dir workerReadiness |
| `src/services/zettelkasten/backlinks.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/confinedSpaceHVAC.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/gasLeakDetection.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/hidranteFireNetwork.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/index.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/microWindEnergy.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/miningVenturi.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/mistingDustSuppression.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/scaffoldWindSuction.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/bernoulli/structuralWindLoad.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/canonical/materializer.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/centrality.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/climateRiskCoupling.ts` | FEAT-services | B18-Analitica |  | Climate->RiskNode coupling (DEEP-knowledge) |
| `src/services/zettelkasten/contextualActions.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/edgeStoreFirestore.ts` | FEAT-services | B14-IA |  | Typed ZK edges; B2/B14 (DEEP-knowledge) |
| `src/services/zettelkasten/edges.ts` | FEAT-services | B14-IA |  | Typed ZK edges; B2/B14 (DEEP-knowledge) |
| `src/services/zettelkasten/families/climateNodeRegistry.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/families/index.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/families/ohsNormativaNodeRegistry.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/families/personalEppNodeRegistry.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/families/physicsNodeRegistry.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/persistence/writeNode.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/resilientRetrieval.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/smartActions.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
| `src/services/zettelkasten/types.ts` | FEAT-services | B14-IA |  | Zettelkasten graph (DEEP-knowledge §Zettelkasten) |
---

## 3. ❓ Sin clasificar

**Ninguno (0).** Los 375 archivos quedaron atribuidos. Toda heurística de
fallback se resolvió antes de emitir; no hubo `UNMATCHED`. Las ambigüedades reales
(p.ej. `controlComparator` B2-vs-B18, `coachBackend` B6-vs-B14, `families/*` B14-vs-B2)
se resolvieron al bloque primario y la rama secundaria queda anotada en la columna
Evidencia y en los DEEP de origen.

## 4. Procedencia de la evidencia

- `DEEP-NH-server.md` — 97 server (mount coverage 60/60, middleware, jobs, triggers).
- `DEEP-NH-services-knowledge.md` — ~96 services (zettelkasten, ai, coach, systemEngine,
  mcp/openapi, etl/excel, consistency, controlComparator, adminBurden, knowledgeBase,
  capacity, euler, eventBus/eventStore).
- `DEEP-NH-services-infra.md` — ~95 services (digitalTwin, ar, cad, photogrammetry,
  privacy, security, external, sync, audit/evidenceChain/eventReplay/domainEvents,
  documents, email, dea, exposure, iot, b2d).
- Singletons no tabulados explícitamente en los DEEP (battery, cargo, driving,
  environment, erp, escalation, glossary, governance, hvac, identity, i18n, immutable,
  internalTransit, leadership, legal, lineOfFire, measurements, migration, mobile,
  normativa, notifications, operationalState, pdca, physics, pinSign, projectClosure,
  proximitySensor, readReceipts, reputationalAlerts, retaliationProtection,
  returnToWork, roiScenario, roleViews, routeScoring, routing, safety, scheduler,
  sif, socialRecognition, suppliers, upsell, uxModes, vulnerability, workerReadiness)
  y los `*Backend.ts` raíz se clasificaron por header/purpose + grep de dominio.

*Todo doc-only. Aplicar `srv-reclass-map.json` al `ledger.json` es una acción posterior
con tu visto bueno.*
