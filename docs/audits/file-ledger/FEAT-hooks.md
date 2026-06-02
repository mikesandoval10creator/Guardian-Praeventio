# File ledger — FEAT-hooks (206 files)

Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.

| Archivo | Bloque | LOC | Test | Propósito / exports |
|---|---|---:|:--:|---|
| `src/hooks/_fetchUtils.ts` |  | 76 |  | Praeventio Guard — Shared fetch utilities for Sprint K migrated hooks. |
| `src/hooks/useAccelerometer.ts` |  | 124 |  | _exports:_ useAccelerometer |
| `src/hooks/useAcousticSOS.ts` |  | 54 | ✓ | _exports:_ useAcousticSOS |
| `src/hooks/useActiveVisitors.ts` | B11-Contratistas | 90 |  | Praeventio Guard — §23-24 Visitor Control hook (active list). |
| `src/hooks/useAdminBurden.ts` |  | 75 |  | Praeventio Guard — Admin Burden + Automation Suggester client hook. |
| `src/hooks/useAdoption.ts` |  | 130 |  | Praeventio Guard — Adoption Analytics client hook (4 mutators). |
| `src/hooks/useAgenda.ts` | B12-CPHS | 144 |  | Praeventio Guard — Agenda client hook (5 mutators). |
| `src/hooks/useAggregateTelemetry.ts` | B7-Salud | 114 |  | Praeventio Guard — F.30 Aggregate Telemetry client hook. |
| `src/hooks/useAiGuardrails.ts` | B14-IA | 217 |  | Praeventio Guard — AI Guardrails client hook (10 mutators). |
| `src/hooks/useAiQuality.ts` | B14-IA | 172 |  | Praeventio Guard — AI Quality Audit client hook (6 stateless mutators). |
| `src/hooks/useAiToggle.ts` | B14-IA | 88 |  | Praeventio Guard — AI Toggle client hook (3 stateless mutators). |
| `src/hooks/useAmbientNoise.ts` |  | 77 |  | _exports:_ useAmbientNoise |
| `src/hooks/useAnnualReview.ts` |  | 162 |  | Praeventio Guard — §291-295 Annual SGI Review hooks + mutators. |
| `src/hooks/useApprenticeship.ts` | B6-Capacitacion | 157 |  | Praeventio Guard — §244-250 Aprendices + Mentoría hooks. |
| `src/hooks/useArPlacement.ts` |  | 187 | ✓ | useArPlacement — Sprint 21 Ola 4 Bucket N. |
| `src/hooks/useAuditChain.ts` | B17-Admin | 112 |  | Praeventio Guard — Tamper-Proof Audit Hash Chain client hook (4 mutators). |
| `src/hooks/useAuditPortal.ts` | B17-Admin | 160 |  | Praeventio Guard — External Audit Portal client hook (6 mutators). |
| `src/hooks/useAutoCalendarEvents.ts` |  | 80 |  | _exports:_ useAutoCalendarEvents |
| `src/hooks/useAutoLogout.ts` |  | 61 |  | _exports:_ useAutoLogout |
| `src/hooks/useAutonomousAlerts.ts` |  | 103 |  | _exports:_ useAutonomousAlerts |
| `src/hooks/useBbs.ts` |  | 89 |  | Praeventio Guard — Behavior-Based Safety client hook (2 mutators). |
| `src/hooks/useBiometricAuth.ts` | B7-Salud | 536 | ✓ | Praeventio Guard — useBiometricAuth (Round 18, R6 agent) |
| `src/hooks/useBluetoothMesh.ts` |  | 137 |  | _exports:_ useBluetoothMesh |
| `src/hooks/useBowtie.ts` | B2-RiesgoIPER | 100 |  | Praeventio Guard — Bowtie Risk Analysis client hook (3 stateless mutators). |
| `src/hooks/useCalendarPredictions.ts` |  | 161 |  | _exports:_ useCalendarPredictions |
| `src/hooks/useChangeMgmt.ts` | B13-MOC | 139 |  | Praeventio Guard — Operational Change (MOC) client hook (4 mutators). |
| `src/hooks/useChecklistBuilder.ts` | B9-Inspecciones | 125 |  | Praeventio Guard — Checklist Builder client hook (4 stateless mutators). |
| `src/hooks/useCircadian.ts` | B7-Salud | 90 |  | Praeventio Guard — Circadian Rhythm + Alertness client hook (3 mutators). |
| `src/hooks/useClimateAwareScheduling.ts` |  | 82 |  | Praeventio Guard — Climate-Aware Scheduling client hook (2 mutators). |
| `src/hooks/useCoachRag.ts` | B14-IA | 90 |  | Praeventio Guard — Coach IA RAG client hook (3 mutators). |
| `src/hooks/useComms.ts` | B1-Emergencia | 144 |  | Praeventio Guard — Communication Map client hook (5 mutators). |
| `src/hooks/useCommsDrill.ts` | B1-Emergencia | 110 |  | Praeventio Guard — Emergency Comms Drill client hook (4 stateless mutators). |
| `src/hooks/useConfidentialReports.ts` | B18-Analitica | 147 |  | Praeventio Guard — §211-213 Reportes Confidenciales / Ley Karin hooks. |
| `src/hooks/useConsistency.ts` |  | 79 |  | Praeventio Guard — Consistency Auditor client hook (2 mutators). |
| `src/hooks/useConsultativeSale.ts` | B11-Contratistas | 45 |  | Praeventio Guard — Consultative Sale Playbook client hook |
| `src/hooks/useContingencySimulation.ts` | B1-Emergencia | 118 |  | Praeventio Guard — Contingency Simulation client hook (4 stateless mutators). |
| `src/hooks/useContinuity.ts` | B13-MOC | 102 |  | Praeventio Guard — Business Continuity client hook (3 mutators). |
| `src/hooks/useContractors.ts` | B11-Contratistas | 97 |  | Praeventio Guard — Contractors KPI client hook (3 mutators). |
| `src/hooks/useControlComparator.ts` |  | 166 |  | Praeventio Guard — Control Comparator client hook (4 stateless mutators |
| `src/hooks/useCorrectiveActions.ts` | B4-Incidentes | 152 |  | Praeventio Guard — F.4 Corrective Actions Center hooks. |
| `src/hooks/useCostCalculator.ts` |  | 69 |  | Praeventio Guard — Prevention Cost Calculator client hook (2 mutators). |
| `src/hooks/useCphsMinute.ts` |  | 18 |  | Praeventio Guard — F.7 CPHS Minute hook. |
| `src/hooks/useCriticalControls.ts` | B2-RiesgoIPER | 202 |  | Praeventio Guard — Critical Controls client hook (9 mutators). |
| `src/hooks/useCriticalRoles.ts` | B13-MOC | 118 |  | Praeventio Guard — Critical Roles client hook (4 mutators). |
| `src/hooks/useCulturePulse.ts` | B12-CPHS | 138 |  | Praeventio Guard — §61-63 Culture Pulse hooks + mutators. |
| `src/hooks/useDataConfidence.ts` | B18-Analitica | 118 |  | Praeventio Guard — §104 Panel de Confianza de Datos hooks. |
| `src/hooks/useDataQuality.ts` |  | 88 |  | Praeventio Guard — F.9 Data Quality (pre-IA gap detector) hook. |
| `src/hooks/useDeadReckoning.ts` |  | 82 |  | _exports:_ DrPosition, useDeadReckoning |
| `src/hooks/useDeduplication.ts` |  | 79 |  | Praeventio Guard — Record Deduplication client hook (2 stateless mutators). |
| `src/hooks/useDocumentVersioning.ts` |  | 180 |  | Praeventio Guard — F.23 Document Versioning client hook. |
| `src/hooks/useDrillsManager.ts` | B1-Emergencia | 162 |  | Praeventio Guard — F.20 Drills Manager hooks. |
| `src/hooks/useDriving.ts` |  | 89 |  | Praeventio Guard — Driving telemetry client hook (3 mutators). |
| `src/hooks/useDrivingSafety.ts` |  | 225 |  | Praeventio Guard — §69-71 Driving Safety hooks + mutators. |
| `src/hooks/useEfficacyVerification.ts` |  | 79 |  | Praeventio Guard — Corrective-Action Efficacy Verification client hook |
| `src/hooks/useEmergencyBrigade.ts` | B1-Emergencia | 126 |  | Praeventio Guard — §74-78 Emergency Brigade hooks + mutators. |
| `src/hooks/useEngineeringControls.ts` | B8-PermisosLOTO | 140 |  | Praeventio Guard — §42-44 Engineering Controls hooks + mutators. |
| `src/hooks/useEppFlow.ts` |  | 195 |  | Praeventio Guard — Bloque 4.2: useEppFlow client hook. |
| `src/hooks/useEquipment.ts` | B10-EPP | 95 |  | Praeventio Guard — Sprint I.5 Equipment Master hook. |
| `src/hooks/useEquipmentQr.ts` | B10-EPP | 203 | ✓ | Praeventio Guard — Bloque 3 wire huérfanos (3.11) client hook. |
| `src/hooks/useErgonomics.ts` | B3-Ergonomia | 61 |  | Praeventio Guard — Ergonomics REBA/RULA client hook (2 mutators). |
| `src/hooks/useEscalation.ts` |  | 157 |  | Praeventio Guard — Escalation + SLA Engine client hook (5 mutators). |
| `src/hooks/useEvacuation.ts` | B1-Emergencia | 121 | ✓ | Praeventio Guard — Evacuation headcount client hook (4 mutators). |
| `src/hooks/useEvacuationHeadcount.ts` | B1-Emergencia | 267 | ✓ | Praeventio Guard — Evacuation Headcount client hook (REST + live Firestore). |
| `src/hooks/useEventReplay.ts` |  | 104 |  | Praeventio Guard — Event Replay Audit Tool client hook (3 mutators). |
| `src/hooks/useExceptions.ts` | B8-PermisosLOTO | 166 |  | Praeventio Guard — Exception engine client hook (6 mutators). |
| `src/hooks/useExpirations.ts` |  | 102 |  | Praeventio Guard — Universal expiration scanner client hook (2 mutators). |
| `src/hooks/useExplainability.ts` | B14-IA | 71 |  | Praeventio Guard — F.28 Explainability client hook. |
| `src/hooks/useExpressBundle.ts` |  | 78 |  | Praeventio Guard — Auditoría Express Bundle client hook (1 mutator). |
| `src/hooks/useExternalAuditPortal.ts` | B17-Admin | 246 | ✓ | Praeventio Guard — Wire-orphan Bloque 3 §3.7: client wrappers for the |
| `src/hooks/useFallDetectionPreference.ts` | B1-Emergencia | 65 |  | _exports:_ useFallDetectionPreference |
| `src/hooks/useFatigue.ts` | B7-Salud | 53 |  | Praeventio Guard — Fatigue Monitor client hook (1 mutator). |
| `src/hooks/useFirestoreCollection.ts` |  | 90 |  | _exports:_ useFirestoreCollection |
| `src/hooks/useFirstResponderMap.ts` | B1-Emergencia | 82 |  | Praeventio Guard — First Responder Map client hook (2 mutators). |
| `src/hooks/useFiveS.ts` |  | 92 |  | Praeventio Guard — 5S Audit client hook (3 mutators). |
| `src/hooks/useFormBuilderAdvanced.ts` | B9-Inspecciones | 143 |  | Praeventio Guard — Form Builder Advanced client hook (5 stateless mutators). |
| `src/hooks/useFrequencyAnalysis.ts` |  | 83 |  | _exports:_ FrequencyAnalysisOptions, FrequencyAnalysisResult, useFrequencyAnalysis |
| `src/hooks/useGamification.ts` | B6-Capacitacion | 159 |  | _exports:_ UserStats, useGamification |
| `src/hooks/useGeoAnchor.ts` |  | 93 | ✓ | useGeoAnchor — Sprint 21 Ola 3 Bucket J.4. |
| `src/hooks/useGeoAnchoredNodes.ts` |  | 175 | ✓ | useGeoAnchoredNodes — Bucket K.1 |
| `src/hooks/useGeoCountry.ts` |  | 109 |  | `useGeoCountry` — consent-gated GPS country detection hook. |
| `src/hooks/useGeofence.ts` | B1-Emergencia | 234 | ✓ | _exports:_ GeofenceZone, buildZonesGeometryHash, GeofencePermissionState, useGeofence |
| `src/hooks/useGeofencePermissions.ts` | B1-Emergencia | 54 |  | Praeventio Guard — Geofence Permission UX client hook (1 stateless mutator). |
| `src/hooks/useGeofenceWithEvents.ts` | B1-Emergencia | 95 |  | SystemEngine — Geofence wrapper hook. |
| `src/hooks/useGeolocationTracking.ts` |  | 192 |  | _exports:_ useGeolocationTracking |
| `src/hooks/useHazmatInventory.ts` | B10-EPP | 216 | ✓ | Praeventio Guard — hazmat inventory client hook. Mirrors useReadReceipts: |
| `src/hooks/useHealthMetrics.ts` | B7-Salud | 333 | ✓ | useHealthMetrics — Bucket OO (Sprint 25). |
| `src/hooks/useHorometro.ts` | B10-EPP | 137 |  | Praeventio Guard — Bloque 4.1: useHorometro client hook. |
| `src/hooks/useHygiene.ts` | B7-Salud | 76 |  | Praeventio Guard — Industrial Hygiene client hook (2 mutators). |
| `src/hooks/useInbox.ts` |  | 88 |  | Praeventio Guard — F.8 Inbox del Prevencionista hook. |
| `src/hooks/useIncidentBundle.ts` | B4-Incidentes | 89 |  | Praeventio Guard — F.3 Incident Evidence Bundle hook. |
| `src/hooks/useIncidentFlow.ts` | B4-Incidentes | 211 |  | Praeventio Guard — Bloque 4.3 useIncidentFlow client hook. |
| `src/hooks/useIncidentTrends.ts` | B4-Incidentes | 63 |  | Praeventio Guard — F.29 Indicadores de Tendencia de Incidentes. |
| `src/hooks/useIndustryIntegration.ts` |  | 182 |  | _exports:_ ComplianceScore, useIndustryIntegration |
| `src/hooks/useIndustryRules.ts` | B5-Cumplimiento | 139 |  | Praeventio Guard — Bloque 3.13 wire huérfanos: industryRules client hook. |
| `src/hooks/useInsights.ts` |  | 185 | ✓ | Praeventio Guard — Wire UI bridge hooks (PASO 2 cierre). |
| `src/hooks/useInvoicePolling.ts` | B15-Billing | 335 | ✓ | Praeventio Guard — useInvoicePolling. |
| `src/hooks/useJsa.ts` |  | 100 |  | Praeventio Guard — JSA (Job Safety Analysis) client hook |
| `src/hooks/useKnowledgeBase.ts` |  | 142 |  | Praeventio Guard — §185-190 Knowledge Base hooks + mutators. |
| `src/hooks/useLeadership.ts` |  | 99 |  | Praeventio Guard — §276-277 Leadership Decisions hooks + mutators. |
| `src/hooks/useLegalCalendar.ts` | B5-Cumplimiento | 169 |  | Praeventio Guard — Legal calendar client hook (5 GET/POST queries). |
| `src/hooks/useLegalObligations.ts` | B5-Cumplimiento | 240 | ✓ | Praeventio Guard — Bloque 3.14 wire huérfanos: Legal Obligations Calendar client hook. |
| `src/hooks/useLessonsLearned.ts` | B4-Incidentes | 72 |  | Praeventio Guard — F.12 Lessons Learned hooks. |
| `src/hooks/useLoneWorker.ts` | B1-Emergencia | 158 |  | Praeventio Guard — Lone worker client hook (5 mutators / queries). |
| `src/hooks/useLoto.ts` |  | 92 |  | Praeventio Guard — LOTO Digital hook. |
| `src/hooks/useManDownDetection.ts` | B1-Emergencia | 401 | ✓ | _exports:_ useManDownDetection |
| `src/hooks/useMaturityIndex.ts` | B2-RiesgoIPER | 37 |  | Praeventio Guard — F.26 Prevention Maturity hook. |
| `src/hooks/useMediaPipePose.ts` | B3-Ergonomia | 195 |  | useMediaPipePose — hook que envuelve `@mediapipe/tasks-vision` Pose Landmarker |
| `src/hooks/useMedicalCatalogs.ts` | B7-Salud | 133 |  | Praeventio Guard — Medical Catalogs lookup client hook (6 lookups). |
| `src/hooks/useMeetingPack.ts` | B12-CPHS | 111 |  | Praeventio Guard — Meeting pack + briefing client hook (3 mutators). |
| `src/hooks/useMentalLoad.ts` | B7-Salud | 85 |  | Praeventio Guard — Mental Load (NASA-TLX) + Admin Burden client hook (2 mutators). |
| `src/hooks/useMicrotraining.ts` | B6-Capacitacion | 160 |  | Praeventio Guard — F.22 Lightning Training client hook. |
| `src/hooks/useMultiProject.ts` |  | 96 |  | Praeventio Guard — Multi-Project Comparator client hook |
| `src/hooks/useMultiRoleSummary.ts` |  | 98 |  | Praeventio Guard — Multi-Role Summary client hook (3 stateless mutators). |
| `src/hooks/useNonConformity.ts` | B5-Cumplimiento | 100 |  | Praeventio Guard — Non-Conformity client hook (3 mutators). |
| `src/hooks/useObjectLifecycle.ts` |  | 159 | ✓ | useObjectLifecycle — wires `deriveLifecycleTransition` (pure orchestrator) |
| `src/hooks/useOfflineInspections.ts` | B9-Inspecciones | 170 |  | Praeventio Guard — F.6 Offline Inspections hooks + mutators. |
| `src/hooks/useOnlineStatus.ts` |  | 21 |  | _exports:_ useOnlineStatus |
| `src/hooks/useOperationalChange.ts` | B13-MOC | 238 |  | Praeventio Guard — useOperationalChange (Bloque 3.17, adapter-backed MOC). |
| `src/hooks/useOrgMetrics.ts` | B18-Analitica | 141 |  | Praeventio Guard — Organizational Metrics client hook (5 mutators). |
| `src/hooks/usePdca.ts` |  | 198 |  | Praeventio Guard — §195-200 PDCA + Non-Conformities hooks + mutators. |
| `src/hooks/usePendingActions.ts` |  | 34 |  | _exports:_ usePendingActions |
| `src/hooks/usePhotoEvidence.ts` | B9-Inspecciones | 151 |  | Praeventio Guard — F.19 Photo Evidence client hook. |
| `src/hooks/usePinSign.ts` |  | 129 |  | Praeventio Guard — PIN Sign client hook (5 mutators, F.25). |
| `src/hooks/usePortableHistory.ts` | B18-Analitica | 143 |  | Praeventio Guard — F.18 Historial Profesional Portátil hooks. |
| `src/hooks/usePortfolioLessons.ts` | B6-Capacitacion | 78 |  | Praeventio Guard — Portfolio Lessons client hook (2 stateless mutators). |
| `src/hooks/usePositiveObservations.ts` | B9-Inspecciones | 111 |  | Praeventio Guard — §214-215 Positive Observations + Balance hooks. |
| `src/hooks/usePostTraining.ts` | B6-Capacitacion | 132 |  | Praeventio Guard — Post-Training Assessment client hook (4 stateless mutators). |
| `src/hooks/usePredictiveAlerts.ts` | B18-Analitica | 90 |  | Praeventio Guard — Predictive Alerts client hook (2 mutators). |
| `src/hooks/usePreShiftRisk.ts` | B2-RiesgoIPER | 39 |  | Praeventio Guard — F.21 Pre-Shift Risk hook. |
| `src/hooks/usePreventionCost.ts` | B15-Billing | 167 |  | Praeventio Guard — Prevention Cost Simulator client hook (Bloque 3.15). |
| `src/hooks/usePricingCalculator.ts` | B15-Billing | 103 |  | Praeventio Guard — Pricing calculator client hook (4 mutators). |
| `src/hooks/usePricingSimulator.ts` | B15-Billing | 104 |  | Praeventio Guard — Pricing Simulator client hook (3 stateless mutators). |
| `src/hooks/usePrivacyRetention.ts` | B5-Cumplimiento | 131 |  | Praeventio Guard — Privacy Retention client hook (4 stateless mutators). |
| `src/hooks/usePrivacyShield.ts` |  | 97 |  | Praeventio Guard — Privacy Shield client hook (3 stateless mutators). |
| `src/hooks/useProjectArAnchors.ts` |  | 92 |  | useProjectArAnchors — hook React reactivo para anclas AR del |
| `src/hooks/useProjectCapacity.ts` |  | 84 |  | useProjectCapacity — thin reactive wrapper over the pure capacity logic. |
| `src/hooks/useProjectClosure.ts` |  | 168 |  | Praeventio Guard — §131-138 Project Closure hooks + mutators. |
| `src/hooks/useProjectComparator.ts` | B18-Analitica | 48 |  | Praeventio Guard — Project Comparator client hook (1 mutator). |
| `src/hooks/useProjectFirestoreCollection.ts` |  | 157 | ✓ | Praeventio Guard — Plan 2026-05-23 Fase B.2. |
| `src/hooks/useProtocols.ts` |  | 86 |  | Praeventio Guard — Protocols (IPER + PREXOR + TMERT) client hook (3 mutators). |
| `src/hooks/usePushNotifications.ts` |  | 275 | ✓ | Praeventio Guard — usePushNotifications (Round 16, R3 agent) |
| `src/hooks/usePymeOnboarding.ts` | B6-Capacitacion | 58 |  | Praeventio Guard — PYME Onboarding client hook (2 mutators). |
| `src/hooks/usePymeWizard.ts` | B17-Admin | 45 |  | Praeventio Guard — PYME Wizard client hook (1 mutator). |
| `src/hooks/useQrAck.ts` | B9-Inspecciones | 105 |  | Praeventio Guard — QR Acknowledgement Sessions client hook (2 mutators). |
| `src/hooks/useQrSignature.ts` | B9-Inspecciones | 74 |  | Praeventio Guard — F.5 QR Signature mutators. |
| `src/hooks/useRaciMatrix.ts` | B12-CPHS | 159 |  | Praeventio Guard — RACI Matrix client hook (6 mutators). |
| `src/hooks/useReadReceipts.ts` |  | 155 |  | Praeventio Guard — Read receipts client hook (6 mutators). |
| `src/hooks/useReconciliationStatus.ts` |  | 106 | ✓ | React hook that surfaces reconciliation run status to the UI. |
| `src/hooks/useReducedMotion.ts` |  | 14 |  | _exports:_ useReducedMotion |
| `src/hooks/useRefuges.ts` | B1-Emergencia | 75 |  | Praeventio Guard — Mountain Refuges client hook (3 mutators). |
| `src/hooks/useRegulatoryFramework.ts` | B5-Cumplimiento | 107 |  | Praeventio Guard — Regulatory Framework client hook (5 lookups). |
| `src/hooks/useRepeatingRisks.ts` |  | 19 |  | Praeventio Guard — F.13 Repeating Risk Radar hook. |
| `src/hooks/useReportsAutomation.ts` | B18-Analitica | 89 |  | Praeventio Guard — Reports Automation client hook (3 mutators). |
| `src/hooks/useReputationalAlerts.ts` |  | 76 |  | Praeventio Guard — Reputational Alerts client hook (2 stateless mutators). |
| `src/hooks/useResearchMode.ts` | B14-IA | 114 |  | Praeventio Guard — Research Mode client hook (4 mutators). |
| `src/hooks/useResidualRisk.ts` | B2-RiesgoIPER | 123 |  | Praeventio Guard — §296-301 Residual Risk hooks. |
| `src/hooks/useResilienceHealth.ts` | B7-Salud | 215 | ✓ | useResilienceHealth — runs `buildResilienceHealthReport` con los |
| `src/hooks/useResilientAi.ts` |  | 223 | ✓ | useResilientAi — React hook que envuelve el resilient AI orchestrator |
| `src/hooks/useResilientAsesorFlag.ts` | B14-IA | 139 | ✓ | useResilientAsesorFlag — feature flag local-first para conmutar |
| `src/hooks/useRestrictedZones.ts` | B1-Emergencia | 186 |  | Praeventio Guard — Restricted Zones client hook. |
| `src/hooks/useRetaliationProtection.ts` |  | 76 |  | Praeventio Guard — Retaliation Protection client hook (2 stateless mutators). |
| `src/hooks/useReturnToWork.ts` |  | 98 |  | Praeventio Guard — Return-to-Work client hook (3 stateless mutators). |
| `src/hooks/useRiskEngine.ts` |  | 359 | ✓ | _exports:_ useRiskEngine |
| `src/hooks/useRiskRanking.ts` | B2-RiesgoIPER | 181 |  | Praeventio Guard — Risk Ranking client hook (4 mutators + 3 React hook stubs). |
| `src/hooks/useRoiScenario.ts` |  | 53 |  | Praeventio Guard — ROI Scenario Comparator client hook (1 mutator). |
| `src/hooks/useRoleViews.ts` |  | 59 |  | Praeventio Guard — Role-based dashboard view client hook (1 mutator). |
| `src/hooks/useRootCause.ts` | B4-Incidentes | 127 |  | Praeventio Guard — Root cause client hook (5 mutators). |
| `src/hooks/useRootCauseInvestigation.ts` | B4-Incidentes | 112 |  | Praeventio Guard — Root Cause Investigation Mode client hook |
| `src/hooks/useRouteScoring.ts` |  | 80 |  | Praeventio Guard — Route Scoring client hook (2 stateless mutators). |
| `src/hooks/useRouting.ts` |  | 77 |  | Praeventio Guard — Routing engines client hook (2 mutators). |
| `src/hooks/useSafetyMetrics.ts` | B18-Analitica | 100 |  | Praeventio Guard — Safety Metrics OSHA + ICMM client hook (3 mutators). |
| `src/hooks/useSafetyPerformance.ts` | B18-Analitica | 77 |  | Praeventio Guard — Safety Performance Index client hook (2 mutators). |
| `src/hooks/useSafetyTalks.ts` | B6-Capacitacion | 47 |  | Praeventio Guard — Safety talks topic suggester client hook (1 mutator). |
| `src/hooks/useSeismicMonitor.ts` |  | 74 | ✓ | _exports:_ Earthquake, useSeismicMonitor |
| `src/hooks/useSensoryFatigue.ts` | B7-Salud | 64 |  | _exports:_ useSensoryFatigue |
| `src/hooks/useSessionExpiry.ts` | B17-Admin | 113 |  | _exports:_ firstLoginKey, clearFirstLogin, useSessionExpiry |
| `src/hooks/useShiftHandover.ts` | B13-MOC | 243 | ✓ | Praeventio Guard — Shift Handover client hook (6 mutators). |
| `src/hooks/useShiftRiskPanel.ts` | B2-RiesgoIPER | 51 |  | Praeventio Guard — Shift Risk Panel client hook (1 mutator). |
| `src/hooks/useSif.ts` |  | 108 |  | Praeventio Guard — F.3 SIF Precursors hooks. |
| `src/hooks/useSignaletics.ts` | B10-EPP | 92 |  | Praeventio Guard — Signaletics client hook (3 stateless mutators). |
| `src/hooks/useSkillGap.ts` | B6-Capacitacion | 129 |  | Praeventio Guard — Skill Gap Analyzer client hook (4 stateless mutators). |
| `src/hooks/useSlmAcquisition.ts` |  | 451 | ✓ | useSlmAcquisition — React hook que orquesta el flujo de adquisición |
| `src/hooks/useSlmOffline.ts` | B16-Offline | 203 |  | `useSlmOffline` — React hook that wraps the ONNX adapter (Brecha B, |
| `src/hooks/useSoftBlocking.ts` | B8-PermisosLOTO | 124 |  | Praeventio Guard — Soft-blocking requirement gate client hook (4 mutators). |
| `src/hooks/useSpacedRepetition.ts` | B6-Capacitacion | 117 |  | Praeventio Guard — Spaced Repetition (SM-2) client hook (4 mutators). |
| `src/hooks/useStoppage.ts` | B8-PermisosLOTO | 141 |  | Praeventio Guard — Stoppage client hook (5 mutators). |
| `src/hooks/useStreamedGuardian.ts` |  | 176 | ✓ | Praeventio Guard — TODO.md §12.9.3 MEDIA: SSE streaming Gemini client. |
| `src/hooks/useSubmit.ts` |  | 26 |  | _exports:_ useSubmit |
| `src/hooks/useSuppliers.ts` |  | 198 |  | Praeventio Guard — §90-91 Suppliers hooks + mutators. |
| `src/hooks/useSurvivalPing.ts` |  | 63 |  | _exports:_ useSurvivalPing |
| `src/hooks/useSyncState.ts` |  | 30 |  | Sprint 25 Bucket QQ — React hook subscribing to OfflineSyncStateMachine. |
| `src/hooks/useSyncStatus.ts` | B16-Offline | 102 |  | Praeventio Guard — Sync Status client hook (5 mutators). |
| `src/hooks/useTenantId.ts` | B17-Admin | 63 |  | useTenantId — hook React que extrae el tenantId del Firebase Auth |
| `src/hooks/useToast.ts` |  | 33 |  | _exports:_ ToastType, Toast, useToast |
| `src/hooks/useTwinAccess.ts` |  | 184 | ✓ | Sprint 25 — Digital Twin Triple-Gate Authentication (ADR 0011) |
| `src/hooks/useUpsell.ts` |  | 44 |  | Praeventio Guard — Pain-Based Upsell client hook (1 stateless mutator). |
| `src/hooks/useVendorOnboarding.ts` | B6-Capacitacion | 152 |  | Praeventio Guard — Vendor/Contractor onboarding client hook |
| `src/hooks/useVulnerability.ts` |  | 84 |  | Praeventio Guard — F.10 Vulnerability Map hook. |
| `src/hooks/useWakeLock.ts` |  | 68 |  | _exports:_ useWakeLock |
| `src/hooks/useWaste.ts` |  | 90 |  | Praeventio Guard — §229-236 Waste Inventory hook. |
| `src/hooks/useWebXRSupport.ts` |  | 126 | ✓ | useWebXRSupport — Sprint 21 Ola 4 Bucket L.1. |
| `src/hooks/useWisdomCapsules.ts` |  | 66 |  | _exports:_ WisdomCapsuleData, useWisdomCapsules |
| `src/hooks/useWorkerHistory.ts` |  | 99 |  | Praeventio Guard — Portable worker history client hook (3 mutators). |
| `src/hooks/useWorkerReadiness.ts` |  | 29 |  | Praeventio Guard — F.16 Worker Readiness hook. |
| `src/hooks/useWorkPermits.ts` | B8-PermisosLOTO | 130 |  | Praeventio Guard — F.15 Work Permits hooks + mutators. |
| `src/hooks/useZettelkastenIntelligence.ts` |  | 373 |  | _exports:_ SmartActionType, NodeSmartAction, SmartAction, URLContext, useZettelkastenIntelligence |
