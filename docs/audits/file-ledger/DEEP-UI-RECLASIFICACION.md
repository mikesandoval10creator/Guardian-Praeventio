# DEEP — Reclasificación UI: cierre de atribución de bloque · 2026-06-02

**Insumo:** `ledger.json` (filtro `block===""` && `category ∈ {FEAT-components, FEAT-pages, FEAT-hooks, FEAT-routes}`) + `DEEP-NH-ui.md` (huérfanos + cross-cutting ya detectados).
**Universo:** 355 archivos UI sin bloque en el ledger mecánico.
**Objetivo:** cada archivo UI con un bloque **B1–B18** sugerido, o etiqueta **CROSS** (layout/shared/infra transversal legítima), para que el barrido quede **100% atribuido** (0 `❓`).

> **Método (code-first).** Partí de la columna "Bloque sugerido" de `DEEP-NH-ui.md` (255 ya firmes) y resolví los **100 `❓unclear`** restantes con evidencia directa: (a) grupo de ruteo que monta la page (`src/routes/*Routes.tsx` → bloque), (b) page importadora del componente (`grep -rl`), (c) endpoint consumido por el hook (`/api/sprint-k/<dominio>/...`), (d) servicio importado. Doc-only; nada se modificó en el código ni en el ledger.

> **CROSS** = infraestructura compartida transversal (layout shell, `shared/*`, primitivas de formulario, hooks de datos genéricos, scaffolds de ruteo mixtos, landings públicas). No son huérfanos ni asignables a un bloque de negocio. **No** confundir CROSS con huérfano: un huérfano (🏚️) puede pertenecer a un bloque B-N y aun así no estar montado.

## 1. Resumen

| Métrica | Valor |
|---|---|
| Archivos UI totales | 355 |
| Reclasificados en esta pasada (eran `❓unclear`) | 100 |
| Atribuidos a un bloque B1–B18 / B?-DigitalTwin | 307 |
| CROSS (transversal legítimo) | 48 |
| Siguen `❓` sin clasificar | 0 |
| Huérfanos (🏚️, 0 importer no-test) — ortogonal al bloque | 86 |

### 1.1 Distribución por bloque final

| Bloque final | Archivos |
|---|---|
| B1-Emergencia | 17 |
| B2-RiesgoIPER | 21 |
| B3-Ergonomia | 9 |
| B4-Incidentes | 6 |
| B5-Cumplimiento | 28 |
| B6-Capacitacion | 24 |
| B7-Salud | 17 |
| B8-PermisosLOTO | 11 |
| B9-Inspecciones | 19 |
| B10-EPP | 8 |
| B11-Contratistas | 17 |
| B12-CPHS | 11 |
| B13-MOC | 13 |
| B14-IA | 19 |
| B15-Billing | 6 |
| B16-Offline | 6 |
| B17-Admin | 30 |
| B18-Analitica | 14 |
| B?-DigitalTwin/AR | 31 |
| CROSS | 48 |
| **TOTAL** | **355** |

> Lectura: **48 CROSS** + **307** atribuidos a bloque (incl. 31 en el bloque candidato `B?-DigitalTwin/AR`, pendiente de decisión §5 del INDEX). **0 quedan `❓`** → barrido UI 100% atribuido.

## 2. Tabla por archivo

| Archivo | Bloque final | CROSS? | Huérfano? | Evidencia (importer/route) |
|---|---|:---:|:---:|---|
| `src/components/adoption/ChurnRiskPanel.tsx` | B2-RiesgoIPER |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/ai/AiResponseCard.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ai/EthicsGuardian.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ai/GuardianVoiceAssistant.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ai/PredictiveAnalysis.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ai/ResilientAiAssistantPanel.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ai/SafetyForecast.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ai/VisionAnalyzer.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/annualReview/AnnualReviewSummary.tsx` | B7-Salud |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/annualReview/PreventiveObjectivesPanel.tsx` | B7-Salud |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/ar/ARMachineryScene.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ar/ARPosterScanner.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ar/ArQuickLookButton.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ar/ArViewLink.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/ar/ARWarehouseScene.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/audit/AuditExpressButton.tsx` | B9-Inspecciones |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/audits/AddAuditModal.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/audits/AuditDetailModal.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/audits/ISOAudit.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/audits/ISOManagement.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/audits/ISOManagementFilters.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/audits/ISOManagementHeader.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/bio/CompensatoryExercisesModal.tsx` | B3-Ergonomia |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/blueprints/BlueprintViewer.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/BunkerManager.tsx` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/calendar/AddEventModal.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/calendar/EventDetailsModal.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/cargo/CargoCogPanel.tsx` | B3-Ergonomia |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/climateAware/ClimatePlanAdjustment.tsx` | B11-Contratistas |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/consistency/ConsistencyAuditCard.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/cost/CostScenarioCard.tsx` | B15-Billing |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/cost/CostSimulator.tsx` | B15-Billing |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/costCalculator/PreventionROIWidget.tsx` | B15-Billing |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/dataQuality/DataQualityCard.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/ARObjectOverlay.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/GaussianSplatViewer.tsx` | B?-DigitalTwin/AR |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/NormativaWarningsBanner.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/PlacedObjectsLayer.tsx` | B4-Incidentes |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/PlaceObjectMenu.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/ReconstructionArLink.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/RePositionConfirmDialog.tsx` | B?-DigitalTwin/AR |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/RiskNodeMarkers.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/Site25DPanel.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/digital-twin/TwinAccessGuard.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/documents/AddDocumentModal.tsx` | B5-Cumplimiento |  |  | importer Documents.tsx; document/compliance mgmt |
| `src/components/documents/EditDocumentModal.tsx` | B5-Cumplimiento |  |  | importer Documents.tsx; document/compliance mgmt |
| `src/components/documents/LegalDocGeneratorForm.tsx` | B5-Cumplimiento |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/driving/DrivingSuggestion.tsx` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/drivingSafety/DriverScoreCard.tsx` | B11-Contratistas |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/engineering/ConfinedSpacePanel.tsx` | B8-PermisosLOTO |  |  | importer CalculatorHub; confined space permit (espacio confinado) |
| `src/components/engineering/HidranteFireNetworkPanel.tsx` | B8-PermisosLOTO |  |  | importer CalculatorHub; fire/hydrant network engineering control |
| `src/components/engineering/SlopeStabilityPanel.tsx` | B18-Analitica |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/engineering/StructuralCalculator.tsx` | B?-DigitalTwin/AR |  |  | importer AIHub; structural calc — but engineering/twin; keep with calc cluster |
| `src/components/eppFlow/PendingPurchaseOrdersPanel.tsx` | B10-EPP |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/eppFlow/PurchaseOrderSignModal.tsx` | B10-EPP |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/escalation/SlaWatchPanel.tsx` | B4-Incidentes |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/etl/CsvImportExportModal.tsx` | B18-Analitica |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/euler/BucklingCalculatorCard.tsx` | B3-Ergonomia |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/evidenceChain/CustodyChainTimelineCard.tsx` | B9-Inspecciones |  | 🏚️ | orphan; chain-of-custody of evidence (cadena de custodia) — inspecciones/evidence |
| `src/components/excelImport/ExcelImportPreview.tsx` | B18-Analitica |  | 🏚️ | orphan; Excel import preview (ETL/data import) |
| `src/components/expirations/ExpirationsListPanel.tsx` | B9-Inspecciones |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/exposure/HeatStressCard.tsx` | B3-Ergonomia |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/external-events/CalmRecommendationCard.tsx` | B1-Emergencia |  | 🏚️ | orphan; external-events (seismic/weather) calm recommendation |
| `src/components/external-events/ExternalEventsPanel.tsx` | B1-Emergencia |  |  | importer Calendar; external hazard events panel |
| `src/components/FastCheckModal.tsx` | B9-Inspecciones |  |  | importer Dashboard; quick pre-task safety check (inspección rápida) |
| `src/components/fiveS/FiveSAuditForm.tsx` | B9-Inspecciones |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/games/gameScore.ts` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/GeolocationTracker.tsx` | B1-Emergencia |  |  | importer App.tsx; geoloc tracking for lone-worker/emergency |
| `src/components/glossary/GlossarySearchPanel.tsx` | B6-Capacitacion |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/governance/DeviationRadarPanel.tsx` | B13-MOC |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/hvac/AirQualityPanel.tsx` | B9-Inspecciones |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/identity/TaxIdInput.tsx` | CROSS | ✅ | 🏚️ | orphan; RUT/tax-id input primitive — shared form widget |
| `src/components/inbox/InboxPrevencionistaPanel.tsx` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/industry/IndustryNormsSummary.tsx` | B5-Cumplimiento |  |  | importer IndustrySelectorWizard; industry normative summary |
| `src/components/industry/IndustrySelectorWizard.tsx` | B17-Admin |  | 🏚️ | orphan; industry/onboarding selector wizard (project setup) |
| `src/components/knowledge/SmartConnectionsPanel.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/knowledgeBase/KnowledgeBaseSearch.tsx` | B6-Capacitacion |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/layout/PendingInvitesBanner.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/layout/ProjectSelector.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/layout/RootLayout.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/layout/Sidebar.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/layout/sidebarMenuGroups.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/leadership/LeadershipTrailCard.tsx` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/legal/CookieConsent.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/lineOfFire/LineOfFireValidationCard.tsx` | B2-RiesgoIPER |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/LocalePicker.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/maps/mapConfig.ts` | CROSS | ✅ |  | 10 importers across maps (driving/emergency/site) — shared map config |
| `src/components/measurements/MeasurementQualityCard.tsx` | B9-Inspecciones |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/normativa/NormativaSwitch.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/operationalState/FaenaStateBanner.tsx` | B13-MOC |  | 🏚️ | orphan; faena operational-state banner (ops/handover) |
| `src/components/pdca/PdcaSummaryCard.tsx` | B4-Incidentes |  | 🏚️ | orphan; PDCA summary card (ciclo mejora/no-conformidad) |
| `src/components/pinSign/PinSignModal.tsx` | B8-PermisosLOTO |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/predictive/AlertSchedulerMount.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/privacy/PrivacyRegimeCard.tsx` | B5-Cumplimiento |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/processes/CloseProcessModal.tsx` | B13-MOC |  |  | importer CuadrillasDashboard; crew/process ops |
| `src/components/processes/CreateCrewModal.tsx` | B13-MOC |  |  | importer CuadrillasDashboard; crew creation ops |
| `src/components/processes/ProcessDetailModal.tsx` | B13-MOC |  |  | importer CuadrillasDashboard; process detail ops |
| `src/components/processes/StartProcessModal.tsx` | B13-MOC |  |  | importer CuadrillasDashboard; process start ops |
| `src/components/projectClosure/ProjectClosureCard.tsx` | B13-MOC |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/projects/GanttProjectView.tsx` | B13-MOC |  |  | importers Projects+CuadrillasDashboard; project gantt/ops planning |
| `src/components/projects/MaquinariaManager.tsx` | B10-EPP |  |  | importers Assets+Projects; machinery/asset management |
| `src/components/projects/PredictedActivityModal.tsx` | B18-Analitica |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/projects/ProjectDocuments.tsx` | B5-Cumplimiento |  |  | importer Projects; project documents/compliance |
| `src/components/protocols/IperMatrixCard.tsx` | B2-RiesgoIPER |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/psychosocial/AddPsychosocialModal.tsx` | B7-Salud |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/psychosocial/AIPsychosocialAnalysisModal.tsx` | B7-Salud |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/QRScannerModal.tsx` | B11-Contratistas |  |  | importers Attendance+Visitors; visitor/attendance QR |
| `src/components/readReceipts/DocumentReadConfirmCard.tsx` | B8-PermisosLOTO |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/risk-network/RiskNetworkExplorer.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/risk-network/RiskNetworkManager.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/risks/IPERCAnalysis.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/risks/IPERCMatrix.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/risks/PresentationMode.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/roleViews/RoleViewCards.tsx` | B17-Admin |  | 🏚️ | orphan; role-based view cards (RBAC/admin) |
| `src/components/safety/SafetyCapsules.tsx` | B6-Capacitacion |  | 🏚️ | orphan; safety micro-capsules (microtraining) |
| `src/components/security/KekRotationPanel.tsx` | B17-Admin |  |  | importer Settings; KEK rotation (KMS/security admin) |
| `src/components/settings/WebAuthnKeysSection.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/Card.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/ConfirmDialog.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/ConsciousnessLoader.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/DataLoadErrorBanner.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/DeepLinkHandler.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/EmptyState.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/ErrorBoundary.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/ErrorFallback.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/GuardianMascot.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/GuestSaveModal.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/KnowledgeGraph.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/Modal.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/ModeSwitcher.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/PremiumFeatureGuard.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/ProjectScopedPage.tsx` | CROSS | ✅ | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/shared/PWAUpdateToast.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/Skeleton.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/SyncCenterModal.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/SyncConflictBanner.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/syncConflictRoutes.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/ToastContainer.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/Tooltip.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/WisdomCapsule.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/WisdomCapsuleWatcher.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/shared/withGlossary.tsx` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/components/sif/SIFAlert.tsx` | B2-RiesgoIPER |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/SunTrackerContainer.tsx` | B7-Salud |  |  | importer Dashboard; UV/sun exposure (Ley 20.096) salud ocupacional |
| `src/components/suppliers/SupplierComparator.tsx` | B11-Contratistas |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/SurvivalPing.tsx` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/sync/ConflictResolutionDrawer.tsx` | B16-Offline |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/twinPhysics/TwinPhysicsScene.tsx` | B?-DigitalTwin/AR |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/twinScene/TwinIntegrationPanel.tsx` | B17-Admin |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/twinScene/TwinSceneInstanced.tsx` | B?-DigitalTwin/AR |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/twinScene/TwinSceneInstancedLazy.tsx` | B?-DigitalTwin/AR |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/components/WeatherBulletin.tsx` | B1-Emergencia |  |  | importers Dashboard+SafeDrivingMode; weather hazard bulletin |
| `src/components/WeatherSafetyRecommendations.tsx` | B1-Emergencia |  |  | importer Dashboard; weather-driven safety recs |
| `src/components/workerReadiness/WorkerReadinessCard.tsx` | B7-Salud |  | 🏚️ | orphan; worker readiness/fitness-for-duty (salud/vida) |
| `src/components/workers/AccessControlModal.tsx` | B17-Admin |  |  | importer Workers; access control (RBAC) |
| `src/components/workers/AddWorkerModal.tsx` | B17-Admin |  |  | importer Workers; worker roster admin |
| `src/components/workers/AIEPPScannerModal.tsx` | B10-EPP |  |  | importer EPPModal; AI EPP scanner |
| `src/components/workers/DocsModal.tsx` | B5-Cumplimiento |  |  | importer Workers; worker documents/compliance |
| `src/components/workers/EditWorkerModal.tsx` | B17-Admin |  |  | importer Workers; worker roster admin |
| `src/components/workers/EPPModal.tsx` | B10-EPP |  |  | importer Workers; worker EPP assignment |
| `src/components/workers/LaborManagementModal.tsx` | B17-Admin |  |  | importer Workers; labor/HR management |
| `src/components/workers/MassImportModal.tsx` | B17-Admin |  |  | importer Workers; mass worker import (roster admin) |
| `src/components/workers/PersonalizedSafetyPlan.tsx` | B7-Salud |  |  | importer Workers; personalized worker safety/health plan |
| `src/components/workers/QRCodeModal.tsx` | B17-Admin |  |  | importer Workers; worker QR credential |
| `src/components/workers/TraceabilityModal.tsx` | B17-Admin |  |  | importer Workers; worker traceability |
| `src/components/workers/UserProfileModal.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/zettelkasten/NlQueryPanel.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/components/zones/ZoneEntryGate.tsx` | B8-PermisosLOTO |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/_fetchUtils.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useAccelerometer.ts` | B1-Emergencia |  |  | sensor hook (fall/man-down); imported by sensor consumers |
| `src/hooks/useAcousticSOS.ts` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useAdminBurden.ts` | B17-Admin |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useAdoption.ts` | B18-Analitica |  | 🏚️ | /sprint-k/adoption/funnel,churn-risk,module-adoption — product analytics |
| `src/hooks/useAmbientNoise.ts` | B3-Ergonomia |  |  | ambient noise sensor — occupational hygiene (ruido) |
| `src/hooks/useAnnualReview.ts` | B7-Salud |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useArPlacement.ts` | B?-DigitalTwin/AR |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useAutoCalendarEvents.ts` | B13-MOC |  |  | calendar auto-events (ops scheduling) |
| `src/hooks/useAutoLogout.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useAutonomousAlerts.ts` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useBbs.ts` | B12-CPHS |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useBluetoothMesh.ts` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useCalendarPredictions.ts` | B18-Analitica |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useClimateAwareScheduling.ts` | B11-Contratistas |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useConsistency.ts` | B5-Cumplimiento |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useControlComparator.ts` | B2-RiesgoIPER |  | 🏚️ | /sprint-k/controls/compare,failures — control efficacy vs risk |
| `src/hooks/useCostCalculator.ts` | B15-Billing |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useCphsMinute.ts` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useDataQuality.ts` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useDeadReckoning.ts` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useDeduplication.ts` | B16-Offline |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useDocumentVersioning.ts` | B5-Cumplimiento |  | 🏚️ | /sprint-k/.../documents/versions,chain — document version control |
| `src/hooks/useDriving.ts` | B11-Contratistas |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useDrivingSafety.ts` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useEfficacyVerification.ts` | B2-RiesgoIPER |  | 🏚️ | /sprint-k/efficacy/verify — control efficacy verification |
| `src/hooks/useEppFlow.ts` | B10-EPP |  |  | /sprint-k/epp-flow/* + webauthn sign-order |
| `src/hooks/useEscalation.ts` | B4-Incidentes |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useEventReplay.ts` | B16-Offline |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useExpirations.ts` | B9-Inspecciones |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useExpressBundle.ts` | B9-Inspecciones |  | 🏚️ | /sprint-k/express-bundle/build — express audit bundle |
| `src/hooks/useFirestoreCollection.ts` | CROSS | ✅ |  | 31 importers — generic Firestore collection data hook |
| `src/hooks/useFiveS.ts` | B9-Inspecciones |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useFrequencyAnalysis.ts` | B3-Ergonomia |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useGeoAnchor.ts` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useGeoAnchoredNodes.ts` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useGeoCountry.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useGeolocationTracking.ts` | B1-Emergencia |  |  | geoloc tracking for lone-worker/emergency |
| `src/hooks/useInbox.ts` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useIndustryIntegration.ts` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useInsights.ts` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useJsa.ts` | B8-PermisosLOTO |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useKnowledgeBase.ts` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useLeadership.ts` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useLoto.ts` | B8-PermisosLOTO |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useMultiProject.ts` | B18-Analitica |  | 🏚️ | /sprint-k/multi-project/compare,best-practices — cross-project analytics |
| `src/hooks/useMultiRoleSummary.ts` | B17-Admin |  | 🏚️ | /sprint-k/role-summary/compose — role-based summary |
| `src/hooks/useObjectLifecycle.ts` | B?-DigitalTwin/AR |  |  | /api/calendar/sync + object lifecycle — twin/AR object mgmt |
| `src/hooks/useOnlineStatus.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/usePdca.ts` | B4-Incidentes |  |  | /sprint-k/pdca/cycles,non-conformities — PDCA/corrective action |
| `src/hooks/usePendingActions.ts` | B16-Offline |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/usePinSign.ts` | B8-PermisosLOTO |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/usePrivacyShield.ts` | B5-Cumplimiento |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useProjectArAnchors.ts` | B?-DigitalTwin/AR |  |  | AR anchors persistence — twin/AR |
| `src/hooks/useProjectCapacity.ts` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useProjectClosure.ts` | B13-MOC |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useProjectFirestoreCollection.ts` | CROSS | ✅ | 🏚️ | project-scoped collection scaffold (Plan B.2) — generic data infra |
| `src/hooks/useProtocols.ts` | B3-Ergonomia |  | 🏚️ | /sprint-k/protocols/iper,prexor,tmert — ergonomics/health protocols |
| `src/hooks/usePushNotifications.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useReadReceipts.ts` | B8-PermisosLOTO |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useReconciliationStatus.ts` | B16-Offline |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useReducedMotion.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useRepeatingRisks.ts` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useReputationalAlerts.ts` | B14-IA |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useResilientAi.ts` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useRetaliationProtection.ts` | B5-Cumplimiento |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useReturnToWork.ts` | B7-Salud |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useRiskEngine.ts` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useRoiScenario.ts` | B15-Billing |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useRoleViews.ts` | B17-Admin |  | 🏚️ | /sprint-k/role-views/build — RBAC role views |
| `src/hooks/useRouteScoring.ts` | B11-Contratistas |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useRouting.ts` | B11-Contratistas |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useSeismicMonitor.ts` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useSif.ts` | B2-RiesgoIPER |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useSlmAcquisition.ts` | B14-IA |  |  | SLM model acquisition (offline AI runtime) |
| `src/hooks/useStreamedGuardian.ts` | B14-IA |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useSubmit.ts` | CROSS | ✅ | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useSuppliers.ts` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useSurvivalPing.ts` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useSyncState.ts` | B16-Offline |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useToast.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useTwinAccess.ts` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useUpsell.ts` | B15-Billing |  | 🏚️ | (ya firme en DEEP-NH-ui) |
| `src/hooks/useVulnerability.ts` | B7-Salud |  | 🏚️ | /sprint-k/.../vulnerability/latest — vulnerable-worker (salud/RRTW) |
| `src/hooks/useWakeLock.ts` | CROSS | ✅ |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useWaste.ts` | B18-Analitica |  | 🏚️ | /sprint-k/.../waste/inventory — waste/sustainability metrics |
| `src/hooks/useWebXRSupport.ts` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useWisdomCapsules.ts` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/hooks/useWorkerHistory.ts` | B7-Salud |  | 🏚️ | /sprint-k/worker-history/redact-pii,build-portable — portable health/work record |
| `src/hooks/useWorkerReadiness.ts` | B7-Salud |  |  | /sprint-k/worker-readiness/* — fitness-for-duty |
| `src/hooks/useZettelkastenIntelligence.ts` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/AcademicProcessor.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Accessibility.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/AfichesSeguridad.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/AIHub.tsx` | B14-IA |  |  | AIRoutes group; AI hub |
| `src/pages/AnnualReview.tsx` | B7-Salud |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Attendance.tsx` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Audits.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/AutoCADViewer.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/B2dAdminPanel.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/BioAnalysis.tsx` | B3-Ergonomia |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/BlueprintViewer.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/CalculatorHub.tsx` | B?-DigitalTwin/AR |  |  | AIRoutes; 12 Bernoulli/Euler engineering calculators |
| `src/pages/Calendar.tsx` | B13-MOC |  |  | OperationsRoutes; orchestrator-driven ops calendar |
| `src/pages/ClimateRoutes.tsx` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/ConsistencyAudit.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/ControlsAndMaterials.tsx` | B10-EPP |  |  | RiskRoutes; controls + materials inventory |
| `src/pages/CphsDraftMinute.tsx` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/CphsModule.tsx` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/CQRSArchitecture.tsx` | B18-Analitica |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/CustodyChain.tsx` | B9-Inspecciones |  |  | App.tsx; chain-of-custody (cadena de custodia) |
| `src/pages/DEAZones.tsx` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/DevPosterSeeder.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Diagnostico.tsx` | B2-RiesgoIPER |  |  | RiskRoutes; useRiskEngine + AI risk diagnostic |
| `src/pages/DigitalTwinAR.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/DigitalTwinFaena.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/DocumentOCRManager.tsx` | B5-Cumplimiento |  |  | OperationsRoutes; document OCR/management |
| `src/pages/DocumentReadConfirm.tsx` | B8-PermisosLOTO |  |  | ComplianceRoutes; document read-receipt (toma de conocimiento) |
| `src/pages/Documents.tsx` | B5-Cumplimiento |  |  | OperationsRoutes; document repository/compliance |
| `src/pages/DocumentViewer.tsx` | B5-Cumplimiento |  |  | OperationsRoutes; document viewer |
| `src/pages/Driving.tsx` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/DrivingSafety.tsx` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/ERPIntegration.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Glossary.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/GoogleDriveIntegrationManager.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Help.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/History.tsx` | B18-Analitica |  |  | App.tsx; activity/incident/audit history reporting |
| `src/pages/HumanBodyViewer.tsx` | B3-Ergonomia |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/ImmutableRender.tsx` | B5-Cumplimiento |  |  | App.tsx; immutable jsPDF+SHA-256 render (legal evidence) |
| `src/pages/ImportData.tsx` | B18-Analitica |  |  | App.tsx; Excel import wizard (ETL/data) |
| `src/pages/Inbox.tsx` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/InhospitableGuide.tsx` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/InviteAccept.tsx` | B17-Admin |  |  | App.tsx; invite-accept (auth/onboarding) |
| `src/pages/IoTEdgeFiltering.tsx` | B18-Analitica |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/KnowledgeBase.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/KnowledgeIngestion.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/LandingPage.tsx` | CROSS | ✅ |  | App.tsx; public marketing landing — no domain |
| `src/pages/LeadershipDecisions.tsx` | B12-CPHS |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/LightPollutionAudit.tsx` | B9-Inspecciones |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Matrix.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/MinsalProtocols.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/ModuleHub.tsx` | B14-IA |  |  | AIRoutes; gemini-driven module hub |
| `src/pages/MuralDinamico.tsx` | B6-Capacitacion |  |  | RiskRoutes; dynamic comms board (mural/posts + moderation) |
| `src/pages/MyData.tsx` | B7-Salud |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/NormativeDetail.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Normatives.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Notifications.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/OcSugerida.tsx` | B10-EPP |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/PdcaModule.tsx` | B4-Incidentes |  |  | App.tsx; PDCA module (mejora continua/no-conformidad) |
| `src/pages/Pizarra.tsx` | B6-Capacitacion |  |  | AIRoutes; pizarra/whiteboard collab |
| `src/pages/PoolGame.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/PredictiveGuard.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/PrivacyPolicy.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Profile.tsx` | B17-Admin |  |  | App.tsx; user profile/account |
| `src/pages/ProjectClosure.tsx` | B13-MOC |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Projects.tsx` | B13-MOC |  |  | OperationsRoutes; project/ops management |
| `src/pages/ProjectsCompare.tsx` | B18-Analitica |  |  | App.tsx; cross-project comparison analytics |
| `src/pages/Psychosocial.tsx` | B7-Salud |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/PTSGenerator.tsx` | B8-PermisosLOTO |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/PublicDemo.tsx` | CROSS | ✅ |  | App.tsx; public demo landing — no tenant domain |
| `src/pages/PublicNodeView.tsx` | B6-Capacitacion |  |  | App.tsx; public knowledge-node view (Zettelkasten share) |
| `src/pages/RefereeAccept.tsx` | B6-Capacitacion |  |  | App.tsx; referee magic-link (apprenticeship co-sign) |
| `src/pages/Reglamentos.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/RepeatingRisks.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/RiskNetwork.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Risks.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/SafeDriving.tsx` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/SafeDrivingMode.tsx` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/SafetyCoach.tsx` | B14-IA |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/SafetyFeed.tsx` | B6-Capacitacion |  |  | App.tsx; BBS-style safety feed + AI risk tagging |
| `src/pages/SecurityShield.tsx` | B17-Admin |  |  | RiskRoutes; MFA TOTP (auth/security) |
| `src/pages/Settings.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/SiteMap.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/SloErrorBudget.tsx` | B18-Analitica |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Splash.tsx` | CROSS | ✅ |  | App.tsx; splash screen — app shell |
| `src/pages/SSOConfig.tsx` | B17-Admin |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/SunTracker.tsx` | B7-Salud |  |  | HealthRoutes; UV exposure tracker (Ley 20.096) |
| `src/pages/SupplierQuality.tsx` | B11-Contratistas |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/Terms.tsx` | B5-Cumplimiento |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/VolcanicEruptionMap.tsx` | B1-Emergencia |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/WebXR.tsx` | B?-DigitalTwin/AR |  |  | (ya firme en DEEP-NH-ui) |
| `src/pages/WorkerReadiness.tsx` | B7-Salud |  |  | App.tsx; worker readiness/fitness-for-duty |
| `src/pages/Workers.tsx` | B17-Admin |  |  | OperationsRoutes; worker roster (HR/RBAC) |
| `src/pages/Zettelkasten.tsx` | B6-Capacitacion |  |  | (ya firme en DEEP-NH-ui) |
| `src/routes/AIRoutes.tsx` | B14-IA |  |  | route-group scaffold for AI pages |
| `src/routes/OperationsRoutes.tsx` | CROSS | ✅ |  | route-group scaffold mixing projects/workers/docs/driving/twin — no single block |
| `src/routes/RiskRoutes.tsx` | B2-RiesgoIPER |  |  | (ya firme en DEEP-NH-ui) |

## 3. Notas de criterio (decisiones no triviales)

- **Mapeo grupo-de-ruteo → bloque** (pages): `AIRoutes`→B14, `RiskRoutes`→B2, `ComplianceRoutes`→B5, `HealthRoutes`→B7, `TrainingRoutes`→B6, `EmergencyRoutes`→B1. `OperationsRoutes` **mezcla** projects/workers/docs/driving/twin → el archivo de ruteo en sí es **CROSS**, pero cada page se atribuye por su dominio real (`Workers`→B17, `Documents`→B5, `Calendar`/`Projects`→B13, etc.).
- **Hooks `/api/sprint-k/<dominio>`**: el sub-path es decisivo — `epp-flow`→B10, `pdca`→B4, `controls/efficacy`→B2, `adoption/multi-project/waste`→B18, `worker-history/worker-readiness/vulnerability`→B7, `role-views/role-summary`→B17, `protocols/iper|prexor|tmert`→B3.
- **CROSS asignados nuevos**: `identity/TaxIdInput` (primitiva RUT reusable), `maps/mapConfig` (10 importers), `useFirestoreCollection` (31 importers, hook de datos genérico), `useProjectFirestoreCollection` (scaffold Plan B.2 genérico), `LandingPage`/`PublicDemo`/`Splash` (shell público sin dominio de negocio), `AIRoutes`/`OperationsRoutes` solo cuando el grupo es heterogéneo (AIRoutes quedó B14 por ser homogéneo; OperationsRoutes CROSS).
- **`B?-DigitalTwin/AR`** se mantiene como bloque-candidato (heredado de `DEEP-NH-ui.md`; ver §5.5 del INDEX "¿crear bloque B-DigitalTwin?"). `CalculatorHub`, `StructuralCalculator`, `useObjectLifecycle`, `useProjectArAnchors` se agrupan ahí por consistencia (cluster engineering/twin/AR).
- **Huérfano ≠ bloque**: el flag 🏚️ se conserva tal cual de `DEEP-NH-ui.md`; la reclasificación solo cierra el **bloque**, no cambia el estado de cableado. Los 86 huérfanos siguen siendo decisión wire-vs-delete del doc de su bloque (INDEX §5.6).

## 4. ❓ Sigue sin clasificar

**0 archivos.** Los 355 archivos UI quedan atribuidos a un bloque B1–B18 / `B?-DigitalTwin/AR` o a `CROSS`. El barrido UI es 100% atribuido y aplicable programáticamente vía `ui-reclass-map.json`.

## 5. Artefacto aplicable

- `docs/audits/file-ledger/ui-reclass-map.json` — objeto `{ "ruta/archivo": "B7-Salud" | "CROSS" | ... }` con las 355 entradas, listo para hacer `block` en el ledger (las entradas `CROSS` y `B?-DigitalTwin/AR` requieren primero la decisión taxonómica del INDEX §5).

*Doc-only. No se tocó `ledger.json` ni código.*
