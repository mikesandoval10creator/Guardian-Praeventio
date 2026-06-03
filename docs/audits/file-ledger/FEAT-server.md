# File ledger — FEAT-server (244 files)

Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.

| Archivo | Bloque | LOC | Test | Propósito / exports |
|---|---|---:|:--:|---|
| `server.ts` |  | 1501 |  |  |
| `src/server/auth/webauthnAssertion.ts` | B17-Admin | 217 | ✓ | Praeventio Guard — WebAuthn assertion verification helper (reusable). |
| `src/server/jobs/aggregateAiFeedback.ts` | B14-IA | 125 |  | Sprint 32 Bucket UU — Weekly RLHF feedback aggregation cron. |
| `src/server/jobs/checkExpiredPpe.ts` |  | 213 | ✓ | Sprint 28 H26 — EPP expiry reaper. |
| `src/server/jobs/checkOverdueMaintenance.ts` | B10-EPP | 141 | ✓ | Bucket K.3 — Overdue maintenance reaper. |
| `src/server/jobs/consolidateZettelkasten.ts` |  | 194 | ✓ | SystemEngine — Zettelkasten consolidation migration. |
| `src/server/jobs/dailyClimateRiskScan.ts` |  | 296 | ✓ | Sprint 25 Bucket TT — Daily Climate Risk Scan Orchestrator. |
| `src/server/jobs/firestoreCriticalReplicate.ts` |  | 185 | ✓ | Bucket W.5 — Hourly write-through replica for critical Firestore data. |
| `src/server/jobs/runB2dMrrSnapshot.ts` |  | 191 | ✓ | runB2dMrrSnapshot — toma una "foto" mensual de los métricos B2D y la |
| `src/server/jobs/runConsistencyAudit.ts` |  | 196 | ✓ | Praeventio Guard — Sprint 39 Fase G.3 follow-up: cron consistency audit. |
| `src/server/jobs/runExceptionAutoExpire.ts` | B8-PermisosLOTO | 98 | ✓ | Praeventio Guard — Sprint 39: Auto-expire de excepciones. |
| `src/server/jobs/runLegalCalendarReminders.ts` | B5-Cumplimiento | 144 | ✓ | Praeventio Guard — Sprint 39: Cron legal calendar reminders. |
| `src/server/jobs/runLoneWorkerEscalation.ts` | B1-Emergencia | 156 | ✓ | Praeventio Guard — Sprint 39: Lone worker auto-escalation cron. |
| `src/server/jobs/runResilienceHealthAlert.ts` | B7-Salud | 171 | ✓ | Praeventio Guard — Sprint 40: Resilience health alert cron. |
| `src/server/jobs/runWorkPermitAutoExpire.ts` | B8-PermisosLOTO | 95 | ✓ | Praeventio Guard — Sprint 39: Auto-expire de work_permits vencidos. |
| `src/server/jobs/sendSusesoReminders.ts` | B5-Cumplimiento | 306 | ✓ | Sprint 28 follow-up — SUSESO DIAT/DIEP deadline reminder reaper. |
| `src/server/jobs/weeklyDigest.ts` |  | 364 |  | Praeventio Guard — Sprint 22 (Bucket Y). |
| `src/server/kmsPreflight.ts` |  | 47 | ✓ | _exports:_ KmsBootConfigResult, validateKmsBootConfig |
| `src/server/mcp/zkFirebaseReadAdapter.ts` | B3-Ergonomia | 194 | ✓ | Firebase Admin SDK implementation of `ZkReadAdapter` for the MCP |
| `src/server/middleware/assertProjectMemberMiddleware.ts` |  | 96 |  | Praeventio Guard — Round 16 R5 Phase 1 split. |
| `src/server/middleware/auditLog.ts` | B17-Admin | 95 |  | Praeventio Guard — Round 17 R1. |
| `src/server/middleware/b2dAuth.ts` |  | 109 | ✓ | Sprint 23 Bucket BB — B2D API authentication middleware. |
| `src/server/middleware/canonicalBody.ts` |  | 128 | ✓ | Praeventio Guard — Round 18 R6 (R6→R17 MEDIUM #2): RFC 8785 canonical |
| `src/server/middleware/captureRouteError.ts` |  | 55 | ✓ | _exports:_ captureRouteError |
| `src/server/middleware/geminiCircuit.ts` | B14-IA | 151 | ✓ | Praeventio Guard — Sprint 22 prod hardening (Bucket X). |
| `src/server/middleware/idempotencyKey.ts` |  | 370 | ✓ | Praeventio Guard — Sprint 35 Bucket (Audit P1 §1.3). |
| `src/server/middleware/largeBodyJson.ts` |  | 19 |  | Praeventio Guard — Round 16 R5 Phase 1 split. |
| `src/server/middleware/limiters.ts` |  | 305 |  | Praeventio Guard — Round 16 R5 Phase 1 split. |
| `src/server/middleware/safeSecretEqual.ts` |  | 35 |  | Praeventio Guard — Round 16 R5 Phase 1 split. |
| `src/server/middleware/securityHeaders.ts` |  | 231 | ✓ | _exports:_ securityHeaders, __cspStaticDirectivesForTests, __buildCspStringForTests, __generateNonceForTests, __connectSrcOriginsForTests, __scriptSrcFallbackOriginsForTests |
| `src/server/middleware/stampCspNonce.ts` |  | 35 | ✓ | Praeventio Guard — Plan v2 F8 / Audit H16 (P3). |
| `src/server/middleware/validate.ts` |  | 81 | ✓ | Praeventio Guard — Sprint 28 Bucket B3. |
| `src/server/middleware/verifyAuth.ts` | B17-Admin | 179 | ✓ | Praeventio Guard — Round 16 R5 Phase 1 split + Sprint 19 F-B05. |
| `src/server/middleware/verifySchedulerToken.ts` |  | 48 | ✓ | Sprint 27 (audit P0 H14) — gate Cloud Scheduler endpoints. |
| `src/server/middleware/verifyTwinStepUp.ts` |  | 194 | ✓ | Sprint 26 — Bucket YY.3 — server-side enforcement del ADR 0011 triple-gate. |
| `src/server/rateLimit/firestoreRateLimitStore.ts` |  | 257 | ✓ | Praeventio Guard — Firestore-backed rate limit store para express-rate-limit. |
| `src/server/routes/admin.ts` | B17-Admin | 705 |  | Praeventio Guard — Round 16 R5 Phase 1 split. |
| `src/server/routes/adminBurden.ts` |  | 145 | ✓ | Praeventio Guard — Admin Burden + Automation Suggester HTTP surface. |
| `src/server/routes/adminJobs.ts` |  | 56 |  | Sprint 35 audit P1 §1.3 — Cloud Scheduler entrypoints for batch |
| `src/server/routes/adoption.ts` |  | 209 | ✓ | Praeventio Guard — Product Adoption Analytics HTTP surface. |
| `src/server/routes/agenda.ts` | B12-CPHS | 248 | ✓ | Praeventio Guard — Agenda + Focus Blocks + Reminders + Digests HTTP surface. |
| `src/server/routes/aggregateTelemetry.ts` | B7-Salud | 178 | ✓ | Praeventio Guard — Sprint 41 F.30 HTTP surface. |
| `src/server/routes/aiFeedback.ts` | B14-IA | 339 |  | Sprint 32 Bucket UU — RLHF feedback loop API. |
| `src/server/routes/aiGuardrails.ts` | B14-IA | 339 | ✓ | Praeventio Guard — AI Guardrails HTTP surface. |
| `src/server/routes/aiQuality.ts` | B14-IA | 334 | ✓ | Praeventio Guard — AI Quality Audit HTTP surface. |
| `src/server/routes/aiToggle.ts` | B14-IA | 154 | ✓ | Praeventio Guard — AI Toggle HTTP surface. |
| `src/server/routes/annualReview.ts` |  | 462 | ✓ | Praeventio Guard — §291-295 Revisión Anual del SGI (ISO 45001 §9.3). |
| `src/server/routes/apprenticeship.ts` | B6-Capacitacion | 505 | ✓ | Praeventio Guard — §244-250 Aprendices + Mentoría + Autorización Progresiva. |
| `src/server/routes/audit.ts` |  | 187 |  | Praeventio Guard — Round 16 R5 Phase 1 split. |
| `src/server/routes/auditChain.ts` | B17-Admin | 204 | ✓ | Praeventio Guard — Tamper-Proof Audit Hash Chain HTTP surface. |
| `src/server/routes/auditPortal.ts` | B17-Admin | 313 | ✓ | Praeventio Guard — External Audit Portal HTTP surface. |
| `src/server/routes/b2d/climate.ts` |  | 220 | ✓ | Sprint 23 Bucket BB.3 — B2D Climate API. |
| `src/server/routes/b2d/hazmat.ts` | B10-EPP | 210 | ✓ | Sprint 23 Bucket BB.4 — B2D Hazmat / engineering calculations API. |
| `src/server/routes/b2d/index.ts` |  | 36 |  | Sprint 23 Bucket BB — B2D API parent router. |
| `src/server/routes/b2d/normativa.ts` |  | 144 | ✓ | Sprint 23 Bucket BB.5 — B2D Normativa API. |
| `src/server/routes/b2d/suite.ts` |  | 300 | ✓ | Sprint 23 Bucket BB.6 — B2D Suite tier API. |
| `src/server/routes/b2dAdmin.ts` |  | 320 |  | Praeventio Guard — Bucket CC: B2D admin endpoints (Sprint 23). |
| `src/server/routes/bbs.ts` | B9-Inspecciones | 171 | ✓ | Praeventio Guard — Behavior-Based Safety (BBS) HTTP surface. |
| `src/server/routes/bcn.ts` |  | 140 |  | Praeventio Guard — BCN snapshot endpoint. |
| `src/server/routes/billing.ts` | B15-Billing | 2078 |  | Praeventio Guard — Round 17 R2 Phase 2 split. |
| `src/server/routes/billing/pricing.ts` | B15-Billing | 54 |  | Praeventio Guard — billing tier pricing constants + validation. |
| `src/server/routes/bowtie.ts` | B2-RiesgoIPER | 238 | ✓ | Praeventio Guard — Bowtie Risk Analysis HTTP surface. |
| `src/server/routes/cad.ts` |  | 116 | ✓ | Sprint 17a (initial stub) → Sprint 21 Bucket Q (LibreDWG Cloud Function proxy). |
| `src/server/routes/changeMgmt.ts` | B13-MOC | 249 | ✓ | Praeventio Guard — Operational Change (MOC) HTTP surface. |
| `src/server/routes/checklistBuilder.ts` | B9-Inspecciones | 232 | ✓ | Praeventio Guard — Checklist Builder HTTP surface. |
| `src/server/routes/circadian.ts` | B7-Salud | 153 | ✓ | Praeventio Guard — Circadian Rhythm + Alertness HTTP surface. |
| `src/server/routes/climateAwareScheduling.ts` |  | 144 | ✓ | Praeventio Guard — Climate-aware scheduling HTTP surface. |
| `src/server/routes/coachRag.ts` | B14-IA | 150 | ✓ | Praeventio Guard — Coach IA RAG HTTP surface. |
| `src/server/routes/comms.ts` | B1-Emergencia | 253 | ✓ | Praeventio Guard — Communication Map HTTP surface. |
| `src/server/routes/commsDrill.ts` | B1-Emergencia | 229 | ✓ | Praeventio Guard — Emergency Comms Drill HTTP surface. |
| `src/server/routes/commute.ts` | B13-MOC | 263 |  | Praeventio Guard — Sprint 12. |
| `src/server/routes/compliance.ts` | B5-Cumplimiento | 332 |  | Praeventio Guard — Sprint 23 Bucket FF. |
| `src/server/routes/complianceEmit.ts` | B5-Cumplimiento | 176 |  | Praeventio Guard — Sprint 38 (CL adapter consolidation). |
| `src/server/routes/confidentialReports.ts` | B18-Analitica | 536 | ✓ | Praeventio Guard — §211-213 Reportes Confidenciales / Ley Karin 21.643. |
| `src/server/routes/consistency.ts` |  | 169 | ✓ | Praeventio Guard — Cross-module consistency auditor HTTP surface. |
| `src/server/routes/consultativeSale.ts` | B11-Contratistas | 160 | ✓ | Praeventio Guard — Consultative Sale Playbook HTTP surface. |
| `src/server/routes/contingencySimulation.ts` | B1-Emergencia | 250 | ✓ | Praeventio Guard — Contingency Simulation HTTP surface. |
| `src/server/routes/continuity.ts` | B13-MOC | 196 | ✓ | Praeventio Guard — Business Continuity HTTP surface. |
| `src/server/routes/contractors.ts` | B11-Contratistas | 173 | ✓ | Praeventio Guard — Contractors KPI + Acreditación HTTP surface. |
| `src/server/routes/controlComparator.ts` |  | 198 | ✓ | Praeventio Guard — Control Comparator HTTP surface. |
| `src/server/routes/correctiveActions.ts` | B4-Incidentes | 219 | ✓ | Praeventio Guard — F.4 Corrective Actions Center. |
| `src/server/routes/costCalculator.ts` |  | 134 | ✓ | Praeventio Guard — Prevention Cost Calculator HTTP surface. |
| `src/server/routes/cphsMinute.ts` |  | 645 | ✓ | Praeventio Guard — F.7 Minuta automática Comité Paritario (CPHS). |
| `src/server/routes/criticalControls.ts` | B2-RiesgoIPER | 372 | ✓ | Praeventio Guard — Critical Controls Library + Robustness HTTP surface. |
| `src/server/routes/criticalRoles.ts` | B13-MOC | 209 | ✓ | Praeventio Guard — Critical Roles map + Substitute matrix HTTP surface. |
| `src/server/routes/cspReport.ts` | B18-Analitica | 138 | ✓ | Praeventio Guard — Sprint 20 twelfth wave Bucket A (TM-I05). |
| `src/server/routes/culturePulse.ts` | B12-CPHS | 784 | ✓ | Praeventio Guard — §61-63 Encuesta de Percepción + Índice de Cultura. |
| `src/server/routes/curriculum.ts` | B6-Capacitacion | 1090 |  | Praeventio Guard — Round 18 Phase 3 split. |
| `src/server/routes/dataConfidence.ts` | B18-Analitica | 614 | ✓ | Praeventio Guard — §104 Panel de Confianza de Datos. |
| `src/server/routes/dataQuality.ts` |  | 197 | ✓ | Praeventio Guard — Fase F.9 Data Quality (pre-IA gap detector). |
| `src/server/routes/deduplication.ts` |  | 152 | ✓ | Praeventio Guard — Record Deduplication HTTP surface. |
| `src/server/routes/documentVersioning.ts` |  | 293 | ✓ | Praeventio Guard — Sprint 41 F.23 HTTP surface. |
| `src/server/routes/drillsManager.ts` | B1-Emergencia | 381 | ✓ | Praeventio Guard — F.20 Gestor de Simulacros. |
| `src/server/routes/driving.ts` |  | 161 | ✓ | Praeventio Guard — Driving safety telemetry HTTP surface. |
| `src/server/routes/drivingSafety.ts` |  | 643 | ✓ | Praeventio Guard — §69-71 Conducción Segura + Rutas Críticas + Alertas Ruta. |
| `src/server/routes/ds67ds76.ts` |  | 518 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/server/routes/dte.ts` | B5-Cumplimiento | 440 |  | Praeventio Guard — Sprint 23 Bucket GG + Sprint 34 biometric DTE. |
| `src/server/routes/efficacyVerification.ts` |  | 139 | ✓ | Praeventio Guard — Corrective-Action Efficacy Verification HTTP surface. |
| `src/server/routes/emergency.ts` | B1-Emergencia | 488 |  | Praeventio Guard — Sprint 14. |
| `src/server/routes/emergencyBrigade.ts` | B1-Emergencia | 514 | ✓ | Praeventio Guard — §74-78 Brigada de Emergencia + Recursos. |
| `src/server/routes/engineeringControls.ts` | B8-PermisosLOTO | 366 | ✓ | Praeventio Guard — §42-44 Inventario Controles de Ingeniería + Jerarquía ISO 31000. |
| `src/server/routes/eppFlow.ts` |  | 581 | ✓ | Praeventio Guard — Bloque 4.2: EPP Inventory Purchase Flow HTTP surface. |
| `src/server/routes/equipment.ts` | B10-EPP | 78 | ✓ | Praeventio Guard — Sprint I.5 Equipment Master + QR Pre-use. |
| `src/server/routes/equipmentQr.ts` | B10-EPP | 474 | ✓ | Praeventio Guard — Bloque 3 wire huérfanos (plan item 3.11). |
| `src/server/routes/ergonomics.ts` | B3-Ergonomia | 189 | ✓ | Praeventio Guard — Ergonomics REBA/RULA HTTP surface. |
| `src/server/routes/escalation.ts` |  | 305 | ✓ | Praeventio Guard — Escalation + SLA Engine HTTP surface. |
| `src/server/routes/evacuation.ts` | B1-Emergencia | 202 | ✓ | Praeventio Guard — Evacuation headcount HTTP surface. |
| `src/server/routes/evacuationHeadcount.ts` | B1-Emergencia | 449 | ✓ | Praeventio Guard — Sprint 39 Bloque 3 wire (Plan item 3.2). |
| `src/server/routes/eventReplay.ts` |  | 227 | ✓ | Praeventio Guard — Event Replay Audit Tool HTTP surface. |
| `src/server/routes/exceptions.ts` | B8-PermisosLOTO | 305 | ✓ | Praeventio Guard — Exception engine HTTP surface. |
| `src/server/routes/expirations.ts` |  | 156 | ✓ | Praeventio Guard — Universal expiration scanner HTTP surface. |
| `src/server/routes/explainability.ts` | B14-IA | 132 | ✓ | Praeventio Guard — Fase F.28 Explainability HTTP surface. |
| `src/server/routes/expressBundle.ts` |  | 201 | ✓ | Praeventio Guard — Auditoría Express Bundle (PDF index) HTTP surface. |
| `src/server/routes/externalAuditPortal.ts` | B17-Admin | 598 | ✓ | Praeventio Guard — Wire-orphan Bloque 3 §3.7: externalAuditPortal HTTP surface. |
| `src/server/routes/fatigue.ts` | B7-Salud | 86 | ✓ | Praeventio Guard — Fatigue Monitor HTTP surface. |
| `src/server/routes/firstResponderMap.ts` | B1-Emergencia | 184 | ✓ | Praeventio Guard — First Responder Map HTTP surface. |
| `src/server/routes/fiveS.ts` |  | 158 | ✓ | Praeventio Guard — 5S Audit + Zone Ranking HTTP surface. |
| `src/server/routes/formBuilderAdvanced.ts` | B9-Inspecciones | 266 | ✓ | Praeventio Guard — Form Builder ADVANCED HTTP surface. |
| `src/server/routes/gamification.ts` | B6-Capacitacion | 147 |  | Praeventio Guard — Round 19 R2 Phase 4 split. |
| `src/server/routes/gemini.ts` | B14-IA | 596 |  | Praeventio Guard — Round 19 R2 Phase 4 split. |
| `src/server/routes/geofencePermissions.ts` | B1-Emergencia | 100 | ✓ | Praeventio Guard — Geofence Permissions UX HTTP surface. |
| `src/server/routes/hazmatInventory.ts` | B10-EPP | 377 | ✓ | Praeventio Guard — Sprint 39 Wire UI hazmat. HTTP surface for the pure |
| `src/server/routes/health.ts` | B7-Salud | 344 |  | Praeventio Guard — Round 16 R5 Phase 1 split. |
| `src/server/routes/healthVault.ts` | B7-Salud | 344 | ✓ | Sprint 26 Bucket VV — HealthVault QR sharing endpoints. |
| `src/server/routes/horometro.ts` | B10-EPP | 432 | ✓ | Praeventio Guard — Bloque 4.1: Horometro routes. |
| `src/server/routes/hygiene.ts` | B7-Salud | 116 | ✓ | Praeventio Guard — Industrial Hygiene (Mifflin-St Jeor BMR) HTTP surface. |
| `src/server/routes/import.ts` |  | 399 |  | Praeventio Guard — Sprint K §106-108 — Importador Excel (HTTP endpoints). |
| `src/server/routes/inbox.ts` |  | 177 | ✓ | Praeventio Guard — Fase F.8 Inbox del Prevencionista. |
| `src/server/routes/incidentBundle.ts` | B4-Incidentes | 215 | ✓ | Praeventio Guard — Fase F.3 Incident Evidence Bundle. |
| `src/server/routes/incidentFlow.ts` | B4-Incidentes | 748 | ✓ | Praeventio Guard — Bloque 4.3: Incident → Investigation → Lesson → Training PDCA HTTP surface. |
| `src/server/routes/incidents.ts` | B4-Incidentes | 194 |  | Praeventio Guard — Sprint 33 wire W4 (2026-05-17). |
| `src/server/routes/incidentTrends.ts` | B4-Incidentes | 493 | ✓ | Praeventio Guard — F.29 Indicadores de Tendencia de Incidentes. |
| `src/server/routes/industryRules.ts` | B5-Cumplimiento | 260 | ✓ | Praeventio Guard — Bloque 3.13 wire huérfanos: industryRules HTTP surface. |
| `src/server/routes/insights.ts` |  | 259 |  | Praeventio Guard — Wire UI bridge: /api/insights routes. |
| `src/server/routes/iot.ts` |  | 155 | ✓ | Sprint 32 Bucket TT — IoT device registration endpoint. |
| `src/server/routes/jsa.ts` | B2-RiesgoIPER | 169 | ✓ | Praeventio Guard — Job Safety Analysis (JSA) HTTP surface. |
| `src/server/routes/knowledgeBase.ts` |  | 395 | ✓ | Praeventio Guard — §185-190 Base de Conocimiento + Curador + Obsolescencia. |
| `src/server/routes/leadership.ts` |  | 321 | ✓ | Praeventio Guard — §276-277 Bitácora de Decisiones de Supervisión + Ranking. |
| `src/server/routes/legalObligations.ts` | B5-Cumplimiento | 495 | ✓ | Praeventio Guard — Plan Bloque 3.14: Legal Obligations Calendar wire-up. |
| `src/server/routes/lessonsLearned.ts` | B4-Incidentes | 178 | ✓ | Praeventio Guard — F.12 Biblioteca de Lecciones Aprendidas. |
| `src/server/routes/loneWorker.ts` | B1-Emergencia | 281 | ✓ | Praeventio Guard — Sprint 39 Fase G.11 — Lone Worker HTTP surface. |
| `src/server/routes/loto.ts` | B8-PermisosLOTO | 80 | ✓ | Praeventio Guard — LOTO Digital (Lock-Out / Tag-Out). |
| `src/server/routes/maintenance.ts` | B10-EPP | 699 |  | Bucket K.3 — HTTP wrapper for the overdue-maintenance reaper. |
| `src/server/routes/maturity.ts` | B2-RiesgoIPER | 406 | ✓ | Praeventio Guard — F.26 Indicador de Madurez Preventiva. |
| `src/server/routes/medicalAptitude.ts` | B7-Salud | 282 | ✓ | Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Certificate router. |
| `src/server/routes/medicalCatalogs.ts` | B7-Salud | 283 | ✓ | Praeventio Guard — Medical Catalogs lookup HTTP surface. |
| `src/server/routes/meetingPack.ts` | B12-CPHS | 207 | ✓ | Praeventio Guard — Meeting pack + briefing HTTP surface. |
| `src/server/routes/mentalLoad.ts` | B7-Salud | 136 | ✓ | Praeventio Guard — Mental Load (NASA-TLX) + Admin Burden HTTP surface. |
| `src/server/routes/microtraining.ts` | B6-Capacitacion | 237 | ✓ | Praeventio Guard — Sprint 41 F.22 HTTP surface. |
| `src/server/routes/misc.ts` |  | 346 |  | Praeventio Guard — Round 19 R2 Phase 4 split. |
| `src/server/routes/multiProject.ts` |  | 163 | ✓ | Praeventio Guard — Multi-Project Comparator HTTP surface. |
| `src/server/routes/multiRoleSummary.ts` |  | 237 | ✓ | Praeventio Guard — Multi-Role Summary HTTP surface. |
| `src/server/routes/nonConformity.ts` | B5-Cumplimiento | 192 | ✓ | Praeventio Guard — Non-Conformity engine HTTP surface. |
| `src/server/routes/oauthGoogle.ts` | B17-Admin | 514 |  | Praeventio Guard — Round 18 Phase 3 split. |
| `src/server/routes/offlineInspections.ts` | B9-Inspecciones | 495 | ✓ | Praeventio Guard — F.6 Modo Sin Señal para Inspecciones (offline-first). |
| `src/server/routes/onboarding.ts` | B6-Capacitacion | 295 |  | Sprint 24 Bucket KK.3 — Self-service onboarding completion endpoint. |
| `src/server/routes/openapi.ts` |  | 61 | ✓ | Sprint 36 — Public OpenAPI endpoint. |
| `src/server/routes/operationalChange.ts` | B13-MOC | 396 | ✓ | Praeventio Guard — Bloque 3.17: Management of Change (MOC) HTTP surface |
| `src/server/routes/organic.ts` | B12-CPHS | 397 |  | Sprint 15 — Organic structure (Crew/Process/Task) write endpoints. |
| `src/server/routes/orgMetrics.ts` | B18-Analitica | 267 | ✓ | Praeventio Guard — Organizational Metrics HTTP surface. |
| `src/server/routes/pdca.ts` |  | 468 | ✓ | Praeventio Guard — §195-200 Ciclo PDCA + No Conformidades (ISO 45001 §10.2). |
| `src/server/routes/photoEvidence.ts` | B9-Inspecciones | 223 | ✓ | Praeventio Guard — Fase F.19 Photo Evidence HTTP endpoints. |
| `src/server/routes/pinSign.ts` |  | 326 | ✓ | Praeventio Guard — PIN Sign HTTP surface (F.25 fallback sin biometría). |
| `src/server/routes/portableHistory.ts` | B18-Analitica | 449 | ✓ | Praeventio Guard — F.18 Historial Profesional Portátil del Trabajador. |
| `src/server/routes/portfolioLessons.ts` | B6-Capacitacion | 162 | ✓ | Praeventio Guard — Portfolio Lessons Engine HTTP surface. |
| `src/server/routes/positiveObservations.ts` | B9-Inspecciones | 379 | ✓ | Praeventio Guard — §214-215 Observaciones Positivas + Balance. |
| `src/server/routes/postTraining.ts` | B6-Capacitacion | 263 | ✓ | Praeventio Guard — Post-Training Assessment HTTP surface. |
| `src/server/routes/predictiveAlerts.ts` | B18-Analitica | 159 | ✓ | Praeventio Guard — Predictive Alerts HTTP surface. |
| `src/server/routes/preShiftRisk.ts` | B2-RiesgoIPER | 458 | ✓ | Praeventio Guard — F.21 Panel de Riesgo por Turno (pre-turno). |
| `src/server/routes/preventionCost.ts` | B15-Billing | 372 | ✓ | Praeventio Guard — Bloque 3.15 — Prevention Cost Simulator HTTP surface. |
| `src/server/routes/pricingCalculator.ts` | B15-Billing | 203 | ✓ | Praeventio Guard — Pricing calculator HTTP surface. |
| `src/server/routes/pricingSimulator.ts` | B15-Billing | 210 | ✓ | Praeventio Guard — Pricing Simulator HTTP surface. |
| `src/server/routes/privacyRetention.ts` | B5-Cumplimiento | 286 | ✓ | Praeventio Guard — Privacy Retention HTTP surface. |
| `src/server/routes/privacyShield.ts` |  | 177 | ✓ | Praeventio Guard — Privacy Shield HTTP surface. |
| `src/server/routes/projectClosure.ts` |  | 675 | ✓ | Praeventio Guard — §131-138 Cierre de Proyecto + Lecciones Transferibles + |
| `src/server/routes/projectComparator.ts` | B18-Analitica | 98 | ✓ | Praeventio Guard — Project Comparator HTTP surface. |
| `src/server/routes/projects.ts` |  | 645 |  | Praeventio Guard — Round 18 Phase 3 split. |
| `src/server/routes/protocols.ts` |  | 170 | ✓ | Praeventio Guard — Protocols (IPER + PREXOR + TMERT) HTTP surface. |
| `src/server/routes/push.ts` |  | 92 |  | Praeventio Guard — Round 17 R3. |
| `src/server/routes/pymeOnboarding.ts` | B6-Capacitacion | 145 | ✓ | Praeventio Guard — PYME Onboarding (Maturity + 30-day plan) HTTP surface. |
| `src/server/routes/pymeWizard.ts` | B17-Admin | 106 | ✓ | Praeventio Guard — PYME Wizard (fast onboarding plan) HTTP surface. |
| `src/server/routes/qrAck.ts` | B9-Inspecciones | 253 | ✓ | Praeventio Guard — QR Acknowledgement Sessions HTTP surface. |
| `src/server/routes/qrSignature.ts` | B9-Inspecciones | 357 | ✓ | Praeventio Guard — F.5 Firma de Recepción Digital con QR. |
| `src/server/routes/raciMatrix.ts` | B12-CPHS | 237 | ✓ | Praeventio Guard — RACI Matrix HTTP surface. |
| `src/server/routes/readReceipts.ts` |  | 279 | ✓ | Praeventio Guard — Read receipts (acknowledgement) HTTP surface. |
| `src/server/routes/refuges.ts` | B1-Emergencia | 169 | ✓ | Praeventio Guard — Mountain Refuges (CONAF + clubes andinos) HTTP surface. |
| `src/server/routes/regulatoryFramework.ts` | B5-Cumplimiento | 257 | ✓ | Praeventio Guard — Regulatory Framework HTTP surface (ISO 45001 + 14 jurisdictions). |
| `src/server/routes/reports.ts` | B18-Analitica | 216 |  | Praeventio Guard — Round 19 R2 Phase 4 split. |
| `src/server/routes/reportsAutomation.ts` | B18-Analitica | 179 | ✓ | Praeventio Guard — Reports Automation HTTP surface. |
| `src/server/routes/reputationalAlerts.ts` |  | 149 | ✓ | Praeventio Guard — Reputational Alerts HTTP surface. |
| `src/server/routes/researchMode.ts` | B14-IA | 200 | ✓ | Praeventio Guard — Research Mode (root cause investigation) HTTP surface. |
| `src/server/routes/residualRisk.ts` | B2-RiesgoIPER | 440 | ✓ | Praeventio Guard — §296-301 Riesgo Residual + Aceptación Formal + Criticidad Sospechosa. |
| `src/server/routes/restrictedZones.ts` | B1-Emergencia | 548 | ✓ | Praeventio Guard — Sprint 39 Bloque 3 (wire-huérfanos #3.4). |
| `src/server/routes/retaliationProtection.ts` |  | 151 | ✓ | Praeventio Guard — Retaliation Protection HTTP surface. |
| `src/server/routes/returnToWork.ts` |  | 244 | ✓ | Praeventio Guard — Return-to-Work + restricciones + derivación HTTP surface. |
| `src/server/routes/riskRadar.ts` | B2-RiesgoIPER | 286 | ✓ | Praeventio Guard — F.13 Radar de Riesgos Repetidos. |
| `src/server/routes/riskRanking.ts` | B2-RiesgoIPER | 212 | ✓ | Praeventio Guard — Risk Ranking HTTP surface. |
| `src/server/routes/roiScenario.ts` |  | 108 | ✓ | Praeventio Guard — ROI Scenario Comparator HTTP surface. |
| `src/server/routes/roleViews.ts` |  | 104 | ✓ | Praeventio Guard — Role-based dashboard view HTTP surface. |
| `src/server/routes/rootCause.ts` | B4-Incidentes | 243 | ✓ | Praeventio Guard — Root cause classifier HTTP surface. |
| `src/server/routes/rootCauseInvestigation.ts` | B4-Incidentes | 198 | ✓ | Praeventio Guard — Root Cause Investigation Mode HTTP surface. |
| `src/server/routes/routeScoring.ts` |  | 162 | ✓ | Praeventio Guard — Route Scoring HTTP surface (driving safety routes). |
| `src/server/routes/routing.ts` |  | 143 | ✓ | Praeventio Guard — Routing engines HTTP surface. |
| `src/server/routes/safetyMetrics.ts` | B18-Analitica | 206 | ✓ | Praeventio Guard — Safety Metrics OSHA + ICMM HTTP surface. |
| `src/server/routes/safetyPerformance.ts` | B18-Analitica | 134 | ✓ | Praeventio Guard — Safety Performance Index (SPI) HTTP surface. |
| `src/server/routes/safetyTalks.ts` | B6-Capacitacion | 92 | ✓ | Praeventio Guard — Safety talks topic suggester HTTP surface. |
| `src/server/routes/shiftHandover.ts` | B13-MOC | 320 | ✓ | Praeventio Guard — Shift Handover (Bitácora Supervisor) HTTP surface. |
| `src/server/routes/shiftRiskPanel.ts` | B2-RiesgoIPER | 127 | ✓ | Praeventio Guard — Shift Risk Panel (Pre-Turno) HTTP surface. |
| `src/server/routes/sif.ts` |  | 122 | ✓ | Praeventio Guard — F.3 SIF Precursors (Serious Injury/Fatality). |
| `src/server/routes/signaletics.ts` | B10-EPP | 199 | ✓ | Praeventio Guard — Signaletics HTTP surface. |
| `src/server/routes/sitebook.ts` | B9-Inspecciones | 180 |  | Praeventio Guard — Wire UI bridge: /api/sitebook routes. |
| `src/server/routes/sitebookSign.ts` | B9-Inspecciones | 277 | ✓ | Praeventio Guard — Plan 2026-05-24 §D.X — server-side SiteBook signing |
| `src/server/routes/sitebookSignRoutes.ts` | B9-Inspecciones | 190 |  | Praeventio Guard — Plan 2026-05-24 §D.X — Express mounting for |
| `src/server/routes/skillGap.ts` | B6-Capacitacion | 219 | ✓ | Praeventio Guard — Skill Gap Analyzer HTTP surface. |
| `src/server/routes/softBlocking.ts` | B8-PermisosLOTO | 278 | ✓ | Praeventio Guard — Soft-blocking requirement gate HTTP surface. |
| `src/server/routes/spacedRepetition.ts` | B6-Capacitacion | 211 | ✓ | Praeventio Guard — Spaced Repetition (SM-2) HTTP surface. |
| `src/server/routes/stoppage.ts` | B8-PermisosLOTO | 288 | ✓ | Praeventio Guard — Stoppage (Paralización + Reanudación) HTTP surface. |
| `src/server/routes/subscription.ts` | B15-Billing | 132 |  | Praeventio Guard — Round 22 (audit fix CRITICAL #1): |
| `src/server/routes/suppliers.ts` |  | 568 | ✓ | Praeventio Guard — §90-91 Calidad de Proveedores + Ranking de Riesgo. |
| `src/server/routes/suseso.ts` | B5-Cumplimiento | 403 | ✓ | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/server/routes/syncStatus.ts` | B16-Offline | 245 | ✓ | Praeventio Guard — Sync Status (offline queue tracker) HTTP surface. |
| `src/server/routes/systemEvents.ts` |  | 72 |  | SystemEngine — POST /api/system-events/emit. |
| `src/server/routes/telemetry.ts` | B7-Salud | 257 |  | Praeventio Guard — Round 19 R2 Phase 4 split. |
| `src/server/routes/upsell.ts` |  | 80 | ✓ | Praeventio Guard — Pain-Based Upsell Suggester HTTP surface. |
| `src/server/routes/vendorOnboarding.ts` | B6-Capacitacion | 301 | ✓ | Praeventio Guard — Vendor / Contractor Onboarding HTTP surface. |
| `src/server/routes/visitors.ts` | B11-Contratistas | 348 | ✓ | Praeventio Guard — Sprint K §23-24: Control de Visitas + Inducción Express QR. |
| `src/server/routes/vulnerability.ts` |  | 77 | ✓ | Praeventio Guard — F.10 Vulnerability Map. |
| `src/server/routes/waste.ts` |  | 81 | ✓ | Praeventio Guard — §229-236 Waste Inventory + ESG manifests. |
| `src/server/routes/wisdomCapsule.ts` |  | 485 | ✓ | Sprint 15 — Wisdom Capsule daily endpoint. |
| `src/server/routes/workerHistory.ts` |  | 243 | ✓ | Praeventio Guard — Portable worker history HTTP surface. |
| `src/server/routes/workerReadiness.ts` |  | 907 | ✓ | Praeventio Guard — F.16 Score de Preparación del Trabajador. |
| `src/server/routes/workPermits.ts` | B8-PermisosLOTO | 548 | ✓ | Praeventio Guard — F.15 Centro de Permisos de Trabajo. |
| `src/server/routes/zettelkasten.ts` |  | 523 |  | Praeventio Guard — Sprint 11. |
| `src/server/services/projectTokens.ts` |  | 261 | ✓ | PR #482 codex P1 — resolver project-member FCM tokens by role. |
| `src/server/services/serverZkNodeWriter.ts` |  | 169 | ✓ | Praeventio Guard — server-side Zettelkasten node writer (Codex P1 on #650). |
| `src/server/services/userLifecycle.ts` |  | 87 | ✓ | Praeventio Guard — Sprint 39 Fase B.2. |
| `src/server/sessionStore/firestoreSessionStore.ts` | B17-Admin | 284 | ✓ | Praeventio Guard — Firestore-backed session store para express-session. |
| `src/server/sync/distributedLock.ts` |  | 350 | ✓ | Bloque 5.4 (C14) — SyncManager distributed lock, Firestore-backed. |
| `src/server/triggers/backgroundTriggers.ts` |  | 476 | ✓ | Praeventio Guard — Round 21 B1 Phase 5 split. |
| `src/server/triggers/healthCheck.ts` | B7-Salud | 109 | ✓ | Praeventio Guard — Round 21 B1 Phase 5 split. |
| `src/server/triggers/systemEngineTrigger.ts` |  | 104 | ✓ | SystemEngine — Server-side trigger. |
| `src/server/triggers/zettelkastenMaterializer.ts` |  | 223 | ✓ | Praeventio Guard — Sprint 39 Fase D.8.c follow-up: materializer trigger. |
| `src/server/types/express.d.ts` |  | 49 |  | Express Request augmentation (Sprint 49 - E.5 P2 H19). |
| `src/server/utils/fcmMulticast.ts` |  | 72 | ✓ | PR #482 codex P1 — chunked FCM multicast. |
