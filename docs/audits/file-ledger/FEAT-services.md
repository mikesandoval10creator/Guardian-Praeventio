# File ledger — FEAT-services (692 files)

Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.

| Archivo | Bloque | LOC | Test | Propósito / exports |
|---|---|---:|:--:|---|
| `src/services/adminBurden/adminBurdenTracker.ts` |  | 213 |  | Praeventio Guard — Sprint 51 §259: Tracker de carga administrativa. |
| `src/services/adminBurden/automationSuggester.ts` |  | 150 |  | Praeventio Guard — Sprint 51 §260: Auto-admin (sugerir automatizaciones). |
| `src/services/adoption/adoptionAnalytics.ts` | B18-Analitica | 231 | ✓ | Praeventio Guard — Sprint K: Adopción + Embudo Conversión + Churn + First Value. |
| `src/services/adService.ts` |  | 123 |  | _exports:_ AD_CONFIG, isNative, initAdMob, prepareInterstitial, showInterstitial, loadAdSenseScript, canShowAd, recordAdShown |
| `src/services/agenda/agendaScheduler.ts` | B12-CPHS | 169 | ✓ | Praeventio Guard — Sprint K: Agenda + Bloques de Foco + Recordatorios + Digests. |
| `src/services/ai/aiAdapter.ts` |  | 136 | ✓ | AI adapter interface — the small swappable boundary between Praeventio's |
| `src/services/ai/asesorAdaptersFactory.ts` | B14-IA | 181 | ✓ | Factory que construye los `OrchestratorAdapters` para el asesor IA |
| `src/services/ai/colorBasedEppDetector.ts` |  | 348 | ✓ | Praeventio Guard — §2.18 (2026-05-22) detector EPP on-device REAL. |
| `src/services/ai/contextualAssistant.ts` |  | 227 | ✓ | Praeventio Guard — Sprint 39 Fase C.10: Asistente contextual con citas Zettelkasten. |
| `src/services/ai/eppDetectorOnDevice.ts` |  | 364 | ✓ | Praeventio Guard — §2.18 fix (2026-05-22): EPP detection ON-DEVICE. |
| `src/services/ai/geminiAdapter.ts` | B14-IA | 146 |  | Gemini consumer-API adapter — the default + the only fully-wired adapter |
| `src/services/ai/index.ts` |  | 167 |  | AI adapter facade — single entry point for picking the right provider. |
| `src/services/ai/resilientAiAdapters.ts` |  | 387 | ✓ | Adapters concretos para conectar el `resilientAiOrchestrator` con |
| `src/services/ai/resilientAiOrchestrator.ts` | B14-IA | 424 | ✓ | Resilient AI Orchestrator — tiered fallback for emergency scenarios. |
| `src/services/ai/vertexAdapter.ts` |  | 324 | ✓ | Vertex AI adapter — real implementation. |
| `src/services/ai/zkRagContextBuilder.ts` |  | 343 | ✓ | Praeventio Guard — Sprint 47 Fase C.10: RAG sobre Zettelkasten + citation policy. |
| `src/services/ai/zkRagResponseValidator.ts` |  | 176 | ✓ | Praeventio Guard — Sprint 47 Fase C.10: Validator post-respuesta del LLM |
| `src/services/aiGuardrails/aiGuardrails.ts` | B14-IA | 284 | ✓ | Praeventio Guard — Sprint 45 §155-160: Guardrails IA + prompts versionados |
| `src/services/aiGuardrails/citationValidator.ts` | B14-IA | 196 | ✓ | Praeventio Guard — Sprint K §158: Citation enforcement. |
| `src/services/aiGuardrails/hallucinationGuard.ts` | B14-IA | 282 | ✓ | Praeventio Guard — Sprint K §159: Control de alucinaciones. |
| `src/services/aiGuardrails/index.ts` | B14-IA | 53 |  | Praeventio Guard — Sprint K §155-160: barrel del módulo aiGuardrails. |
| `src/services/aiGuardrails/runWithGuardrails.ts` | B14-IA | 282 | ✓ | Praeventio Guard — Sprint K §155: Wrapper de guardrails sobre el adapter |
| `src/services/aiGuardrails/versionedPrompts.ts` | B14-IA | 285 | ✓ | Praeventio Guard — Sprint K §156: Prompts versionados. |
| `src/services/aiQuality/aiAuditLog.ts` | B14-IA | 255 | ✓ | Praeventio Guard — Sprint 39 Fase G.4: control de calidad IA. |
| `src/services/aiToggle/aiModeController.ts` | B14-IA | 228 | ✓ | Praeventio Guard — Sprint 51 §161-162: AI Mode Controller (AI-off toggle + local fallback) |
| `src/services/aiToggle/ruleDriftDetector.ts` | B14-IA | 221 | ✓ | Praeventio Guard — Sprint 51 §163: Rule Drift Detector |
| `src/services/analytics/adapter.ts` | B18-Analitica | 321 | ✓ | Analytics adapter (ninth wave, Bucket D). |
| `src/services/analytics/b2dMetrics.ts` | B18-Analitica | 220 | ✓ | Praeventio Guard — B2D revenue metrics (Bucket CC, Sprint 23) |
| `src/services/analytics/index.ts` | B18-Analitica | 152 |  | Analytics — public barrel (ninth wave, Bucket D). |
| `src/services/analytics/queue.ts` | B18-Analitica | 176 |  | Analytics IndexedDB queue (ninth wave, Bucket D). |
| `src/services/analytics/serverAdapter.ts` | B18-Analitica | 401 | ✓ | Node-only analytics adapter for server-side wire-points (admin |
| `src/services/analytics/sinks.ts` | B18-Analitica | 96 |  | Analytics sinks (ninth wave, Bucket D). |
| `src/services/analytics/types.ts` | B18-Analitica | 823 |  | Analytics — typed event surface (ninth wave, Bucket D). |
| `src/services/annualReview/annualReviewFirestoreAdapter.ts` |  | 74 | ✓ | Persistence #22: annual SGI review adapter (PreventiveObjective). |
| `src/services/annualReview/annualSgiReview.ts` |  | 228 | ✓ | Praeventio Guard — Sprint K: Revisión Anual del Sistema de Gestión. |
| `src/services/apprenticeship/apprenticeshipProgressService.ts` | B6-Capacitacion | 249 | ✓ | Praeventio Guard — Sprint K: Aprendices + Mentoría + Autorización Progresiva. |
| `src/services/ar/arAnchorFirestoreAdapter.ts` |  | 205 | ✓ | AR Anchor Firestore Adapter — persistencia por proyecto. |
| `src/services/ar/arAnchorService.ts` |  | 254 | ✓ | AR Anchor Service — tipos + lógica de negocio para anclas AR |
| `src/services/ar/arHitTest.ts` |  | 220 | ✓ | Praeventio Guard — AR hit-test pure logic. |
| `src/services/ar/arPlatformPolicy.ts` |  | 138 | ✓ | Praeventio Guard — Sprint 48 E.1 (cierre): AR platform policy + scene orchestrator. |
| `src/services/ar/arQuickLookFallback.ts` |  | 159 | ✓ | Praeventio Guard — AR Quick Look fallback para iOS Safari. |
| `src/services/ar/arSceneOrchestrator.ts` | B14-IA | 237 | ✓ | Praeventio Guard — Sprint 48 E.1 (cierre): AR scene orchestrator. |
| `src/services/ar/posterCatalog.ts` |  | 453 | ✓ | Poster Catalog — catálogo de afiches de seguridad reconocibles por el |
| `src/services/ar/posterEmbeddings.generated.ts` |  | 26 |  | Poster Embeddings — pre-computados offline vía `scripts/seed-poster-embeddings.ts`. |
| `src/services/ar/posterMatcher.ts` |  | 299 | ✓ | Poster Matcher — wrapper sobre MediaPipe `ImageEmbedder` para |
| `src/services/ar/usdzConverter.ts` |  | 142 | ✓ | Sprint 23 Bucket EE.5 — USDZ converter client adapter. |
| `src/services/ar/webXrCapabilities.ts` |  | 259 | ✓ | Praeventio Guard — WebXR AR Fase E.1. |
| `src/services/audit/expressBundleBuilder.ts` |  | 257 | ✓ | Praeventio Guard — Sprint 39 Fase F.1: Modo Auditoría Express. |
| `src/services/audit/tamperProofChain.ts` |  | 404 | ✓ | Tamper-Proof Audit Hash Chain. |
| `src/services/auditPortal/auditPortalFirestoreAdapter.ts` | B17-Admin | 114 | ✓ | Persistence #8: externalAuditPortal adapter. |
| `src/services/auditPortal/auditPortalStore.ts` | B17-Admin | 35 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) audit portal store. |
| `src/services/auditPortal/externalAuditPortal.ts` | B17-Admin | 280 | ✓ | Praeventio Guard — Sprint 39 Fase H.1: Portal Evidencias Auditor Externo. |
| `src/services/auditService.ts` |  | 73 |  | _exports:_ AuditLogDetails, AuditLog, logAuditAction |
| `src/services/auth/customClaims.ts` | B17-Admin | 116 | ✓ | Praeventio Guard — TODO.md §12.4.2: Custom claim `assignedSiteIds`. |
| `src/services/auth/projectMembership.ts` | B17-Admin | 102 | ✓ | Praeventio Guard — server-side project membership enforcement. |
| `src/services/auth/totp.ts` | B17-Admin | 260 | ✓ | Praeventio Guard — TOTP (RFC 6238) + HOTP (RFC 4226) puro. |
| `src/services/auth/totpEnrollment.ts` | B17-Admin | 258 | ✓ | Praeventio Guard — TOTP enrollment + verification service. |
| `src/services/auth/webauthnChallenge.ts` | B17-Admin | 178 | ✓ | Praeventio Guard — Round 17 (R5 agent): WebAuthn challenge cache. |
| `src/services/auth/webauthnClient.ts` | B17-Admin | 221 |  | webauthnClient — Sprint 30 Bucket KK. |
| `src/services/auth/webauthnComplianceSign.ts` | B5-Cumplimiento | 155 |  | Praeventio Guard — WebAuthn compliance signing client (DS 67 / DS 76 / SUSESO). |
| `src/services/auth/webauthnCredentialStore.ts` | B17-Admin | 231 | ✓ | Praeventio Guard — Round 19 (R19 A5 agent): WebAuthn credential store. |
| `src/services/b2d/apiKeyService.ts` |  | 233 | ✓ | Sprint 23 Bucket BB — B2D API key service. |
| `src/services/b2d/externalClimate.ts` |  | 384 |  | Praeventio Guard — B2D External Climate sources (§2.16 cierre Fase C.4, 2026-05-21). |
| `src/services/b2d/usage.ts` |  | 35 |  | Sprint 23 Bucket BB — B2D usage tracking helper. |
| `src/services/battery/batteryAdvisor.ts` |  | 182 | ✓ | Praeventio Guard — TODO.md §12.2.8: Battery-aware polling advisor. |
| `src/services/bcnService.ts` |  | 89 |  | Service to interact with the Biblioteca del Congreso Nacional (BCN) API. |
| `src/services/behaviorObservation/bbsObservationEngine.ts` | B9-Inspecciones | 216 | ✓ | Praeventio Guard — Sprint K: BBS (Behavior-Based Safety) Observation Engine. |
| `src/services/billing/appleSsn.ts` | B15-Billing | 495 |  | Praeventio Guard — Apple App Store Server Notifications v2 handler. |
| `src/services/billing/appleTransactionValidator.ts` | B15-Billing | 366 | ✓ | Praeventio Guard — Apple App Store transaction validator. |
| `src/services/billing/currency.ts` | B15-Billing | 117 | ✓ | Praeventio Guard — LATAM currency formatting. |
| `src/services/billing/googlePlayValidator.ts` | B15-Billing | 349 | ✓ | Praeventio Guard — Google Play subscription receipt validator. |
| `src/services/billing/iapAdapter.ts` | B15-Billing | 427 | ✓ | Praeventio Guard — Unified In-App-Purchase adapter. |
| `src/services/billing/idempotency.ts` | B15-Billing | 210 | ✓ | Praeventio Guard — withIdempotency() lock-then-complete helper. |
| `src/services/billing/invoice.ts` | B15-Billing | 286 | ✓ | Praeventio Guard — Pure invoice math. |
| `src/services/billing/khipuAdapter.ts` | B15-Billing | 412 | ✓ | Praeventio Guard — Khipu adapter (REAL IMPLEMENTATION). |
| `src/services/billing/mercadoPagoAdapter.ts` | B15-Billing | 247 | ✓ | Praeventio Guard — MercadoPago adapter (REAL IMPLEMENTATION). |
| `src/services/billing/mercadoPagoIpn.ts` | B15-Billing | 759 | ✓ | Praeventio Guard — MercadoPago IPN handler. |
| `src/services/billing/mpJwksCache.ts` | B15-Billing | 173 | ✓ | Praeventio Guard — Round 19 (A9): in-memory JWKS cache for MercadoPago. |
| `src/services/billing/types.ts` | B15-Billing | 164 |  | Praeventio Guard — Billing types (Chilean B2B + International) |
| `src/services/billing/webpayAdapter.ts` | B15-Billing | 491 | ✓ | Praeventio Guard — Webpay/Transbank adapter (REAL IMPLEMENTATION). |
| `src/services/billing/webpayMetrics.ts` | B15-Billing | 73 | ✓ | Praeventio Guard — Webpay return latency histogram emitter. |
| `src/services/billingService.ts` | B15-Billing | 49 |  | _exports:_ PurchaseResult, verifyGooglePlayPurchase, isNative |
| `src/services/bowtie/bowtieAnalysisBuilder.ts` | B2-RiesgoIPER | 246 | ✓ | Praeventio Guard — Sprint K Fase §-bowtie: Análisis Bowtie de Riesgo. |
| `src/services/bundlePerf/bundleSizeAnalyzer.ts` |  | 206 | ✓ | Praeventio Guard — Sprint 47 D.7: Bundle size analyzer + lazy strategy. |
| `src/services/cad/dwgAdapter.ts` |  | 169 |  | Sprint 21 Bucket Q — DWG client-side adapter. |
| `src/services/cad/dwgDocumentValidator.ts` |  | 398 | ✓ | Sprint 50 E.5 P2 H1 — DWG document validator (pre-upload). |
| `src/services/cad/dxfAdapter.ts` |  | 189 | ✓ | Sprint 17a — DXF entity adapter for the MIT-only CAD viewer stack. |
| `src/services/calendar/legalObligations.ts` | B5-Cumplimiento | 97 | ✓ | Chilean SST normative cadences. |
| `src/services/calendar/predictions.ts` |  | 243 | ✓ | Calendar predictions — pure rule engine. |
| `src/services/capacity/normativeAlerts.ts` |  | 283 | ✓ | Per-project Chilean normativa alerts. |
| `src/services/capacity/tierEvaluation.ts` |  | 155 | ✓ | Deterministic capacity / tier evaluation. |
| `src/services/cargo/stowageOptimizer.ts` |  | 309 | ✓ | Praeventio Guard — Sprint 39 Fase D.2: Optimizador de Estiba + COG. |
| `src/services/changeMgmt/operationalChangeFirestoreAdapter.ts` | B13-MOC | 64 | ✓ | Persistence #6: operationalChangeService adapter. |
| `src/services/changeMgmt/operationalChangeService.ts` | B13-MOC | 553 | ✓ | Praeventio Guard — Sprint 39 Fase J.6: Control de Cambios Operacionales. |
| `src/services/changeMgmt/operationalChangeStore.ts` | B13-MOC | 29 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) operational change store. |
| `src/services/checklistBuilder/checklistBuilder.ts` | B9-Inspecciones | 410 | ✓ | Praeventio Guard — Sprint 49 §261-270: Constructor de Checklists con |
| `src/services/chemicalBackend.ts` |  | 179 |  | _exports:_ analyzeChemicalRisk, designHazmatStorage, suggestChemicalSubstitution |
| `src/services/circadian/circadianRhythmService.ts` | B7-Salud | 167 | ✓ | Praeventio Guard — Sprint K: Ritmo circadiano + Sueño + Carga mental. |
| `src/services/clientReporting/monthlyClientReport.ts` | B18-Analitica | 138 | ✓ | Praeventio Guard — Sprint K: Reporte Mensual Cliente + Alertas Reputacionales. |
| `src/services/clientReporting/monthlyClientReportBuilder.ts` | B18-Analitica | 388 | ✓ | Praeventio Guard — Sprint 51 §117: Reporte mensual cliente (auto-generado |
| `src/services/climateAwareScheduling/climateAwareScheduling.ts` |  | 187 | ✓ | Praeventio Guard — Sprint K: Climate-Aware Scheduling + Work Suspension. |
| `src/services/coach/normativeRag.ts` |  | 386 | ✓ | NormativeRagService — domain-aware retrieval over CL safety/health corpus. |
| `src/services/coach/personaSelector.ts` |  | 273 | ✓ | Praeventio Guard — §12.6.1: Selector de persona para GeminiChat. |
| `src/services/coach/prompts.ts` | B14-IA | 346 | ✓ | Coach IA — Domain-specialized prompt templates. |
| `src/services/coachBackend.ts` |  | 38 |  | _exports:_ getSafetyCoachResponse |
| `src/services/comiteBackend.ts` | B12-CPHS | 77 |  | _exports:_ suggestMeetingAgenda, summarizeAgreements |
| `src/services/comms/communicationMap.ts` | B1-Emergencia | 199 | ✓ | Praeventio Guard — Sprint K: Mapa Comunicación + Escalamiento + Contactabilidad + Radio + Plan B. |
| `src/services/commsDrill/commsDrillEngine.ts` | B1-Emergencia | 306 | ✓ | Praeventio Guard — Sprint 53 §215-218: Emergency Comms Drill Engine. |
| `src/services/compliance/adapters/au/index.ts` | B5-Cumplimiento | 62 |  | Praeventio Guard — Bloque 7 (D-COMPL-AU): Australia compliance adapter scaffold. |
| `src/services/compliance/adapters/ca/index.ts` | B5-Cumplimiento | 64 |  | Praeventio Guard — Bloque 7 (D-COMPL-CA): Canada compliance adapter scaffold. |
| `src/services/compliance/adapters/cl/index.ts` | B5-Cumplimiento | 118 |  | Praeventio Guard — Sprint 38 (CL adapter consolidation). |
| `src/services/compliance/adapters/in/index.ts` | B5-Cumplimiento | 72 |  | Praeventio Guard — Bloque 7 (D-COMPL-IN): India compliance adapter scaffold. |
| `src/services/compliance/adapters/index.ts` | B5-Cumplimiento | 127 |  | Praeventio Guard — Bloque 7 frontend orquestador: registro de adapters. |
| `src/services/compliance/adapters/jp/index.ts` | B5-Cumplimiento | 60 |  | Praeventio Guard — Bloque 7 (D-COMPL-JP): Japan compliance adapter scaffold. |
| `src/services/compliance/adapters/jurisdictionErrors.ts` | B5-Cumplimiento | 42 |  | Praeventio Guard — Bloque 7: Errores compartidos por adapters jurisdiccionales. |
| `src/services/compliance/adapters/kr/index.ts` | B5-Cumplimiento | 65 |  | Praeventio Guard — Bloque 7 (D-COMPL-KR): Korea compliance adapter scaffold. |
| `src/services/compliance/adapters/uk/index.ts` | B5-Cumplimiento | 72 |  | Praeventio Guard — Bloque 7 (D-COMPL-UK): UK compliance adapter scaffold. |
| `src/services/compliance/ds67/ds67Service.ts` | B5-Cumplimiento | 321 | ✓ | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/compliance/ds67/types.ts` | B5-Cumplimiento | 59 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/compliance/ds76/ds76Service.ts` | B5-Cumplimiento | 233 | ✓ | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/compliance/ds76/types.ts` | B5-Cumplimiento | 51 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/compliance/ley19628.ts` | B5-Cumplimiento | 576 | ✓ | Praeventio Guard — Sprint 23 Bucket FF. |
| `src/services/compliance/normativeAuditLog.ts` | B5-Cumplimiento | 219 | ✓ | Praeventio Guard — §12.4.3: Audit log para mutaciones de normativa. |
| `src/services/compliance/registry.ts` | B5-Cumplimiento | 431 |  | Praeventio Guard — Sprint 38 (CL adapter consolidation). |
| `src/services/compliance/trafficLightEngine.ts` | B5-Cumplimiento | 238 | ✓ | Praeventio Guard — Sprint 39 Fase F.2: semáforo cumplimiento por proyecto. |
| `src/services/confidentialReports/confidentialReportsFirestoreAdapter.ts` | B18-Analitica | 118 | ✓ | Persistence #20: confidential reports adapter. |
| `src/services/confidentialReports/confidentialReportsService.ts` | B18-Analitica | 239 | ✓ | Praeventio Guard — Sprint K: Reportes Confidenciales + Canal Denuncias + Protección Represalias. |
| `src/services/confidentialReports/karinReportingEngine.ts` | B18-Analitica | 240 | ✓ | Praeventio Guard — Sprint 49: Ley Karin Reporting Engine. |
| `src/services/consistency/consistencyAuditor.ts` |  | 347 | ✓ | Praeventio Guard — Sprint 39 Fase G.3: revisión de consistencia entre módulos. |
| `src/services/consistency/consistencyStateBuilder.ts` |  | 226 | ✓ | Praeventio Guard — Sprint K wire UI (2026-05-23) consistency state builder. |
| `src/services/consultativeSale/consultativeSalePlaybook.ts` | B11-Contratistas | 286 | ✓ | Praeventio Guard — Sprint 52 §170: Consultative Sale Playbook. |
| `src/services/contingencySimulation/contingencyScenarioBuilder.ts` | B1-Emergencia | 675 |  | Praeventio Guard — Sprint 52: Simulador de escenarios de contingencia (§241). |
| `src/services/contingencySimulation/tabletopExerciseEngine.ts` | B1-Emergencia | 241 |  | Praeventio Guard — Sprint 52: Tabletop Exercise Engine (§242). |
| `src/services/continuity/continuityPlanning.ts` | B13-MOC | 225 | ✓ | Praeventio Guard — Sprint K: Continuidad Operacional + Punto Único de Falla + Polivalencia. |
| `src/services/contractors/contractorKpiService.ts` | B11-Contratistas | 180 | ✓ | Praeventio Guard — Sprint K: KPI Contratistas + Ranking + Acreditación. |
| `src/services/controlComparator/controlComparator.ts` |  | 314 | ✓ | Praeventio Guard — Sprint 52 §193: Comparador de Controles A vs B. |
| `src/services/controlComparator/controlFailureLibrary.ts` |  | 670 | ✓ | Praeventio Guard — Sprint 52 §306: Biblioteca de Fallas de Controles |
| `src/services/correctiveActions/correctiveActionsCenter.ts` | B4-Incidentes | 337 | ✓ | Praeventio Guard — Sprint 40 Fase F.4: Centro de Acciones Correctivas (PDCA). |
| `src/services/correctiveActions/correctiveActionsFirestoreAdapter.ts` | B4-Incidentes | 92 | ✓ | Persistence #19: corrective actions adapter. |
| `src/services/correctiveActions/weakActionDetector.ts` | B4-Incidentes | 298 | ✓ | Praeventio Guard — Sprint 39 Fase L.6: Acciones Correctivas Robustas. |
| `src/services/costCalculator/preventionCostCalculator.ts` | B15-Billing | 175 | ✓ | Praeventio Guard — Sprint 39 Fase J.3: Calculadoras de Costo Preventivo. |
| `src/services/cphs/cphsMinuteAutogenerator.ts` | B12-CPHS | 316 | ✓ | Praeventio Guard — Sprint 40 Fase F.7: Autogenerador minuta CPHS. |
| `src/services/cphs/cphsService.ts` | B12-CPHS | 396 | ✓ | Praeventio Guard — Sprint 28 Bucket B5: CPHS service. |
| `src/services/cphs/types.ts` | B12-CPHS | 164 |  | Praeventio Guard — Sprint 28 Bucket B5: CPHS (Comité Paritario de Higiene |
| `src/services/cqrs/incidents/incidentCommands.ts` | B4-Incidentes | 465 | ✓ | Praeventio Guard — Incident command handlers. |
| `src/services/cqrs/incidents/incidentEvents.ts` | B4-Incidentes | 307 |  | Praeventio Guard — Incident aggregate: eventos + reducer. |
| `src/services/cqrs/incidents/incidentReadModel.ts` | B4-Incidentes | 238 | ✓ | Praeventio Guard — Incident read model + projection. |
| `src/services/cqrs/incidents/incidentSystem.ts` | B4-Incidentes | 162 |  | Praeventio Guard — Incident CQRS system singleton. |
| `src/services/criticalControls/controlRobustness.ts` | B2-RiesgoIPER | 292 | ✓ | Praeventio Guard — Sprint 39 Fase L.5: extensiones criticalControls. |
| `src/services/criticalControls/controlValidationsStore.ts` | B2-RiesgoIPER | 78 |  | Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-22). |
| `src/services/criticalControls/criticalControlsLibrary.ts` | B2-RiesgoIPER | 132 | ✓ | Praeventio Guard — Sprint 39 Fase I.2: Biblioteca de Controles Críticos + Validación. |
| `src/services/criticalRoles/criticalRolesMap.ts` | B13-MOC | 236 | ✓ | Praeventio Guard — Sprint K: Mapa de Roles Críticos + Sustitutos. |
| `src/services/culturePulse/safetyCulturePulse.ts` | B12-CPHS | 176 | ✓ | Praeventio Guard — Sprint K: Encuesta percepción + índice cultura + reconocimiento. |
| `src/services/curriculum/claims.ts` | B6-Capacitacion | 373 | ✓ | Praeventio Guard — Round 14 (R5 agent): Experience-Validation claims. |
| `src/services/curriculum/historyAggregator.ts` | B6-Capacitacion | 172 | ✓ | Praeventio Guard — Round 17 (R5 agent): pure curriculum aggregator. |
| `src/services/curriculum/refereeTokens.ts` | B6-Capacitacion | 46 | ✓ | Praeventio Guard — Round 14 (R5 agent): magic-link referee tokens. |
| `src/services/dataConfidence/dataConfidencePanel.ts` | B18-Analitica | 276 | ✓ | Praeventio Guard — Sprint 43 §104: Panel Confianza Datos. |
| `src/services/dataQuality/incompletenessScanner.ts` |  | 486 | ✓ | Praeventio Guard — Sprint 40 Fase F.9: Detector de Datos Incompletos. |
| `src/services/dataSeedService.ts` |  | 114 |  | _exports:_ seedInitialData |
| `src/services/dea/deaFirestoreAdapter.ts` |  | 121 | ✓ | Persistence #N (Sprint C — 2026-05-15): DEA Firestore adapter. |
| `src/services/dea/deaService.ts` |  | 142 | ✓ | DEA (Desfibrilador Externo Automático) — Ley 21.156. |
| `src/services/deduplication/recordDeduplicator.ts` |  | 318 | ✓ | Praeventio Guard — Sprint 44 §108: Desduplicador de Registros. |
| `src/services/digitalTwin/gaussianSplatFirestoreAdapter.ts` |  | 84 | ✓ | Persistence #23: Gaussian Splat captures adapter. |
| `src/services/digitalTwin/gaussianSplatRegistry.ts` |  | 306 | ✓ | Praeventio Guard — Fase D parcial: Gaussian Splat registry for Digital Twin. |
| `src/services/digitalTwin/lifecycle/objectLifecycleOrchestrator.ts` | B14-IA | 468 | ✓ | Object Lifecycle Orchestrator — el wire que conecta: |
| `src/services/digitalTwin/objectPlacement/normativaRules.ts` |  | 260 | ✓ | Normativa rules engine — valida la colocación de objetos virtuales |
| `src/services/digitalTwin/onDeviceReconstruction/frameExtractor.ts` |  | 242 |  | Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction module. |
| `src/services/digitalTwin/onDeviceReconstruction/glbExporter.ts` |  | 101 |  | Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction. |
| `src/services/digitalTwin/onDeviceReconstruction/index.ts` |  | 258 |  | Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction pipeline. |
| `src/services/digitalTwin/onDeviceReconstruction/midasDepthEstimator.ts` |  | 273 | ✓ | Praeventio Guard — Plan 2026-05-23 §Fase D.1 — MiDaS depth ML on-device. |
| `src/services/digitalTwin/onDeviceReconstruction/pointCloudBuilder.ts` |  | 395 | ✓ | Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction. |
| `src/services/digitalTwin/onDeviceReconstruction/usdzExporter.ts` |  | 240 | ✓ | Praeventio Guard — §2.28 (2026-05-23) USDZ exporter para iOS Quick Look. |
| `src/services/digitalTwin/photogrammetry/mockAdapter.ts` |  | 173 | ✓ | Mock photogrammetry adapter — para tests + desarrollo offline. |
| `src/services/digitalTwin/photogrammetry/onDeviceAdapter.ts` |  | 271 |  | Praeventio Guard — §2.28 (2026-05-22) on-device PhotogrammetryAdapter. |
| `src/services/digitalTwin/photogrammetry/reconstructionJobStore.ts` |  | 204 |  | Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction. |
| `src/services/digitalTwin/photogrammetry/types.ts` |  | 200 |  | Photogrammetry types — Brecha C foundation. |
| `src/services/digitalTwin/placedObjectsStore.ts` |  | 137 | ✓ | Sprint 21 Ola 3 — Bucket J — placedObjectsStore. |
| `src/services/digitalTwin/siteGeometry.ts` |  | 227 |  | Sprint 13 — Digital Twin Phase A |
| `src/services/digitalTwin/siteGeometryStore.ts` |  | 103 |  | Sprint 13 — Digital Twin Phase A |
| `src/services/documentHygiene/documentHygieneEngine.ts` | B7-Salud | 267 | ✓ | Praeventio Guard — Sprint K: Higiene Documental. |
| `src/services/documents/documentVersioning.ts` |  | 281 | ✓ | Praeventio Guard — Sprint 41 Fase F.23: Versionado de Documentos. |
| `src/services/documents/documentVersioningFirestoreAdapter.ts` |  | 168 | ✓ | Praeventio Guard — Sprint 41 F.23 persistence. |
| `src/services/documents/legalDocTemplates.ts` |  | 291 | ✓ | Praeventio Guard — Sprint 39 Fase C.7: Legal docs desde plantilla. |
| `src/services/domainEvents/domainEventStore.ts` |  | 208 | ✓ | Praeventio Guard — Sprint 45 §151-153: Eventos de dominio auditables |
| `src/services/drillsManager/drillsManager.ts` | B1-Emergencia | 247 | ✓ | Praeventio Guard — Sprint K: Gestor de Simulacros + Evaluación Preparación. |
| `src/services/driving/commuteSession.ts` | B13-MOC | 299 | ✓ | Praeventio Guard — Sprint 12. |
| `src/services/driving/speedTrigger.ts` |  | 224 | ✓ | Praeventio Guard — Sprint 12. |
| `src/services/drivingSafety/drivingSafetyService.ts` |  | 203 | ✓ | Praeventio Guard — Sprint K: Conducción Segura + Rutas Críticas + Alertas Ruta. |
| `src/services/dte/dteAutoIssueOrchestrator.ts` | B5-Cumplimiento | 277 | ✓ | Praeventio Guard — Sprint 49 D.8.b: DTE Auto-Issue Orchestrator (pure). |
| `src/services/dte/dteIssueQueue.ts` | B5-Cumplimiento | 186 | ✓ | Praeventio Guard — Sprint 49 D.8.b: DTE Issue Queue (pure). |
| `src/services/efficacyVerification/efficacyVerifier.ts` |  | 342 | ✓ | Praeventio Guard — Sprint 44 F.11: Verificación de Eficacia. |
| `src/services/email/index.ts` |  | 25 |  | Praeventio Guard — Sprint 22 (Bucket Y) email service barrel. |
| `src/services/email/resendService.ts` |  | 167 | ✓ | Praeventio Guard — Sprint 22 (Bucket Y). |
| `src/services/email/templates.ts` |  | 559 |  | Praeventio Guard — Sprint 22 (Bucket Y). |
| `src/services/emergency/autoTrigger.ts` | B1-Emergencia | 424 | ✓ | Guardian Praeventio — emergency auto-trigger predicates. |
| `src/services/emergency/emergencyNumbers.ts` | B1-Emergencia | 229 | ✓ | Praeventio Guard — Sprint 39 Fase C.5: números de emergencia país-aware. |
| `src/services/emergency/gpsBreadcrumbTracker.ts` | B1-Emergencia | 164 | ✓ | Sprint 47 — Fase C.5: GPS breadcrumb tracker (engine puro). |
| `src/services/emergency/meshFallback.ts` | B1-Emergencia | 137 |  | Sprint 33 — Audit wire W10: emergency offline → mesh rebroadcast |
| `src/services/emergency/sosOrchestrator.ts` | B1-Emergencia | 263 | ✓ | Sprint 47 — Fase C.5: SOS Orchestrator (engine puro). |
| `src/services/emergency/sosOutbox.ts` | B1-Emergencia | 185 | ✓ | Praeventio Guard — Sprint 39 Fase C.5: SOS outbox offline-first. |
| `src/services/emergencyBrigade/emergencyBrigadeService.ts` | B1-Emergencia | 185 | ✓ | Praeventio Guard — Sprint K: Brigada Emergencia + Recursos + Extintores + Mapa + QR Puntos. |
| `src/services/engineering/scratchCalculations.ts` |  | 181 | ✓ | Praeventio Guard — Scratch storage para cálculos de ingeniería. |
| `src/services/engineeringControls/engineeringControlsInventory.ts` | B8-PermisosLOTO | 273 | ✓ | Praeventio Guard — Sprint K: Inventario Controles Ingeniería + Jerarquía + EPP Quality Audit. |
| `src/services/environment/chileClimatology.ts` |  | 237 | ✓ | Praeventio Guard — Chile climate normals (climatology). |
| `src/services/environmental/environmentalCompliance.ts` | B5-Cumplimiento | 271 | ✓ | Praeventio Guard — Sprint K: Residuos + Manifiestos + Huella Ambiental + ESG + Permisos Ambientales. |
| `src/services/environmental/wasteFirestoreAdapter.ts` |  | 117 | ✓ | Persistence #21: waste records + manifests adapter. |
| `src/services/environmentBackend.client.ts` |  | 163 | ✓ | environmentBackend (frontend client) |
| `src/services/environmentBackend.ts` |  | 466 | ✓ | _exports:_ updateGlobalEnvironmentalContext, ForecastLocation, TenantLocationContext, resolveTenantLocation, setTenantLocationResolver, getForecast |
| `src/services/eppBackend.ts` |  | 75 |  | _exports:_ predictEPPReplacement, auditEPPCompliance |
| `src/services/equipment/equipmentFirestoreAdapter.ts` | B10-EPP | 85 | ✓ | Persistence #10: equipmentQrService adapter. |
| `src/services/equipment/equipmentQrService.ts` | B10-EPP | 177 | ✓ | Praeventio Guard — Sprint 39 Fase I.5: QR Equipos + Pre-uso. |
| `src/services/ergonomics/landmarksToScore.ts` | B3-Ergonomia | 315 | ✓ | landmarksToScore — convierte 33 landmarks 3D MediaPipe Pose en los inputs |
| `src/services/ergonomics/poseEdgeFilter.ts` | B3-Ergonomia | 283 | ✓ | Sprint 34 — Pose-driven edge filter (REBA / RULA). |
| `src/services/ergonomics/reba.ts` | B3-Ergonomia | 379 | ✓ | REBA — Rapid Entire Body Assessment (deterministic backend). |
| `src/services/ergonomics/rula.ts` | B3-Ergonomia | 285 | ✓ | RULA — Rapid Upper Limb Assessment. |
| `src/services/erp/erpAdapter.ts` |  | 249 | ✓ | Praeventio Guard — ERP Integration adapter (honest implementation). |
| `src/services/escalation/escalationSlaEngine.ts` |  | 368 | ✓ | Praeventio Guard — Sprint 50 §206-210: Escalation engine + SLA cierre. |
| `src/services/etl/csvAdapter.ts` |  | 355 | ✓ | Sprint 24 — Bucket JJ — Universal CSV importer/exporter. |
| `src/services/etl/schemas.ts` |  | 312 | ✓ | Sprint 24 — Bucket JJ — Pre-built CSV schemas for the 6 entity types |
| `src/services/euler/criticalLoad.ts` |  | 146 | ✓ | Euler critical buckling load — Fase 3 del plan Euler-Matrix. |
| `src/services/euler/eulerianPath.ts` |  | 274 | ✓ | Eulerian path / circuit finder — Fase 2 del plan Euler-Matrix |
| `src/services/euler/eulerLagrange.ts` |  | 243 | ✓ | Cálculo variacional Euler-Lagrange — Fase 8 del plan Euler-Matrix. |
| `src/services/euler/fftAnalyzer.ts` |  | 218 | ✓ | Fast Fourier Transform — Fase 5 del plan Euler-Matrix. |
| `src/services/euler/graphConnectivity.ts` |  | 233 | ✓ | Euler graph connectivity primitives — Fase 1 del plan Euler-Matrix |
| `src/services/euler/index.ts` |  | 27 |  | Barrel for Euler-driven primitives — pareja matemática de Bernoulli |
| `src/services/euler/inviscidFlow.ts` |  | 225 | ✓ | Ecuaciones de Euler de fluidos no-viscosos — Fase 4 del plan Euler-Matrix. |
| `src/services/euler/odeIntegrator.ts` |  | 308 | ✓ | Método de Euler explícito para ODE — Fase 6 del plan Euler-Matrix. |
| `src/services/euler/polyhedronAchievements.ts` |  | 199 | ✓ | Característica de Euler V-E+F=2 — Fase 10 del plan Euler-Matrix |
| `src/services/euler/zettelkastenTopology.ts` |  | 277 | ✓ | Topología auto-organizativa de Zettelkasten — Fase 7 del plan Euler-Matrix. |
| `src/services/evacuation/evacuationFirestoreAdapter.ts` | B1-Emergencia | 120 | ✓ | Praeventio Guard — Sprint 39 Persistence Layer #4: evacuationHeadcount adapter. |
| `src/services/evacuation/evacuationHeadcount.ts` | B1-Emergencia | 163 | ✓ | Praeventio Guard — Sprint 39 Fase G.12: Conteo de evacuación con QR. |
| `src/services/eventBus/eventBus.ts` |  | 360 | ✓ | Praeventio Guard — Fase C.4: Event Bus global in-process. |
| `src/services/eventBus/integrations.ts` |  | 189 |  | Praeventio Guard — Fase C.4: Integraciones eventBus ↔ services SST. |
| `src/services/eventReplay/eventReplayAuditTool.ts` |  | 391 | ✓ | Praeventio Guard — Sprint 53 §147-152: Event replay sourcing audit tool |
| `src/services/eventStore/inMemoryEventStore.ts` |  | 231 | ✓ | Praeventio Guard — In-memory Event Store. |
| `src/services/eventStore/types.ts` |  | 172 |  | Praeventio Guard — Event Store core types. |
| `src/services/evidenceChain/custodyChainFirestoreAdapter.ts` |  | 76 | ✓ | Persistence #11: custodyChainService adapter. |
| `src/services/evidenceChain/custodyChainService.ts` |  | 249 | ✓ | Praeventio Guard — Sprint 39 Fase J.7: Cadena de Custodia de Evidencias. |
| `src/services/excelImport/excelImporter.ts` |  | 219 | ✓ | Praeventio Guard — Sprint K: Importador Excel + Validador + Desduplicador. |
| `src/services/excelImporter/deduplicator.ts` |  | 125 | ✓ | Praeventio Guard — Sprint K §108 — Deduplicador. |
| `src/services/excelImporter/index.ts` |  | 52 |  | Praeventio Guard — Sprint K §106-108 — Excel importer (barrel). |
| `src/services/excelImporter/recordValidator.ts` |  | 278 | ✓ | Praeventio Guard — Sprint K §107 — Validador estructural (Zod) por kind. |
| `src/services/excelImporter/xlsxReader.ts` |  | 316 | ✓ | Praeventio Guard — Sprint K §106 — Lector de archivos Excel. |
| `src/services/exceptions/exceptionEngine.ts` | B8-PermisosLOTO | 244 | ✓ | Praeventio Guard — Sprint 39 Fase G.2: Motor de excepciones. |
| `src/services/exceptions/exceptionFirestoreAdapter.ts` | B8-PermisosLOTO | 132 | ✓ | Persistence #12: exceptionEngine adapter. |
| `src/services/exceptions/exceptionStore.ts` | B8-PermisosLOTO | 38 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) exception store. |
| `src/services/expirations/expirationScanner.ts` |  | 204 | ✓ | Praeventio Guard — Sprint 39 Fase B.9: vencimientos universales. |
| `src/services/explainability/recommendationExplainer.ts` | B14-IA | 231 | ✓ | Praeventio Guard — Sprint 41 Fase F.28: Explicabilidad de Recomendaciones. |
| `src/services/exposure/exposureFirestoreAdapter.ts` |  | 50 | ✓ | Persistence #5: exposureRegistry adapter. |
| `src/services/exposure/exposureRegistry.ts` |  | 106 | ✓ | Praeventio Guard — Sprint 39 Fase G.8: Registro de exposición ocupacional. |
| `src/services/exposure/thermalStressCalculator.ts` |  | 281 | ✓ | Praeventio Guard — Sprint 39 Fase L.9: Estrés Térmico + UV + Aclimatación. |
| `src/services/external/eonet/eonetAdapter.ts` |  | 157 | ✓ | EONET adapter — natural-event feed (wildfires, storms, volcanoes, …). |
| `src/services/external/eonet/types.ts` |  | 79 |  | External natural-event feed adapter — type definitions. |
| `src/services/external/index.ts` |  | 70 |  | External natural-event feeds — shared module re-exports. |
| `src/services/external/nasaPower/nasaPowerAdapter.ts` |  | 325 | ✓ | NASA POWER adapter — clima histórico hourly por punto GPS. |
| `src/services/external/nasaPower/types.ts` |  | 138 |  | NASA POWER (Prediction Of Worldwide Energy Resources) types. |
| `src/services/external/recommendationBuilder.ts` |  | 221 | ✓ | Calm-recommendation builder. |
| `src/services/external/usgs/types.ts` |  | 40 |  | USGS Earthquake feed adapter — type definitions. |
| `src/services/external/usgs/usgsEarthquakeAdapter.ts` |  | 128 | ✓ | USGS Earthquake adapter — sub-minute global seismic feed. |
| `src/services/fatigue/fatigueMonitor.ts` | B7-Salud | 140 | ✓ | Praeventio Guard — Sprint 39 Fase I.4: Control de Fatiga por Jornada. |
| `src/services/financialAnalytics/eppBudgetTracker.ts` | B18-Analitica | 212 | ✓ | Praeventio Guard — Sprint 51 §176: EPP Budget Tracker. |
| `src/services/financialAnalytics/purchaseOrderSuggester.ts` | B18-Analitica | 159 | ✓ | Praeventio Guard — Sprint 51 §177: Purchase Order Suggester. |
| `src/services/financialAnalytics/roiCalculator.ts` | B18-Analitica | 235 | ✓ | Praeventio Guard — Sprint 51 §175 + §178: ROI Calculator. |
| `src/services/firebase.ts` | B3-Ergonomia | 370 |  | _exports:_ db, auth, storage, googleProvider, getMessagingInstance, signInWithGoogle, logOut, testConnection, OperationType, FirestoreErrorInfo, handleFirestoreError, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, onAuthStateChanged, ref, uploadBytes, getDownloadURL, deleteObject, listAll, getToken, onMessage |
| `src/services/firestore/createProjectScopedStore.ts` |  | 264 | ✓ | Praeventio Guard — Plan 2026-05-23 Fase B.1. |
| `src/services/firestore/resilientReader.ts` |  | 214 | ✓ | Resilient Firestore Reader — retry exponencial + offline cache fallback. |
| `src/services/firstResponderMap/firstResponderMap.ts` | B1-Emergencia | 307 | ✓ | Praeventio Guard — Sprint 52 §219: First Responder Map per site. |
| `src/services/fiveS/fiveSAudit.ts` |  | 140 | ✓ | Praeventio Guard — Sprint K: 5S Audit + Housekeeping + Zone Scoring. |
| `src/services/focusBlocks/focusBlocks.ts` |  | 313 | ✓ | Praeventio Guard — §201-210 Bloques de Foco (core). |
| `src/services/foregroundService/guardianForegroundService.ts` |  | 217 | ✓ | Praeventio Guard — Sprint 47 C.2: Foreground Service Android. |
| `src/services/formBuilderAdvanced/advancedFieldEngine.ts` | B9-Inspecciones | 871 | ✓ | Praeventio Guard — Sprint 53 §263-268: Form Builder ADVANCED fields. |
| `src/services/gamification/daysWithoutIncident.ts` | B4-Incidentes | 151 | ✓ | Sprint 29 Bucket DD F-D — "Días sin incidentes" gamification axis. |
| `src/services/gamification/positiveXp.ts` | B6-Capacitacion | 108 | ✓ | Sprint 15 — Positive-only XP API. |
| `src/services/gamificationBackend.ts` | B6-Capacitacion | 74 |  | _exports:_ awardPoints, getLeaderboard, checkMedalEligibility |
| `src/services/gamificationService.ts` | B6-Capacitacion | 54 |  | _exports:_ POINT_VALUES, PointReason, awardPoints, getLeaderboard |
| `src/services/gemini/_shared.ts` | B14-IA | 98 |  | Praeventio Guard — TODO.md §12.5.1: helpers compartidos para el |
| `src/services/gemini/chat.ts` | B14-IA | 204 | ✓ | Praeventio Guard — §12.5.1 split step 10: Gemini chat + advice. |
| `src/services/gemini/embeddings.ts` | B14-IA | 161 | ✓ | Praeventio Guard — §12.5.1 split step 4: Gemini embeddings + semantic search. |
| `src/services/gemini/emergency.ts` | B1-Emergencia | 187 | ✓ | Praeventio Guard — §12.5.1 split step 8: Gemini emergency planning. |
| `src/services/gemini/governance.ts` | B14-IA | 133 | ✓ | Praeventio Guard — §12.5.1 split step 1: Gemini governance helpers. |
| `src/services/gemini/operations.ts` | B14-IA | 392 | ✓ | Praeventio Guard — §12.5.1 split step 12: Gemini operations bundle. |
| `src/services/gemini/parsing.ts` | B14-IA | 68 | ✓ | Praeventio Guard — §12.5.1 split step 3: Gemini response parsing + retry. |
| `src/services/gemini/personPlans.ts` | B14-IA | 245 | ✓ | Praeventio Guard — §12.5.1 split step 11: Gemini person-centric plans. |
| `src/services/gemini/pii.ts` | B14-IA | 53 | ✓ | Praeventio Guard — §12.5.1 split step 2: Gemini PII redaction seam. |
| `src/services/gemini/risk.ts` | B14-IA | 303 | ✓ | Praeventio Guard — §12.5.1 split step 6: Gemini risk analysis bundle. |
| `src/services/gemini/safetyDocs.ts` | B14-IA | 162 | ✓ | Praeventio Guard — §12.5.1 split step 9: Gemini safety documents. |
| `src/services/gemini/suggestions.ts` | B14-IA | 115 | ✓ | Praeventio Guard — §12.5.1 split step 7: Gemini proactive suggestions. |
| `src/services/gemini/vision.ts` | B14-IA | 163 | ✓ | Praeventio Guard — §12.5.1 split step 5: Gemini multimodal/vision. |
| `src/services/geminiBackend.ts` | B14-IA | 1467 | ✓ | _exports:_ generateRealisticIoTEvent, simulateRiskPropagation, enrichNodeData, generatePredictiveForecast, generateOperationalTasks, forecastSafetyEvents, analyzeRiskNetwork, predictAccidents, analyzeSiteMapDensity, generateTrainingQuiz, validateRiskImageClick, calculateDynamicEvacuationRoute |
| `src/services/geminiService.ts` | B14-IA | 144 |  | _exports:_ generateEmbeddingsBatch, autoConnectNodes, semanticSearch, analyzeFastCheck, predictGlobalIncidents, analyzeRiskWithAI, analyzePostureWithAI, generateEmergencyPlan, analyzeSafetyImage, generateISOAuditChecklist, generatePTS, generatePTSWithManufacturerData |
| `src/services/geofence/permissionUXDecision.ts` | B1-Emergencia | 336 | ✓ | Sprint 50 E.5 P2 H27 — Geofence permission UX decision engine. |
| `src/services/geofence/polygonUtils.ts` | B1-Emergencia | 276 | ✓ | Praeventio Guard — §12.6.3: Geofence polygon utility. |
| `src/services/glossary/glossaryEngine.ts` |  | 324 | ✓ | Praeventio Guard — Sprint 50 §97-99: Glosario + FAQ + Feedback Utilidad. |
| `src/services/governance/deviationNormalizationRadar.ts` |  | 247 | ✓ | Praeventio Guard — Sprint 39 Fase L.2: Radar de Normalización del Desvío. |
| `src/services/hazmat/hazmatExposureCalculator.ts` | B10-EPP | 277 | ✓ | Hazmat exposure calculator — radios de aislamiento + evacuación |
| `src/services/hazmat/hazmatExtensions.ts` | B10-EPP | 354 | ✓ | Praeventio Guard — Sprint 39 Fase L.11: Hazmat QR + Modo Derrame + Compatibilidad GHS. |
| `src/services/hazmat/hazmatInventory.ts` | B10-EPP | 199 | ✓ | Praeventio Guard — Sprint 39 Fase G.7: Control de sustancias peligrosas. |
| `src/services/hazmat/hazmatSegregation.ts` | B10-EPP | 211 | ✓ | Hazmat segregation matrix — IMDG Code 7.2.4 (International Maritime |
| `src/services/health/googleFitAdapter.ts` | B7-Salud | 204 |  | Google Fit adapter (DEPRECATED wrapper). |
| `src/services/health/healthConnectAdapter.ts` | B7-Salud | 411 | ✓ | Health Connect adapter — REAL implementation (Round 2). |
| `src/services/health/healthFacadeNative.ts` | B7-Salud | 427 | ✓ | Native health facade — Bucket P (Sprint 21 ola 5). |
| `src/services/health/healthKitAdapter.ts` | B7-Salud | 265 |  | iOS HealthKit adapter — REAL implementation (Round 3 phase 1). |
| `src/services/health/index.ts` | B7-Salud | 118 |  | Health adapter facade. |
| `src/services/health/nativeHealthAdapter.ts` | B7-Salud | 224 | ✓ | Native Health Adapter — Sprint 30 Bucket HH (audit close-out). |
| `src/services/health/occupationalContext.ts` | B7-Salud | 888 | ✓ | OccupationalContextBundle — Bucket WW (Sprint 26). |
| `src/services/health/shiftWindow.ts` | B7-Salud | 125 | ✓ | Sprint 25 — Privacy by Design (ADR 0010) — ShiftWindow guard |
| `src/services/health/types.ts` | B7-Salud | 107 |  | Shared types for the Health data layer. |
| `src/services/health/vaultRecord.ts` | B7-Salud | 202 | ✓ | Sprint 26 Bucket VV — HealthRecord shape unificado (ADR 0012). |
| `src/services/health/vaultShare.ts` | B7-Salud | 257 | ✓ | Sprint 25 — HealthVault Share Token (ADR 0012) |
| `src/services/heatmap/findingsHeatmapBuilder.ts` | B2-RiesgoIPER | 190 | ✓ | Praeventio Guard — Sprint 42 Fase F.14: Mapa de Calor de Hallazgos. |
| `src/services/horometro/horometroService.ts` | B10-EPP | 393 |  | Praeventio Guard — Bloque 4.1: Horometro -> Mantenimiento Preventivo flow. |
| `src/services/hvac/thermalModel.ts` |  | 284 | ✓ | Praeventio Guard — Sprint 39 Fase D.3: Modelo térmico 1R1C + CO2 HVAC. |
| `src/services/hygiene/metabolicRate.ts` | B7-Salud | 69 | ✓ | Mifflin-St Jeor Basal Metabolic Rate calculator. |
| `src/services/i18n/culturalConventions.ts` |  | 150 | ✓ | Sprint 31 Bucket SS — Cultural conventions framework. |
| `src/services/identity/rutValidators.ts` |  | 300 | ✓ | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/services/immutable/pdfImmutableService.ts` |  | 401 | ✓ | Praeventio Guard — PDF inmutable real (jsPDF + SHA-256 content addressing). |
| `src/services/inbox/inboxAggregator.ts` | B18-Analitica | 487 | ✓ | Praeventio Guard — Sprint 40 Fase F.8: Bandeja Inbox del Prevencionista. |
| `src/services/incidentBundle/incidentEvidenceBundle.ts` | B4-Incidentes | 433 | ✓ | Praeventio Guard — Sprint 43 Fase F.3: Paquete de Evidencia por Incidente. |
| `src/services/incidents/incidentRagService.ts` | B4-Incidentes | 436 | ✓ | Sprint 29 Bucket AA F-B — Incident RAG (NL search sobre histórico tenant). |
| `src/services/incidentTrends/trendAnalyzer.ts` | B4-Incidentes | 341 | ✓ | Praeventio Guard — Sprint 41 Fase F.29: Indicadores tendencia incidentes. |
| `src/services/industryRules/industryRuleEngine.ts` | B5-Cumplimiento | 179 | ✓ | Praeventio Guard — Sprint 39 Fase J.1: Motor de Reglas por Industria. |
| `src/services/inspections/inspectionOutbox.ts` | B9-Inspecciones | 554 | ✓ | Praeventio Guard — Fase F.6 P1 #3 fix (PR #322 Codex review). |
| `src/services/inspections/offlineInspectionService.ts` | B9-Inspecciones | 254 | ✓ | Praeventio Guard — Sprint 42 Fase F.6: Modo Sin Señal para Inspecciones. |
| `src/services/internalTransit/internalTransitService.ts` |  | 353 | ✓ | Praeventio Guard — Sprint 39 Fase L.10: Tránsito Interno + Convivencia. |
| `src/services/inventoryBackend.ts` | B10-EPP | 80 |  | _exports:_ optimizePPEInventory |
| `src/services/iot/edgeFilter.ts` |  | 622 | ✓ | Sprint 34 — Edge Filtering, dos fases (mineria subterranea / mesh-first). |
| `src/services/iot/firestoreBridge.ts` |  | 221 | ✓ | Sprint 32 Bucket TT — MQTT → Firestore bridge. |
| `src/services/iot/ingestRuleEngine.ts` |  | 167 |  | Sprint 32 Bucket TT — Ingest rule engine. |
| `src/services/iot/mqttAdapter.ts` |  | 350 |  | Sprint 32 Bucket TT — MQTT adapter (dual + in-memory). |
| `src/services/iot/mqttClient.ts` |  | 368 | ✓ | Praeventio Guard — MQTT-over-WebSocket client real (no simulación). |
| `src/services/iot/probabilityFailureScoring.ts` |  | 172 | ✓ | Praeventio Guard — §12.7.4: Telemetría IoT ↔ Probabilidad Falla |
| `src/services/iot/types.ts` |  | 103 |  | Sprint 32 Bucket TT — IoT canonical types. |
| `src/services/jsa/jobSafetyAnalysis.ts` | B2-RiesgoIPER | 382 | ✓ | Praeventio Guard — Job Safety Analysis (JSA / Análisis de Seguridad |
| `src/services/knowledgeBase/knowledgeBaseService.ts` |  | 180 | ✓ | Praeventio Guard — Sprint K: Base conocimiento + Glosario + FAQ + Curador. |
| `src/services/leadership/supervisionDecisionTrail.ts` |  | 198 | ✓ | Praeventio Guard — Sprint K: Historial de Decisiones de Supervisión + Ranking. |
| `src/services/legal/legalRuleEngine.ts` |  | 255 | ✓ | Praeventio Guard — Sprint 39 Fase B.10: abogado codificado. |
| `src/services/legal/termsContent.ts` |  | 134 |  | Términos y Condiciones de Servicio — Praeventio Guard |
| `src/services/legalBackend.ts` |  | 143 |  | _exports:_ auditLegalGap, evaluateNormativeImpact |
| `src/services/legalCalendar/legalCalendarStore.ts` | B5-Cumplimiento | 61 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) legal calendar store. |
| `src/services/legalCalendar/legalObligationsCalendar.ts` | B5-Cumplimiento | 240 | ✓ | Praeventio Guard — Sprint 39 Fase J.2: Calendario Obligaciones Legales. |
| `src/services/lessonsLearned/lessonsFirestoreAdapter.ts` | B4-Incidentes | 67 | ✓ | Persistence #17: lessons library adapter. |
| `src/services/lessonsLearned/lessonsLibrary.ts` | B4-Incidentes | 171 | ✓ | Praeventio Guard — Sprint K: Biblioteca de Lecciones Aprendidas (F.12). |
| `src/services/lineOfFire/lineOfFireChecker.ts` |  | 189 | ✓ | Praeventio Guard — Sprint K: Control de Línea de Fuego. |
| `src/services/loneWorker/loneWorkerService.ts` | B1-Emergencia | 118 | ✓ | Praeventio Guard — Sprint 39 Fase G.11: Control de trabajo solitario. |
| `src/services/loneWorker/loneWorkerStore.ts` | B1-Emergencia | 43 |  | Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-23). |
| `src/services/loneWorker/manDownTimer.ts` | B1-Emergencia | 301 | ✓ | Praeventio Guard — §12.6.2: ManDown timer + re-escalación service. |
| `src/services/loto/lotoDigitalLight.ts` | B8-PermisosLOTO | 171 | ✓ | Praeventio Guard — Sprint K: LOTO Digital Liviano + Energías Peligrosas. |
| `src/services/loto/lotoFirestoreAdapter.ts` | B8-PermisosLOTO | 87 | ✓ | Persistence #16: LOTO digital adapter. |
| `src/services/maintenance/horometerEngine.ts` | B10-EPP | 269 | ✓ | Praeventio Guard — Sprint 39 Fase C.6: Horómetro → mantenimiento → calendario. |
| `src/services/maintenance/maintenanceScheduler.ts` | B10-EPP | 311 |  | Praeventio Guard — Bloque 4.1: Mantenimiento preventivo scheduler. |
| `src/services/maturity/preventionMaturityIndex.ts` | B2-RiesgoIPER | 395 | ✓ | Praeventio Guard — Sprint 41 F.26: Indicador de Madurez Preventiva. |
| `src/services/mcp/stdioBoot.ts` |  | 62 | ✓ | Praeventio Guard — Sprint 49 activación @modelcontextprotocol/sdk. |
| `src/services/mcp/zettelkastenServer.ts` |  | 340 | ✓ | Praeventio Guard — Sprint 39 Fase D.11: MCP Zettelkasten server. |
| `src/services/mcp/zettelkastenStdioAdapter.ts` |  | 168 | ✓ | Praeventio Guard — Sprint 45 D.11 (cierre): stdio adapter para MCP server. |
| `src/services/measurements/measurementChain.ts` |  | 261 | ✓ | Praeventio Guard — Sprint 39 Fase L.12: Cadena de Medición + Calibración. |
| `src/services/medical/aptitudeCertGenerator.ts` | B7-Salud | 356 | ✓ | Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Certificate generator. |
| `src/services/medical/aptitudeCertSigner.ts` | B7-Salud | 199 | ✓ | Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Certificate signer. |
| `src/services/medical/bodyRoutineGenerator.ts` | B7-Salud | 370 | ✓ | Praeventio Guard — §12.6.5: HumanBodyViewer rutinas auto-generadas |
| `src/services/medical/iconLibrary.ts` | B7-Salud | 98 | ✓ | Sprint 17c — Bioicons-derived medical icon registry. |
| `src/services/medicalAnalysisBackend.ts` | B7-Salud | 284 |  | Praeventio Guard — TODO.md §12.5.1: medical analysis backend split. |
| `src/services/medicineBackend.ts` | B7-Salud | 208 |  | _exports:_ mapRisksToSurveillance, analyzeHealthPatterns, generateCompensatoryExercises |
| `src/services/meetingPack/meetingPackBuilder.ts` | B12-CPHS | 331 | ✓ | Praeventio Guard — Sprint 51 §188-190: Pack supervisor + Resumen reunión |
| `src/services/mentalLoad/mentalLoadTracker.ts` | B7-Salud | 155 | ✓ | Praeventio Guard — Sprint K: Carga mental + Carga administrativa + Automatizador admin. |
| `src/services/mesh/fileChunker.ts` | B16-Offline | 81 | ✓ | Sprint 26 — File Chunker (ADR 0013) |
| `src/services/mesh/meshPacket.ts` | B16-Offline | 367 | ✓ | Sprint 25 — Mesh Packet (ADR 0013) |
| `src/services/mesh/meshRelayQueue.ts` | B16-Offline | 317 | ✓ | Sprint 25 — Mesh Relay Queue (ADR 0013) |
| `src/services/mesh/meshRelayXpWire.ts` | B16-Offline | 69 |  | Sprint 32 — Mesh relay → Positive XP wire. |
| `src/services/mesh/meshRequestRouter.ts` | B16-Offline | 343 | ✓ | Sprint 26 — Mesh Request Router (ADR 0013) |
| `src/services/mesh/transportFacade.ts` | B16-Offline | 241 | ✓ | Sprint 30 — Mesh Transport Facade (ADR 0013, Bucket II) |
| `src/services/microtraining/lightningTrainingService.ts` | B6-Capacitacion | 350 | ✓ | Praeventio Guard — Sprint 41 F.22: Modo Capacitación Relámpago. |
| `src/services/microtraining/microtrainingFirestoreAdapter.ts` | B6-Capacitacion | 132 | ✓ | Praeventio Guard — Sprint 41 F.22 persistence. |
| `src/services/migration/registry.ts` |  | 171 | ✓ | Praeventio Guard — Sprint 24 differentiators (Bucket MM). |
| `src/services/ml/vertexTrainer.ts` |  | 164 | ✓ | Sprint 32 Bucket VV — Vertex AI custom training scaffold. |
| `src/services/mobile/foregroundServiceClient.ts` |  | 262 | ✓ | Praeventio Guard — Sprint mobile FGS: foreground-service client wrapper. |
| `src/services/multiProject/projectComparator.ts` | B18-Analitica | 326 | ✓ | Praeventio Guard — Sprint 41 Fase F.27: Comparador entre Proyectos. |
| `src/services/multiRoleSummary/roleSummaryComposer.ts` | B3-Ergonomia | 431 | ✓ | Praeventio Guard — Sprint 49 §134-138: Resúmenes multi-rol + lecciones |
| `src/services/networkBackend.ts` |  | 206 | ✓ | _exports:_ syncNodeToNetwork, syncBatchToNetwork |
| `src/services/nodeSeedService.ts` |  | 79 |  | _exports:_ seedProjectNodes, SEED_COUNT |
| `src/services/nonConformity/nonConformityEngine.ts` | B5-Cumplimiento | 185 | ✓ | Praeventio Guard — Sprint 49: No Conformidades engine. |
| `src/services/normativa/countryPacks.ts` |  | 95 | ✓ | Country-pack registry for jurisdiction-aware normativa. |
| `src/services/normativa/locationNormativa.ts` |  | 422 | ✓ | GPS-based country detection for the normativa pack loader. |
| `src/services/notifications/fcmAdapter.ts` |  | 140 | ✓ | Praeventio Guard — Firebase Cloud Messaging (FCM) server-side adapter. |
| `src/services/oauthTokenStore.ts` | B17-Admin | 223 |  | Server-only Google OAuth token store. |
| `src/services/observability/cloudErrorReportingAdapter.browser-stub.ts` | B9-Inspecciones | 47 |  | Praeventio Guard — cloudErrorReportingAdapter browser stub. |
| `src/services/observability/cloudErrorReportingAdapter.ts` | B9-Inspecciones | 82 |  | Praeventio Guard — GCP Cloud Error Reporting adapter (STUB INTENCIONAL). |
| `src/services/observability/errorTrackingAdapter.ts` | B9-Inspecciones | 23 |  | Praeventio Guard — Error tracking adapter shared helpers. |
| `src/services/observability/index.ts` | B9-Inspecciones | 167 |  | Praeventio Guard — Observability module facade. |
| `src/services/observability/metricsAdapter.ts` | B9-Inspecciones | 206 |  | Praeventio Guard — Metrics adapter (counters / gauges / histograms). |
| `src/services/observability/noopErrorTrackingAdapter.browser-stub.ts` | B9-Inspecciones | 129 |  | Praeventio Guard — noopErrorTrackingAdapter browser stub. |
| `src/services/observability/noopErrorTrackingAdapter.ts` | B9-Inspecciones | 196 |  | Praeventio Guard — Noop error tracking adapter (dev / CI default). |
| `src/services/observability/piiRedactor.ts` | B9-Inspecciones | 126 | ✓ | Praeventio Guard — PII redactor for Vertex AI prompts. |
| `src/services/observability/quotaTracker.ts` | B9-Inspecciones | 363 | ✓ | Praeventio Guard — Sprint 22 prod hardening (Bucket X). |
| `src/services/observability/resilienceHealthMonitor.ts` | B7-Salud | 551 | ✓ | Resilience Health Monitor — agrega el estado de todos los |
| `src/services/observability/sentryAdapter.browser-stub.ts` | B9-Inspecciones | 60 |  | Praeventio Guard — sentryAdapter browser stub. |
| `src/services/observability/sentryAdapter.ts` | B9-Inspecciones | 263 | ✓ | Praeventio Guard — Sentry error tracking adapter (real SDK). |
| `src/services/observability/sentryInstrumentation.ts` | B9-Inspecciones | 202 | ✓ | Praeventio Guard — Sentry instrumentation helper. |
| `src/services/observability/slos.ts` | B9-Inspecciones | 153 | ✓ | Praeventio Guard — Sprint 24 differentiators (Bucket MM.4). |
| `src/services/observability/tracing.ts` | B9-Inspecciones | 267 |  | Praeventio Guard — Sprint 22 Bucket AA. |
| `src/services/observability/types.ts` | B9-Inspecciones | 198 |  | Praeventio Guard — Observability adapter types. |
| `src/services/onboarding/faenaOnboardingBundle.ts` | B6-Capacitacion | 178 | ✓ | Praeventio Guard — Sprint 39 Fase G.10: Paquete de ingreso a faena. |
| `src/services/onboarding/faenaOnboardingFirestoreAdapter.ts` | B6-Capacitacion | 75 | ✓ | Persistence #9: faenaOnboardingBundle adapter. |
| `src/services/openapi/bootstrap.ts` |  | 457 |  | Sprint 36 — OpenAPI registry bootstrap. |
| `src/services/openapi/registry.ts` |  | 92 |  | Sprint 36 — Auto-OpenAPI registry. |
| `src/services/openapi/specGenerator.ts` |  | 227 | ✓ | Sprint 36 — OpenAPI 3.1 spec generator. |
| `src/services/operationalState/faenaStateEngine.ts` |  | 132 | ✓ | Praeventio Guard — Sprint 39 Fase G.5: Estado Operacional de Faena. |
| `src/services/orchestratorService.ts` | B14-IA | 208 | ✓ | _exports:_ fetchWeatherData, fetchSeismicData, fetchEnvironmentContext |
| `src/services/organic/crewService.ts` | B12-CPHS | 171 | ✓ | Sprint 15 — Crew persistence layer. |
| `src/services/organic/processService.ts` | B12-CPHS | 218 | ✓ | Sprint 15 — Process lifecycle + positive XP economy. |
| `src/services/organic/taskService.ts` | B12-CPHS | 82 | ✓ | Sprint 15 — Task persistence layer. |
| `src/services/orgMetrics/organizationalMetrics.ts` | B18-Analitica | 302 | ✓ | Praeventio Guard — Sprint K: Métricas organizacionales. |
| `src/services/pdca/pdcaCycle.ts` |  | 199 | ✓ | Praeventio Guard — Sprint K: PDCA + No Conformidades + Eficacia. |
| `src/services/pdca/pdcaCycleEngine.ts` |  | 226 | ✓ | Praeventio Guard — Sprint 49: PDCA Cycle Engine (multi-cycle projects). |
| `src/services/photoEvidence/photoEvidenceEngine.ts` | B9-Inspecciones | 275 | ✓ | Praeventio Guard — Sprint 42 Fase F.19: Motor Evidencia Fotográfica. |
| `src/services/photoEvidence/photoEvidenceFirestoreAdapter.ts` | B9-Inspecciones | 143 | ✓ | Praeventio Guard — Sprint 42 Fase F.19: Photo Evidence persistence. |
| `src/services/physics/bernoulliEngine.ts` |  | 55 | ✓ | Bernoulli engine — fluid dynamics for ventilation, hazmat, structural and EPP modules. SI units. |
| `src/services/pinSign/pinSignService.ts` |  | 333 | ✓ | Praeventio Guard — Sprint K F.25: PIN Sign (firma por PIN sin biometría). |
| `src/services/portfolioLessons/portfolioLessonsEngine.ts` | B6-Capacitacion | 299 | ✓ | Praeventio Guard — Sprint 53: Portfolio Lessons Transfer Engine. |
| `src/services/positiveObservations/positiveObservationsFirestoreAdapter.ts` | B9-Inspecciones | 65 | ✓ | Persistence #18: positive observations adapter. |
| `src/services/positiveObservations/positiveObservationsService.ts` | B9-Inspecciones | 163 | ✓ | Praeventio Guard — Sprint K: Observaciones Positivas + Balance. |
| `src/services/postTraining/postTrainingAssessmentEngine.ts` | B6-Capacitacion | 255 | ✓ | Praeventio Guard — Sprint 51 §83-87: Aprendizaje post-capacitación + |
| `src/services/predictionBackend.ts` |  | 126 |  | _exports:_ generatePredictiveForecast, analyzeRiskCorrelations |
| `src/services/predictiveAlerts/alertScheduler.ts` | B18-Analitica | 99 | ✓ | Sprint 15 — Predictive alert scheduler. |
| `src/services/predictiveAlerts/calendarPreWarn.ts` | B18-Analitica | 362 | ✓ | Sprint 29 Bucket DD F-E — Predictive × Calendar pre-warning. |
| `src/services/predictiveAlerts/windowedTrigger.ts` | B18-Analitica | 109 | ✓ | Sprint 15 — Windowed predictive trigger. |
| `src/services/pricing/aiTier.ts` | B15-Billing | 253 | ✓ | Praeventio Guard — B2D API tiers (single source of truth) |
| `src/services/pricing/eppIndustryCatalog.ts` | B15-Billing | 318 | ✓ | Praeventio Guard — Sprint K §171-179: EPP catalog per industry. |
| `src/services/pricing/iapSkus.ts` | B15-Billing | 160 | ✓ | Praeventio Guard — §2.13 fix (2026-05-22). |
| `src/services/pricing/jurisdictionLimits.ts` | B15-Billing | 74 | ✓ | Sprint 31 OO — Jurisdiction limits per tier. |
| `src/services/pricing/subscriptionPlan.ts` | B15-Billing | 61 | ✓ | _exports:_ SUBSCRIPTION_PLANS, SubscriptionPlan, TIER_TO_SUBSCRIPTION_PLAN, isSubscriptionPlan, subscriptionPlanForPaidTier, normalizeSubscriptionPlanId, subscriptionPlanMatchesPaidTier |
| `src/services/pricing/tiers.ts` | B15-Billing | 379 | ✓ | Praeventio Guard - Pricing Tiers (single source of truth) |
| `src/services/pricingCalculator/pricingCalculator.ts` | B15-Billing | 206 | ✓ | Praeventio Guard — Sprint K: Pricing calculadora + Simulador + Presupuesto + ROI + OC sugerida. |
| `src/services/pricingSimulator/pricingSimulator.ts` | B15-Billing | 253 | ✓ | Praeventio Guard — Sprint 45 §171-173: Pricing Simulator + Calculadora. |
| `src/services/privacy/dpiaTemplate.ts` |  | 284 | ✓ | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/152fz-ru.ts` |  | 47 |  | Praeventio Guard — Sprint 31 Bucket SS. |
| `src/services/privacy/regimes/appi.ts` |  | 46 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/ccpa.ts` |  | 39 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/cpra.ts` |  | 41 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/gdpr.ts` |  | 44 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/ley19628.ts` |  | 47 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/lgpd.ts` |  | 48 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/pdpa.ts` |  | 40 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/pipa-tw.ts` |  | 47 |  | Praeventio Guard — Sprint 31 Bucket SS. |
| `src/services/privacy/regimes/pipeda.ts` |  | 43 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/regimes/pipl-cn.ts` |  | 53 |  | Praeventio Guard — Sprint 31 Bucket SS. |
| `src/services/privacy/registry.ts` |  | 260 | ✓ | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacy/types.ts` |  | 100 |  | Praeventio Guard — Sprint 31 Bucket MM. |
| `src/services/privacyRetention/dataRetentionPolicy.ts` | B5-Cumplimiento | 391 | ✓ | Praeventio Guard — Sprint 44 §125-128: Política de retención + consent |
| `src/services/privacyShield/piiClassifier.ts` |  | 189 | ✓ | Praeventio Guard — Sprint K: Privacidad PII + Datos Médicos Separados + Retención. |
| `src/services/projectClosure/projectClosureService.ts` |  | 212 | ✓ | Praeventio Guard — Sprint K: Cierre Proyecto + Lecciones Transferibles + Decisiones Críticas. |
| `src/services/projectComparator/projectComparator.ts` | B18-Analitica | 325 | ✓ | Praeventio Guard — Sprint 55 Fase F.27: Project Comparator. |
| `src/services/protocols/iper.ts` | B2-RiesgoIPER | 136 | ✓ | IPER — Identificación de Peligros y Evaluación de Riesgos. |
| `src/services/protocols/prexor.ts` | B3-Ergonomia | 129 | ✓ | PREXOR — Protocolo de Exposición Ocupacional al Ruido. |
| `src/services/protocols/tmert.ts` | B3-Ergonomia | 107 | ✓ | TMERT — Trastornos Musculoesqueléticos Relacionados al Trabajo |
| `src/services/proximitySensor/proximityModeDetector.ts` |  | 227 | ✓ | Praeventio Guard — Sprint 49 C.3: Proximity Sensor + Mode Detection. |
| `src/services/psychosocialBackend.ts` |  | 87 |  | _exports:_ analyzePsychosocialRisks, generateStressPreventionTips |
| `src/services/pymeOnboarding/pymeWizard.ts` | B6-Capacitacion | 196 | ✓ | Praeventio Guard — Sprint K: Modo PYME wizard rápido + Madurez Preventiva. |
| `src/services/pymeWizard/pymeOnboardingWizard.ts` | B6-Capacitacion | 257 | ✓ | Praeventio Guard — Sprint K: PYME Onboarding Wizard rápido. |
| `src/services/qrAck/qrAckSessionEngine.ts` | B9-Inspecciones | 368 | ✓ | Praeventio Guard — Sprint 43 Fase F.5: Firma Recepción Digital con QR. |
| `src/services/qrSignature/qrSignatureService.ts` | B9-Inspecciones | 330 | ✓ | Praeventio Guard — Sprint 40 Fase F.5: Firma de Recepción Digital con QR. |
| `src/services/raciMatrix/raciMatrixEngine.ts` | B12-CPHS | 319 |  | Praeventio Guard — Sprint 53: RACI matrix engine (§50-58 2da tanda usuario). |
| `src/services/rag/safeNormativeQuery.ts` | B14-IA | 224 | ✓ | Praeventio Guard — safeNormativeQuery — TODO.md §12.2.3 CRÍTICA. |
| `src/services/ragService.ts` |  | 272 | ✓ | _exports:_ generateEmbedding, indexLaw, downloadSpecificNormative, initializeRAG, searchRelevantContext, queryCommunityKnowledge |
| `src/services/readReceipts/readReceiptService.ts` |  | 196 | ✓ | Praeventio Guard — Sprint 39 Fase G.1: confirmación lectura obligatoria. |
| `src/services/readReceipts/readReceiptStore.ts` |  | 116 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) read-receipt store. |
| `src/services/refuges/mountainRefuges.ts` | B1-Emergencia | 399 | ✓ | Catálogo de refugios de montaña en Chile (CONAF + Club Andino + |
| `src/services/regulatory/iso45001.ts` | B5-Cumplimiento | 115 |  | Sprint 28 Bucket B1 — Catálogo baseline ISO 45001:2018. |
| `src/services/regulatory/jurisdictionRegistry.ts` | B5-Cumplimiento | 134 | ✓ | Sprint 48 E.4 — Registry de perfiles de jurisdicción. |
| `src/services/regulatory/jurisdictions/au.ts` | B5-Cumplimiento | 74 |  | Sprint 29 Bucket EE — Adaptador Australia (modelo armonizado WHS). |
| `src/services/regulatory/jurisdictions/br.ts` | B5-Cumplimiento | 70 |  | Sprint 28 Bucket B1 — Adaptador Brasil (Normas Regulamentadoras). |
| `src/services/regulatory/jurisdictions/ca.ts` | B5-Cumplimiento | 83 |  | Sprint 29 Bucket EE — Adaptador Canadá (federal + provincial mention). |
| `src/services/regulatory/jurisdictions/cl.ts` | B5-Cumplimiento | 62 |  | Sprint 28 Bucket B1 — Adaptador Chile. |
| `src/services/regulatory/jurisdictions/cn.ts` | B5-Cumplimiento | 106 |  | Sprint 31 Bucket SS — Adaptador China (MEM, 应急管理部). |
| `src/services/regulatory/jurisdictions/eu.ts` | B5-Cumplimiento | 61 |  | Sprint 28 Bucket B1 — Adaptador EU (Directiva 89/391/CEE marco). |
| `src/services/regulatory/jurisdictions/in.ts` | B5-Cumplimiento | 102 |  | Sprint 31 Bucket NN — Adaptador India (Ministry of Labour & Employment). |
| `src/services/regulatory/jurisdictions/jp.ts` | B5-Cumplimiento | 87 |  | Sprint 31 Bucket NN — Adaptador Japón (MHLW). |
| `src/services/regulatory/jurisdictions/kr.ts` | B5-Cumplimiento | 95 |  | Sprint 31 Bucket NN — Adaptador Corea del Sur (MOEL). |
| `src/services/regulatory/jurisdictions/mx.ts` | B5-Cumplimiento | 54 |  | Sprint 28 Bucket B1 — Adaptador México (NOM-STPS). |
| `src/services/regulatory/jurisdictions/ru.ts` | B5-Cumplimiento | 79 |  | Sprint 31 Bucket SS — Adaptador Rusia (Rostrud, Роструд). |
| `src/services/regulatory/jurisdictions/tw.ts` | B5-Cumplimiento | 74 |  | Sprint 31 Bucket SS — Adaptador Taiwán (Ministry of Labor, 勞動部). |
| `src/services/regulatory/jurisdictions/uk.ts` | B5-Cumplimiento | 82 |  | Sprint 29 Bucket EE — Adaptador UK (Health and Safety Executive). |
| `src/services/regulatory/jurisdictions/us-osha.ts` | B5-Cumplimiento | 61 |  | Sprint 28 Bucket B1 — Adaptador US OSHA (29 CFR 1910). |
| `src/services/regulatory/privacyRegimeRegistry.ts` | B5-Cumplimiento | 17 | ✓ | Sprint 48 E.4 — Façade pública del catálogo de regímenes de privacidad. |
| `src/services/regulatory/privacyRegimes.ts` | B5-Cumplimiento | 385 |  | Sprint 48 E.4 — Catálogo de regímenes de privacidad. Determinístico, |
| `src/services/regulatory/profiles.ts` | B5-Cumplimiento | 642 |  | Sprint 48 E.4 — Perfiles de jurisdicción para 6 países (UK/CA/AU/JP/KR/IN) |
| `src/services/regulatory/registry.ts` | B5-Cumplimiento | 314 | ✓ | Sprint 28 Bucket B1 — Registry orquestador. |
| `src/services/regulatory/types.ts` | B5-Cumplimiento | 60 |  | Sprint 28 Bucket B1 — Regulatory Framework Abstraction (ADR 0014). |
| `src/services/reportsAutomation/reportsAutomation.ts` | B18-Analitica | 199 | ✓ | Praeventio Guard — Sprint K: Reports Automation + Templates + Distribución. |
| `src/services/reputationalAlerts/reputationalAlertEngine.ts` |  | 330 | ✓ | Praeventio Guard — Sprint 51 §118: Alertas reputacionales (incidentes |
| `src/services/researchMode/researchMode.ts` | B14-IA | 203 | ✓ | Praeventio Guard — Sprint K: Modo Investigación Causa Raíz + Árbol Visual + Comparador. |
| `src/services/residualRisk/residualRiskEngine.ts` | B2-RiesgoIPER | 228 | ✓ | Praeventio Guard — Sprint K: Riesgo Residual + Aceptación Formal + Drift Sospechoso. |
| `src/services/retaliationProtection/retaliationDetector.ts` |  | 199 | ✓ | Praeventio Guard — Sprint 49: Retaliation Protection Detector. |
| `src/services/returnToWork/returnToWorkPlanner.ts` |  | 350 | ✓ | Praeventio Guard — Sprint 49 §251-253: Return-to-Work + Restricciones |
| `src/services/riskRadar/repeatingRiskRadar.ts` | B2-RiesgoIPER | 417 | ✓ | Praeventio Guard — Sprint 40 Fase F.13: Radar de Riesgos Repetidos. |
| `src/services/riskRanking/riskRankingEngine.ts` | B2-RiesgoIPER | 167 | ✓ | Praeventio Guard — Sprint 39 Fase I.6: Top 10 Riesgos + Controles Débiles. |
| `src/services/roiScenario/roiScenarioSimulator.ts` |  | 359 | ✓ | Praeventio Guard — Sprint 53 §175 (extendido): ROI Scenario Simulator. |
| `src/services/roleOnboarding/roleOnboardingTracks.ts` | B6-Capacitacion | 305 | ✓ | Praeventio Guard — Sprint 52: Onboarding por rol con tracks dirigidos. |
| `src/services/roleViews/roleViewBuilder.ts` |  | 243 | ✓ | Praeventio Guard — Sprint 39 Fase J.4: Modos por Rol (Jefe Terreno / Trabajador / Gerencia). |
| `src/services/rootCause/noBlameInvestigation.ts` | B4-Incidentes | 321 | ✓ | Praeventio Guard — Sprint 39 Fase L.3: Investigación sin Culpa + Cadena de Tiempo. |
| `src/services/rootCause/rootCauseClassifier.ts` | B4-Incidentes | 154 | ✓ | Praeventio Guard — Sprint 39 Fase I.3: Clasificación de Causa Raíz. |
| `src/services/rootCause/rootCauseStore.ts` | B4-Incidentes | 69 |  | Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-22). |
| `src/services/rootCauseInvestigation/investigationMode.ts` | B4-Incidentes | 274 | ✓ | Praeventio Guard — Sprint K Fase §191: Modo Investigación Causa Raíz Avanzado. |
| `src/services/routeScoring/criticalRouteScoring.ts` |  | 266 | ✓ | Praeventio Guard — Sprint 53. |
| `src/services/routeScoring/driverRouteMatcher.ts` |  | 232 | ✓ | Praeventio Guard — Sprint 53. |
| `src/services/routing/gridAStar.ts` |  | 222 | ✓ | Praeventio Guard — Codex fake fix §2.3 (2026-05-15). |
| `src/services/routing/routeClimateAssessment.ts` |  | 308 | ✓ | Route climate assessment — evaluación de riesgo climático para una ruta |
| `src/services/routingBackend.ts` |  | 79 | ✓ | Represents a coordinate point. |
| `src/services/safety/ergonomicAssessments.ts` | B3-Ergonomia | 280 | ✓ | Firestore writer for REBA / RULA ergonomic assessments. |
| `src/services/safety/ergonomicLegalTrigger.ts` | B3-Ergonomia | 167 |  | Ergonomic legal-threshold trigger. |
| `src/services/safety/iperAssessments.ts` |  | 178 | ✓ | Firestore writer for IPER (Identificación de Peligros y Evaluación de |
| `src/services/safetyEngineBackend.ts` |  | 131 |  | _exports:_ performProjectSafetyHealthCheck, autoValidateTelemetry, predictGlobalIncidents |
| `src/services/safetyMetrics/osha.ts` | B18-Analitica | 320 | ✓ | Praeventio Guard — Sprint 39 Fase D.10: Safety metrics OSHA + ICMM. |
| `src/services/safetyPerformance/safetyPerformanceIndex.ts` | B18-Analitica | 157 | ✓ | Praeventio Guard — Sprint K: Safety Performance Index (SPI) + leading/lagging KPIs. |
| `src/services/safetyTalks/safetyTalksStore.ts` | B6-Capacitacion | 36 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) safety talks store. |
| `src/services/safetyTalks/talkTopicSuggester.ts` | B6-Capacitacion | 249 | ✓ | Praeventio Guard — Sprint 39 Fase J.5: Sugeridor de Tema de Charla. |
| `src/services/scheduler/distributedLease.ts` |  | 249 | ✓ | Sprint 35 — Distributed lease for in-process cron jobs. |
| `src/services/security/browserEnvelope.ts` |  | 354 | ✓ | Browser-side envelope encryption — AES-256-GCM con DEK aleatorio |
| `src/services/security/deviceKek.ts` |  | 194 | ✓ | Device-bound Key Encryption Key (KEK). |
| `src/services/security/encryptedKvStore.ts` |  | 201 | ✓ | Encrypted key-value store sobre IndexedDB. |
| `src/services/security/kekRotationOrchestrator.ts` | B14-IA | 407 | ✓ | KEK Rotation Orchestrator. |
| `src/services/security/kmsAdapter.ts` |  | 219 |  | KMS adapter interface + dev/stub implementations. |
| `src/services/security/kmsEnvelope.ts` |  | 172 | ✓ | Envelope encryption for OAuth tokens (and any other small secret). |
| `src/services/seedBackend.ts` |  | 144 |  | _exports:_ cleanupUserApiKeys, runSeed |
| `src/services/seedService.ts` |  | 138 |  | _exports:_ seedCommunityGlossary, seedGlobalData |
| `src/services/sensorBus/sensorBus.ts` | B16-Offline | 349 | ✓ | Praeventio Guard — TODO.md §12.2.1: sensorBus central (Zustand). |
| `src/services/shiftBackend.ts` |  | 87 |  | _exports:_ generateShiftHandoverInsights, analyzeShiftFatiguePatterns |
| `src/services/shiftHandover/shiftHandoverFirestoreAdapter.ts` | B13-MOC | 50 | ✓ | Persistence #7: shiftHandoverService adapter. |
| `src/services/shiftHandover/shiftHandoverInsights.ts` | B13-MOC | 148 | ✓ | Praeventio Guard — Sprint K: Shift Handover Insights. |
| `src/services/shiftHandover/shiftHandoverService.ts` | B13-MOC | 217 | ✓ | Praeventio Guard — Sprint 39 Fase J.8: Bitácora Supervisor + Cambio de Turno. |
| `src/services/shiftHandover/shiftHandoverStore.ts` | B13-MOC | 33 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) shift handover store. |
| `src/services/shiftRiskPanel/preShiftRiskComposer.ts` | B3-Ergonomia | 337 | ✓ | Praeventio Guard — Sprint 40 Fase F.21: Panel Riesgo por Turno. |
| `src/services/sif/sifFirestoreAdapter.ts` |  | 102 | ✓ | Persistence #14: SIF precursors adapter. |
| `src/services/sif/sifPrecursorClassifier.ts` |  | 219 | ✓ | Praeventio Guard — Sprint 39 Fase L.4: SIF Precursor Classifier. |
| `src/services/signaletics/signageValidator.ts` | B10-EPP | 464 | ✓ | Praeventio Guard — Sprint 49 §223-227: Validación de señalética + |
| `src/services/sii/bsaleAdapter.ts` | B5-Cumplimiento | 573 | ✓ | Praeventio Guard — Bsale PSE adapter (REAL IMPLEMENTATION, Sprint 23 GG). |
| `src/services/sii/dteGenerator.ts` | B5-Cumplimiento | 198 | ✓ | Praeventio Guard — Sprint 34 Bucket: SII DTE generator (no-push model). |
| `src/services/sii/dtePdfRenderer.ts` | B5-Cumplimiento | 119 |  | Praeventio Guard — Sprint 34: DTE PDF renderer. |
| `src/services/sii/dteSigner.ts` | B5-Cumplimiento | 272 | ✓ | Praeventio Guard — Sprint 34: DTE biometric signer (WebAuthn passkey). |
| `src/services/sii/index.ts` | B5-Cumplimiento | 99 |  | Praeventio Guard — SII module facade. |
| `src/services/sii/libredteAdapter.ts` | B5-Cumplimiento | 25 |  | Praeventio Guard — LibreDTE PSE adapter (STUB ONLY). |
| `src/services/sii/openfacturaAdapter.ts` | B5-Cumplimiento | 39 |  | Praeventio Guard — OpenFactura PSE adapter (STUB ONLY). |
| `src/services/sii/siiAdapter.ts` | B5-Cumplimiento | 204 | ✓ | Praeventio Guard — SII adapter shared helpers. |
| `src/services/sii/siiPreflightCheck.ts` | B5-Cumplimiento | 326 | ✓ | Praeventio Guard — SII pre-flight checks. Sprint 50, E.5 P2 H5. |
| `src/services/sii/simpleApiAdapter.ts` | B5-Cumplimiento | 36 |  | Praeventio Guard — SimpleAPI PSE adapter (STUB ONLY). |
| `src/services/sii/susesoApiClient.ts` | B5-Cumplimiento | 229 | ✓ | Praeventio Guard — SUSESO API client (DIAT / DIEP / ROI submission). |
| `src/services/sii/types.ts` | B5-Cumplimiento | 173 |  | Praeventio Guard — SII (Servicio de Impuestos Internos) DTE types |
| `src/services/siteBook/siteBookCrdt.ts` | B9-Inspecciones | 498 | ✓ | Praeventio Guard — Site Book CRDT layer. |
| `src/services/siteBook/siteBookFirestoreAdapter.ts` | B9-Inspecciones | 387 | ✓ | Praeventio Guard — Sprint 39 Persistence Layer #1: siteBookService adapter. |
| `src/services/siteBook/siteBookService.ts` | B9-Inspecciones | 296 | ✓ | Praeventio Guard — Sprint 39 Fase H.2: Libro de Obra Digital Preventivo. |
| `src/services/siteBook/siteBookSigning.ts` | B9-Inspecciones | 254 | ✓ | Praeventio Guard — Plan 2026-05-24 §D.X — DS 76 firma electrónica |
| `src/services/siteBook/siteBookSigningClient.ts` | B9-Inspecciones | 214 | ✓ | Praeventio Guard — Plan 2026-05-24 §D.X — client orchestrator for |
| `src/services/siteBook/siteBookStore.ts` | B9-Inspecciones | 63 |  | Praeventio Guard — Sprint K wire UI (2026-05-23) site book store. |
| `src/services/skillGap/skillGapAnalyzer.ts` | B6-Capacitacion | 326 | ✓ | Praeventio Guard — Sprint 51 §246-249: Skill Gap Analyzer + Polivalencia + |
| `src/services/slm/cache/modelCache.ts` | B14-IA | 273 | ✓ | IndexedDB-backed cache for on-device SLM model blobs. |
| `src/services/slm/encryptedOfflineQueue.ts` | B14-IA | 604 | ✓ | Encrypted IndexedDB-backed offline session queue. |
| `src/services/slm/guardianOffline.ts` | B14-IA | 629 | ✓ | GuardianOfflineService — Sprint 26 Bucket ZZ. |
| `src/services/slm/hmac.ts` | B14-IA | 310 | ✓ | Per-session HMAC-SHA256 sign / verify primitives for the offline |
| `src/services/slm/index.ts` | B14-IA | 126 |  | Public barrel for the SLM offline namespace. |
| `src/services/slm/loader.ts` | B14-IA | 176 | ✓ | Cache-aware SLM model loader. |
| `src/services/slm/offlineQueue.ts` | B14-IA | 322 | ✓ | IndexedDB-backed offline session queue. |
| `src/services/slm/onnxAdapter.ts` | B14-IA | 662 | ✓ | ONNX Runtime Web direct adapter — Brecha B (SLM offline) entry point. |
| `src/services/slm/orchestrator.ts` | B14-IA | 226 | ✓ | Online/offline orchestrator for AI inference. |
| `src/services/slm/reconciliation.ts` | B14-IA | 225 | ✓ | Offline → Zettelkasten reconciliation service. |
| `src/services/slm/reconciliationAutoTrigger.ts` | B14-IA | 436 | ✓ | Auto-trigger layer for the offline → Zettelkasten reconciliation runner. |
| `src/services/slm/reconciliationRunner.ts` | B14-IA | 206 | ✓ | Wires `reconcileOfflineSessions()` to the real Zettelkasten |
| `src/services/slm/registry.ts` | B14-IA | 214 | ✓ | Static registry of on-device SLM candidates. |
| `src/services/slm/sampling.ts` | B14-IA | 250 | ✓ | Sampling primitives for the on-device SLM generation loop |
| `src/services/slm/slmAcquisitionService.ts` | B14-IA | 351 | ✓ | SLM Acquisition Service — first-launch download orchestration. |
| `src/services/slm/slmAdapter.ts` | B14-IA | 178 | ✓ | Main-thread facade for the SLM Web Worker. |
| `src/services/slm/slmIntegrityCheck.ts` | B14-IA | 171 | ✓ | Praeventio Guard — Sprint 39 STUB-3 cierre: SLM integrity checker. |
| `src/services/slm/slmIntegrityGuard.ts` | B14-IA | 211 | ✓ | SLM Integrity Guard — Sprint 47, Brecha C (C.9 SLM offline runtime). |
| `src/services/slm/slmRuntime.ts` | B14-IA | 1033 | ✓ | SLM Runtime — Sprint 47, Brecha C (C.9 SLM offline runtime). |
| `src/services/slm/tokenizer.ts` | B14-IA | 183 |  | Tokenizer abstraction for the on-device SLM |
| `src/services/slm/types.ts` | B14-IA | 213 |  | Canonical type definitions for the SLM (Small Language Model) offline |
| `src/services/slm/worker/createSlmRuntimeProxyForBrowser.ts` | B14-IA | 90 |  | Browser factory: construye un `SlmRuntimeWorkerProxy` cableado al |
| `src/services/slm/worker/slmRuntimeWorker.ts` | B14-IA | 68 |  | SLM Runtime Worker — production entrypoint. |
| `src/services/slm/worker/slmRuntimeWorkerCore.ts` | B14-IA | 427 | ✓ | SLM Runtime Worker — core logic (test-friendly). |
| `src/services/slm/worker/slmRuntimeWorkerProtocol.ts` | B14-IA | 236 |  | Protocolo de mensajes entre el main thread y el SLM Runtime Worker. |
| `src/services/slm/worker/slmRuntimeWorkerProxy.ts` | B14-IA | 441 | ✓ | Main-thread proxy del SLM Runtime Worker. |
| `src/services/slm/worker/slmWorker.ts` | B14-IA | 500 | ✓ | SLM Web Worker — runs ONNX Runtime Web off the main thread. |
| `src/services/slm/workerProxy.ts` | B14-IA | 78 |  | Main-thread proxy for the SLM Web Worker. |
| `src/services/socialRecognition/wallEngine.ts` |  | 241 | ✓ | Praeventio Guard — §12.7.3: Reconocimiento social — Muro Dinámico. |
| `src/services/softBlocking/requirementGate.ts` | B8-PermisosLOTO | 250 | ✓ | Praeventio Guard — Sprint 41 Fase F.17: Bloqueo Soft por Requisito Faltante. |
| `src/services/spacedRepetition/spacedRepetitionScheduler.ts` | B6-Capacitacion | 140 | ✓ | Praeventio Guard — Sprint K: Aprendizaje post-capacitación + Repetición Espaciada. |
| `src/services/stoppage/stoppageEngine.ts` | B8-PermisosLOTO | 270 | ✓ | Praeventio Guard — Sprint 39 Fase I.1: Paralización + Reanudación Controlada. |
| `src/services/stoppage/stoppageFirestoreAdapter.ts` | B8-PermisosLOTO | 69 | ✓ | Praeventio Guard — Sprint 39 Persistence Layer #3: stoppageEngine adapter. |
| `src/services/stoppage/stoppageStore.ts` | B8-PermisosLOTO | 82 |  | Praeventio Guard — §Sprint K UI wire (2026-05-22) stoppage store. |
| `src/services/suppliers/supplierQualityService.ts` |  | 191 | ✓ | Praeventio Guard — Sprint K: Evaluación de Proveedores + Servicios Críticos + SLA. |
| `src/services/suppliers/supplierScoring.ts` |  | 169 | ✓ | Praeventio Guard — Sprint K: Supplier Scoring 4 dimensiones. |
| `src/services/suseso/cumplimientoCalculator.ts` | B5-Cumplimiento | 239 | ✓ | Praeventio Guard — §12.7.5: Dashboard Cumplimiento SUSESO (cálculo interno). |
| `src/services/suseso/diatPdfRenderer.ts` | B5-Cumplimiento | 228 | ✓ | Praeventio Guard — Sprint 39 Fase B.5: DIAT/DIEP PDF renderer. |
| `src/services/suseso/folioGenerator.ts` | B5-Cumplimiento | 117 | ✓ | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/services/suseso/monthlyReport.ts` | B5-Cumplimiento | 240 | ✓ | Praeventio Guard — §12.7.6: Reportes mensuales SUSESO. |
| `src/services/suseso/reminders.ts` | B5-Cumplimiento | 171 | ✓ | Praeventio Guard — Sprint 28 follow-up. |
| `src/services/suseso/susesoServerOnlyHelpers.ts` | B5-Cumplimiento | 147 | ✓ | Praeventio Guard — Sprint 49 D.8.a. |
| `src/services/suseso/susesoService.ts` | B5-Cumplimiento | 294 | ✓ | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/services/suseso/types.ts` | B5-Cumplimiento | 166 |  | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/services/susesoBackend.ts` | B5-Cumplimiento | 88 |  | _exports:_ calculatePreventionROI, generateSusesoFormMetadata |
| `src/services/sync/conflictQueue.ts` | B16-Offline | 239 | ✓ | Praeventio Guard — TODO.md §12.2.2: conflict_queue para safety docs. |
| `src/services/sync/conflictResolver.ts` |  | 393 | ✓ | Sprint 34 — Per-field conflict resolver for offline sync. |
| `src/services/sync/encryptedOutboxAdapter.ts` |  | 152 | ✓ | Encrypted persistence adapter para `GenericOutboxEngine`. |
| `src/services/sync/genericOutboxEngine.ts` |  | 402 | ✓ | Generic Offline Outbox Engine. |
| `src/services/sync/monotonicSync.ts` |  | 154 | ✓ | Praeventio Guard — Sprint 39 Fase C.11: sync con revisiones monotónicas. |
| `src/services/sync/outboxBackoff.ts` |  | 40 |  | Backoff exponencial deterministico para el outbox engine. |
| `src/services/sync/syncStateMachine.ts` |  | 398 | ✓ | Sprint 25 Bucket QQ — Centralized Offline Sync State Machine. |
| `src/services/sync/topologyAwarePrefetch.ts` |  | 375 | ✓ | Praeventio Guard — Sprint 47 C.11 (cierre completo): Topology-aware |
| `src/services/syncManager.ts` |  | 284 | ✓ | _exports:_ RestoreEvent, matrixSyncManager |
| `src/services/syncStatus/syncQueueTracker.ts` | B16-Offline | 229 | ✓ | Praeventio Guard — Sprint 39 Fase H.3: Estado Sincronización Visible. |
| `src/services/systemEngine/adapters/appModeContextAdapter.ts` |  | 15 |  | SystemEngine — AppMode context adapter (placeholder). |
| `src/services/systemEngine/adapters/emergencyContextAdapter.ts` | B1-Emergencia | 65 |  | SystemEngine — Emergency context adapter. |
| `src/services/systemEngine/adapters/firebaseContextAdapter.ts` | B3-Ergonomia | 14 |  | SystemEngine — Firebase context adapter (placeholder). |
| `src/services/systemEngine/adapters/index.ts` |  | 23 |  | SystemEngine — Adapter barrel. |
| `src/services/systemEngine/adapters/languageProviderAdapter.ts` |  | 12 |  | SystemEngine — LanguageProvider adapter (placeholder). |
| `src/services/systemEngine/adapters/normativeContextAdapter.ts` |  | 13 |  | SystemEngine — Normative context adapter (placeholder). |
| `src/services/systemEngine/adapters/notificationContextAdapter.ts` |  | 14 |  | SystemEngine — Notification context adapter (placeholder). |
| `src/services/systemEngine/adapters/projectContextAdapter.ts` |  | 13 |  | SystemEngine — Project context adapter (placeholder). |
| `src/services/systemEngine/adapters/sensorContextAdapter.ts` |  | 24 |  | SystemEngine — Sensor context adapter (placeholder). |
| `src/services/systemEngine/adapters/subscriptionContextAdapter.ts` | B15-Billing | 58 |  | SystemEngine — Subscription context adapter. |
| `src/services/systemEngine/adapters/themeContextAdapter.ts` |  | 13 |  | SystemEngine — Theme context adapter (placeholder). |
| `src/services/systemEngine/adapters/universalKnowledgeContextAdapter.ts` |  | 16 |  | SystemEngine — UniversalKnowledge context adapter (placeholder). |
| `src/services/systemEngine/decisionEngine.ts` |  | 79 |  | SystemEngine — DecisionEngine. |
| `src/services/systemEngine/eventLog.ts` |  | 270 |  | SystemEngine — EventLog. |
| `src/services/systemEngine/eventTypes.ts` |  | 169 |  | SystemEngine — Event schema (discriminated union). |
| `src/services/systemEngine/executor.ts` |  | 124 |  | SystemEngine — Executor. |
| `src/services/systemEngine/policies/geofenceToSos.ts` | B1-Emergencia | 79 |  | SystemEngine — Policy: geofence_crossed → SOS escalation. |
| `src/services/systemEngine/policies/index.ts` |  | 44 |  | SystemEngine — Policy registry. |
| `src/services/systemEngine/policies/policy.types.ts` |  | 93 |  | SystemEngine — Policy + Action types. |
| `src/services/systemEngine/policies/tierChangeReactivity.ts` |  | 66 |  | SystemEngine — Policy: tier_changed → reactive feature-flag refresh. |
| `src/services/systemEngine/README.md` |  | 165 |  | SystemEngine |
| `src/services/systemEngine/subscriber.ts` |  | 103 |  | SystemEngine — Subscriber. |
| `src/services/systemEngine/zettelkasten/healthEvent.ts` | B7-Salud | 155 |  | SystemEngine — Zettelkasten health event helper. |
| `src/services/telemetry/aggregator.ts` | B7-Salud | 210 | ✓ | Praeventio Guard — Sprint 41 Fase F.30: Telemetría agregada. |
| `src/services/telemetry/eventCollector.ts` | B7-Salud | 192 | ✓ | Praeventio Guard — Sprint 41 F.30 event collector. |
| `src/services/trainingBackend.ts` | B6-Capacitacion | 98 |  | _exports:_ generateCustomSafetyTraining, generateTrainingQuiz |
| `src/services/upsell/painBasedUpsellSuggester.ts` |  | 175 | ✓ | Praeventio Guard — Sprint K: Upsell por dolor real. |
| `src/services/uxModes/uxModeAdapter.ts` |  | 255 | ✓ | Praeventio Guard — Sprint 50 §141-145: Modos adaptativos de UI. |
| `src/services/vendorOnboarding/vendorAccreditationTracker.ts` | B6-Capacitacion | 160 | ✓ | Praeventio Guard — Sprint 52 (2da tanda §47-48): Vendor Accreditation |
| `src/services/vendorOnboarding/vendorOnboardingFlow.ts` | B6-Capacitacion | 267 | ✓ | Praeventio Guard — Sprint 52 (2da tanda §35, §40, §42-45): Vendor/Contractor |
| `src/services/visitorControl/visitorRegistry.ts` | B11-Contratistas | 255 | ✓ | Praeventio Guard — Sprint K §23-24: Control de Visitas + Inducción Express QR. |
| `src/services/visitors/visitorAccessService.ts` | B11-Contratistas | 186 | ✓ | Praeventio Guard — Sprint K: Control de Visitas + Inducción Express QR. |
| `src/services/visitors/visitorFirestoreAdapter.ts` | B11-Contratistas | 66 | ✓ | Persistence #15: visitor access adapter. |
| `src/services/vulnerability/operationalVulnerabilityMap.ts` |  | 275 | ✓ | Praeventio Guard — Sprint 39 Fase L.1: Mapa de Vulnerabilidad Operacional. |
| `src/services/vulnerability/vulnerabilityFirestoreAdapter.ts` |  | 58 | ✓ | Persistence #13: vulnerability map adapter. |
| `src/services/workerHistory/portableHistoryExporter.ts` | B18-Analitica | 475 | ✓ | Praeventio Guard — Sprint 42 Fase F.18: Historial Profesional Portátil. |
| `src/services/workerReadiness/readinessScore.ts` |  | 359 | ✓ | Praeventio Guard — Sprint 41 Fase F.16: Score Preparación Trabajador. |
| `src/services/workPermits/criticalPermitValidators.ts` | B8-PermisosLOTO | 482 | ✓ | Praeventio Guard — Validadores profundos por kind de permiso crítico. |
| `src/services/workPermits/excavationPermitExtension.ts` | B8-PermisosLOTO | 219 | ✓ | Praeventio Guard — Sprint 39 Fase L.8: Plan de Excavación Segura. |
| `src/services/workPermits/liftingPermitExtension.ts` | B8-PermisosLOTO | 165 | ✓ | Praeventio Guard — Sprint 39 Fase L.7: Izaje Crítico. |
| `src/services/workPermits/permitLifecycleAdvisor.ts` | B8-PermisosLOTO | 194 | ✓ | Praeventio Guard — Sprint 42 F.15: Permit Lifecycle Advisor. |
| `src/services/workPermits/workPermitEngine.ts` | B8-PermisosLOTO | 441 | ✓ | Praeventio Guard — Sprint 39 Fase G.6: Permisos de Trabajo Seguro. |
| `src/services/workPermits/workPermitFirestoreAdapter.ts` | B8-PermisosLOTO | 247 | ✓ | Praeventio Guard — Sprint 39 Persistence Layer #2: workPermitEngine adapter. |
| `src/services/zettelkasten/backlinks.ts` |  | 116 | ✓ | Praeventio Guard — §ZK-1: Backlinks bidireccionales (agregador). |
| `src/services/zettelkasten/bernoulli/confinedSpaceHVAC.ts` |  | 89 | ✓ | A.4 — Monitoreo de espacios confinados: gradiente de presión HVAC. |
| `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` |  | 75 | ✓ | C.14 — Monitor hidrostático de diques / tranques de relaves. |
| `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` |  | 83 | ✓ | C.15 — Dispersión de nube de gas + zona de exclusión dinámica (Pasquill-Gifford). |
| `src/services/zettelkasten/bernoulli/gasLeakDetection.ts` |  | 85 | ✓ | A.5 — Detección de fugas en redes de gas industrial vía desviación Bernoulli. |
| `src/services/zettelkasten/bernoulli/hazmatPipePressure.ts` | B10-EPP | 72 | ✓ | B.7 — Presión en tuberías hazmat + cavitación check. |
| `src/services/zettelkasten/bernoulli/hidranteFireNetwork.ts` |  | 93 | ✓ | A.1 — Hidrante / red de incendio. Pure Bernoulli-based node generator. |
| `src/services/zettelkasten/bernoulli/index.ts` |  | 60 |  | Barrel + registry for Bernoulli-driven Zettelkasten node generators. |
| `src/services/zettelkasten/bernoulli/microWindEnergy.ts` |  | 64 | ✓ | C.11 — Micro-generación eólica para sensores autónomos (Betz 0.593). |
| `src/services/zettelkasten/bernoulli/miningVenturi.ts` |  | 78 | ✓ | B.6 — Ventilación táctica en minería (efecto Venturi extracción gases). |
| `src/services/zettelkasten/bernoulli/mistingDustSuppression.ts` |  | 85 | ✓ | A.2 — Sistema de supresión de polvo (misting Venturi PM2.5 / sílice). |
| `src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts` |  | 80 | ✓ | B.10 — Capacidad pulmonar + altitud (DS 594 Art. 49 / DS 28/2012). |
| `src/services/zettelkasten/bernoulli/respiratorFatigue.ts` | B7-Salud | 60 | ✓ | B.9 — Fatiga del respirador (NIOSH 42 CFR Part 84). |
| `src/services/zettelkasten/bernoulli/scaffoldWindSuction.ts` |  | 74 | ✓ | A.3 — Estabilidad de cubiertas y andamios: succión por viento. |
| `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` |  | 55 | ✓ | C.13 — Photogrammetry/SLAM bridge. LingBot-Map is not integrated yet. |
| `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts` |  | 75 | ✓ | C.12 — Estabilidad de talud post-lluvia (ángulo de reposo + hidrostática). |
| `src/services/zettelkasten/bernoulli/structuralWindLoad.ts` |  | 62 | ✓ | B.8 — Cargas de viento en estructuras (wrap NCh 432). |
| `src/services/zettelkasten/canonical/materializer.ts` |  | 269 | ✓ | Praeventio Guard — Sprint 39 Fase D.8.c: Zettelkasten canonical materializer. |
| `src/services/zettelkasten/centrality.ts` |  | 132 | ✓ | Praeventio Guard — §ZK-6: Graph centrality metrics + archive candidacy. |
| `src/services/zettelkasten/climateRiskCoupling.ts` |  | 637 | ✓ | Climate ↔ Zettelkasten coupling. |
| `src/services/zettelkasten/contextualActions.ts` |  | 388 | ✓ | Praeventio Guard — §12.7.2: Acciones contextuales para nodos del grafo. |
| `src/services/zettelkasten/edges.ts` |  | 292 | ✓ | Praeventio Guard — Sprint 39 Fase B.7: aristas tipadas + bidireccionalidad. |
| `src/services/zettelkasten/edgeStoreFirestore.ts` |  | 45 |  | Praeventio Guard — Firestore-backed EdgeStore adapter (shared). |
| `src/services/zettelkasten/families/aiAnalyticsNodeRegistry.ts` | B18-Analitica | 64 |  | Static catalog for the AI & ANALYTICS family (52 nodes). |
| `src/services/zettelkasten/families/assetsFaenaNodeRegistry.ts` | B10-EPP | 116 |  | Static catalog for the ASSETS & FAENA family (80 nodes). |
| `src/services/zettelkasten/families/climateNodeRegistry.ts` |  | 65 |  | Static catalog for the CLIMATE & ENVIRONMENT family (50 nodes). |
| `src/services/zettelkasten/families/eventsIncidentsNodeRegistry.ts` | B4-Incidentes | 72 |  | Static catalog for the EVENTS & INCIDENTS family (60 nodes). |
| `src/services/zettelkasten/families/index.ts` |  | 48 |  | Aggregator barrel for the 8 Zettelkasten v2 family registries. |
| `src/services/zettelkasten/families/ohsNormativaNodeRegistry.ts` |  | 122 |  | Static catalog for the OHS & NORMATIVA family (80 nodes). |
| `src/services/zettelkasten/families/personalEppNodeRegistry.ts` |  | 62 |  | Static catalog for the PERSONAL & EPP family (50 nodes). |
| `src/services/zettelkasten/families/physicsNodeRegistry.ts` |  | 58 |  | Static catalog for the PHYSICS & FLUIDS family (60 nodes). |
| `src/services/zettelkasten/families/workflowComplianceNodeRegistry.ts` | B5-Cumplimiento | 92 |  | Static catalog for the WORKFLOW & COMPLIANCE family (80 nodes). |
| `src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts` | B10-EPP | 872 | ✓ | Praeventio Guard — Bloque 4.2: Inspeccion EPP -> Inventario -> Orden de Compra. |
| `src/services/zettelkasten/flows/horometroMaintenanceFlow.ts` | B10-EPP | 706 | ✓ | Praeventio Guard — Bloque 4.1: Zettelkasten Flagship 4.1 flow. |
| `src/services/zettelkasten/flows/incidentLessonTrainingFlow.ts` | B4-Incidentes | 905 | ✓ | Praeventio Guard — Bloque 4.3: |
| `src/services/zettelkasten/incidentPostmortem.ts` | B4-Incidentes | 349 | ✓ | Sprint 34 — Incident → Zettelkasten post-mortem auto-write. |
| `src/services/zettelkasten/persistence/writeNode.ts` |  | 291 | ✓ | Praeventio Guard — Sprint 11. |
| `src/services/zettelkasten/resilientRetrieval.ts` |  | 345 | ✓ | Resilient Zettelkasten Retrieval — multi-source fallback chain. |
| `src/services/zettelkasten/riskOrchestrator.ts` | B14-IA | 228 | ✓ | Praeventio Guard — Sprint 39 Fase B.8: Risk → EPP → Training orchestrator. |
| `src/services/zettelkasten/smartActions.ts` |  | 320 | ✓ | Praeventio Guard — §12.1.6: 5 smart actions Proto-1 ausentes en |
| `src/services/zettelkasten/types.ts` |  | 83 |  | Shared Zettelkasten payload types for Bernoulli-driven node generators. |
| `src/services/zones/restrictedZonesEngine.ts` | B1-Emergencia | 100 | ✓ | Praeventio Guard — Sprint 39 Fase G.9: Zonas restringidas. |
