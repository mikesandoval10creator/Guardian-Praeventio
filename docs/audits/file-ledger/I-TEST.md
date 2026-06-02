# File ledger — I-TEST (1247 files)

Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.

| Archivo | Bloque | LOC | Test | Propósito / exports |
|---|---|---:|:--:|---|
| `android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java` | B16-Offline | 19 |  |  |
| `firestore.test.rules` |  | 24 |  | TEST-ONLY open rules for the `firestore-stores` CI job (store-LOGIC suite). |
| `loadtest/Dockerfile` |  |  |  |  |
| `loadtest/run.sh` |  | 89 |  |  |
| `loadtest/seed-and-assert.cjs` |  | 85 |  | Seed + assert helper for the SOS 1k load test. |
| `loadtest/sos-1000-concurrent.yml` | B1-Emergencia | 63 |  | Praeventio Guard — Sprint 34 / Brecha D (E2E load). |
| `loadtest/sos-processor.cjs` | B1-Emergencia | 24 |  | Artillery processor for sos-1000-concurrent.yml. |
| `scripts/download-mediapipe-models.test.cjs` | B14-IA | 159 |  | download-mediapipe-models.test.cjs — Bucket PP.7. |
| `scripts/precommit-allowbackup-guard.test.cjs` |  | 131 |  |  |
| `scripts/precommit-stub-guard.test.cjs` |  | 133 |  | _exports:_ thing, handler, h, id, jitter |
| `scripts/validate-env.test.cjs` |  | 19 |  | Sprint 21 Ola 6 / Bucket U.6 — pointer file. |
| `src/__smoke__/billing-flow.smoke.test.ts` | B15-Billing | 75 |  | Smoke: billing tier → invoice → audit. |
| `src/__smoke__/critical-paths.smoke.test.ts` |  | 91 |  | Smoke: critical paths meta-test. |
| `src/__smoke__/health-adapter.smoke.test.ts` | B7-Salud | 136 |  | Smoke: health adapter facade selection across mocked platforms. |
| `src/__smoke__/normativa-flow.smoke.test.ts` |  | 67 |  | Smoke: country detection → pack load → switch + per-project alerts. |
| `src/__smoke__/safety-calc.smoke.test.ts` |  | 64 |  | Smoke: REBA + RULA + IPER + TMERT + PREXOR sanity. |
| `src/__smoke__/setup.ts` |  | 77 |  | Shared test fixtures for the smoke-test suite. |
| `src/__tests__/contracts/contactEmailConsistency.test.ts` |  | 79 |  | Contract test — Fase B.3 del plan integrado (verificación 2026-05-21). |
| `src/__tests__/contracts/docConsistency.test.ts` |  | 51 |  | Contract test — Fase B.3 del plan integrado (verificación 2026-05-21). |
| `src/__tests__/contracts/ds40Annotation.test.ts` | B5-Cumplimiento | 117 |  | Contract test — Fase B.3 del plan integrado (verificación 2026-05-21). |
| `src/__tests__/contracts/ds44Migration.test.ts` | B5-Cumplimiento | 54 |  | Praeventio Guard — Contract test #5: DS 44/2024 migración consciente. |
| `src/__tests__/contracts/noBrowserSusesoApiClient.test.ts` | B5-Cumplimiento | 100 |  | Contract test — §2.14 P0 SECURITY (cierre Fase C.1, 2026-05-21). |
| `src/__tests__/contracts/noServerSidePhotogrammetry.test.ts` |  | 132 |  | Contract test — §2.28 (2026-05-21). |
| `src/__tests__/contracts/openapiCoverage.test.ts` |  | 81 |  | Praeventio Guard — Contract test #6: docs/api/openapi.yaml endpoints |
| `src/__tests__/contracts/playwrightHealthContract.test.ts` | B7-Salud | 29 |  | Contract test — Fase B.3 del plan integrado (verificación 2026-05-21). |
| `src/__tests__/contracts/projectScopedStoresContract.test.ts` |  | 285 |  | Praeventio Guard — Plan 2026-05-23 Fase B.5 — contract test stores. |
| `src/__tests__/contracts/publicReadRules.test.ts` |  | 114 |  | Contract test — §2.26 (UX anonymous browsing 2026-05-21). |
| `src/__tests__/contracts/releaseBlockers.test.ts` |  | 81 |  | Contract test — Fase B.3 del plan integrado (verificación 2026-05-21). |
| `src/__tests__/contracts/routerMountCoverage.test.ts` |  | 97 |  | Generic router-mount coverage contract (B1-D1). |
| `src/__tests__/contracts/sentryConfig.test.ts` |  | 28 |  | Praeventio Guard — Contract test #4: configuración Sentry alineada |
| `src/__tests__/contracts/zkMaterializerWired.test.ts` |  | 92 |  | Contract test — §2.15 cierre Fase C.3 (2026-05-21). |
| `src/__tests__/e2eFixtures-auth.test.ts` | B17-Admin | 128 |  | Praeventio Guard — Sprint 19 / F-B01. |
| `src/__tests__/helpers/fakeFirestore.ts` |  | 353 |  | Reusable in-memory Firestore-admin fake for real-router supertest coverage |
| `src/__tests__/scripts/anyRatchet.test.ts` |  | 74 |  | Vitest gate for scripts/check-any-ratchet.cjs — the `as any` type-safety |
| `src/__tests__/scripts/conventionGuard.test.ts` |  | 102 |  | Vitest gate for scripts/check-convention-guard.cjs — the CLAUDE.md #3/#19 |
| `src/__tests__/scripts/fillAndroidAssetlinks.test.ts` | B10-EPP | 274 |  | Tests for scripts/fill-android-assetlinks.mjs. |
| `src/__tests__/scripts/fillIosAasa.test.ts` |  | 206 |  | Tests for scripts/fill-ios-aasa.mjs. |
| `src/__tests__/scripts/i18nParity.test.ts` | B12-CPHS | 82 |  | Vitest gate for scripts/validate-i18n.cjs — the CLAUDE.md Rule #18 |
| `src/__tests__/scripts/medicalGuard.test.cjs` | B7-Salud | 204 |  | Sprint 26 Bucket XX.4 — tests para scripts/precommit-medical-guard.cjs |
| `src/__tests__/scripts/prepackageSlmRegistryParser.test.ts` |  | 133 |  | Smoke test for the prepackage-slm-models registry parser. |
| `src/__tests__/scripts/validateEnv.test.ts` |  | 182 |  | Sprint 21 Ola 6 / Bucket U.6 — tests for scripts/validate-env.cjs. |
| `src/__tests__/server/admin.router.test.ts` | B17-Admin | 481 |  | Real-router supertest for the admin privileged endpoints — the privilege- |
| `src/__tests__/server/admin.test.ts` | B17-Admin | 169 |  | Praeventio Guard — Round 15 (I3 / A6): admin endpoints HTTP tests. |
| `src/__tests__/server/adminBurden.test.ts` |  | 369 |  | Real-router supertest for src/server/routes/adminBurden.ts |
| `src/__tests__/server/adminJobs.test.ts` |  | 70 |  | Real-router supertest for the scheduler-gated admin job endpoint |
| `src/__tests__/server/aiFeedback.router.test.ts` | B14-IA | 274 |  | Real-router supertest for POST /api/ai/feedback and GET /api/ai/feedback/summary. |
| `src/__tests__/server/aiGuardrails.test.ts` | B14-IA | 748 |  | Real-router supertest for src/server/routes/aiGuardrails.ts |
| `src/__tests__/server/aiQuality.test.ts` | B14-IA | 677 |  | Real-router supertest for src/server/routes/aiQuality.ts. |
| `src/__tests__/server/annualReview.test.ts` |  | 721 |  | Real-router supertest for §291-295 Revisión Anual del SGI (ISO 45001 §9.3). |
| `src/__tests__/server/apprenticeship.router.test.ts` | B6-Capacitacion | 719 |  | Real-router supertest for src/server/routes/apprenticeship.ts |
| `src/__tests__/server/apprenticeship.test.ts` | B6-Capacitacion | 28 |  | Praeventio Guard — P0 security hardening contract test. |
| `src/__tests__/server/askGuardian.test.ts` |  | 280 |  | Praeventio Guard — Round 15 (I3 / A6): /api/ask-guardian. |
| `src/__tests__/server/audit.router.test.ts` |  | 146 |  | Real-router supertest for the audit-trail endpoints (ISO 45001 §10.2 — a real |
| `src/__tests__/server/auditCoverage.test.ts` |  | 370 |  | Praeventio Guard — Round 17 R1: Audit-log coverage tests for the 6 |
| `src/__tests__/server/auditLog.test.ts` | B17-Admin | 119 |  | Praeventio Guard — Round 15 (I3 / A6): /api/audit-log HTTP tests. |
| `src/__tests__/server/auditPortal.test.ts` | B17-Admin | 840 |  | Real-router supertest coverage for src/server/routes/auditPortal.ts |
| `src/__tests__/server/b2dAdmin.test.ts` |  | 687 |  | Real-router supertest coverage for src/server/routes/b2dAdmin.ts |
| `src/__tests__/server/bcn.router.test.ts` |  | 254 |  | Real-router supertest for src/server/routes/bcn.ts |
| `src/__tests__/server/billing.appleSsn.replay.test.ts` | B15-Billing | 285 |  | Praeventio Guard — Sprint 35 audit P0 (Apple SSN replay defense). |
| `src/__tests__/server/billing.appleSsn.test.ts` | B15-Billing | 497 |  | Praeventio Guard — Sprint 27 audit P0 fix H2. |
| `src/__tests__/server/billing.router.test.ts` | B15-Billing | 1163 |  | Real-router supertest for src/server/routes/billing.ts |
| `src/__tests__/server/billing.test.ts` | B15-Billing | 482 |  | Praeventio Guard — Round 15 (I3 / A6): Billing endpoints HTTP tests. |
| `src/__tests__/server/billing.webhookReplay.test.ts` | B15-Billing | 309 |  | Praeventio Guard — Sprint 35 audit P0 (billing webhook replay defense). |
| `src/__tests__/server/bowtie.test.ts` | B2-RiesgoIPER | 738 |  | Real-router supertest for src/server/routes/bowtie.ts |
| `src/__tests__/server/changeMgmt.test.ts` | B13-MOC | 622 |  | Real-router supertest for src/server/routes/changeMgmt.ts |
| `src/__tests__/server/checklistBuilder.test.ts` | B9-Inspecciones | 612 |  | Real-router supertest for src/server/routes/checklistBuilder.ts |
| `src/__tests__/server/coachChatTenant.test.ts` | B17-Admin | 166 |  | Praeventio Guard — Round 17 R1: cross-tenant guard for /api/coach/chat. |
| `src/__tests__/server/comms.test.ts` | B1-Emergencia | 497 |  | Real-router supertest for the Communication Map route |
| `src/__tests__/server/commute.test.ts` | B13-MOC | 713 |  | Real-router supertest for src/server/routes/commute.ts. |
| `src/__tests__/server/compliance.test.ts` | B5-Cumplimiento | 613 |  | Real-router supertest for src/server/routes/compliance.ts |
| `src/__tests__/server/complianceEmit.test.ts` | B5-Cumplimiento | 240 |  | Tests for the ADR-0017 compliance emission router. |
| `src/__tests__/server/confidentialReports.router.test.ts` | B18-Analitica | 195 |  | Real-router supertest for §211-213 Confidential Reports / Ley Karín 21.643. |
| `src/__tests__/server/confidentialReports.test.ts` | B18-Analitica | 60 |  | Praeventio Guard — P0 security hardening contract test (HIGHEST sensitivity). |
| `src/__tests__/server/contingencySimulation.test.ts` | B1-Emergencia | 616 |  | Real-router supertest for src/server/routes/contingencySimulation.ts. |
| `src/__tests__/server/correctiveActions.router.test.ts` | B4-Incidentes | 258 |  | Real-router supertest for the corrective-actions endpoints (F.4 Center). |
| `src/__tests__/server/cphsMinute.test.ts` |  | 159 |  | Real-router supertest for the CPHS monthly-minute draft endpoint |
| `src/__tests__/server/criticalControls.test.ts` | B2-RiesgoIPER | 690 |  | Real-router supertest for src/server/routes/criticalControls.ts |
| `src/__tests__/server/culturePulse.router.test.ts` | B12-CPHS | 754 |  | Real-router supertest for src/server/routes/culturePulse.ts |
| `src/__tests__/server/culturePulse.test.ts` | B12-CPHS | 316 |  | Real-router supertest for the Culture Pulse survey endpoints (§61-63 — |
| `src/__tests__/server/curriculum.router.test.ts` | B6-Capacitacion | 995 |  | Real-router supertest coverage for src/server/routes/curriculum.ts. |
| `src/__tests__/server/curriculum.test.ts` | B6-Capacitacion | 205 |  | Praeventio Guard — Round 15 (I3 / A6): Curriculum claim endpoints. |
| `src/__tests__/server/dataConfidence.test.ts` | B18-Analitica | 134 |  | Real-router supertest for §104 Data Confidence panel (3 endpoints). Tells |
| `src/__tests__/server/deduplication.test.ts` |  | 443 |  | Real-router supertest for src/server/routes/deduplication.ts |
| `src/__tests__/server/documentVersioning.test.ts` |  | 663 |  | Real-router supertest for src/server/routes/documentVersioning.ts |
| `src/__tests__/server/drillsManager.test.ts` | B1-Emergencia | 710 |  | Real-router supertest for src/server/routes/drillsManager.ts |
| `src/__tests__/server/drivingSafety.router.test.ts` |  | 140 |  | Real-router supertest for §69-71 Driving Safety (critical routes + driver |
| `src/__tests__/server/drivingSafety.test.ts` |  | 28 |  | Praeventio Guard — P0 security hardening contract test. |
| `src/__tests__/server/ds67ds76.audit.test.ts` |  | 308 |  | P0 security fix tests: ds67ds76 router must await auditServerEvent and |
| `src/__tests__/server/dte.test.ts` | B5-Cumplimiento | 714 |  | Real-router supertest for src/server/routes/dte.ts (Plan v3 Fase 1). |
| `src/__tests__/server/dteSign.integration.test.ts` |  | 375 |  | Praeventio Guard — Sprint 35 audit P0 (DIAT/DIEP digital-signature flow). |
| `src/__tests__/server/efficacyVerification.test.ts` |  | 402 |  | Real-router supertest for src/server/routes/efficacyVerification.ts |
| `src/__tests__/server/emergency.router.test.ts` | B1-Emergencia | 696 |  | Real-router supertest for src/server/routes/emergency.ts |
| `src/__tests__/server/emergency.test.ts` | B1-Emergencia | 480 |  | Praeventio Guard — Sprint 14: /api/emergency/sos HTTP tests. |
| `src/__tests__/server/emergencyBrigade.test.ts` | B1-Emergencia | 701 |  | Real-router supertest for src/server/routes/emergencyBrigade.ts |
| `src/__tests__/server/engineeringControls.test.ts` | B8-PermisosLOTO | 544 |  | Real-router supertest for src/server/routes/engineeringControls.ts |
| `src/__tests__/server/eppFlow.test.ts` |  | 769 |  | Praeventio Guard — Real-router supertest coverage for eppFlow route. |
| `src/__tests__/server/equipmentQr.test.ts` | B10-EPP | 254 |  | Real-router supertest for the equipment-QR pre-use inspection endpoints |
| `src/__tests__/server/escalation.router.test.ts` |  | 468 |  | Real-router supertest for escalation SLA engine endpoints. |
| `src/__tests__/server/evacuationHeadcount.router.test.ts` | B1-Emergencia | 613 |  | Real-router supertest for evacuationHeadcount endpoints. |
| `src/__tests__/server/evacuationHeadcount.test.ts` | B1-Emergencia | 28 |  | Praeventio Guard — P0 security hardening contract test. |
| `src/__tests__/server/eventReplay.test.ts` |  | 584 |  | Praeventio Guard — Real-router supertest for |
| `src/__tests__/server/exceptions.router.test.ts` | B8-PermisosLOTO | 464 |  | Real-router supertest for exceptions endpoints (Sprint 39 G.2). |
| `src/__tests__/server/externalAuditPortal.test.ts` | B17-Admin | 763 |  | Real-router supertest coverage for src/server/routes/externalAuditPortal.ts |
| `src/__tests__/server/gamification.router.test.ts` | B6-Capacitacion | 135 |  | Real-router supertest for the gamification + AI safety-coach endpoints |
| `src/__tests__/server/gamification.test.ts` | B6-Capacitacion | 68 |  | Praeventio Guard — security depth: /api/gamification/points tenant isolation. |
| `src/__tests__/server/gemini.router.test.ts` | B14-IA | 407 |  | Real-router supertest for the /api/gemini whitelisted RPC proxy — a security |
| `src/__tests__/server/gemini.test.ts` | B14-IA | 175 |  | Praeventio Guard — security depth: /api/gemini allowlist gate. |
| `src/__tests__/server/hazmatInventory.test.ts` | B10-EPP | 516 |  | Praeventio Guard — Plan v3 Fase 1: real-router supertest for |
| `src/__tests__/server/health.test.ts` | B7-Salud | 37 |  | Praeventio Guard — Round 15 (I3 / A6): /api/health route HTTP tests. |
| `src/__tests__/server/horometro.test.ts` | B10-EPP | 792 |  | Real-router supertest coverage for src/server/routes/horometro.ts |
| `src/__tests__/server/import.test.ts` |  | 413 |  | Praeventio Guard — src/server/routes/import.ts coverage. |
| `src/__tests__/server/incidentBundle.test.ts` | B4-Incidentes | 495 |  | Real-router supertest for the Incident Evidence Bundle route |
| `src/__tests__/server/incidentFlow.test.ts` | B4-Incidentes | 167 |  | Real-router supertest for the Incident→Investigation→Lesson→Training PDCA |
| `src/__tests__/server/incidents.router.test.ts` | B4-Incidentes | 135 |  | Real-router supertest for POST /api/incidents/report — field incident |
| `src/__tests__/server/incidentTrends.test.ts` | B4-Incidentes | 111 |  | Real-router supertest for F.29 incident-trend indicators. Pure analytics |
| `src/__tests__/server/industryRules.test.ts` | B5-Cumplimiento | 572 |  | Real-router supertest for src/server/routes/industryRules.ts |
| `src/__tests__/server/insights.router.test.ts` |  | 407 |  | Real-router supertest for GET /api/insights/* endpoints. |
| `src/__tests__/server/invitations.router.test.ts` |  | 144 |  | Real-router supertest for the invitations router (the most security-sensitive |
| `src/__tests__/server/jsa.test.ts` | B2-RiesgoIPER | 600 |  | Real-router supertest for src/server/routes/jsa.ts |
| `src/__tests__/server/knowledgeBase.test.ts` |  | 165 |  | Real-router supertest for the Knowledge Base endpoints (org knowledge graph |
| `src/__tests__/server/leadership.router.test.ts` |  | 560 |  | Real-router supertest for src/server/routes/leadership.ts |
| `src/__tests__/server/leadership.test.ts` |  | 28 |  | Praeventio Guard — P0 security hardening contract test. |
| `src/__tests__/server/legalObligations.test.ts` | B5-Cumplimiento | 731 |  | Real-router supertest for src/server/routes/legalObligations.ts |
| `src/__tests__/server/limiters.test.ts` |  | 848 |  | Praeventio Guard — Round 21 B4 (R20 R6 MEDIUM #2 close-out): |
| `src/__tests__/server/loneWorker.router.test.ts` | B1-Emergencia | 519 |  | Real-router supertest for the lone-worker safety surface. |
| `src/__tests__/server/maintenance.test.ts` | B10-EPP | 846 |  | Real-router supertest for src/server/routes/maintenance.ts |
| `src/__tests__/server/maturity.test.ts` | B2-RiesgoIPER | 117 |  | Real-router supertest for F.26 prevention-maturity index. Reads 8 canonical |
| `src/__tests__/server/medicalCatalogs.test.ts` | B7-Salud | 583 |  | Real-router supertest for src/server/routes/medicalCatalogs.ts. |
| `src/__tests__/server/mercadoPagoIpn.test.ts` | B15-Billing | 404 |  | Praeventio Guard — Round 18 R2 (deferred from R17): MercadoPago IPN |
| `src/__tests__/server/misc.test.ts` |  | 268 |  | Real-router supertest for the grab-bag misc route (src/server/routes/misc.ts). |
| `src/__tests__/server/multiProject.test.ts` |  | 474 |  | Real-router supertest for src/server/routes/multiProject.ts |
| `src/__tests__/server/oauthGoogle.test.ts` | B17-Admin | 242 |  | Praeventio Guard — Google OAuth callback security suite. |
| `src/__tests__/server/offlineInspections.test.ts` | B9-Inspecciones | 149 |  | Real-router supertest for F.6 offline-first inspections. Critical for the |
| `src/__tests__/server/onboarding.test.ts` | B6-Capacitacion | 404 |  | Praeventio Guard — Sprint 24 Bucket KK.3: onboarding completion integration tests. |
| `src/__tests__/server/operationalChange.test.ts` | B13-MOC | 888 |  | Real-router supertest for Bloque 3.17 — Management of Change (MOC). |
| `src/__tests__/server/organic.router.test.ts` | B12-CPHS | 179 |  | Real-router supertest for the Organic structure (Crew/Process/Task) writers |
| `src/__tests__/server/orgMetrics.router.test.ts` | B18-Analitica | 414 |  | Real-router supertest for orgMetrics endpoints. |
| `src/__tests__/server/pdca.test.ts` |  | 151 |  | Real-router supertest for §195-200 PDCA + non-conformities (ISO 45001 §10.2). |
| `src/__tests__/server/pinSign.test.ts` |  | 687 |  | Real-router supertest for src/server/routes/pinSign.ts |
| `src/__tests__/server/portableHistory.test.ts` | B18-Analitica | 159 |  | Real-router supertest for F.18 Portable Worker History (Ley 19.628 privacy). |
| `src/__tests__/server/positiveObservations.test.ts` | B9-Inspecciones | 622 |  | Real-router supertest for src/server/routes/positiveObservations.ts |
| `src/__tests__/server/postTraining.test.ts` | B6-Capacitacion | 593 |  | Praeventio Guard — Real-router supertest for the post-training assessment |
| `src/__tests__/server/preShiftRisk.test.ts` | B2-RiesgoIPER | 663 |  | Real-router supertest for GET /api/sprint-k/:projectId/pre-shift-risk |
| `src/__tests__/server/preventionCost.test.ts` | B15-Billing | 591 |  | Praeventio Guard — Plan v3 Fase 1: real-router supertest for |
| `src/__tests__/server/privacyRetention.test.ts` | B5-Cumplimiento | 709 |  | Praeventio Guard — Plan v3 Fase 1: real-router supertest for |
| `src/__tests__/server/projectClosure.router.test.ts` |  | 157 |  | Real-router supertest for the project-closure lifecycle (6 endpoints). The |
| `src/__tests__/server/projectClosure.test.ts` |  | 40 |  | Praeventio Guard — P0 security hardening contract test. |
| `src/__tests__/server/projects.router.test.ts` |  | 172 |  | Real-router supertest for project membership/invitation authorization — |
| `src/__tests__/server/projects.test.ts` |  | 273 |  | Praeventio Guard — Round 15 (I3 / A6): Project membership endpoints. |
| `src/__tests__/server/push.test.ts` |  | 254 |  | Praeventio Guard — Round 17 (R3): /api/push/register-token HTTP tests. |
| `src/__tests__/server/qrSignature.test.ts` | B9-Inspecciones | 613 |  | Praeventio Guard — Real-router supertest coverage for qrSignature route. |
| `src/__tests__/server/readReceipts.router.test.ts` |  | 468 |  | Real-router supertest for readReceipts endpoints (Sprint 39 G.1). |
| `src/__tests__/server/regulatoryFramework.test.ts` | B5-Cumplimiento | 564 |  | Real-router supertest for src/server/routes/regulatoryFramework.ts |
| `src/__tests__/server/reports.test.ts` | B18-Analitica | 41 |  | Praeventio Guard — security depth: /api/reports/generate-pdf body limits. |
| `src/__tests__/server/residualRisk.test.ts` | B2-RiesgoIPER | 585 |  | Real-router supertest for src/server/routes/residualRisk.ts |
| `src/__tests__/server/restrictedZones.test.ts` | B1-Emergencia | 831 |  | Praeventio Guard — Plan v3 Fase 1: real-router supertest coverage for |
| `src/__tests__/server/retaliationProtection.test.ts` |  | 504 |  | Real-router supertest for src/server/routes/retaliationProtection.ts |
| `src/__tests__/server/returnToWork.test.ts` |  | 485 |  | Real-router supertest for src/server/routes/returnToWork.ts (Sprint 49 §251-254). |
| `src/__tests__/server/riskRadar.test.ts` | B2-RiesgoIPER | 374 |  | Real-router supertest for src/server/routes/riskRadar.ts |
| `src/__tests__/server/rootCauseInvestigation.test.ts` | B4-Incidentes | 592 |  | Praeventio Guard — Real-router supertest for |
| `src/__tests__/server/routeScoring.test.ts` |  | 408 |  | Real-router supertest for src/server/routes/routeScoring.ts |
| `src/__tests__/server/runResilienceHealthAlert.test.ts` | B7-Salud | 43 |  | Praeventio Guard — P0 security hardening contract test. |
| `src/__tests__/server/serverMountOrder.test.ts` |  | 248 |  | Contract test for server.ts route mount ordering. |
| `src/__tests__/server/shiftHandover.test.ts` | B13-MOC | 705 |  | Real-router supertest for src/server/routes/shiftHandover.ts |
| `src/__tests__/server/sitebook.test.ts` | B9-Inspecciones | 178 |  | Real-router supertest for the Site Book (Bitácora de Obra) endpoints |
| `src/__tests__/server/sitebookSignRoutes.router.test.ts` | B9-Inspecciones | 477 |  | Real-router supertest for src/server/routes/sitebookSignRoutes.ts |
| `src/__tests__/server/skillGap.test.ts` | B6-Capacitacion | 614 |  | Real-router supertest for src/server/routes/skillGap.ts |
| `src/__tests__/server/softBlocking.test.ts` | B8-PermisosLOTO | 652 |  | Real-router supertest for src/server/routes/softBlocking.ts |
| `src/__tests__/server/stoppage.router.test.ts` | B8-PermisosLOTO | 434 |  | Real-router supertest for src/server/routes/stoppage.ts |
| `src/__tests__/server/subscription.router.test.ts` | B15-Billing | 145 |  | Real-router companion to subscription.test.ts (which drives the test-server.ts |
| `src/__tests__/server/subscription.test.ts` | B15-Billing | 122 |  | Praeventio Guard — security depth: /api/subscription/upgrade paid-invoice gate. |
| `src/__tests__/server/suppliers.test.ts` |  | 144 |  | Real-router supertest for §90-91 supplier quality + risk ranking. 5 |
| `src/__tests__/server/suseso.router.test.ts` | B5-Cumplimiento | 926 |  | Real-router supertest for src/server/routes/suseso.ts. |
| `src/__tests__/server/systemEvents.test.ts` |  | 116 |  | Real-router supertest for the SystemEngine emit endpoint |
| `src/__tests__/server/telemetry.router.test.ts` | B7-Salud | 537 |  | Real-router supertest for src/server/routes/telemetry.ts |
| `src/__tests__/server/telemetryCanonical.test.ts` | B7-Salud | 365 |  | Praeventio Guard — Round 18 R6 (R6→R17 MEDIUM #2): canonical-JSON HMAC |
| `src/__tests__/server/telemetryRotation.test.ts` | B7-Salud | 359 |  | Praeventio Guard — Round 17 R1: per-tenant IoT secret rotation. |
| `src/__tests__/server/test-server.ts` |  | 1524 |  | Praeventio Guard — Round 15 (I3 / A6 audit) test server harness. |
| `src/__tests__/server/validateMiddleware.integration.test.ts` |  | 203 |  | Praeventio Guard — Sprint 28 Bucket B3 (audit hallazgo H17). |
| `src/__tests__/server/vendorOnboarding.test.ts` | B6-Capacitacion | 822 |  | Real-router supertest for Sprint K §35, §40, §42-45 vendor/contractor |
| `src/__tests__/server/verifyAuthE2E.test.ts` | B17-Admin | 155 |  | Praeventio Guard — Sprint 19 / F-B05. |
| `src/__tests__/server/visitors.router.test.ts` | B11-Contratistas | 437 |  | Real-router supertest for the visitors endpoints. |
| `src/__tests__/server/visitors.test.ts` | B11-Contratistas | 35 |  | Praeventio Guard — P0 security hardening contract test. |
| `src/__tests__/server/webauthnRegister.test.ts` |  | 867 |  | Praeventio Guard — Round 20 R5: POST /api/auth/webauthn/register/options |
| `src/__tests__/server/webauthnVerify.test.ts` |  | 1169 |  | Praeventio Guard — Round 18 R6 (Round 17 MEDIUM #1 close-out): |
| `src/__tests__/server/weeklyDigest.test.ts` |  | 720 |  | Unit tests for src/server/jobs/weeklyDigest.ts |
| `src/__tests__/server/wisdomCapsule.test.ts` |  | 457 |  | Real-router supertest for the Wisdom Capsule endpoints. |
| `src/__tests__/server/workerHistory.test.ts` |  | 590 |  | Real-router supertest for src/server/routes/workerHistory.ts (Sprint 42 F.18). |
| `src/__tests__/server/workerReadiness.test.ts` |  | 139 |  | Real-router supertest for F.16 worker-readiness ("torniquete virtual" — |
| `src/__tests__/server/workPermits.criticalValidate.test.ts` | B8-PermisosLOTO | 119 |  | Real-router supertest for the NEWLY-WIRED POST .../work-permits/validate-critical. |
| `src/__tests__/server/workPermits.router.test.ts` | B8-PermisosLOTO | 857 |  | Real-router supertest for src/server/routes/workPermits.ts |
| `src/__tests__/server/zettelkasten.backlinks.test.ts` |  | 144 |  | Real-router supertest for POST /api/zettelkasten/backlinks (§ZK-1 wire, |
| `src/__tests__/server/zettelkasten.riskControls.test.ts` |  | 167 |  | Real-router supertest for POST /api/zettelkasten/risk-control-suggestions |
| `src/__tests__/server/zettelkasten.test.ts` |  | 160 |  | Praeventio Guard — Sprint 11 (zettelkasten route HTTP coverage). |
| `src/__tests__/server/zettelkastenNlQuery.test.ts` |  | 134 |  | Sprint 29 Bucket AA F-B — integration tests para POST /api/zettelkasten/nl-query. |
| `src/__tests__/vite-config/workboxModelsCache.test.ts` |  | 86 |  | Verify the Workbox runtime-cache regex in `vite.config.ts` correctly |
| `src/components/admin/CreateApiKeyModal.test.tsx` | B17-Admin | 127 |  | Praeventio Guard — Bucket CC tests for `CreateApiKeyModal.tsx`. |
| `src/components/adoption/ChurnRiskPanel.test.tsx` |  | 64 |  |  |
| `src/components/agenda/AgendaDigestCard.test.tsx` | B12-CPHS | 62 |  |  |
| `src/components/ai/AiResponseCard.test.tsx` |  | 273 |  |  |
| `src/components/ai/ResilientAiAssistantPanel.test.tsx` |  | 209 |  |  |
| `src/components/annualReview/AnnualReviewSummary.test.tsx` |  | 67 |  |  |
| `src/components/annualReview/PreventiveObjectivesPanel.test.tsx` |  | 66 |  |  |
| `src/components/apprenticeship/ApprenticeshipBoard.test.tsx` | B6-Capacitacion | 60 |  |  |
| `src/components/ar/ARPosterScanner.test.tsx` |  | 178 |  | Smoke tests for ARPosterScanner (Sprint G AR Real Vision, Modo 3). |
| `src/components/ar/ArQuickLookButton.test.tsx` |  | 143 |  | ArQuickLookButton tests — Sprint 21 Ola 4 Bucket M.6. |
| `src/components/ar/ArViewLink.test.tsx` |  | 132 |  | ArViewLink tests — Sprint 30 Bucket JJ. |
| `src/components/audit/AuditExpressButton.test.tsx` |  | 65 |  |  |
| `src/components/auditPortal/ExternalAuditPortalCard.test.tsx` | B17-Admin | 49 |  |  |
| `src/components/audits/ISOAudit.test.tsx` |  | 95 |  | Sprint 25 — Bucket SS.2 — ISOAudit smoke tests. |
| `src/components/audits/ISOManagement.test.tsx` |  | 86 |  | Sprint 25 — Bucket SS.2 — ISOManagement smoke tests. |
| `src/components/behaviorObservation/BbsProfileCard.test.tsx` | B9-Inspecciones | 184 |  |  |
| `src/components/billing/TierDowngradeModal.test.tsx` | B15-Billing | 116 |  | Sprint 28 H25 — TierDowngradeModal tests. |
| `src/components/cargo/CargoCogPanel.test.tsx` |  | 79 |  |  |
| `src/components/changeMgmt/ChangeWorkflowActions.test.tsx` | B13-MOC | 330 |  | Praeventio Guard — Plan 2026-05-24 §MOC — role-gating tests for |
| `src/components/changeMgmt/OperationalChangeCard.test.tsx` | B13-MOC | 63 |  |  |
| `src/components/circadian/AlertnessGuard.test.tsx` | B7-Salud | 55 |  |  |
| `src/components/clientReporting/MonthlyClientReportPanel.test.tsx` | B18-Analitica | 73 |  |  |
| `src/components/climateAware/ClimatePlanAdjustment.test.tsx` |  | 66 |  |  |
| `src/components/coach/DomainPromptCatalog.test.tsx` | B14-IA | 44 |  |  |
| `src/components/compliance/ComplianceTrafficLight.test.tsx` | B5-Cumplimiento | 70 |  |  |
| `src/components/confidentialReports/ConfidentialReportInbox.test.tsx` | B18-Analitica | 74 |  |  |
| `src/components/consistency/ConsistencyAuditCard.test.tsx` |  | 63 |  |  |
| `src/components/continuity/SpofPanel.test.tsx` | B13-MOC | 62 |  |  |
| `src/components/contractors/ContractorRankingTable.test.tsx` | B11-Contratistas | 59 |  |  |
| `src/components/correctiveActions/ActionBalanceCard.test.tsx` | B4-Incidentes | 58 |  |  |
| `src/components/correctiveActions/CorrectiveActionsCenterPanel.test.tsx` | B4-Incidentes | 101 |  |  |
| `src/components/costCalculator/PreventionROIWidget.test.tsx` |  | 52 |  |  |
| `src/components/cphs/CphsCommitteeStatusCard.test.tsx` | B12-CPHS | 131 |  |  |
| `src/components/criticalControls/BarrierAnalysisCard.test.tsx` | B2-RiesgoIPER | 92 |  |  |
| `src/components/criticalRoles/CriticalRoleCoverageCard.test.tsx` | B13-MOC | 74 |  |  |
| `src/components/culturePulse/CulturePulseDashboard.test.tsx` | B12-CPHS | 88 |  |  |
| `src/components/dashboard/challengeUtils.test.ts` | B18-Analitica | 133 |  | Praeventio Guard — Unit tests for the pure helpers extracted from |
| `src/components/dashboard/RoleAwareDashboard.test.tsx` | B18-Analitica | 93 |  |  |
| `src/components/dataQuality/DataQualityCard.test.tsx` |  | 53 |  |  |
| `src/components/digital-twin/GaussianSplatViewer.test.tsx` |  | 97 |  |  |
| `src/components/digital-twin/HazmatWindOverlay.test.tsx` | B10-EPP | 78 |  | Sprint 25 — Bucket SS.2 — HazmatWindOverlay tests. |
| `src/components/digital-twin/RiskNodeMarkers.test.tsx` |  | 89 |  | Sprint 25 — Bucket SS.2 — RiskNodeMarkers tests. |
| `src/components/digital-twin/Site25DPanel.test.tsx` |  | 269 |  | Sprint 13 — Site25DPanel render & overlay tests. |
| `src/components/documentHygiene/DocConfidenceCard.test.tsx` | B7-Salud | 63 |  |  |
| `src/components/documentHygiene/DocumentHygienePanel.test.tsx` | B7-Salud | 61 |  |  |
| `src/components/documents/LegalDocGeneratorForm.test.tsx` |  | 87 |  |  |
| `src/components/drillsManager/DrillResultReviewCard.test.tsx` | B1-Emergencia | 81 |  |  |
| `src/components/drillsManager/DrillsCompliancePanel.test.tsx` | B1-Emergencia | 53 |  |  |
| `src/components/drivingSafety/DriverScoreCard.test.tsx` |  | 47 |  |  |
| `src/components/emergency/DynamicEvacuationMap.test.tsx` | B1-Emergencia | 67 |  | Sprint 25 — Bucket SS.2 — DynamicEvacuationMap smoke tests. |
| `src/components/emergency/FallDetectionMonitor.test.tsx` | B1-Emergencia | 210 |  | Sprint 27 P0 audit — hallazgo H6 regression test. |
| `src/components/emergency/SOSButton.test.tsx` | B1-Emergencia | 51 |  | Sprint 14 — SOSButton long-press timing tests. |
| `src/components/emergencyBrigade/EmergencyBrigadePanel.test.tsx` | B1-Emergencia | 76 |  |  |
| `src/components/engineeringControls/EngineeringInventoryCard.test.tsx` | B8-PermisosLOTO | 71 |  |  |
| `src/components/environmental/WasteInventoryPanel.test.tsx` | B10-EPP | 82 |  |  |
| `src/components/equipment/EquipmentStatusCard.test.tsx` | B10-EPP | 54 |  |  |
| `src/components/escalation/SlaWatchPanel.test.tsx` |  | 230 |  |  |
| `src/components/euler/BucklingCalculatorCard.test.tsx` |  | 43 |  |  |
| `src/components/evacuation/EvacuationStatusBoard.test.tsx` | B1-Emergencia | 77 |  |  |
| `src/components/evidenceChain/CustodyChainTimelineCard.test.tsx` |  | 80 |  |  |
| `src/components/excelImport/ExcelImportPreview.test.tsx` |  | 66 |  |  |
| `src/components/exceptions/ExceptionsAuditPanel.test.tsx` | B8-PermisosLOTO | 71 |  |  |
| `src/components/expirations/ExpirationsListPanel.test.tsx` |  | 82 |  |  |
| `src/components/explainability/ExplainedRecommendationCard.test.tsx` | B14-IA | 123 |  | Praeventio Guard — F.28 ExplainedRecommendationCard smoke tests. |
| `src/components/exposure/HeatStressCard.test.tsx` |  | 44 |  |  |
| `src/components/external-events/CalmRecommendationCard.test.tsx` |  | 61 |  |  |
| `src/components/fatigue/FatigueAssessmentCard.test.tsx` | B7-Salud | 61 |  |  |
| `src/components/firstResponderMap/FirstResponderDispatchPanel.test.tsx` | B1-Emergencia | 168 |  |  |
| `src/components/fiveS/FiveSAuditForm.test.tsx` |  | 44 |  |  |
| `src/components/games/gameScore.test.ts` |  | 80 |  | Round 15 / I4 — gameScore pure-helpers contract. |
| `src/components/gamification/DaysWithoutIncidentBadge.test.tsx` | B4-Incidentes | 52 |  | Sprint 29 Bucket DD F-D — DaysWithoutIncidentBadge tests. |
| `src/components/glossary/GlossarySearchPanel.test.tsx` |  | 192 |  |  |
| `src/components/governance/DeviationRadarPanel.test.tsx` |  | 68 |  |  |
| `src/components/hazmat/HazmatCompatibilityPanel.test.tsx` | B10-EPP | 54 |  |  |
| `src/components/health/OccupationalContextBundleCard.test.tsx` | B7-Salud | 71 |  |  |
| `src/components/heatmap/FindingsHeatmapPreview.test.tsx` | B2-RiesgoIPER | 74 |  |  |
| `src/components/hvac/AirQualityPanel.test.tsx` |  | 61 |  |  |
| `src/components/hygiene/AddHygieneModal.test.tsx` | B7-Salud | 92 |  | Sprint 32 — Bucket WW — AddHygieneModal render/submit tests. |
| `src/components/hygiene/MorningRoutine.test.tsx` | B7-Salud | 160 |  | Sprint 25 — Bucket SS.3 — MorningRoutine persistence tests. |
| `src/components/identity/TaxIdInput.test.tsx` |  | 41 |  |  |
| `src/components/inbox/InboxPrevencionistaPanel.test.tsx` |  | 119 |  |  |
| `src/components/incidentBundle/IncidentEvidenceBundleCard.test.tsx` | B4-Incidentes | 192 |  |  |
| `src/components/incidentTrends/TrendSeriesChart.test.tsx` | B4-Incidentes | 77 |  |  |
| `src/components/industryRules/IndustryPresetCard.test.tsx` | B5-Cumplimiento | 35 |  |  |
| `src/components/internalTransit/VehiclePreOpChecklistCard.test.tsx` | B9-Inspecciones | 248 |  |  |
| `src/components/investigation/PunitiveLanguageWarning.test.tsx` | B4-Incidentes | 40 |  |  |
| `src/components/knowledgeBase/KnowledgeBaseSearch.test.tsx` |  | 60 |  |  |
| `src/components/layout/sidebarMenuGroups.test.ts` |  | 166 |  | Praeventio Guard — Plan 2026-05-23 §P2. |
| `src/components/leadership/LeadershipTrailCard.test.tsx` |  | 81 |  |  |
| `src/components/legalCalendar/LegalCalendarView.test.tsx` | B5-Cumplimiento | 77 |  |  |
| `src/components/legalCalendar/LegalObligationCard.test.tsx` | B5-Cumplimiento | 101 |  | Praeventio Guard — Plan Bloque 3.14: <LegalObligationCard /> smoke tests. |
| `src/components/lessonsLearned/LessonSuggestionsCard.test.tsx` | B4-Incidentes | 78 |  |  |
| `src/components/lineOfFire/LineOfFireValidationCard.test.tsx` |  | 59 |  |  |
| `src/components/loneWorker/LoneWorkerCard.test.tsx` | B1-Emergencia | 42 |  |  |
| `src/components/loto/LotoStatusPanel.test.tsx` | B8-PermisosLOTO | 96 |  |  |
| `src/components/maintenance/HorometerStatusCard.test.tsx` | B10-EPP | 64 |  |  |
| `src/components/maturity/MaturityIndexCard.test.tsx` | B2-RiesgoIPER | 88 |  |  |
| `src/components/measurements/MeasurementQualityCard.test.tsx` |  | 58 |  |  |
| `src/components/medical/MedicalIcon.test.tsx` | B7-Salud | 123 |  | Sprint 17c — MedicalIcon component tests. |
| `src/components/medicine/AddMedicineModal.test.tsx` | B7-Salud | 80 |  | Sprint 20 — Bucket D — AddMedicineModal render/submit tests. |
| `src/components/meetingPack/SupervisorBriefingCard.test.tsx` | B12-CPHS | 172 |  |  |
| `src/components/mentalLoad/MentalLoadSurveyForm.test.tsx` | B7-Salud | 49 |  |  |
| `src/components/microtraining/LightningTrainingPlayer.test.tsx` | B6-Capacitacion | 71 |  |  |
| `src/components/monthlyClientReport/MonthlyClientReportCard.test.tsx` | B18-Analitica | 54 |  |  |
| `src/components/nonConformity/NonConformityListPanel.test.tsx` | B5-Cumplimiento | 188 |  |  |
| `src/components/observability/ResilienceHealthDashboard.test.tsx` | B7-Salud | 270 |  |  |
| `src/components/onboarding/OnboardingWizard.test.tsx` | B6-Capacitacion | 201 |  | Sprint 24 Bucket KK.5 — OnboardingWizard tests. |
| `src/components/operationalState/FaenaStateBanner.test.tsx` |  | 96 |  |  |
| `src/components/organic/ProcessClosePreviewCard.test.tsx` | B12-CPHS | 57 |  |  |
| `src/components/orgMetrics/OperationalPressureGauge.test.tsx` | B18-Analitica | 54 |  |  |
| `src/components/pdca/PdcaSummaryCard.test.tsx` |  | 57 |  |  |
| `src/components/photoEvidence/PhotoEvidenceCard.test.tsx` | B9-Inspecciones | 34 |  |  |
| `src/components/positiveObservations/PositiveObservationsBoard.test.tsx` | B9-Inspecciones | 72 |  |  |
| `src/components/predictiveAlerts/PredictiveAlertsList.test.tsx` | B18-Analitica | 48 |  |  |
| `src/components/pricingCalculator/ROICalculatorWidget.test.tsx` | B15-Billing | 70 |  |  |
| `src/components/pricingCalculator/TierComparatorWidget.test.tsx` | B15-Billing | 69 |  |  |
| `src/components/privacy/PrivacyRegimeCard.test.tsx` |  | 45 |  |  |
| `src/components/processes/CloseProcessModal.test.tsx` |  | 119 |  | Sprint 20 — Bucket D — CloseProcessModal integration tests. |
| `src/components/processes/StartProcessModal.test.tsx` |  | 133 |  | Sprint 20 — Bucket D — StartProcessModal integration tests. |
| `src/components/projectClosure/ProjectClosureCard.test.tsx` |  | 101 |  |  |
| `src/components/projects/PredictedActivityModal.test.tsx` |  | 100 |  | PredictedActivityModal — accessibility tests. |
| `src/components/protocols/IperMatrixCard.test.tsx` |  | 50 |  |  |
| `src/components/pymeOnboarding/PymeMaturityWizard.test.tsx` | B2-RiesgoIPER | 58 |  |  |
| `src/components/pymeWizard/PymeOnboardingPlanPanel.test.tsx` | B6-Capacitacion | 165 |  |  |
| `src/components/qrSignature/QrSignatureModal.test.tsx` | B9-Inspecciones | 107 |  |  |
| `src/components/raciMatrix/RaciHealthCard.test.tsx` | B7-Salud | 184 |  |  |
| `src/components/readReceipts/DocumentReadConfirmCard.test.tsx` |  | 116 |  |  |
| `src/components/regulatory/Iso45001Catalog.test.tsx` | B5-Cumplimiento | 38 |  |  |
| `src/components/reportsAutomation/ReportTemplatePreview.test.tsx` | B18-Analitica | 68 |  |  |
| `src/components/researchMode/RootCauseTreeSummary.test.tsx` | B4-Incidentes | 75 |  |  |
| `src/components/residualRisk/ResidualRiskCard.test.tsx` | B2-RiesgoIPER | 61 |  |  |
| `src/components/riskMatrix/RiskMatrix5x5.test.tsx` | B2-RiesgoIPER | 63 |  |  |
| `src/components/riskRadar/RepeatingRiskRadarCard.test.tsx` | B2-RiesgoIPER | 53 |  |  |
| `src/components/riskRanking/RiskRankingWidgets.test.tsx` | B2-RiesgoIPER | 108 |  |  |
| `src/components/roleOnboarding/OnboardingTrackProgressPanel.test.tsx` | B6-Capacitacion | 234 |  |  |
| `src/components/roleViews/RoleViewCards.test.tsx` |  | 48 |  |  |
| `src/components/rootCause/RootCauseClassifierCard.test.tsx` | B4-Incidentes | 67 |  |  |
| `src/components/safetyMetrics/SafetyMetricsDashboard.test.tsx` | B18-Analitica | 93 |  |  |
| `src/components/safetyMetrics/SafetyTrendChart.test.tsx` | B18-Analitica | 52 |  |  |
| `src/components/safetyPerformance/SpiDashboard.test.tsx` | B18-Analitica | 67 |  |  |
| `src/components/safetyTalks/DailyTalkSuggestion.test.tsx` | B6-Capacitacion | 64 |  |  |
| `src/components/security/KekRotationPanel.test.tsx` |  | 292 |  |  |
| `src/components/shared/AsesorChatRouter.test.tsx` | B14-IA | 71 |  |  |
| `src/components/shared/DeepLinkHandler.test.tsx` |  | 72 |  | Sprint 21 — Bucket G: deep-link handler bridge tests. |
| `src/components/shared/EmergencyOverlay.test.tsx` | B1-Emergencia | 167 |  | Sprint 25 — Bucket NN: tests for EmergencyOverlay. |
| `src/components/shared/ProjectScopedPage.test.tsx` |  | 236 |  | Praeventio Guard — Plan 2026-05-23 Fase B.3 — tests del shell component. |
| `src/components/shared/RegulatoryCitation.test.tsx` | B5-Cumplimiento | 91 |  | Sprint 29 Bucket EE — RegulatoryCitation render tests. |
| `src/components/shared/syncConflictRoutes.test.ts` |  | 63 |  |  |
| `src/components/shared/Tooltip.test.tsx` |  | 141 |  | Sprint 20 sixteenth-wave (Bucket D — A11Y-015): tests for the WCAG |
| `src/components/shiftHandover/ShiftQualityCard.test.tsx` | B13-MOC | 50 |  |  |
| `src/components/shiftRiskPanel/PreShiftRiskCard.test.tsx` | B2-RiesgoIPER | 78 |  |  |
| `src/components/sif/SIFAlert.test.tsx` |  | 75 |  |  |
| `src/components/siteBook/SiteBook.test.tsx` | B9-Inspecciones | 152 |  |  |
| `src/components/slm/__tests__/OfflineSLMBanner.test.tsx` | B14-IA | 63 |  | Sprint 20 — Bucket Lambda — T-1.5 — OfflineSLMBanner tests. |
| `src/components/slm/__tests__/SLMModelPicker.test.tsx` | B14-IA | 53 |  | Sprint 20 — Bucket Lambda — T-1.5 — SLMModelPicker tests. |
| `src/components/slm/__tests__/SLMProvider.test.tsx` | B14-IA | 165 |  | Sprint 20 — Bucket Nu — SLMProvider tests. |
| `src/components/slm/__tests__/SLMStatusPanel.test.tsx` | B14-IA | 92 |  | Sprint 20 — Bucket Lambda — T-1.5 — SLMStatusPanel tests. |
| `src/components/slm/ReconciliationStatusToast.test.tsx` | B14-IA | 133 |  | Tests for `<ReconciliationStatusToast />`. |
| `src/components/slm/SlmAcquisitionPrompt.test.tsx` | B14-IA | 190 |  |  |
| `src/components/slm/SlmDownloadFloatingBanner.test.tsx` | B14-IA | 131 |  |  |
| `src/components/slm/SlmManagerScreen.test.tsx` | B14-IA | 187 |  |  |
| `src/components/softBlocking/RequirementGatePanel.test.tsx` | B8-PermisosLOTO | 57 |  |  |
| `src/components/spacedRepetition/SpacedRepetitionReviewQueue.test.tsx` | B6-Capacitacion | 78 |  |  |
| `src/components/stoppage/StoppageSummaryCard.test.tsx` | B8-PermisosLOTO | 32 |  |  |
| `src/components/suppliers/SupplierComparator.test.tsx` |  | 98 |  |  |
| `src/components/suseso/SusesoDeadlineBadge.test.tsx` | B5-Cumplimiento | 88 |  | SusesoDeadlineBadge tests — Sprint 28 follow-up. |
| `src/components/sync/ConflictResolutionDrawer.test.tsx` |  | 91 |  | Sprint 34 — Drawer happy path: receives a critical conflict, supervisor |
| `src/components/syncStatus/SyncQueueBadge.test.tsx` | B16-Offline | 52 |  |  |
| `src/components/telemetry/twinStateMapper.test.ts` | B7-Salud | 85 |  |  |
| `src/components/telemetry/WeatherAndSeismicPanels.test.tsx` | B7-Salud | 66 |  | Sprint 25 — Bucket SS.2 — WeatherAndSeismicPanels tests. |
| `src/components/telemetry/webhookCommand.test.ts` | B7-Salud | 29 |  |  |
| `src/components/twinPhysics/TwinPhysicsScene.test.tsx` |  | 70 |  | Sprint 48 E.2 — partial migration. Este test mantiene mocks por dos |
| `src/components/twinScene/__tests__/sceneGraph.r3f.test.tsx` |  | 161 |  | Sprint 48 E.2 — @react-three/test-renderer real (sin mock Canvas). |
| `src/components/twinScene/r3fTestRenderer.smoke.test.ts` |  | 20 |  | Sprint 48 E.2 — smoke test confirma que @react-three/test-renderer |
| `src/components/twinScene/TwinIntegrationPanel.test.tsx` |  | 117 |  | Sprint 48 E.2 — Test enfocado en READOUT HUD (DOM derivado de cálculos |
| `src/components/twinScene/TwinSceneInstanced.test.tsx` |  | 149 |  | Sprint 48 E.2 — Migración parcial a @react-three/test-renderer real. |
| `src/components/twinScene/TwinSceneInstancedLazy.test.tsx` |  | 20 |  |  |
| `src/components/visitors/VisitorCheckInForm.test.tsx` | B11-Contratistas | 71 |  |  |
| `src/components/vulnerability/VulnerabilityHeatmap.test.tsx` | B2-RiesgoIPER | 74 |  |  |
| `src/components/workerHistory/PortableHistoryPreview.test.tsx` | B18-Analitica | 79 |  |  |
| `src/components/workerReadiness/WorkerReadinessCard.test.tsx` |  | 50 |  |  |
| `src/components/workers/AccessControlModal.test.tsx` |  | 88 |  | Sprint 25 — Bucket SS.1 — AccessControlModal smoke tests. |
| `src/components/workers/AddWorkerModal.test.tsx` |  | 98 |  | Sprint 20 — Bucket D — AddWorkerModal integration tests. |
| `src/components/workers/DocsModal.test.tsx` |  | 109 |  | Sprint 20 — Bucket D — DocsModal render/list/delete tests. |
| `src/components/workers/EditWorkerModal.test.tsx` |  | 81 |  | Sprint 25 — Bucket SS.1 — EditWorkerModal smoke tests. |
| `src/components/workers/MassImportModal.test.tsx` |  | 70 |  | Sprint 25 — Bucket SS.1 — MassImportModal smoke tests. |
| `src/components/workers/QRCodeModal.test.tsx` |  | 51 |  | Sprint 25 — Bucket SS.1 — QRCodeModal smoke tests. |
| `src/components/workers/TraceabilityModal.test.tsx` |  | 89 |  | Sprint 25 — Bucket SS.1 — TraceabilityModal smoke tests. |
| `src/components/workPermits/PermitChecklistRenderer.test.tsx` | B8-PermisosLOTO | 75 |  |  |
| `src/components/workPermits/WorkPermitCard.test.tsx` | B8-PermisosLOTO | 80 |  |  |
| `src/components/zones/ZoneEntryGate.test.tsx` |  | 121 |  | Sprint 39 wire #3.4 — refactor: ZoneEntryGate ya no "bloquea". Es un |
| `src/contexts/AccessibilityContext.test.tsx` |  | 205 |  | Sprint K §139-145 — smoke tests for AccessibilityContext. |
| `src/contexts/EmergencyContext.meshFallback.test.tsx` | B1-Emergencia | 216 |  | Sprint 33 audit W10 — verifica el wire offline emergency → mesh |
| `src/contexts/LanguageProvider.test.ts` |  | 168 |  | LanguageProvider — language detection precedence + persistence. |
| `src/contexts/SubscriptionContext.test.ts` | B15-Billing | 140 |  |  |
| `src/contexts/SystemEngineProvider.test.tsx` |  | 42 |  | The critical safety invariant: when `enabled={false}` the provider must be a |
| `src/data/demoProject.test.ts` |  | 210 |  | Sprint 26 — Bucket YY.4 tests — demo project integrity. |
| `src/data/industryDemos.test.ts` |  | 127 |  |  |
| `src/data/medical/medicalCatalogs.test.ts` | B7-Salud | 94 |  | Sprint 21 — Bucket R · Tests de integridad para catálogos médicos. |
| `src/hooks/useAcousticSOS.test.tsx` |  | 138 |  | Tests for the acoustic SOS detector — a trapped/immobilized worker bangs a |
| `src/hooks/useArPlacement.test.ts` |  | 164 |  | Praeventio Guard — useArPlacement unit tests (Sprint 21 Ola 4 Bucket N). |
| `src/hooks/useBiometricAuth.test.tsx` | B7-Salud | 217 |  | Tests for the biometric / WebAuthn proof-of-presence hook — SECURITY code. |
| `src/hooks/useEquipmentQr.test.ts` | B10-EPP | 257 |  | Tests for the equipment-QR API client (Bloque 3.11 wire — 5 endpoints + 1 |
| `src/hooks/useEvacuation.test.ts` | B1-Emergencia | 97 |  | Tests for the evacuation-headcount API client (4 mutators). Vital: this is |
| `src/hooks/useEvacuationHeadcount.test.ts` | B1-Emergencia | 297 |  | Tests for the evacuation-headcount client hook (REST + live Firestore). |
| `src/hooks/useExternalAuditPortal.test.ts` | B17-Admin | 222 |  | Tests for the externalAuditPortal HTTP client (Wire-orphan Bloque 3 §3.7). |
| `src/hooks/useGeoAnchor.test.ts` |  | 118 |  | useGeoAnchor — unit tests para la conversión mesh ↔ geo. |
| `src/hooks/useGeoAnchoredNodes.test.ts` |  | 162 |  | Tests para `useGeoAnchoredNodes`. Mockeamos `services/firebase` para |
| `src/hooks/useGeofence.test.ts` | B1-Emergencia | 84 |  | useGeofence — Sprint 44 P2 (audit H11) unit tests para el hash de |
| `src/hooks/useHazmatInventory.test.ts` | B10-EPP | 179 |  | Tests for the hazmat-inventory API client (7 typed wrappers). The server |
| `src/hooks/useHealthMetrics.test.ts` | B7-Salud | 273 |  | Bucket OO (Sprint 25) — tests for useHealthMetrics. |
| `src/hooks/useInsights.test.tsx` |  | 171 |  |  |
| `src/hooks/useInvoicePolling.test.ts` | B15-Billing | 500 |  | Praeventio Guard — useInvoicePolling unit tests. |
| `src/hooks/useLegalObligations.test.ts` | B5-Cumplimiento | 247 |  | Tests for the legal-obligations calendar API client (Bloque 3.14 wire |
| `src/hooks/useManDownDetection.test.tsx` | B1-Emergencia | 221 |  | Tests for the Man Down (Hombre Caído) detection hook — VITAL safety code. |
| `src/hooks/useObjectLifecycle.test.ts` |  | 106 |  | Praeventio Guard — useObjectLifecycle unit tests. |
| `src/hooks/useProjectFirestoreCollection.test.tsx` |  | 347 |  | Praeventio Guard — Plan 2026-05-23 Fase B.2 — tests del hook. |
| `src/hooks/usePushNotifications.test.ts` |  | 119 |  | Praeventio Guard — usePushNotifications unit tests (Round 16 R3). |
| `src/hooks/useReconciliationStatus.test.tsx` |  | 107 |  | Tests for `useReconciliationStatus`. Runs in jsdom so the hook's |
| `src/hooks/useResilienceHealth.test.ts` | B7-Salud | 145 |  |  |
| `src/hooks/useResilientAi.test.tsx` |  | 245 |  |  |
| `src/hooks/useResilientAsesorFlag.test.ts` | B14-IA | 111 |  |  |
| `src/hooks/useRiskEngine.test.tsx` |  | 254 |  | Tests for the core risk-graph hook. It owns the `nodes` collection used |
| `src/hooks/useSeismicMonitor.test.ts` |  | 103 |  | Tests for the USGS seismic monitor. Vital + report-relevant: this is the |
| `src/hooks/useShiftHandover.test.ts` | B13-MOC | 194 |  | Tests for the shift-handover API client (6 mutators) + the 4 orphan-UI |
| `src/hooks/useSlmAcquisition.test.tsx` |  | 179 |  |  |
| `src/hooks/useStreamedGuardian.test.ts` |  | 170 |  | Praeventio Guard — useStreamedGuardian unit tests. |
| `src/hooks/useTwinAccess.test.ts` |  | 213 |  |  |
| `src/hooks/useWebXRSupport.test.ts` |  | 129 |  | useWebXRSupport — tests L.5 (Sprint 21 Ola 4 Bucket L). |
| `src/i18n/i18n.test.ts` |  | 212 |  | i18n.test.ts — Sprint 28 B2 global launch foundation. |
| `src/lib/apiAuth.test.ts` |  | 180 |  | Praeventio Guard — §2.20 fix tests (2026-05-21). |
| `src/lib/e2eAuth.test.ts` |  | 220 |  | §2.19 fix (2026-05-21) — Vitest unit tests para los helpers nuevos |
| `src/lib/sentry.test.ts` |  | 137 |  | Praeventio Guard — `@sentry/react` client init tests. |
| `src/pages/AnnualReview.test.tsx` |  | 256 |  | Praeventio Guard — Sprint K §291-295 page wrapper tests. |
| `src/pages/Apprenticeship.test.tsx` | B6-Capacitacion | 345 |  | Praeventio Guard — Sprint K §244-250 page wrapper tests. |
| `src/pages/ArcadeGames.test.tsx` | B6-Capacitacion | 39 |  | Round 15 / I4 — Arcade hub registry contract. |
| `src/pages/CalculatorHub.test.tsx` |  | 93 |  | Sprint 29 Bucket AA F-A — CalculatorHub integration tests. |
| `src/pages/ConfidentialReports.test.tsx` | B18-Analitica | 371 |  | Praeventio Guard — Sprint K §211-213 page wrapper tests. |
| `src/pages/CorrectiveActions.test.tsx` | B4-Incidentes | 174 |  | Praeventio Guard — Fase F.4 page wrapper tests. |
| `src/pages/CphsDraftMinute.test.tsx` |  | 222 |  | Praeventio Guard — Fase F.7 page wrapper tests. |
| `src/pages/CphsModule.test.tsx` |  | 162 |  | Praeventio Guard — Sprint 28 Bucket B5: CPHS module UI tests. |
| `src/pages/CphsModulePage.container.test.tsx` |  | 155 |  | Sprint 29 Bucket DD F-G — CphsModulePageContainer wiring tests. |
| `src/pages/CulturePulse.test.tsx` | B12-CPHS | 318 |  | Praeventio Guard — Sprint K §61-63 page wrapper tests. |
| `src/pages/CustodyChain.test.tsx` |  | 141 |  | Praeventio Guard — Fase F.24 page wrapper smoke test. |
| `src/pages/DataConfidence.test.tsx` | B18-Analitica | 315 |  | Praeventio Guard — Sprint K §104 page wrapper tests. |
| `src/pages/DrillsManager.test.tsx` | B1-Emergencia | 349 |  | Praeventio Guard — Fase F.20 page wrapper tests. |
| `src/pages/DrivingSafety.test.tsx` |  | 378 |  | Praeventio Guard — Sprint K §69-71 page wrapper tests. |
| `src/pages/EmergencyBrigade.test.tsx` | B1-Emergencia | 303 |  | Praeventio Guard — Sprint K §74-78 page wrapper tests. |
| `src/pages/EngineeringControls.test.tsx` | B8-PermisosLOTO | 435 |  | Praeventio Guard — §42-44 page wrapper tests. |
| `src/pages/Evacuation.slm.test.tsx` | B1-Emergencia | 172 |  | Sprint 37 — Brecha B (SLM offline fallback) — wire integration test |
| `src/pages/FindingsHeatMap.test.tsx` | B2-RiesgoIPER | 106 |  | Praeventio Guard — Fase F.14 page wrapper smoke test. |
| `src/pages/HealthVaultViewer.test.tsx` | B7-Salud | 121 |  | Sprint 26 Bucket VV — HealthVaultViewer page tests. |
| `src/pages/Inbox.test.tsx` |  | 142 |  | Praeventio Guard — Fase F.8 page wrapper tests. |
| `src/pages/IncidentBundle.test.tsx` | B4-Incidentes | 145 |  | Praeventio Guard — Fase F.3 page wrapper tests. |
| `src/pages/IncidentTrends.test.tsx` | B4-Incidentes | 244 |  | Praeventio Guard — F.29 page wrapper tests. |
| `src/pages/KnowledgeBase.test.tsx` |  | 235 |  | Praeventio Guard — Fase §185-190 page wrapper tests. |
| `src/pages/LeadershipDecisions.test.tsx` |  | 315 |  | Praeventio Guard — Sprint K §276-277 page wrapper tests. |
| `src/pages/LessonsLearned.test.tsx` | B4-Incidentes | 293 |  | Praeventio Guard — Fase F.12 page wrapper tests. |
| `src/pages/LightPollutionAudit.test.ts` |  | 49 |  | Round 15 / I4 — DS 594 Art. 103 lighting audit pure-helpers. |
| `src/pages/MaturityIndicator.test.tsx` | B2-RiesgoIPER | 232 |  | Praeventio Guard — Fase F.26 page wrapper tests. |
| `src/pages/MountainRefuges.test.tsx` | B1-Emergencia | 183 |  | Praeventio Guard — audit follow-up 2026-05-17. |
| `src/pages/OcSugerida.test.tsx` |  | 89 |  | Praeventio Guard — Sprint K §171-179 OcSugerida smoke tests. |
| `src/pages/OfflineInspection.test.tsx` | B9-Inspecciones | 517 |  | Praeventio Guard — Fase F.6 page wrapper tests. |
| `src/pages/PdcaModule.test.tsx` |  | 341 |  | Praeventio Guard — Sprint K §195-200 page wrapper tests. |
| `src/pages/PoolGame.test.ts` |  | 36 |  | Round 15 / I4 — Evacuation drill geometry helper. |
| `src/pages/PositiveObservations.test.tsx` | B9-Inspecciones | 445 |  | Praeventio Guard — Sprint K §214-215 page wrapper tests. |
| `src/pages/PreShiftRisk.test.tsx` | B2-RiesgoIPER | 195 |  | Praeventio Guard — Fase F.21 page wrapper tests. |
| `src/pages/PricingCalculator.test.tsx` | B15-Billing | 148 |  | Praeventio Guard — Sprint K §171-179 PricingCalculator smoke tests. |
| `src/pages/ProjectClosure.test.tsx` |  | 346 |  | Praeventio Guard — Sprint K §131-138 page wrapper tests. |
| `src/pages/ProjectsCompare.test.tsx` |  | 152 |  | Praeventio Guard — Fase F.27 page wrapper smoke test. |
| `src/pages/PublicDemo.test.tsx` |  | 59 |  | PublicDemo tests — Sprint 30 Bucket LL. |
| `src/pages/QrSignature.test.tsx` | B9-Inspecciones | 174 |  | Praeventio Guard — Fase F.5 page wrapper tests. |
| `src/pages/RepeatingRisks.test.tsx` |  | 205 |  | Praeventio Guard — Fase F.13 page wrapper tests. |
| `src/pages/ResidualRisk.test.tsx` | B2-RiesgoIPER | 253 |  | Praeventio Guard — Sprint K §296-301 page wrapper tests. |
| `src/pages/RiskNetwork.test.tsx` |  | 142 |  | Praeventio Guard — RiskNetwork page: ?node= deep-link tests. |
| `src/pages/Settings.webauthn.test.tsx` |  | 187 |  | Settings WebAuthn UI tests — Sprint 30 Bucket KK. |
| `src/pages/SoftBlocks.test.tsx` | B8-PermisosLOTO | 162 |  | Praeventio Guard — Fase F.17 page wrapper smoke test. |
| `src/pages/SunTracker.test.ts` |  | 78 |  | Round 15 / I4 — UV index pure helpers (Ley 20.096). |
| `src/pages/SupplierQuality.test.tsx` |  | 255 |  | Praeventio Guard — Sprint K §90-91 page wrapper tests. |
| `src/pages/WorkerPortableHistory.test.tsx` | B18-Analitica | 265 |  | Praeventio Guard — Sprint 42 Fase F.18 page wrapper tests. |
| `src/pages/WorkerReadiness.test.tsx` |  | 263 |  | Praeventio Guard — Fase F.16 page wrapper tests. |
| `src/pages/WorkPermits.test.tsx` | B8-PermisosLOTO | 347 |  | Praeventio Guard — Fase F.15 page wrapper tests. |
| `src/providers/MeshProvider.test.tsx` |  | 184 |  | Sprint 35 — MeshProvider tests. Closes the ADR-0013 last-mile from |
| `src/rules-tests/dirtyDozen.test.ts` |  | 371 |  | Dirty Dozen — Firestore rules pentest suite (Bucket RR). |
| `src/rules-tests/firestore.rules.test.ts` |  | 1650 |  | Firestore security-rules unit tests. |
| `src/rules-tests/projectScopedStores.rules.test.ts` |  | 244 |  | Rules tests for the 14 Sprint-K client-SDK stores (createProjectScopedStore). |
| `src/rules-tests/tenantScoped.test.ts` | B17-Admin | 255 |  | Cross-tenant isolation tests — Fase D.4. |
| `src/server/auth/webauthnAssertion.test.ts` | B17-Admin | 161 |  | Tests para verifyWebAuthnAssertion — Regla #3 cierre del DIAT WebAuthn |
| `src/server/jobs/checkExpiredPpe.test.ts` |  | 295 |  | Tests for `checkExpiredPpe` — Sprint 28 H26. |
| `src/server/jobs/checkOverdueMaintenance.test.ts` | B10-EPP | 198 |  | Tests para `checkOverdueMaintenance` — Bucket K.3. |
| `src/server/jobs/consolidateZettelkasten.test.ts` |  | 104 |  |  |
| `src/server/jobs/dailyClimateRiskScan.test.ts` |  | 252 |  | Sprint 25 Bucket TT — Tests for runDailyClimateRiskScan. |
| `src/server/jobs/firestoreCriticalReplicate.test.ts` |  | 189 |  | Bucket W.6 — Tests for `replicateCriticalData`. |
| `src/server/jobs/runB2dMrrSnapshot.test.ts` |  | 321 |  |  |
| `src/server/jobs/runConsistencyAudit.test.ts` |  | 159 |  |  |
| `src/server/jobs/runExceptionAutoExpire.test.ts` | B8-PermisosLOTO | 122 |  |  |
| `src/server/jobs/runLegalCalendarReminders.test.ts` | B5-Cumplimiento | 173 |  |  |
| `src/server/jobs/runLoneWorkerEscalation.test.ts` | B1-Emergencia | 210 |  |  |
| `src/server/jobs/runResilienceHealthAlert.test.ts` | B7-Salud | 302 |  |  |
| `src/server/jobs/runWorkPermitAutoExpire.test.ts` | B8-PermisosLOTO | 100 |  |  |
| `src/server/jobs/sendSusesoReminders.test.ts` | B5-Cumplimiento | 443 |  | Tests for `sendSusesoReminders` — Sprint 28 follow-up. |
| `src/server/kmsPreflight.test.ts` |  | 36 |  |  |
| `src/server/mcp/zkFirebaseReadAdapter.test.ts` | B3-Ergonomia | 400 |  |  |
| `src/server/middleware/b2dAuth.test.ts` |  | 156 |  | Sprint 23 Bucket BB.9 — b2dAuth middleware tests. |
| `src/server/middleware/canonicalBody.test.ts` |  | 129 |  | Praeventio Guard — Round 18 R6 (R6→R17 MEDIUM #2): RFC 8785 canonical-JSON |
| `src/server/middleware/captureRouteError.test.ts` |  | 125 |  | Test for centralized `captureRouteError` helper. |
| `src/server/middleware/geminiCircuit.test.ts` | B14-IA | 127 |  | Praeventio Guard — Sprint 22 prod hardening (Bucket X) tests. |
| `src/server/middleware/idempotencyKey.test.ts` |  | 313 |  | Praeventio Guard — Sprint 35 Bucket (Audit P1 §1.3). |
| `src/server/middleware/securityHeaders.test.ts` |  | 317 |  |  |
| `src/server/middleware/stampCspNonce.test.ts` |  | 73 |  | Praeventio Guard — Plan v2 F8 / Audit H16 (P3). |
| `src/server/middleware/validate.test.ts` |  | 171 |  | Praeventio Guard — Sprint 28 Bucket B3. |
| `src/server/middleware/verifyAuth.test.ts` | B17-Admin | 542 |  | Praeventio Guard — 15th wave Bucket A. |
| `src/server/middleware/verifySchedulerToken.test.ts` |  | 102 |  | Sprint 27 (audit P0 H14) — tests for the scheduler-token gate. |
| `src/server/middleware/verifyTwinStepUp.test.ts` |  | 138 |  | Sprint 26 — Bucket YY.3 tests — verifyTwinStepUp middleware. |
| `src/server/rateLimit/firestoreRateLimitStore.test.ts` |  | 261 |  | Praeventio Guard — Unit tests del FirestoreRateLimitStore. |
| `src/server/routes/adminBurden.test.ts` |  | 29 |  | Praeventio Guard — adminBurden router contract tests. |
| `src/server/routes/adoption.test.ts` |  | 34 |  | Praeventio Guard — adoption router contract tests. |
| `src/server/routes/agenda.test.ts` | B12-CPHS | 35 |  | Praeventio Guard — agenda router contract tests. |
| `src/server/routes/aggregateTelemetry.test.ts` | B7-Salud | 36 |  | Praeventio Guard — F.30 Aggregate Telemetry router contract tests. |
| `src/server/routes/aiFeedback.replay.test.ts` | B14-IA | 214 |  | Sprint 33 — replay protection + per-uid rate limiter for POST /api/ai/feedback. |
| `src/server/routes/aiGuardrails.test.ts` | B14-IA | 40 |  | Praeventio Guard — aiGuardrails router contract tests. |
| `src/server/routes/aiQuality.test.ts` | B14-IA | 45 |  | Praeventio Guard — aiQuality router contract tests. |
| `src/server/routes/aiToggle.test.ts` | B14-IA | 48 |  | Praeventio Guard — AI Toggle router contract tests. |
| `src/server/routes/annualReview.test.ts` |  | 28 |  | Praeventio Guard — §291-295 router contract tests. |
| `src/server/routes/apprenticeship.test.ts` | B6-Capacitacion | 32 |  |  |
| `src/server/routes/auditChain.test.ts` | B17-Admin | 37 |  | Praeventio Guard — auditChain router contract tests. |
| `src/server/routes/auditPortal.test.ts` | B17-Admin | 36 |  | Praeventio Guard — auditPortal router contract tests. |
| `src/server/routes/b2d/climate.test.ts` |  | 105 |  | Sprint 23 Bucket BB.9 — Climate API integration tests. |
| `src/server/routes/b2d/hazmat.test.ts` | B10-EPP | 104 |  | Sprint 23 Bucket BB.9 — Hazmat API integration tests. |
| `src/server/routes/b2d/normativa.test.ts` |  | 82 |  | Sprint 23 Bucket BB.9 — Normativa API integration tests. |
| `src/server/routes/b2d/suite.test.ts` |  | 184 |  | Praeventio Guard — B2D Suite Coach tests (§2.17 cierre Fase C.5, 2026-05-21). |
| `src/server/routes/bbs.test.ts` | B9-Inspecciones | 29 |  | Praeventio Guard — bbs router contract tests. |
| `src/server/routes/bowtie.test.ts` | B2-RiesgoIPER | 33 |  | Praeventio Guard — bowtie router contract tests. |
| `src/server/routes/cad.test.ts` |  | 205 |  | Sprint 17a → Sprint 21 Bucket Q. |
| `src/server/routes/changeMgmt.test.ts` | B13-MOC | 34 |  | Praeventio Guard — changeMgmt router contract tests. |
| `src/server/routes/checklistBuilder.test.ts` | B9-Inspecciones | 37 |  | Praeventio Guard — checklistBuilder router contract tests. |
| `src/server/routes/circadian.test.ts` | B7-Salud | 33 |  | Praeventio Guard — circadian router contract tests. |
| `src/server/routes/climateAwareScheduling.test.ts` |  | 29 |  | Praeventio Guard — climateAwareScheduling router contract tests. |
| `src/server/routes/coachRag.test.ts` | B14-IA | 33 |  | Praeventio Guard — coachRag router contract tests. |
| `src/server/routes/comms.test.ts` | B1-Emergencia | 41 |  | Praeventio Guard — comms router contract tests. |
| `src/server/routes/commsDrill.test.ts` | B1-Emergencia | 37 |  | Praeventio Guard — commsDrill router contract tests. |
| `src/server/routes/confidentialReports.test.ts` | B18-Analitica | 33 |  |  |
| `src/server/routes/consistency.test.ts` |  | 29 |  | Praeventio Guard — consistency router contract tests. |
| `src/server/routes/consultativeSale.test.ts` | B11-Contratistas | 25 |  | Praeventio Guard — consultativeSale router contract tests. |
| `src/server/routes/contingencySimulation.test.ts` | B1-Emergencia | 41 |  | Praeventio Guard — contingencySimulation router contract tests. |
| `src/server/routes/continuity.test.ts` | B13-MOC | 33 |  | Praeventio Guard — continuity router contract tests. |
| `src/server/routes/contractors.test.ts` | B11-Contratistas | 33 |  | Praeventio Guard — contractors router contract tests. |
| `src/server/routes/controlComparator.test.ts` |  | 60 |  | Praeventio Guard — Control Comparator router contract tests. |
| `src/server/routes/correctiveActions.test.ts` | B4-Incidentes | 49 |  | Praeventio Guard — F.4 Corrective Actions Center router contract tests. |
| `src/server/routes/costCalculator.test.ts` |  | 29 |  | Praeventio Guard — costCalculator router contract tests. |
| `src/server/routes/cphsMinute.test.ts` |  | 23 |  | Praeventio Guard — F.7 router contract tests. |
| `src/server/routes/criticalControls.test.ts` | B2-RiesgoIPER | 39 |  | Praeventio Guard — criticalControls router contract tests. |
| `src/server/routes/criticalRoles.test.ts` | B13-MOC | 34 |  | Praeventio Guard — criticalRoles router contract tests. |
| `src/server/routes/cspReport.test.ts` | B18-Analitica | 187 |  | Sprint 20 twelfth wave Bucket A — CSP violation report endpoint tests. |
| `src/server/routes/culturePulse.test.ts` | B12-CPHS | 28 |  | Praeventio Guard — §61-63 router contract tests. |
| `src/server/routes/dataConfidence.test.ts` | B18-Analitica | 41 |  |  |
| `src/server/routes/dataQuality.test.ts` |  | 24 |  | Praeventio Guard — F.9 Data Quality router contract tests. |
| `src/server/routes/deduplication.test.ts` |  | 29 |  | Praeventio Guard — deduplication router contract tests. |
| `src/server/routes/documentVersioning.test.ts` |  | 73 |  | Praeventio Guard — F.23 Document Versioning router contract tests. |
| `src/server/routes/drillsManager.test.ts` | B1-Emergencia | 28 |  | Praeventio Guard — F.20 router contract tests. |
| `src/server/routes/driving.test.ts` |  | 33 |  | Praeventio Guard — driving router contract tests. |
| `src/server/routes/drivingSafety.test.ts` |  | 30 |  | Praeventio Guard — §69-71 router contract tests. |
| `src/server/routes/efficacyVerification.test.ts` |  | 29 |  | Praeventio Guard — efficacyVerification router contract tests. |
| `src/server/routes/emergencyBrigade.test.ts` | B1-Emergencia | 28 |  | Praeventio Guard — §74-78 router contract tests. |
| `src/server/routes/engineeringControls.test.ts` | B8-PermisosLOTO | 27 |  | Praeventio Guard — §42-44 router contract tests. |
| `src/server/routes/eppFlow.test.ts` |  | 69 |  | Praeventio Guard — eppFlow router contract tests. |
| `src/server/routes/equipment.test.ts` | B10-EPP | 24 |  | Praeventio Guard — Equipment Master router contract tests. |
| `src/server/routes/equipmentQr.test.ts` | B10-EPP | 112 |  | Praeventio Guard — Bloque 3 wire huérfanos (3.11) router contract tests. |
| `src/server/routes/ergonomics.test.ts` | B3-Ergonomia | 29 |  | Praeventio Guard — ergonomics router contract tests. |
| `src/server/routes/escalation.test.ts` |  | 35 |  | Praeventio Guard — escalation router contract tests. |
| `src/server/routes/evacuation.test.ts` | B1-Emergencia | 34 |  | Praeventio Guard — evacuation router contract tests. |
| `src/server/routes/evacuationHeadcount.test.ts` | B1-Emergencia | 506 |  | Praeventio Guard — Sprint 39 Bloque 3 wire — evacuationHeadcount router |
| `src/server/routes/eventReplay.test.ts` |  | 33 |  | Praeventio Guard — eventReplay router contract tests. |
| `src/server/routes/exceptions.test.ts` | B8-PermisosLOTO | 36 |  | Praeventio Guard — exceptions router contract tests. |
| `src/server/routes/expirations.test.ts` |  | 29 |  | Praeventio Guard — expirations router contract tests. |
| `src/server/routes/explainability.test.ts` | B14-IA | 36 |  | Praeventio Guard — F.28 Explainability router contract tests. |
| `src/server/routes/expressBundle.test.ts` |  | 25 |  | Praeventio Guard — expressBundle router contract tests. |
| `src/server/routes/externalAuditPortal.test.ts` | B17-Admin | 644 |  | Praeventio Guard — externalAuditPortal contract tests. |
| `src/server/routes/fatigue.test.ts` | B7-Salud | 25 |  | Praeventio Guard — fatigue router contract tests. |
| `src/server/routes/firstResponderMap.test.ts` | B1-Emergencia | 29 |  | Praeventio Guard — firstResponderMap router contract tests. |
| `src/server/routes/fiveS.test.ts` |  | 33 |  | Praeventio Guard — fiveS router contract tests. |
| `src/server/routes/formBuilderAdvanced.test.ts` | B9-Inspecciones | 49 |  | Praeventio Guard — formBuilderAdvanced router contract tests. |
| `src/server/routes/geofencePermissions.test.ts` | B1-Emergencia | 25 |  | Praeventio Guard — geofencePermissions router contract tests. |
| `src/server/routes/hazmatInventory.test.ts` | B10-EPP | 519 |  | Praeventio Guard — hazmatInventory router contract tests. |
| `src/server/routes/healthDeep.test.ts` | B7-Salud | 186 |  | Sprint 22 Bucket AA — /api/health/deep tests. |
| `src/server/routes/healthVault.test.ts` | B7-Salud | 296 |  | Sprint 26 Bucket VV — healthVault route integration tests. |
| `src/server/routes/horometro.test.ts` | B10-EPP | 127 |  | Praeventio Guard — Bloque 4.1: horometro router contract tests. |
| `src/server/routes/hygiene.test.ts` | B7-Salud | 29 |  | Praeventio Guard — hygiene router contract tests. |
| `src/server/routes/inbox.test.ts` |  | 23 |  | Praeventio Guard — F.8 Inbox del Prevencionista router contract tests. |
| `src/server/routes/incidentBundle.test.ts` | B4-Incidentes | 24 |  | Praeventio Guard — F.3 Incident Evidence Bundle router contract tests. |
| `src/server/routes/incidentFlow.test.ts` | B4-Incidentes | 128 |  | Praeventio Guard — Bloque 4.3 incidentFlow router contract tests. |
| `src/server/routes/incidentTrends.test.ts` | B4-Incidentes | 30 |  | Praeventio Guard — F.29 router contract tests. |
| `src/server/routes/industryRules.test.ts` | B5-Cumplimiento | 105 |  | Praeventio Guard — Bloque 3.13 wire huérfanos: industryRules router |
| `src/server/routes/iot.test.ts` |  | 156 |  | Sprint 32 Bucket TT — coverage for POST /api/iot/devices/register. |
| `src/server/routes/jsa.test.ts` | B2-RiesgoIPER | 33 |  | Praeventio Guard — jsa router contract tests. |
| `src/server/routes/knowledgeBase.test.ts` |  | 28 |  | Praeventio Guard — §185-190 router contract tests. |
| `src/server/routes/leadership.test.ts` |  | 27 |  | Praeventio Guard — §276-277 router contract tests. |
| `src/server/routes/legalObligations.test.ts` | B5-Cumplimiento | 110 |  | Praeventio Guard — legalObligations router contract tests. |
| `src/server/routes/lessonsLearned.test.ts` | B4-Incidentes | 30 |  | Praeventio Guard — F.12 router contract tests. |
| `src/server/routes/loneWorker.test.ts` | B1-Emergencia | 51 |  | Praeventio Guard — loneWorker router contract tests. |
| `src/server/routes/loto.test.ts` | B8-PermisosLOTO | 22 |  | Praeventio Guard — LOTO Digital router contract tests. |
| `src/server/routes/maturity.test.ts` | B2-RiesgoIPER | 23 |  | Praeventio Guard — F.26 router contract tests. |
| `src/server/routes/medicalAptitude.test.ts` | B7-Salud | 105 |  | Praeventio Guard — Sprint 35 Bucket — /api/medical/aptitude-cert tests. |
| `src/server/routes/medicalCatalogs.test.ts` | B7-Salud | 32 |  | Praeventio Guard — medicalCatalogs router contract tests. |
| `src/server/routes/meetingPack.test.ts` | B12-CPHS | 33 |  | Praeventio Guard — meetingPack router contract tests. |
| `src/server/routes/mentalLoad.test.ts` | B7-Salud | 29 |  | Praeventio Guard — mentalLoad router contract tests. |
| `src/server/routes/microtraining.test.ts` | B6-Capacitacion | 60 |  | Praeventio Guard — F.22 Microtraining router contract tests. |
| `src/server/routes/multiProject.test.ts` |  | 33 |  | Praeventio Guard — multiProject router contract tests. |
| `src/server/routes/multiRoleSummary.test.ts` |  | 48 |  | Praeventio Guard — Multi-Role Summary router contract tests. |
| `src/server/routes/nonConformity.test.ts` | B5-Cumplimiento | 33 |  | Praeventio Guard — nonConformity router contract tests. |
| `src/server/routes/offlineInspections.test.ts` | B9-Inspecciones | 28 |  | Praeventio Guard — F.6 router contract tests. |
| `src/server/routes/openapi.test.ts` |  | 44 |  | Sprint 36 — Tests for /api/openapi.{json,html} router. |
| `src/server/routes/operationalChange.test.ts` | B13-MOC | 66 |  | Praeventio Guard — operationalChange router contract tests (Bloque 3.17). |
| `src/server/routes/orgMetrics.test.ts` | B18-Analitica | 41 |  | Praeventio Guard — orgMetrics router contract tests. |
| `src/server/routes/pdca.test.ts` |  | 30 |  | Praeventio Guard — §195-200 router contract tests. |
| `src/server/routes/photoEvidence.test.ts` | B9-Inspecciones | 48 |  | Praeventio Guard — F.19 Photo Evidence router contract tests. |
| `src/server/routes/pinSign.test.ts` |  | 31 |  | Praeventio Guard — pinSign router contract tests. |
| `src/server/routes/portableHistory.test.ts` | B18-Analitica | 31 |  |  |
| `src/server/routes/portfolioLessons.test.ts` | B6-Capacitacion | 29 |  | Praeventio Guard — portfolioLessons router contract tests. |
| `src/server/routes/positiveObservations.test.ts` | B9-Inspecciones | 33 |  | Praeventio Guard — §214-215 router contract tests. |
| `src/server/routes/postTraining.test.ts` | B6-Capacitacion | 39 |  | Praeventio Guard — postTraining router contract tests. |
| `src/server/routes/predictiveAlerts.test.ts` | B18-Analitica | 28 |  | Praeventio Guard — predictiveAlerts router contract tests. |
| `src/server/routes/preShiftRisk.test.ts` | B2-RiesgoIPER | 23 |  | Praeventio Guard — F.21 router contract tests. |
| `src/server/routes/preventionCost.test.ts` | B15-Billing | 67 |  | Praeventio Guard — preventionCost router contract tests (Bloque 3.15). |
| `src/server/routes/pricingCalculator.test.ts` | B15-Billing | 34 |  | Praeventio Guard — pricingCalculator router contract tests. |
| `src/server/routes/pricingSimulator.test.ts` | B15-Billing | 33 |  | Praeventio Guard — pricingSimulator router contract tests. |
| `src/server/routes/privacyRetention.test.ts` | B5-Cumplimiento | 37 |  | Praeventio Guard — privacyRetention router contract tests. |
| `src/server/routes/privacyShield.test.ts` |  | 33 |  | Praeventio Guard — privacyShield router contract tests. |
| `src/server/routes/projectClosure.test.ts` |  | 30 |  | Praeventio Guard — §131-138 router contract tests. |
| `src/server/routes/projectComparator.test.ts` | B18-Analitica | 25 |  | Praeventio Guard — projectComparator router contract tests. |
| `src/server/routes/protocols.test.ts` |  | 33 |  | Praeventio Guard — protocols router contract tests. |
| `src/server/routes/pymeOnboarding.test.ts` | B6-Capacitacion | 28 |  | Praeventio Guard — pymeOnboarding router contract tests. |
| `src/server/routes/pymeWizard.test.ts` | B17-Admin | 25 |  | Praeventio Guard — pymeWizard router contract tests. |
| `src/server/routes/qrAck.test.ts` | B9-Inspecciones | 29 |  | Praeventio Guard — qrAck router contract tests. |
| `src/server/routes/qrSignature.test.ts` | B9-Inspecciones | 26 |  | Praeventio Guard — F.5 router contract tests. |
| `src/server/routes/raciMatrix.test.ts` | B12-CPHS | 36 |  | Praeventio Guard — raciMatrix router contract tests. |
| `src/server/routes/readReceipts.test.ts` |  | 36 |  | Praeventio Guard — readReceipts router contract tests. |
| `src/server/routes/refuges.test.ts` | B1-Emergencia | 29 |  | Praeventio Guard — refuges router contract tests. |
| `src/server/routes/regulatoryFramework.test.ts` | B5-Cumplimiento | 31 |  | Praeventio Guard — regulatoryFramework router contract tests. |
| `src/server/routes/reportsAutomation.test.ts` | B18-Analitica | 33 |  | Praeventio Guard — reportsAutomation router contract tests. |
| `src/server/routes/reputationalAlerts.test.ts` |  | 29 |  | Praeventio Guard — reputationalAlerts router contract tests. |
| `src/server/routes/researchMode.test.ts` | B14-IA | 37 |  | Praeventio Guard — researchMode router contract tests. |
| `src/server/routes/residualRisk.test.ts` | B2-RiesgoIPER | 28 |  | Praeventio Guard — §296-301 router contract tests. |
| `src/server/routes/restrictedZones.test.ts` | B1-Emergencia | 78 |  | Praeventio Guard — restrictedZones router contract tests. |
| `src/server/routes/retaliationProtection.test.ts` |  | 29 |  | Praeventio Guard — retaliationProtection router contract tests. |
| `src/server/routes/returnToWork.test.ts` |  | 33 |  | Praeventio Guard — return-to-work router contract tests. |
| `src/server/routes/riskRadar.test.ts` | B2-RiesgoIPER | 23 |  | Praeventio Guard — F.13 router contract tests. |
| `src/server/routes/riskRanking.test.ts` | B2-RiesgoIPER | 30 |  | Praeventio Guard — riskRanking router contract tests. |
| `src/server/routes/roiScenario.test.ts` |  | 25 |  | Praeventio Guard — roiScenario router contract tests. |
| `src/server/routes/roleViews.test.ts` |  | 25 |  | Praeventio Guard — roleViews router contract tests. |
| `src/server/routes/rootCause.test.ts` | B4-Incidentes | 35 |  | Praeventio Guard — rootCause router contract tests. |
| `src/server/routes/rootCauseInvestigation.test.ts` | B4-Incidentes | 37 |  | Praeventio Guard — rootCauseInvestigation router contract tests. |
| `src/server/routes/routeScoring.test.ts` |  | 36 |  | Praeventio Guard — routeScoring router contract tests. |
| `src/server/routes/routing.test.ts` |  | 29 |  | Praeventio Guard — routing router contract tests. |
| `src/server/routes/safetyMetrics.test.ts` | B18-Analitica | 33 |  | Praeventio Guard — safetyMetrics router contract tests. |
| `src/server/routes/safetyPerformance.test.ts` | B18-Analitica | 29 |  | Praeventio Guard — safetyPerformance router contract tests. |
| `src/server/routes/safetyTalks.test.ts` | B6-Capacitacion | 25 |  | Praeventio Guard — safetyTalks router contract tests. |
| `src/server/routes/shiftHandover.test.ts` | B13-MOC | 32 |  | Praeventio Guard — shiftHandover router contract tests. |
| `src/server/routes/shiftRiskPanel.test.ts` | B2-RiesgoIPER | 25 |  | Praeventio Guard — shiftRiskPanel router contract tests. |
| `src/server/routes/sif.test.ts` |  | 36 |  | Praeventio Guard — F.3 SIF Precursors router contract tests. |
| `src/server/routes/signaletics.test.ts` | B10-EPP | 48 |  | Praeventio Guard — signaletics router contract tests. |
| `src/server/routes/sitebookSign.test.ts` | B9-Inspecciones | 432 |  | Praeventio Guard — Plan 2026-05-24 §D.X — server-side SiteBook signing. |
| `src/server/routes/sitebookSignRoutes.webauthn.test.ts` | B9-Inspecciones | 101 |  | P0 security fix tests: sitebookSignRoutes.ts must read WEBAUTHN_RP_ID |
| `src/server/routes/skillGap.test.ts` | B6-Capacitacion | 37 |  | Praeventio Guard — skillGap router contract tests. |
| `src/server/routes/softBlocking.test.ts` | B8-PermisosLOTO | 34 |  | Praeventio Guard — softBlocking router contract tests. |
| `src/server/routes/spacedRepetition.test.ts` | B6-Capacitacion | 37 |  | Praeventio Guard — spacedRepetition router contract tests. |
| `src/server/routes/stoppage.test.ts` | B8-PermisosLOTO | 31 |  | Praeventio Guard — stoppage router contract tests. |
| `src/server/routes/suppliers.test.ts` |  | 29 |  | Praeventio Guard — §90-91 router contract tests. |
| `src/server/routes/suseso.test.ts` | B5-Cumplimiento | 485 |  | Sprint 49 D.8.a — route tests for the new admin-gated SUSESO surface. |
| `src/server/routes/syncStatus.test.ts` | B16-Offline | 31 |  | Praeventio Guard — syncStatus router contract tests. |
| `src/server/routes/upsell.test.ts` |  | 25 |  | Praeventio Guard — upsell router contract tests. |
| `src/server/routes/vendorOnboarding.test.ts` | B6-Capacitacion | 49 |  | Praeventio Guard — vendorOnboarding router contract tests. |
| `src/server/routes/visitors.test.ts` | B11-Contratistas | 418 |  | Praeventio Guard — Sprint K §23-24 smoke tests for /api/visitors. |
| `src/server/routes/vulnerability.test.ts` |  | 24 |  | Praeventio Guard — F.10 Vulnerability Map router contract tests. |
| `src/server/routes/waste.test.ts` |  | 24 |  | Praeventio Guard — §229-236 Waste Inventory router contract tests. |
| `src/server/routes/wisdomCapsule.test.ts` |  | 81 |  |  |
| `src/server/routes/workerHistory.test.ts` |  | 33 |  | Praeventio Guard — workerHistory router contract tests. |
| `src/server/routes/workerReadiness.test.ts` |  | 23 |  | Praeventio Guard — F.16 router contract tests. |
| `src/server/routes/workPermits.test.ts` | B8-PermisosLOTO | 28 |  | Praeventio Guard — F.15 router contract tests. |
| `src/server/services/projectTokens.test.ts` |  | 348 |  |  |
| `src/server/services/serverZkNodeWriter.test.ts` |  | 107 |  | Pins the server-side ZK writer's tri-write against the canonical endpoint |
| `src/server/services/userLifecycle.test.ts` |  | 70 |  |  |
| `src/server/sessionStore/firestoreSessionStore.test.ts` | B17-Admin | 314 |  | Praeventio Guard — Unit tests del FirestoreSessionStore. |
| `src/server/sync/distributedLock.test.ts` |  | 410 |  | Bloque 5.4 (C14) — distributedLock tests. |
| `src/server/triggers/backgroundTriggers.test.ts` |  | 433 |  | Praeventio Guard — Round 21 B1 Phase 5 tests. |
| `src/server/triggers/healthCheck.test.ts` | B7-Salud | 128 |  | Praeventio Guard — Round 21 B1 Phase 5 tests. |
| `src/server/triggers/systemEngineTrigger.test.ts` |  | 97 |  |  |
| `src/server/triggers/zettelkastenMaterializer.test.ts` |  | 182 |  |  |
| `src/server/utils/fcmMulticast.test.ts` |  | 107 |  |  |
| `src/services/adminBurden/adminBurden.test.ts` |  | 262 |  |  |
| `src/services/adoption/adoptionAnalytics.test.ts` | B18-Analitica | 110 |  |  |
| `src/services/agenda/agendaScheduler.test.ts` | B12-CPHS | 139 |  |  |
| `src/services/ai/aiAdapter.test.ts` |  | 218 |  | Tests for the AI adapter facade + the gemini-consumer / vertex-ai / noop |
| `src/services/ai/asesorAdaptersFactory.test.ts` | B14-IA | 152 |  |  |
| `src/services/ai/colorBasedEppDetector.test.ts` |  | 148 |  | Praeventio Guard — §2.18 (2026-05-22) tests del detector EPP on-device |
| `src/services/ai/contextualAssistant.test.ts` |  | 222 |  |  |
| `src/services/ai/eppDetectorOnDevice.test.ts` |  | 228 |  | §2.18 EPP detector on-device tests. |
| `src/services/ai/resilientAiAdapters.test.ts` |  | 263 |  |  |
| `src/services/ai/resilientAiOrchestrator.test.ts` | B14-IA | 239 |  |  |
| `src/services/ai/vertexAdapter.test.ts` |  | 292 |  | Tests for the real Vertex AI adapter (post-H4 fix). |
| `src/services/ai/zkRagContextBuilder.test.ts` |  | 361 |  |  |
| `src/services/ai/zkRagResponseValidator.test.ts` |  | 153 |  |  |
| `src/services/aiGuardrails/aiGuardrails.test.ts` | B14-IA | 168 |  |  |
| `src/services/aiGuardrails/citationValidator.test.ts` | B14-IA | 119 |  | Tests para citationValidator.ts — Sprint K §158. |
| `src/services/aiGuardrails/hallucinationGuard.test.ts` | B14-IA | 134 |  | Tests para hallucinationGuard.ts — Sprint K §159. |
| `src/services/aiGuardrails/runWithGuardrails.test.ts` | B14-IA | 328 |  | Tests para runWithGuardrails.ts — Sprint K §155 (integration). |
| `src/services/aiGuardrails/versionedPrompts.test.ts` | B14-IA | 97 |  | Tests para versionedPrompts.ts — Sprint K §156. |
| `src/services/aiQuality/aiAuditLog.test.ts` | B14-IA | 169 |  |  |
| `src/services/aiToggle/aiModeController.test.ts` | B14-IA | 157 |  |  |
| `src/services/aiToggle/ruleDriftDetector.test.ts` | B14-IA | 210 |  |  |
| `src/services/analytics/adapter.test.ts` | B18-Analitica | 642 |  | Analytics adapter tests (ninth wave, Bucket D). |
| `src/services/analytics/b2dMetrics.test.ts` | B18-Analitica | 190 |  | Praeventio Guard — Bucket CC tests for `b2dMetrics.ts`. |
| `src/services/analytics/serverAdapter.test.ts` | B18-Analitica | 446 |  | Server analytics adapter tests (15th wave, Bucket D). |
| `src/services/annualReview/annualReviewFirestoreAdapter.test.ts` |  | 85 |  |  |
| `src/services/annualReview/annualSgiReview.test.ts` |  | 128 |  |  |
| `src/services/apprenticeship/apprenticeshipProgressService.test.ts` | B6-Capacitacion | 152 |  |  |
| `src/services/ar/arAnchorFirestoreAdapter.test.ts` |  | 207 |  |  |
| `src/services/ar/arAnchorService.test.ts` |  | 200 |  |  |
| `src/services/ar/arHitTest.test.ts` |  | 195 |  |  |
| `src/services/ar/arPlatformPolicy.test.ts` |  | 110 |  |  |
| `src/services/ar/arQuickLookFallback.test.ts` |  | 108 |  |  |
| `src/services/ar/arSceneOrchestrator.test.ts` | B14-IA | 144 |  |  |
| `src/services/ar/posterCatalog.test.ts` |  | 272 |  |  |
| `src/services/ar/posterMatcher.test.ts` |  | 265 |  |  |
| `src/services/ar/usdzConverter.test.ts` |  | 188 |  | Sprint 23 Bucket EE.8 — UsdzConverter unit tests. |
| `src/services/ar/webXrCapabilities.test.ts` |  | 175 |  |  |
| `src/services/audit/expressBundleBuilder.test.ts` |  | 139 |  |  |
| `src/services/audit/tamperProofChain.test.ts` |  | 476 |  |  |
| `src/services/auditPortal/auditPortalFirestoreAdapter.test.ts` | B17-Admin | 97 |  |  |
| `src/services/auditPortal/externalAuditPortal.test.ts` | B17-Admin | 180 |  |  |
| `src/services/auth/customClaims.test.ts` | B17-Admin | 132 |  | Praeventio Guard — customClaims unit tests (§12.4.2). |
| `src/services/auth/projectMembership.test.ts` | B17-Admin | 113 |  | Praeventio Guard — assertProjectMember() unit tests. |
| `src/services/auth/totp.test.ts` | B17-Admin | 236 |  |  |
| `src/services/auth/totpEnrollment.test.ts` | B17-Admin | 200 |  |  |
| `src/services/auth/webauthnChallenge.test.ts` | B17-Admin | 324 |  | Praeventio Guard — Round 17 (R5 agent): WebAuthn challenge cache. |
| `src/services/auth/webauthnCredentialStore.test.ts` | B17-Admin | 340 |  | Praeventio Guard — Round 19 (R19 A5 agent): WebAuthn credential store |
| `src/services/b2d/apiKeyService.test.ts` |  | 223 |  | Sprint 23 Bucket BB.9 — apiKeyService tests. |
| `src/services/battery/batteryAdvisor.test.ts` |  | 162 |  | Praeventio Guard — batteryAdvisor unit tests. |
| `src/services/behaviorObservation/bbsObservationEngine.test.ts` | B9-Inspecciones | 148 |  |  |
| `src/services/billing/appleTransactionValidator.test.ts` | B15-Billing | 271 |  |  |
| `src/services/billing/currency.test.ts` | B15-Billing | 102 |  | Praeventio Guard — currency formatting tests. |
| `src/services/billing/googlePlayValidator.test.ts` | B15-Billing | 287 |  |  |
| `src/services/billing/iapAdapter.test.ts` | B15-Billing | 247 |  | Praeventio Guard — IapAdapter unit tests. |
| `src/services/billing/idempotency.test.ts` | B15-Billing | 331 |  | Praeventio Guard — withIdempotency() unit tests. |
| `src/services/billing/invoice.test.ts` | B15-Billing | 254 |  |  |
| `src/services/billing/khipuAdapter.test.ts` | B15-Billing | 373 |  | Praeventio Guard — khipuAdapter unit tests. |
| `src/services/billing/mercadoPagoAdapter.test.ts` | B15-Billing | 224 |  | Praeventio Guard — mercadoPagoAdapter unit tests. |
| `src/services/billing/mercadoPagoIpn.test.ts` | B15-Billing | 629 |  | Praeventio Guard — Round 18 R2 (deferred from R17): MercadoPago IPN handler tests. |
| `src/services/billing/mercadoPagoIpnProduction.test.ts` | B15-Billing | 225 |  | Tests para MercadoPago HMAC production format `ts=...,v1=...`. |
| `src/services/billing/mpJwksCache.test.ts` | B15-Billing | 137 |  | Praeventio Guard — Round 19 (A9): mpJwksCache unit tests. |
| `src/services/billing/webpayAdapter.test.ts` | B15-Billing | 1591 |  | Praeventio Guard — webpayAdapter unit tests. |
| `src/services/billing/webpayMetrics.test.ts` | B15-Billing | 94 |  | Praeventio Guard — Webpay return latency histogram tests. |
| `src/services/bowtie/bowtieAnalysisBuilder.test.ts` | B2-RiesgoIPER | 132 |  |  |
| `src/services/bundlePerf/bundleSizeAnalyzer.test.ts` |  | 147 |  |  |
| `src/services/cad/dwgDocumentValidator.test.ts` |  | 326 |  | Sprint 50 E.5 P2 H1 — tests for DWG document validator. |
| `src/services/cad/dxfAdapter.test.ts` |  | 73 |  |  |
| `src/services/calendar/legalObligations.test.ts` | B5-Cumplimiento | 59 |  |  |
| `src/services/calendar/predictions.test.ts` |  | 71 |  |  |
| `src/services/capacity/normativeAlerts.test.ts` |  | 308 |  |  |
| `src/services/capacity/tierEvaluation.test.ts` |  | 281 |  |  |
| `src/services/cargo/stowageOptimizer.test.ts` |  | 215 |  |  |
| `src/services/changeMgmt/operationalChangeFirestoreAdapter.test.ts` | B13-MOC | 82 |  |  |
| `src/services/changeMgmt/operationalChangeService.test.ts` | B13-MOC | 144 |  |  |
| `src/services/changeMgmt/operationalChangeWorkflow.test.ts` | B13-MOC | 428 |  | Praeventio Guard — Plan 2026-05-24 §MOC — Workflow approval ISO 45001 §8.1.3. |
| `src/services/checklistBuilder/checklistBuilder.test.ts` | B9-Inspecciones | 308 |  |  |
| `src/services/circadian/circadianRhythmService.test.ts` | B7-Salud | 114 |  |  |
| `src/services/clientReporting/monthlyClientReport.test.ts` | B18-Analitica | 69 |  |  |
| `src/services/clientReporting/monthlyClientReportBuilder.test.ts` | B18-Analitica | 191 |  |  |
| `src/services/climateAwareScheduling/climateAwareScheduling.test.ts` |  | 115 |  |  |
| `src/services/coach/normativeRag.test.ts` |  | 113 |  |  |
| `src/services/coach/personaSelector.test.ts` |  | 155 |  | Tests para §12.6.1 — Persona selector GeminiChat. |
| `src/services/coach/prompts.test.ts` | B14-IA | 96 |  |  |
| `src/services/comms/communicationMap.test.ts` | B1-Emergencia | 107 |  |  |
| `src/services/commsDrill/commsDrillEngine.test.ts` | B1-Emergencia | 203 |  |  |
| `src/services/compliance/adapters/registry.test.ts` | B5-Cumplimiento | 128 |  | Praeventio Guard — Tests del registro de adapters compliance (Bloque 7). |
| `src/services/compliance/ds67/ds67Service.country.test.ts` | B5-Cumplimiento | 187 |  | Praeventio Guard — Sprint 33 wire W6. |
| `src/services/compliance/ds67/ds67Service.test.ts` | B5-Cumplimiento | 208 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/compliance/ds67/ds67Service.xpHook.test.ts` | B5-Cumplimiento | 121 |  | Sprint 32 wire W4 — verifica que signForm invoca awardXp con |
| `src/services/compliance/ds76/ds76Service.country.test.ts` | B5-Cumplimiento | 179 |  | Praeventio Guard — Sprint 33 wire W6. |
| `src/services/compliance/ds76/ds76Service.test.ts` | B5-Cumplimiento | 184 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/compliance/ds76/ds76Service.xpHook.test.ts` | B5-Cumplimiento | 123 |  | Sprint 32 wire W4 — verifica que signForm DS76 invoca awardXp |
| `src/services/compliance/ley19628.test.ts` | B5-Cumplimiento | 318 |  | Praeventio Guard — Sprint 23 Bucket FF tests. |
| `src/services/compliance/normativeAuditLog.test.ts` | B5-Cumplimiento | 184 |  | Tests para §12.4.3 — audit log mutations normativa. |
| `src/services/compliance/trafficLightEngine.test.ts` | B5-Cumplimiento | 160 |  |  |
| `src/services/confidentialReports/confidentialReportsFirestoreAdapter.test.ts` | B18-Analitica | 83 |  |  |
| `src/services/confidentialReports/confidentialReportsService.test.ts` | B18-Analitica | 175 |  |  |
| `src/services/confidentialReports/karinReportingEngine.test.ts` | B18-Analitica | 189 |  |  |
| `src/services/consistency/consistencyAuditor.test.ts` |  | 191 |  |  |
| `src/services/consistency/consistencyStateBuilder.test.ts` |  | 164 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) tests. |
| `src/services/consultativeSale/consultativeSalePlaybook.test.ts` | B11-Contratistas | 202 |  |  |
| `src/services/contingencySimulation/contingencySimulation.test.ts` | B1-Emergencia | 445 |  |  |
| `src/services/continuity/continuityPlanning.test.ts` | B13-MOC | 110 |  |  |
| `src/services/contractors/contractorKpiService.test.ts` | B11-Contratistas | 137 |  |  |
| `src/services/controlComparator/controlComparator.test.ts` |  | 270 |  |  |
| `src/services/controlComparator/controlFailureLibrary.test.ts` |  | 127 |  |  |
| `src/services/correctiveActions/correctiveActionsCenter.test.ts` | B4-Incidentes | 216 |  |  |
| `src/services/correctiveActions/correctiveActionsFirestoreAdapter.test.ts` | B4-Incidentes | 56 |  |  |
| `src/services/correctiveActions/weakActionDetector.test.ts` | B4-Incidentes | 170 |  |  |
| `src/services/costCalculator/preventionCostCalculator.test.ts` | B15-Billing | 128 |  |  |
| `src/services/cphs/cphsMinuteAutogenerator.test.ts` | B12-CPHS | 211 |  |  |
| `src/services/cphs/cphsService.test.ts` | B12-CPHS | 366 |  | Praeventio Guard — Sprint 28 Bucket B5: CPHS service tests. |
| `src/services/cphs/cphsService.xpHook.test.ts` | B12-CPHS | 147 |  | Sprint 32 wire W4 — verifica que recordMinutes y signMinutes invocan |
| `src/services/cqrs/incidents/incidentCommands.test.ts` | B4-Incidentes | 350 |  |  |
| `src/services/cqrs/incidents/incidentReadModel.test.ts` | B4-Incidentes | 204 |  |  |
| `src/services/criticalControls/controlRobustness.test.ts` | B2-RiesgoIPER | 150 |  |  |
| `src/services/criticalControls/controlValidationsStore.firestore.test.ts` | B2-RiesgoIPER | 151 |  | Praeventio Guard — Plan 2026-05-23 Fase C.3. |
| `src/services/criticalControls/criticalControlsLibrary.test.ts` | B2-RiesgoIPER | 119 |  |  |
| `src/services/criticalRoles/criticalRolesMap.test.ts` | B13-MOC | 137 |  |  |
| `src/services/culturePulse/safetyCulturePulse.test.ts` | B12-CPHS | 131 |  |  |
| `src/services/curriculum/claims.test.ts` | B6-Capacitacion | 343 |  | Praeventio Guard — Round 14 (R5 agent): curriculum_claims service tests. |
| `src/services/curriculum/historyAggregator.test.ts` | B6-Capacitacion | 249 |  | Praeventio Guard — Round 17 (R5 agent): historyAggregator tests. |
| `src/services/curriculum/refereeTokens.test.ts` | B6-Capacitacion | 59 |  | Praeventio Guard — Round 14 (R5 agent): magic-link referee tokens. |
| `src/services/dataConfidence/dataConfidencePanel.test.ts` | B18-Analitica | 159 |  |  |
| `src/services/dataQuality/incompletenessScanner.test.ts` |  | 209 |  |  |
| `src/services/dea/deaFirestoreAdapter.test.ts` |  | 127 |  |  |
| `src/services/dea/deaService.test.ts` |  | 110 |  |  |
| `src/services/deduplication/recordDeduplicator.test.ts` |  | 131 |  |  |
| `src/services/digitalTwin/gaussianSplatFirestoreAdapter.test.ts` |  | 71 |  |  |
| `src/services/digitalTwin/gaussianSplatRegistry.test.ts` |  | 172 |  |  |
| `src/services/digitalTwin/lifecycle/objectLifecycleOrchestrator.test.ts` | B14-IA | 349 |  |  |
| `src/services/digitalTwin/objectPlacement/normativaRules.test.ts` |  | 271 |  |  |
| `src/services/digitalTwin/onDeviceReconstruction/midasDepthEstimator.test.ts` |  | 141 |  | Praeventio Guard — Plan 2026-05-23 §Fase D.1 tests. |
| `src/services/digitalTwin/onDeviceReconstruction/pointCloudBuilder.test.ts` |  | 144 |  | Praeventio Guard — §2.28 (2026-05-22) tests del point cloud builder. |
| `src/services/digitalTwin/onDeviceReconstruction/usdzExporter.test.ts` |  | 151 |  | Praeventio Guard — §2.28 (2026-05-23) tests del USDZ exporter. |
| `src/services/digitalTwin/photogrammetry/mockAdapter.test.ts` |  | 117 |  |  |
| `src/services/digitalTwin/placedObjectsStore.test.ts` |  | 185 |  | placedObjectsStore — unit tests con Firebase mockeado. |
| `src/services/documentHygiene/documentHygieneEngine.test.ts` | B7-Salud | 144 |  |  |
| `src/services/documents/documentVersioning.test.ts` |  | 237 |  |  |
| `src/services/documents/documentVersioningFirestoreAdapter.test.ts` |  | 187 |  | Praeventio Guard — DocumentVersioningAdapter unit tests. |
| `src/services/documents/legalDocTemplates.test.ts` |  | 136 |  |  |
| `src/services/domainEvents/domainEventStore.test.ts` |  | 157 |  |  |
| `src/services/drillsManager/drillsManager.test.ts` | B1-Emergencia | 183 |  |  |
| `src/services/driving/commuteSession.test.ts` | B13-MOC | 112 |  | Praeventio Guard — Sprint 12. |
| `src/services/driving/speedTrigger.test.ts` |  | 164 |  | Unit tests for the pure driving-safety helpers in speedTrigger.ts. |
| `src/services/drivingSafety/drivingSafetyService.test.ts` |  | 127 |  |  |
| `src/services/dte/dteAutoIssueOrchestrator.test.ts` | B5-Cumplimiento | 197 |  | Praeventio Guard — Sprint 49 D.8.b: dteAutoIssueOrchestrator unit tests. |
| `src/services/dte/dteIssueQueue.test.ts` | B5-Cumplimiento | 168 |  | Praeventio Guard — Sprint 49 D.8.b: dteIssueQueue unit tests. |
| `src/services/efficacyVerification/efficacyVerifier.test.ts` |  | 252 |  |  |
| `src/services/email/resendService.test.ts` |  | 253 |  | Praeventio Guard — Sprint 22 (Bucket Y) tests. |
| `src/services/emergency/autoTrigger.test.ts` | B1-Emergencia | 161 |  | Sprint 20 — Bucket D — autoTrigger sismic-detection unit tests. |
| `src/services/emergency/autoTrigger.usgs.test.ts` | B1-Emergencia | 107 |  | Sprint 39 J3c — autoTrigger USGS cross-check tests. |
| `src/services/emergency/emergencyNumbers.test.ts` | B1-Emergencia | 96 |  |  |
| `src/services/emergency/gpsBreadcrumbTracker.test.ts` | B1-Emergencia | 129 |  |  |
| `src/services/emergency/sosOrchestrator.test.ts` | B1-Emergencia | 196 |  |  |
| `src/services/emergency/sosOutbox.test.ts` | B1-Emergencia | 123 |  |  |
| `src/services/emergencyBrigade/emergencyBrigadeService.test.ts` | B1-Emergencia | 125 |  |  |
| `src/services/engineering/scratchCalculations.test.ts` |  | 122 |  | Tests para scratch calculations storage (Regla #3). |
| `src/services/engineeringControls/engineeringControlsInventory.test.ts` | B8-PermisosLOTO | 152 |  |  |
| `src/services/environment/chileClimatology.test.ts` |  | 117 |  | Tests para climatología chilena (Regla #3 — funciona REAL). |
| `src/services/environmental/environmentalCompliance.test.ts` | B5-Cumplimiento | 155 |  |  |
| `src/services/environmental/wasteFirestoreAdapter.test.ts` |  | 119 |  |  |
| `src/services/environmentBackend.client.test.ts` |  | 141 |  |  |
| `src/services/environmentBackend.test.ts` |  | 400 |  |  |
| `src/services/equipment/equipmentFirestoreAdapter.test.ts` | B10-EPP | 95 |  |  |
| `src/services/equipment/equipmentQrService.test.ts` | B10-EPP | 160 |  |  |
| `src/services/ergonomics/landmarksToScore.test.ts` | B3-Ergonomia | 222 |  |  |
| `src/services/ergonomics/poseEdgeFilter.test.ts` | B3-Ergonomia | 130 |  | Sprint 34 — Cobertura PoseEdgeFilter. |
| `src/services/ergonomics/reba.test.ts` | B3-Ergonomia | 1015 |  |  |
| `src/services/ergonomics/rula.test.ts` | B3-Ergonomia | 904 |  |  |
| `src/services/erp/erpAdapter.test.ts` |  | 173 |  | Praeventio Guard — Tests del ERP adapter honesto. |
| `src/services/escalation/escalationSlaEngine.test.ts` |  | 232 |  |  |
| `src/services/etl/csvAdapter.test.ts` |  | 160 |  | Sprint 24 — Bucket JJ — CsvAdapter tests. |
| `src/services/etl/schemas.test.ts` |  | 139 |  | Sprint 24 — Bucket JJ — Pre-built schema tests. |
| `src/services/euler/criticalLoad.test.ts` |  | 176 |  |  |
| `src/services/euler/eulerianPath.test.ts` |  | 201 |  |  |
| `src/services/euler/eulerLagrange.test.ts` |  | 215 |  |  |
| `src/services/euler/fftAnalyzer.test.ts` |  | 207 |  |  |
| `src/services/euler/graphConnectivity.test.ts` |  | 182 |  |  |
| `src/services/euler/inviscidFlow.test.ts` |  | 218 |  |  |
| `src/services/euler/odeIntegrator.test.ts` |  | 274 |  |  |
| `src/services/euler/polyhedronAchievements.test.ts` |  | 187 |  |  |
| `src/services/euler/zettelkastenTopology.test.ts` |  | 262 |  |  |
| `src/services/evacuation/evacuationFirestoreAdapter.test.ts` | B1-Emergencia | 92 |  |  |
| `src/services/evacuation/evacuationHeadcount.test.ts` | B1-Emergencia | 151 |  |  |
| `src/services/eventBus/eventBus.test.ts` |  | 352 |  |  |
| `src/services/eventReplay/eventReplayAuditTool.test.ts` |  | 449 |  |  |
| `src/services/eventStore/inMemoryEventStore.test.ts` |  | 201 |  |  |
| `src/services/evidenceChain/custodyChainFirestoreAdapter.test.ts` |  | 91 |  |  |
| `src/services/evidenceChain/custodyChainService.test.ts` |  | 191 |  |  |
| `src/services/excelImport/excelImporter.test.ts` |  | 95 |  |  |
| `src/services/excelImporter/deduplicator.test.ts` |  | 93 |  | Praeventio Guard — Sprint K §108 — deduplicator tests. |
| `src/services/excelImporter/recordValidator.test.ts` |  | 135 |  | Praeventio Guard — Sprint K §107 — recordValidator tests. |
| `src/services/excelImporter/xlsxReader.test.ts` |  | 135 |  | Praeventio Guard — Sprint K §106 — xlsxReader tests. |
| `src/services/exceptions/exceptionEngine.test.ts` | B8-PermisosLOTO | 163 |  |  |
| `src/services/exceptions/exceptionFirestoreAdapter.test.ts` | B8-PermisosLOTO | 103 |  |  |
| `src/services/expirations/expirationScanner.test.ts` |  | 153 |  |  |
| `src/services/explainability/recommendationExplainer.test.ts` | B14-IA | 148 |  |  |
| `src/services/exposure/exposureFirestoreAdapter.test.ts` |  | 72 |  |  |
| `src/services/exposure/exposureRegistry.test.ts` |  | 97 |  |  |
| `src/services/exposure/thermalStressCalculator.test.ts` |  | 136 |  |  |
| `src/services/external/eonet/eonetAdapter.test.ts` |  | 85 |  |  |
| `src/services/external/nasaPower/nasaPowerAdapter.test.ts` |  | 331 |  |  |
| `src/services/external/recommendationBuilder.test.ts` |  | 86 |  |  |
| `src/services/external/usgs/usgsEarthquakeAdapter.test.ts` |  | 105 |  |  |
| `src/services/fatigue/fatigueMonitor.test.ts` | B7-Salud | 112 |  |  |
| `src/services/financialAnalytics/eppBudgetTracker.test.ts` | B18-Analitica | 160 |  |  |
| `src/services/financialAnalytics/purchaseOrderSuggester.test.ts` | B18-Analitica | 194 |  |  |
| `src/services/financialAnalytics/roiCalculator.test.ts` | B18-Analitica | 179 |  |  |
| `src/services/firestore/createProjectScopedStore.firestore.test.ts` |  | 213 |  | Praeventio Guard — Plan 2026-05-23 Fase C.3. |
| `src/services/firestore/createProjectScopedStore.test.ts` |  | 280 |  | Praeventio Guard — Plan 2026-05-23 Fase B.1 — tests del helper. |
| `src/services/firestore/resilientReader.test.ts` |  | 247 |  |  |
| `src/services/firstResponderMap/firstResponderMap.test.ts` | B1-Emergencia | 217 |  |  |
| `src/services/fiveS/fiveSAudit.test.ts` |  | 70 |  |  |
| `src/services/focusBlocks/focusBlocks.test.ts` |  | 196 |  |  |
| `src/services/foregroundService/guardianForegroundService.test.ts` |  | 163 |  |  |
| `src/services/formBuilderAdvanced/advancedFieldEngine.test.ts` | B9-Inspecciones | 364 |  |  |
| `src/services/gamification/daysWithoutIncident.test.ts` | B4-Incidentes | 169 |  | Sprint 29 Bucket DD F-D — daysWithoutIncident service tests. |
| `src/services/gamification/positiveXp.test.ts` | B6-Capacitacion | 59 |  |  |
| `src/services/gemini/asesorDomain.test.ts` | B14-IA | 66 |  | Coach IA por dominio (#9) — unit tests for the two pure functions that make |
| `src/services/gemini/chat.test.ts` | B14-IA | 42 |  | Tests §12.5.1 split step 10 — gemini/chat.ts. |
| `src/services/gemini/embeddings.test.ts` | B14-IA | 93 |  | Tests §12.5.1 split step 4 — gemini/embeddings.ts. |
| `src/services/gemini/emergency.test.ts` | B1-Emergencia | 41 |  | Tests §12.5.1 split step 8 — gemini/emergency.ts. |
| `src/services/gemini/governance.test.ts` | B14-IA | 137 |  | Tests §12.5.1 split step 1 — gemini/governance.ts. |
| `src/services/gemini/operations.test.ts` | B14-IA | 78 |  | Tests §12.5.1 split step 12 — gemini/operations.ts. |
| `src/services/gemini/parsing.test.ts` | B14-IA | 111 |  | Tests §12.5.1 split step 3 — gemini/parsing.ts. |
| `src/services/gemini/personPlans.test.ts` | B14-IA | 66 |  | Tests §12.5.1 split step 11 — gemini/personPlans.ts. |
| `src/services/gemini/pii.test.ts` | B14-IA | 100 |  | Tests §12.5.1 split step 2 — gemini/pii.ts. |
| `src/services/gemini/risk.test.ts` | B14-IA | 53 |  | Tests §12.5.1 split step 6 — gemini/risk.ts. |
| `src/services/gemini/safetyDocs.test.ts` | B14-IA | 44 |  | Tests §12.5.1 split step 9 — gemini/safetyDocs.ts. |
| `src/services/gemini/suggestions.test.ts` | B14-IA | 26 |  | Tests §12.5.1 split step 7 — gemini/suggestions.ts. |
| `src/services/gemini/vision.test.ts` | B14-IA | 48 |  | Tests §12.5.1 split step 5 — gemini/vision.ts. |
| `src/services/geminiBackend.test.ts` | B14-IA | 911 |  | Unit tests for src/services/geminiBackend.ts. |
| `src/services/geofence/permissionUXDecision.test.ts` | B1-Emergencia | 294 |  |  |
| `src/services/geofence/polygonUtils.test.ts` | B1-Emergencia | 199 |  | Tests §12.6.3 — Geofence polygon utility. |
| `src/services/glossary/glossaryEngine.test.ts` |  | 234 |  |  |
| `src/services/governance/deviationNormalizationRadar.test.ts` |  | 125 |  |  |
| `src/services/hazmat/hazmatExposureCalculator.test.ts` | B10-EPP | 121 |  |  |
| `src/services/hazmat/hazmatExtensions.test.ts` | B10-EPP | 151 |  |  |
| `src/services/hazmat/hazmatInventory.test.ts` | B10-EPP | 115 |  |  |
| `src/services/hazmat/hazmatSegregation.test.ts` | B10-EPP | 129 |  |  |
| `src/services/health/healthConnectAdapter.test.ts` | B7-Salud | 1209 |  | Unit tests for healthConnectAdapter.ts (Block 2 Wave 2). |
| `src/services/health/healthFacade.test.ts` | B7-Salud | 227 |  | TDD on `getHealthAdapter()` — the runtime adapter selection logic. |
| `src/services/health/healthFacadeNative.test.ts` | B7-Salud | 310 |  | Bucket P (Sprint 21 ola 5) — tests for the native health facade. |
| `src/services/health/nativeHealthAdapter.test.ts` | B7-Salud | 311 |  | Sprint 30 Bucket HH — tests for the shift-aware native health adapter. |
| `src/services/health/occupationalContext.test.ts` | B7-Salud | 582 |  | occupationalContext.test.ts — Bucket WW (Sprint 26). |
| `src/services/health/shiftWindow.test.ts` | B7-Salud | 152 |  |  |
| `src/services/health/vaultRecord.test.ts` | B7-Salud | 151 |  | Sprint 26 Bucket VV — vaultRecord CRUD tests. |
| `src/services/health/vaultShare.test.ts` | B7-Salud | 283 |  |  |
| `src/services/heatmap/findingsHeatmapBuilder.test.ts` | B2-RiesgoIPER | 183 |  |  |
| `src/services/hvac/thermalModel.test.ts` |  | 121 |  |  |
| `src/services/hygiene/metabolicRate.test.ts` | B7-Salud | 71 |  |  |
| `src/services/i18n/culturalConventions.test.ts` |  | 133 |  | Sprint 31 Bucket SS — Tests cultural conventions framework. |
| `src/services/identity/rutValidators.test.ts` |  | 231 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/immutable/pdfImmutableService.test.ts` |  | 492 |  |  |
| `src/services/inbox/inboxAggregator.test.ts` | B18-Analitica | 232 |  |  |
| `src/services/incidentBundle/incidentEvidenceBundle.test.ts` | B4-Incidentes | 336 |  |  |
| `src/services/incidents/incidentRagService.report.test.ts` | B4-Incidentes | 403 |  | Sprint 33 wire W4 — reportIncident unit tests. |
| `src/services/incidents/incidentRagService.test.ts` | B4-Incidentes | 155 |  | Sprint 29 Bucket AA F-B — incidentRagService unit tests. |
| `src/services/incidentTrends/trendAnalyzer.test.ts` | B4-Incidentes | 224 |  |  |
| `src/services/industryRules/industryRuleEngine.test.ts` | B5-Cumplimiento | 85 |  |  |
| `src/services/inspections/inspectionOutbox.test.ts` | B9-Inspecciones | 356 |  | Praeventio Guard — Fase F.6 P1 #3 fix tests (PR #322 Codex review). |
| `src/services/inspections/offlineInspectionService.test.ts` | B9-Inspecciones | 217 |  |  |
| `src/services/internalTransit/internalTransitService.test.ts` |  | 181 |  |  |
| `src/services/iot/edgeFilter.phase2.eonet.test.ts` |  | 127 |  | Sprint 39 J3b — Phase 2 packet enrichment with EONET / USGS correlations. |
| `src/services/iot/edgeFilter.test.ts` |  | 191 |  | Sprint 34 — Cobertura del EdgeFilter (2-fase + 90% drop ratio). |
| `src/services/iot/firestoreBridge.test.ts` |  | 138 |  | Sprint 32 Bucket TT — coverage for the MQTT → Firestore bridge. |
| `src/services/iot/mqttClient.test.ts` |  | 871 |  | Praeventio Guard — mqttClient.ts unit tests. |
| `src/services/iot/probabilityFailureScoring.test.ts` |  | 128 |  | Tests para §12.7.4 — IoT failure probability scoring. |
| `src/services/jsa/jobSafetyAnalysis.test.ts` | B2-RiesgoIPER | 374 |  |  |
| `src/services/knowledgeBase/knowledgeBaseService.test.ts` |  | 125 |  |  |
| `src/services/leadership/supervisionDecisionTrail.test.ts` |  | 95 |  |  |
| `src/services/legal/legalRuleEngine.test.ts` |  | 158 |  |  |
| `src/services/legalCalendar/legalObligationsCalendar.test.ts` | B5-Cumplimiento | 139 |  |  |
| `src/services/lessonsLearned/lessonsFirestoreAdapter.test.ts` | B4-Incidentes | 62 |  |  |
| `src/services/lessonsLearned/lessonsLibrary.test.ts` | B4-Incidentes | 114 |  |  |
| `src/services/lineOfFire/lineOfFireChecker.test.ts` |  | 96 |  |  |
| `src/services/loneWorker/loneWorkerService.test.ts` | B1-Emergencia | 130 |  |  |
| `src/services/loneWorker/manDownTimer.test.ts` | B1-Emergencia | 176 |  | Tests §12.6.2 — ManDown timer + escalation. |
| `src/services/loto/lotoDigitalLight.test.ts` | B8-PermisosLOTO | 132 |  |  |
| `src/services/loto/lotoFirestoreAdapter.test.ts` | B8-PermisosLOTO | 75 |  |  |
| `src/services/maintenance/horometerEngine.test.ts` | B10-EPP | 135 |  |  |
| `src/services/maturity/preventionMaturityIndex.test.ts` | B2-RiesgoIPER | 246 |  |  |
| `src/services/mcp/stdioBoot.test.ts` |  | 19 |  |  |
| `src/services/mcp/zettelkastenServer.test.ts` |  | 318 |  |  |
| `src/services/mcp/zettelkastenStdioAdapter.test.ts` |  | 33 |  |  |
| `src/services/measurements/measurementChain.test.ts` |  | 164 |  |  |
| `src/services/medical/aptitudeCertGenerator.test.ts` | B7-Salud | 82 |  | Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Generator tests. |
| `src/services/medical/aptitudeCertSigner.test.ts` | B7-Salud | 166 |  | Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Signer tests. |
| `src/services/medical/bodyRoutineGenerator.test.ts` | B7-Salud | 217 |  | Tests §12.6.5 — Body routine generator. |
| `src/services/medical/iconLibrary.test.ts` | B7-Salud | 70 |  | Sprint 19 — Bucket C / F-C01. |
| `src/services/meetingPack/meetingPackBuilder.test.ts` | B12-CPHS | 243 |  |  |
| `src/services/mentalLoad/mentalLoadTracker.test.ts` | B7-Salud | 119 |  |  |
| `src/services/mesh/fileChunker.test.ts` | B16-Offline | 59 |  | Sprint 26 — fileChunker tests. |
| `src/services/mesh/meshPacket.test.ts` | B16-Offline | 324 |  |  |
| `src/services/mesh/meshRelayQueue.relayXp.test.ts` | B16-Offline | 162 |  | Sprint 32 — verifica que el wire SOS-rebroadcast → awardXp dispara |
| `src/services/mesh/meshRelayQueue.test.ts` | B16-Offline | 265 |  |  |
| `src/services/mesh/meshRequestRouter.test.ts` | B16-Offline | 393 |  | Sprint 26 — MeshRequestRouter tests. |
| `src/services/mesh/transportFacade.test.ts` | B16-Offline | 289 |  | Sprint 30 — TransportFacade tests (ADR 0013, Bucket II). |
| `src/services/microtraining/lightningTrainingService.test.ts` | B6-Capacitacion | 215 |  |  |
| `src/services/microtraining/microtrainingFirestoreAdapter.test.ts` | B6-Capacitacion | 242 |  | Praeventio Guard — MicrotrainingAdapter unit tests. |
| `src/services/migration/registry.test.ts` |  | 99 |  | Praeventio Guard — Sprint 24 differentiators (Bucket MM) tests. |
| `src/services/ml/vertexTrainer.test.ts` |  | 78 |  | Sprint 32 Bucket VV — vertexTrainer stub tests. |
| `src/services/mobile/foregroundServiceClient.test.ts` |  | 192 |  | Smoke tests for `foregroundServiceClient`. |
| `src/services/multiProject/projectComparator.test.ts` | B18-Analitica | 187 |  |  |
| `src/services/multiRoleSummary/roleSummaryComposer.test.ts` | B3-Ergonomia | 175 |  |  |
| `src/services/networkBackend.test.ts` |  | 245 |  | Praeventio Guard — networkBackend.syncNodeToNetwork tests. |
| `src/services/nonConformity/nonConformityEngine.test.ts` | B5-Cumplimiento | 120 |  |  |
| `src/services/normativa/countryPacks.test.ts` |  | 48 |  | Country-pack registry tests. |
| `src/services/normativa/locationNormativa.test.ts` |  | 264 |  | Tests for GPS-based country detection helpers. |
| `src/services/notifications/fcmAdapter.test.ts` |  | 160 |  | Praeventio Guard — FCM (Firebase Cloud Messaging) adapter unit tests. |
| `src/services/observability/observability.test.ts` | B9-Inspecciones | 353 |  | Praeventio Guard — Observability adapter tests. |
| `src/services/observability/piiRedactor.test.ts` | B9-Inspecciones | 137 |  | Praeventio Guard — PII redactor tests. |
| `src/services/observability/quotaTracker.test.ts` | B9-Inspecciones | 283 |  | Praeventio Guard — Sprint 22 prod hardening (Bucket X) tests. |
| `src/services/observability/resilienceHealthMonitor.test.ts` | B7-Salud | 466 |  |  |
| `src/services/observability/sentryAdapter.test.ts` | B9-Inspecciones | 243 |  | Praeventio Guard — Sentry adapter unit tests. |
| `src/services/observability/sentryInstrumentation.test.ts` | B9-Inspecciones | 396 |  | Praeventio Guard — Sentry instrumentation helper tests. |
| `src/services/observability/slos.test.ts` | B9-Inspecciones | 51 |  | Praeventio Guard — Sprint 24 differentiators (Bucket MM.4) tests. |
| `src/services/onboarding/faenaOnboardingBundle.test.ts` | B6-Capacitacion | 149 |  |  |
| `src/services/onboarding/faenaOnboardingFirestoreAdapter.test.ts` | B6-Capacitacion | 91 |  |  |
| `src/services/openapi/specGenerator.test.ts` |  | 108 |  | Sprint 36 — Tests for the auto-OpenAPI spec generator. |
| `src/services/operationalState/faenaStateEngine.test.ts` |  | 92 |  |  |
| `src/services/orchestratorService.test.ts` | B14-IA | 134 |  |  |
| `src/services/organic/crewService.test.ts` | B12-CPHS | 60 |  |  |
| `src/services/organic/processService.test.ts` | B12-CPHS | 137 |  |  |
| `src/services/organic/taskService.test.ts` | B12-CPHS | 54 |  |  |
| `src/services/orgMetrics/organizationalMetrics.test.ts` | B18-Analitica | 148 |  |  |
| `src/services/pdca/pdcaCycle.test.ts` |  | 124 |  |  |
| `src/services/pdca/pdcaCycleEngine.test.ts` |  | 167 |  |  |
| `src/services/photoEvidence/photoEvidenceEngine.test.ts` | B9-Inspecciones | 201 |  |  |
| `src/services/photoEvidence/photoEvidenceFirestoreAdapter.test.ts` | B9-Inspecciones | 318 |  | Praeventio Guard — PhotoEvidenceAdapter unit tests. |
| `src/services/physics/bernoulliEngine.test.ts` |  | 74 |  |  |
| `src/services/pinSign/pinSignService.test.ts` |  | 217 |  | Praeventio Guard — pinSignService unit tests. |
| `src/services/portfolioLessons/portfolioLessonsEngine.test.ts` | B6-Capacitacion | 329 |  | Praeventio Guard — Sprint 53 tests para portfolio lessons transfer engine. |
| `src/services/positiveObservations/positiveObservationsFirestoreAdapter.test.ts` | B9-Inspecciones | 55 |  |  |
| `src/services/positiveObservations/positiveObservationsService.test.ts` | B9-Inspecciones | 78 |  |  |
| `src/services/postTraining/postTrainingAssessmentEngine.test.ts` | B6-Capacitacion | 262 |  |  |
| `src/services/predictiveAlerts/alertScheduler.test.ts` | B18-Analitica | 57 |  |  |
| `src/services/predictiveAlerts/calendarPreWarn.test.ts` | B18-Analitica | 153 |  | Sprint 29 Bucket DD F-E — calendarPreWarn tests. |
| `src/services/predictiveAlerts/windowedTrigger.test.ts` | B18-Analitica | 39 |  |  |
| `src/services/pricing/aiTier.test.ts` | B15-Billing | 171 |  |  |
| `src/services/pricing/eppIndustryCatalog.test.ts` | B15-Billing | 55 |  | Praeventio Guard — Sprint K §171-179 — EPP catalog tests. |
| `src/services/pricing/iapSkus.test.ts` | B15-Billing | 116 |  | §2.13 IAP SKU mapping tests. |
| `src/services/pricing/jurisdictionLimits.test.ts` | B15-Billing | 115 |  | Sprint 31 OO — jurisdictionLimits tests. |
| `src/services/pricing/subscriptionPlan.test.ts` | B15-Billing | 29 |  |  |
| `src/services/pricing/tiers.test.ts` | B15-Billing | 267 |  |  |
| `src/services/pricingCalculator/pricingCalculator.test.ts` | B15-Billing | 159 |  |  |
| `src/services/pricingSimulator/pricingSimulator.test.ts` | B15-Billing | 101 |  |  |
| `src/services/privacy/dpiaTemplate.test.ts` |  | 96 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/registry.test.ts` |  | 255 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacyRetention/dataRetentionPolicy.test.ts` | B5-Cumplimiento | 247 |  |  |
| `src/services/privacyShield/piiClassifier.test.ts` |  | 81 |  |  |
| `src/services/projectClosure/projectClosureService.test.ts` |  | 115 |  |  |
| `src/services/projectComparator/projectComparator.test.ts` | B18-Analitica | 229 |  | Praeventio Guard — Sprint 55 Fase F.27 service tests. |
| `src/services/protocols/iper.test.ts` | B2-RiesgoIPER | 163 |  | IPER tests — Identificación de Peligros y Evaluación de Riesgos. |
| `src/services/protocols/prexor.test.ts` | B3-Ergonomia | 141 |  | PREXOR tests — Protocolo de Exposición Ocupacional al Ruido. |
| `src/services/protocols/tmert.test.ts` | B3-Ergonomia | 115 |  | TMERT tests — Trastornos Musculoesqueléticos (extremidad superior). |
| `src/services/proximitySensor/proximityModeDetector.test.ts` |  | 156 |  |  |
| `src/services/pymeOnboarding/pymeWizard.test.ts` | B6-Capacitacion | 78 |  |  |
| `src/services/pymeWizard/pymeOnboardingWizard.test.ts` | B6-Capacitacion | 85 |  |  |
| `src/services/qrAck/qrAckSessionEngine.test.ts` | B9-Inspecciones | 392 |  |  |
| `src/services/qrSignature/qrSignatureService.test.ts` | B9-Inspecciones | 243 |  |  |
| `src/services/raciMatrix/raciMatrix.test.ts` | B12-CPHS | 437 |  |  |
| `src/services/rag/safeNormativeQuery.test.ts` | B14-IA | 197 |  | Praeventio Guard — safeNormativeQuery unit tests. |
| `src/services/ragService.test.ts` |  | 628 |  | Praeventio Guard — ragService unit tests. |
| `src/services/readReceipts/readReceiptService.test.ts` |  | 146 |  |  |
| `src/services/refuges/mountainRefuges.test.ts` | B1-Emergencia | 158 |  |  |
| `src/services/regulatory/jurisdictionRegistry.test.ts` | B5-Cumplimiento | 223 |  | Sprint 48 E.4 — Tests del jurisdictionRegistry (perfiles UK/CA/AU/JP/KR/IN). |
| `src/services/regulatory/jurisdictions.test.ts` | B5-Cumplimiento | 526 |  | Sprint 29 Bucket EE — Tests UK/CA/AU jurisdictions. |
| `src/services/regulatory/privacyRegimeRegistry.test.ts` | B5-Cumplimiento | 167 |  | Sprint 48 E.4 — Tests del privacyRegimeRegistry. |
| `src/services/regulatory/registry.test.ts` | B5-Cumplimiento | 206 |  | Sprint 28 Bucket B1 — Regulatory registry tests. |
| `src/services/reportsAutomation/reportsAutomation.test.ts` | B18-Analitica | 101 |  |  |
| `src/services/reputationalAlerts/reputationalAlertEngine.test.ts` |  | 184 |  |  |
| `src/services/researchMode/researchMode.test.ts` | B14-IA | 97 |  |  |
| `src/services/residualRisk/residualRiskEngine.test.ts` | B2-RiesgoIPER | 178 |  |  |
| `src/services/retaliationProtection/retaliationDetector.test.ts` |  | 83 |  |  |
| `src/services/returnToWork/returnToWorkPlanner.test.ts` |  | 244 |  |  |
| `src/services/riskRadar/repeatingRiskRadar.test.ts` | B2-RiesgoIPER | 359 |  |  |
| `src/services/riskRanking/riskRankingEngine.test.ts` | B2-RiesgoIPER | 144 |  |  |
| `src/services/roiScenario/roiScenarioSimulator.test.ts` |  | 510 |  |  |
| `src/services/roleOnboarding/roleOnboardingTracks.test.ts` | B6-Capacitacion | 310 |  |  |
| `src/services/roleViews/roleViewBuilder.test.ts` |  | 128 |  |  |
| `src/services/rootCause/noBlameInvestigation.test.ts` | B4-Incidentes | 207 |  |  |
| `src/services/rootCause/rootCauseClassifier.test.ts` | B4-Incidentes | 121 |  |  |
| `src/services/rootCause/rootCauseStore.firestore.test.ts` | B4-Incidentes | 132 |  | Praeventio Guard — Plan 2026-05-23 Fase C.3. |
| `src/services/rootCauseInvestigation/investigationMode.test.ts` | B4-Incidentes | 166 |  |  |
| `src/services/routeScoring/criticalRouteScoring.test.ts` |  | 204 |  |  |
| `src/services/routeScoring/driverRouteMatcher.test.ts` |  | 244 |  |  |
| `src/services/routing/gridAStar.test.ts` |  | 113 |  | Tests para A* real sobre grilla. Cierra Codex fake fix §2.3. |
| `src/services/routing/routeClimateAssessment.test.ts` |  | 311 |  |  |
| `src/services/routingBackend.test.ts` |  | 217 |  |  |
| `src/services/safety/ergonomicAssessments.legalTrigger.test.ts` | B3-Ergonomia | 167 |  | Tests for the DS-594 art. 110 legal-threshold trigger wired into |
| `src/services/safety/ergonomicAssessments.test.ts` | B3-Ergonomia | 517 |  | Tests for the Firestore writer wrapping REBA/RULA assessment persistence. |
| `src/services/safety/ergonomicAssessments.xpHook.test.ts` | B3-Ergonomia | 88 |  | Sprint 32 wire W4 — verifica que recordErgonomicAssessment invoca |
| `src/services/safety/iperAssessments.test.ts` |  | 503 |  | Tests for the Firestore writer wrapping IPER matrix assessment persistence. |
| `src/services/safetyMetrics/osha.test.ts` | B18-Analitica | 183 |  |  |
| `src/services/safetyPerformance/safetyPerformanceIndex.test.ts` | B18-Analitica | 122 |  |  |
| `src/services/safetyTalks/talkTopicSuggester.test.ts` | B6-Capacitacion | 95 |  |  |
| `src/services/scheduler/distributedLease.test.ts` |  | 193 |  | Sprint 35 — distributedLease tests. |
| `src/services/security/browserEnvelope.test.ts` |  | 235 |  |  |
| `src/services/security/cloudKmsAdapter.test.ts` |  | 138 |  | Smoke tests for the production cloud-kms adapter. |
| `src/services/security/deviceKek.test.ts` |  | 190 |  |  |
| `src/services/security/encryptedKvStore.test.ts` |  | 203 |  |  |
| `src/services/security/kekRotationOrchestrator.test.ts` | B14-IA | 457 |  |  |
| `src/services/security/kmsEnvelope.test.ts` |  | 185 |  |  |
| `src/services/sensorBus/sensorBus.test.ts` | B16-Offline | 200 |  | Praeventio Guard — sensorBus unit tests (TODO.md §12.2.1). |
| `src/services/shiftHandover/shiftHandoverFirestoreAdapter.test.ts` | B13-MOC | 81 |  |  |
| `src/services/shiftHandover/shiftHandoverInsights.test.ts` | B13-MOC | 113 |  |  |
| `src/services/shiftHandover/shiftHandoverService.test.ts` | B13-MOC | 241 |  |  |
| `src/services/shiftRiskPanel/preShiftRiskComposer.test.ts` | B3-Ergonomia | 256 |  |  |
| `src/services/sif/sifFirestoreAdapter.test.ts` |  | 76 |  |  |
| `src/services/sif/sifPrecursorClassifier.test.ts` |  | 152 |  |  |
| `src/services/signaletics/signageValidator.test.ts` | B10-EPP | 217 |  |  |
| `src/services/sii/bsaleAdapter.test.ts` | B5-Cumplimiento | 361 |  | Praeventio Guard — Bsale adapter tests (Sprint 23 Bucket GG). |
| `src/services/sii/dteGenerator.test.ts` | B5-Cumplimiento | 123 |  | Praeventio Guard — dteGenerator unit tests. |
| `src/services/sii/dteSigner.test.ts` | B5-Cumplimiento | 209 |  | Praeventio Guard — dteSigner unit tests. |
| `src/services/sii/siiAdapter.test.ts` | B5-Cumplimiento | 283 |  | Praeventio Guard — SII adapter tests. |
| `src/services/sii/siiPreflightCheck.test.ts` | B5-Cumplimiento | 362 |  | Praeventio Guard — SII pre-flight checks tests. Sprint 50, E.5 P2 H5. |
| `src/services/sii/susesoApiClient.test.ts` | B5-Cumplimiento | 185 |  | Praeventio Guard — SUSESO API client tests. |
| `src/services/siteBook/siteBookCounter.firestore.test.ts` | B9-Inspecciones | 68 |  | Praeventio Guard — Plan 2026-05-23 Fase C.3. |
| `src/services/siteBook/siteBookCrdt.test.ts` | B9-Inspecciones | 389 |  |  |
| `src/services/siteBook/siteBookFirestoreAdapter.test.ts` | B9-Inspecciones | 461 |  |  |
| `src/services/siteBook/siteBookService.test.ts` | B9-Inspecciones | 213 |  |  |
| `src/services/siteBook/siteBookSigning.test.ts` | B9-Inspecciones | 216 |  | Praeventio Guard — Plan 2026-05-24 §D.X tests for SiteBook signing. |
| `src/services/siteBook/siteBookSigningClient.test.ts` | B9-Inspecciones | 245 |  | Praeventio Guard — Plan 2026-05-24 §D.X — client orchestrator tests. |
| `src/services/skillGap/skillGapAnalyzer.test.ts` | B6-Capacitacion | 250 |  |  |
| `src/services/slm/cache/modelCache.test.ts` | B14-IA | 108 |  | Tests for the IndexedDB-backed SLM model cache (Fase 1 T-1.2). |
| `src/services/slm/encryptedOfflineQueue.test.ts` | B14-IA | 509 |  | Tests for `encryptedOfflineQueue.ts`. |
| `src/services/slm/guardianOffline.test.ts` | B14-IA | 341 |  | Tests for GuardianOfflineService — Sprint 26 Bucket ZZ. |
| `src/services/slm/hmac.test.ts` | B14-IA | 173 |  | Tests for the per-session HMAC primitives (Sprint 20 ninth wave, |
| `src/services/slm/loader.test.ts` | B14-IA | 177 |  | Tests for the cache-aware SLM model loader (Fase 1 T-1.2). |
| `src/services/slm/offlineQueue.test.ts` | B14-IA | 536 |  | Tests for the IndexedDB-backed offline session queue (Fase 1 T-1.4). |
| `src/services/slm/onnxAdapter.test.ts` | B14-IA | 503 |  | Tests for the ONNX Runtime Web direct adapter (Brecha B, Bucket O). |
| `src/services/slm/orchestrator.test.ts` | B14-IA | 461 |  | Tests for the online/offline orchestrator (Fase 1 T-1.4). |
| `src/services/slm/reconciliation.test.ts` | B14-IA | 349 |  | Tests for the offline → Zettelkasten reconciliation service (Fase 1 T-1.4). |
| `src/services/slm/reconciliationAutoTrigger.test.ts` | B14-IA | 330 |  | Service-level tests for `reconciliationAutoTrigger.ts`. |
| `src/services/slm/reconciliationRunner.test.ts` | B14-IA | 151 |  | Tests for `reconciliationRunner.ts` — the wiring layer between |
| `src/services/slm/registry.test.ts` | B14-IA | 228 |  |  |
| `src/services/slm/sampling.test.ts` | B14-IA | 212 |  | Tests for the SLM sampling primitives (Brecha B — Sprint 23 Bucket DD). |
| `src/services/slm/slmAcquisitionService.test.ts` | B14-IA | 203 |  |  |
| `src/services/slm/slmAdapter.test.ts` | B14-IA | 154 |  | Tests for the SLM main-thread facade (Fase 1 T-1.4). |
| `src/services/slm/slmIntegrityCheck.test.ts` | B14-IA | 175 |  |  |
| `src/services/slm/slmIntegrityGuard.test.ts` | B14-IA | 209 |  | Tests for `slmIntegrityGuard.ts` — SHA-256 motor + SlmIntegrityError. |
| `src/services/slm/slmRuntime.offline.test.ts` | B14-IA | 659 |  | Offline contract tests for `slmRuntime.ts`. |
| `src/services/slm/slmRuntime.test.ts` | B14-IA | 708 |  | Tests for `slmRuntime.ts` — the C.9 ONNX runtime wrapper. |
| `src/services/slm/worker/slmRuntimeWorkerCore.test.ts` | B14-IA | 505 |  |  |
| `src/services/slm/worker/slmRuntimeWorkerProxy.test.ts` | B14-IA | 416 |  |  |
| `src/services/slm/worker/slmWorker.test.ts` | B14-IA | 129 |  | Smoke tests for the slmWorker tokenizer wiring (Sprint 20 fifth wave, |
| `src/services/socialRecognition/wallEngine.test.ts` |  | 210 |  | Tests §12.7.3 — Reconocimiento social Muro Dinámico. |
| `src/services/softBlocking/requirementGate.test.ts` | B8-PermisosLOTO | 206 |  |  |
| `src/services/spacedRepetition/spacedRepetitionScheduler.test.ts` | B6-Capacitacion | 87 |  |  |
| `src/services/stoppage/stoppageEngine.test.ts` | B8-PermisosLOTO | 165 |  |  |
| `src/services/stoppage/stoppageFirestoreAdapter.test.ts` | B8-PermisosLOTO | 58 |  |  |
| `src/services/suppliers/supplierQualityService.test.ts` |  | 123 |  |  |
| `src/services/suppliers/supplierScoring.test.ts` |  | 88 |  |  |
| `src/services/suseso/cumplimientoCalculator.test.ts` | B5-Cumplimiento | 255 |  | Praeventio Guard — Tests Dashboard Cumplimiento SUSESO (§12.7.5) |
| `src/services/suseso/diatPdfRenderer.test.ts` | B5-Cumplimiento | 129 |  |  |
| `src/services/suseso/folioGenerator.test.ts` | B5-Cumplimiento | 188 |  | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/services/suseso/monthlyReport.test.ts` | B5-Cumplimiento | 235 |  | Praeventio Guard — Tests §12.7.6 Reportes mensuales SUSESO. |
| `src/services/suseso/reminders.test.ts` | B5-Cumplimiento | 104 |  | Praeventio Guard — Sprint 28 follow-up. |
| `src/services/suseso/susesoServerOnlyHelpers.test.ts` | B5-Cumplimiento | 104 |  | Praeventio Guard — Sprint 49 D.8.a tests for susesoServerOnlyHelpers. |
| `src/services/suseso/susesoService.test.ts` | B5-Cumplimiento | 308 |  | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/services/sync/conflictQueue.test.ts` | B16-Offline | 218 |  | Praeventio Guard — conflictQueue unit tests. |
| `src/services/sync/conflictResolver.test.ts` |  | 160 |  | Sprint 34 — Tests for the per-field conflict resolver. |
| `src/services/sync/encryptedOutboxAdapter.test.ts` |  | 276 |  |  |
| `src/services/sync/genericOutboxEngine.test.ts` |  | 377 |  |  |
| `src/services/sync/monotonicSync.test.ts` |  | 92 |  |  |
| `src/services/sync/syncStateMachine.test.ts` |  | 217 |  | Sprint 25 Bucket QQ — Tests for OfflineSyncStateMachine. |
| `src/services/sync/topologyAwarePrefetch.test.ts` |  | 246 |  |  |
| `src/services/syncManager.test.ts` |  | 218 |  |  |
| `src/services/syncStatus/syncQueueTracker.test.ts` | B16-Offline | 173 |  |  |
| `src/services/systemEngine/__tests__/decisionEngine.test.ts` |  | 97 |  |  |
| `src/services/systemEngine/__tests__/eventTypes.test.ts` |  | 88 |  |  |
| `src/services/systemEngine/__tests__/executor.test.ts` |  | 89 |  |  |
| `src/services/systemEngine/__tests__/policies-registry.test.ts` |  | 49 |  |  |
| `src/services/systemEngine/__tests__/policies/geofenceToSos.test.ts` | B1-Emergencia | 70 |  |  |
| `src/services/systemEngine/__tests__/policies/tierChangeReactivity.test.ts` |  | 46 |  |  |
| `src/services/systemEngine/__tests__/zettelkasten-healthEvent.test.ts` | B7-Salud | 71 |  |  |
| `src/services/telemetry/aggregator.test.ts` | B7-Salud | 189 |  |  |
| `src/services/telemetry/eventCollector.test.ts` | B7-Salud | 240 |  | Praeventio Guard — telemetry eventCollector unit tests. |
| `src/services/upsell/painBasedUpsellSuggester.test.ts` |  | 77 |  |  |
| `src/services/uxModes/uxModeAdapter.test.ts` |  | 181 |  |  |
| `src/services/vendorOnboarding/vendorAccreditationTracker.test.ts` | B6-Capacitacion | 155 |  |  |
| `src/services/vendorOnboarding/vendorOnboardingFlow.test.ts` | B6-Capacitacion | 274 |  |  |
| `src/services/visitorControl/visitorRegistry.test.ts` | B11-Contratistas | 174 |  | Praeventio Guard — Sprint K §23-24 unit tests for visitorRegistry. |
| `src/services/visitors/visitorAccessService.test.ts` | B11-Contratistas | 156 |  |  |
| `src/services/visitors/visitorFirestoreAdapter.test.ts` | B11-Contratistas | 67 |  |  |
| `src/services/vulnerability/operationalVulnerabilityMap.test.ts` |  | 185 |  |  |
| `src/services/vulnerability/vulnerabilityFirestoreAdapter.test.ts` |  | 48 |  |  |
| `src/services/workerHistory/portableHistoryExporter.test.ts` | B18-Analitica | 287 |  |  |
| `src/services/workerReadiness/readinessScore.test.ts` |  | 222 |  |  |
| `src/services/workPermits/criticalPermitValidators.test.ts` | B8-PermisosLOTO | 346 |  |  |
| `src/services/workPermits/excavationPermitExtension.test.ts` | B8-PermisosLOTO | 85 |  |  |
| `src/services/workPermits/liftingPermitExtension.test.ts` | B8-PermisosLOTO | 69 |  |  |
| `src/services/workPermits/permitLifecycleAdvisor.test.ts` | B8-PermisosLOTO | 230 |  |  |
| `src/services/workPermits/workPermitEngine.test.ts` | B8-PermisosLOTO | 263 |  |  |
| `src/services/workPermits/workPermitFirestoreAdapter.test.ts` | B8-PermisosLOTO | 236 |  |  |
| `src/services/zettelkasten/backlinks.test.ts` |  | 206 |  | Tests §ZK-1 — Backlinks bidireccionales (agregador estructurado). |
| `src/services/zettelkasten/bernoulli/confinedSpaceHVAC.test.ts` |  | 24 |  |  |
| `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.test.ts` |  | 30 |  |  |
| `src/services/zettelkasten/bernoulli/gasDispersionCloud.test.ts` |  | 24 |  |  |
| `src/services/zettelkasten/bernoulli/gasLeakDetection.test.ts` |  | 25 |  |  |
| `src/services/zettelkasten/bernoulli/hazmatPipePressure.test.ts` | B10-EPP | 25 |  |  |
| `src/services/zettelkasten/bernoulli/hidranteFireNetwork.test.ts` |  | 25 |  |  |
| `src/services/zettelkasten/bernoulli/microWindEnergy.test.ts` |  | 22 |  |  |
| `src/services/zettelkasten/bernoulli/miningVenturi.test.ts` |  | 22 |  |  |
| `src/services/zettelkasten/bernoulli/mistingDustSuppression.test.ts` |  | 26 |  |  |
| `src/services/zettelkasten/bernoulli/pulmonaryAltitude.test.ts` |  | 24 |  |  |
| `src/services/zettelkasten/bernoulli/respiratorFatigue.test.ts` | B7-Salud | 25 |  |  |
| `src/services/zettelkasten/bernoulli/scaffoldWindSuction.test.ts` |  | 25 |  |  |
| `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.test.ts` |  | 22 |  |  |
| `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.test.ts` |  | 24 |  |  |
| `src/services/zettelkasten/bernoulli/structuralWindLoad.test.ts` |  | 24 |  |  |
| `src/services/zettelkasten/canonical/materializer.test.ts` |  | 224 |  |  |
| `src/services/zettelkasten/centrality.test.ts` |  | 114 |  | Praeventio Guard — §ZK-6 centrality metrics tests. |
| `src/services/zettelkasten/climateRiskCoupling.eonet.test.ts` |  | 118 |  | Sprint 39 J3a — climateRiskCoupling EONET integration tests. |
| `src/services/zettelkasten/climateRiskCoupling.test.ts` |  | 242 |  |  |
| `src/services/zettelkasten/contextualActions.test.ts` |  | 142 |  | Tests §12.7.2 — Contextual actions nodos grafo. |
| `src/services/zettelkasten/edges.test.ts` |  | 253 |  |  |
| `src/services/zettelkasten/families/registries.test.ts` |  | 96 |  | Integrity tests for the 8 family registries. |
| `src/services/zettelkasten/flows/eppInventoryPurchaseFlow.test.ts` | B10-EPP | 494 |  | Praeventio Guard — Bloque 4.2: eppInventoryPurchaseFlow coverage. |
| `src/services/zettelkasten/flows/horometroMaintenanceFlow.test.ts` | B10-EPP | 502 |  | Praeventio Guard — Bloque 4.1: end-to-end tests for the horometro |
| `src/services/zettelkasten/flows/incidentLessonTrainingFlow.test.ts` | B4-Incidentes | 579 |  | Praeventio Guard — Bloque 4.3 incidentLessonTrainingFlow coverage. |
| `src/services/zettelkasten/incidentPostmortem.test.ts` | B4-Incidentes | 288 |  | Sprint 34 — incidentPostmortem coverage. |
| `src/services/zettelkasten/persistence/writeNode.test.ts` |  | 225 |  | Praeventio Guard — Sprint 11 (writeNode coverage). |
| `src/services/zettelkasten/resilientRetrieval.test.ts` |  | 295 |  |  |
| `src/services/zettelkasten/riskOrchestrator.test.ts` | B14-IA | 119 |  |  |
| `src/services/zettelkasten/smartActions.test.ts` |  | 207 |  | Tests §12.1.6 — Smart actions ZK. |
| `src/services/zones/restrictedZonesEngine.test.ts` | B1-Emergencia | 113 |  |  |
| `src/smoke.test.ts` |  | 15 |  |  |
| `src/store/eventBus.test.ts` |  | 90 |  |  |
| `src/test/fakeFirestore.ts` |  | 188 |  | Praeventio Guard — Sprint 39 Persistence Layer: fake Firestore for tests. |
| `src/test/firestore-emulator-setup.ts` |  | 102 |  | Praeventio Guard — Plan 2026-05-23 Fase C.1. |
| `src/test/setup.ts` |  | 112 |  | Vitest setup file — loaded for every test, regardless of environment. |
| `src/types/roles.test.ts` |  | 91 |  |  |
| `src/utils/aptitudeCertificate.test.ts` | B7-Salud | 316 |  | Praeventio Guard — Aptitude Certificate PDF generator tests. |
| `src/utils/deterministicRandom.test.ts` |  | 122 |  |  |
| `src/utils/ds109Certificate.test.ts` |  | 187 |  | Praeventio Guard — DS 109 PDF generator tests. |
| `src/utils/ds67Notification.test.ts` |  | 153 |  | Praeventio Guard — DS 67 PDF generator tests. |
| `src/utils/ds76MiningContractor.test.ts` | B11-Contratistas | 128 |  | Praeventio Guard — DS 76 PDF generator tests. |
| `src/utils/haversine.test.ts` |  | 57 |  |  |
| `src/utils/offlineStorage.test.ts` | B16-Offline | 567 |  | Unit tests for src/utils/offlineStorage.ts (web/IDB path). |
| `src/utils/pricingOcPdf.test.ts` | B15-Billing | 83 |  | Smoke tests para generatePricingOcPdf (H21 cierre Fase A.3, 2026-05-21). |
| `src/utils/pwa-offline.test.ts` | B16-Offline | 181 |  |  |
| `src/utils/randomId.test.ts` |  | 90 |  | Tests for the shared `randomId()` helper. |
| `src/utils/rut.test.ts` |  | 131 |  | Praeventio Guard — Chilean RUT validator unit tests. |
| `src/utils/sqliteEncryption.test.ts` | B16-Offline | 90 |  | Praeventio Guard — P0 security fix tests (SQLite mobile encryption). |
| `src/utils/susesoCertificate.test.ts` | B5-Cumplimiento | 105 |  | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/workers/forceGraphWorker.test.ts` |  | 104 |  | Unit tests for the forceGraphWorker (Sprint 29 Bucket BB — H22). |
| `tests/dr/dr-runbook-dryrun.spec.ts` |  | 253 |  | Praeventio Guard — Sprint 35 DR dry-run. |
| `tests/dr/seed-dr-dataset.cjs` |  | 233 |  | Praeventio Guard — Sprint 35 DR dry-run. |
| `tests/e2e/accessibility.spec.ts` |  | 177 |  |  |
| `tests/e2e/fall-detection-toggle.spec.ts` |  | 64 |  |  |
| `tests/e2e/fixtures/auth.ts` | B17-Admin | 276 |  | _exports:_ TestUser, DEFAULT_TEST_USER, buildE2EAuthHeader, loginAsTestUser, signInBrowserViaCustomToken |
| `tests/e2e/fixtures/seed.ts` |  | 113 |  | Praeventio Guard — Sprint 19 / F-B03. |
| `tests/e2e/fixtures/server.ts` |  | 122 |  | Praeventio Guard — Sprint 19 / F-B02. |
| `tests/e2e/landing-i18n.spec.ts` |  | 78 |  |  |
| `tests/e2e/landing.spec.ts` |  | 102 |  |  |
| `tests/e2e/offline-resilience.spec.ts` | B16-Offline | 66 |  |  |
| `tests/e2e/process-lifecycle.spec.ts` |  | 73 |  |  |
| `tests/e2e/sos-button.spec.ts` | B1-Emergencia | 102 |  |  |
| `tests/e2e/sw-models-cache.spec.ts` |  | 201 |  |  |
