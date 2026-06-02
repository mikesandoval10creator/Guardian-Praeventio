# DEEP — needs-human: UI (components/pages/hooks sin bloque) · 2026-06-02

**Archivos revisados:** 355 (FEAT-components 168 · FEAT-pages 93 · FEAT-hooks 91 · FEAT-routes 3), agrupados en ~85 subsistemas/carpetas.
**Método:** `block===""` && `category ∈ {FEAT-components,FEAT-pages,FEAT-hooks,FEAT-routes}` del `ledger.json`. Detección de importadores con `rg -l` (specifier estricto `["'/]basename["']` + recheck por word-boundary `\bbasename\b` excluyendo el propio archivo, `*.test.*`, `*.spec.*`, `__tests__/`). Pages cruzadas contra `src/routes/*` y `src/App.tsx` (lazy + `<Route element>`).

> Nota de precisión: la columna "Bloque sugerido" es heurística (carpeta + nombre + `purpose` del ledger). ~100 quedaron `❓unclear` por heurística pero la mayoría son atribuibles a la vista de su carpeta (workers→B17, processes→Operations/B-procesos, engineering→B3 estructural, etc.). El foco fiable de esta auditoría son **huérfanos / cross-cutting / ruteo**, no la asignación fina de bloque.

## 1. Resumen: distribución por bloque sugerido + huérfanos

| Bloque sugerido | Archivos | Huérfanos |
|---|---|---|
| B1-Emergencia | 10 | 0 |
| B10-EPP | 3 | 2 |
| B11-Contratistas | 16 | 7 |
| B12-CPHS | 11 | 1 |
| B13-MOC | 4 | 2 |
| B14-IA | 15 | 2 |
| B15-Billing | 6 | 6 |
| B16-Offline | 6 | 2 |
| B17-Admin | 14 | 2 |
| B18-Analitica | 7 | 0 |
| B2-RiesgoIPER | 18 | 5 |
| B3-Ergonomia | 7 | 3 |
| B4-Incidentes | 3 | 2 |
| B5-Cumplimiento | 18 | 5 |
| B6-Capacitacion | 18 | 2 |
| B7-Salud | 9 | 3 |
| B8-PermisosLOTO | 8 | 4 |
| B9-Inspecciones | 15 | 7 |
| B?-DigitalTwin/AR | 27 | 6 |
| cross-cutting | 40 | 2 |
| ❓unclear | 100 | 23 |

**Total huérfanos confirmados: 86** (48 components + 38 hooks + 0 pages) — 79 directos (0 referencias) + 7 transitivos (sólo importados por otros huérfanos). Cross-cutting legítimo sin bloque: 38. Pages no ruteadas: **0** (las 93 están montadas en `src/routes/*` o `src/App.tsx`).

## 2. Huérfanos confirmados (0 importer no-test)

Patrón dominante: componentes "Wire UI #N" / "wire huérfanos" creados completos pero nunca montados en ninguna page, y hooks-cliente (`use*` con N mutators) sin consumidor. Son código real (mayoría ≥120 LOC, no stubs), simplemente desconectados → estado 🏚️ (muerto/no-cableado, no roto).

- `src/components/adoption/ChurnRiskPanel.tsx` (117 LOC, directo)
- `src/components/annualReview/AnnualReviewSummary.tsx` (146 LOC, directo)
- `src/components/annualReview/PreventiveObjectivesPanel.tsx` (129 LOC, directo)
- `src/components/audit/AuditExpressButton.tsx` (98 LOC, directo)
- `src/components/cargo/CargoCogPanel.tsx` (227 LOC, directo)
- `src/components/climateAware/ClimatePlanAdjustment.tsx` (141 LOC, directo)
- `src/components/cost/CostScenarioCard.tsx` (194 LOC, directo)
- `src/components/cost/CostSimulator.tsx` (928 LOC, transitivo)
- `src/components/costCalculator/PreventionROIWidget.tsx` (105 LOC, directo)
- `src/components/digital-twin/GaussianSplatViewer.tsx` (322 LOC, directo)
- `src/components/digital-twin/RePositionConfirmDialog.tsx` (194 LOC, directo)
- `src/components/documents/LegalDocGeneratorForm.tsx` (161 LOC, directo)
- `src/components/drivingSafety/DriverScoreCard.tsx` (99 LOC, directo)
- `src/components/eppFlow/PendingPurchaseOrdersPanel.tsx` (178 LOC, directo)
- `src/components/eppFlow/PurchaseOrderSignModal.tsx` (292 LOC, transitivo)
- `src/components/escalation/SlaWatchPanel.tsx` (268 LOC, directo)
- `src/components/euler/BucklingCalculatorCard.tsx` (214 LOC, directo)
- `src/components/evidenceChain/CustodyChainTimelineCard.tsx` (149 LOC, directo)
- `src/components/excelImport/ExcelImportPreview.tsx` (131 LOC, directo)
- `src/components/expirations/ExpirationsListPanel.tsx` (146 LOC, directo)
- `src/components/exposure/HeatStressCard.tsx` (111 LOC, directo)
- `src/components/external-events/CalmRecommendationCard.tsx` (106 LOC, directo)
- `src/components/fiveS/FiveSAuditForm.tsx` (159 LOC, directo)
- `src/components/glossary/GlossarySearchPanel.tsx` (337 LOC, directo)
- `src/components/governance/DeviationRadarPanel.tsx` (134 LOC, directo)
- `src/components/hvac/AirQualityPanel.tsx` (134 LOC, directo)
- `src/components/identity/TaxIdInput.tsx` (100 LOC, directo)
- `src/components/industry/IndustrySelectorWizard.tsx` (620 LOC, directo)
- `src/components/knowledgeBase/KnowledgeBaseSearch.tsx` (149 LOC, directo)
- `src/components/lineOfFire/LineOfFireValidationCard.tsx` (118 LOC, directo)
- `src/components/measurements/MeasurementQualityCard.tsx` (109 LOC, directo)
- `src/components/operationalState/FaenaStateBanner.tsx` (106 LOC, directo)
- `src/components/pdca/PdcaSummaryCard.tsx` (89 LOC, directo)
- `src/components/pinSign/PinSignModal.tsx` (238 LOC, directo)
- `src/components/privacy/PrivacyRegimeCard.tsx` (135 LOC, directo)
- `src/components/projectClosure/ProjectClosureCard.tsx` (162 LOC, directo)
- `src/components/protocols/IperMatrixCard.tsx` (149 LOC, directo)
- `src/components/roleViews/RoleViewCards.tsx` (111 LOC, directo)
- `src/components/safety/SafetyCapsules.tsx` (148 LOC, directo)
- `src/components/shared/ProjectScopedPage.tsx` (136 LOC, directo)
- `src/components/sif/SIFAlert.tsx` (141 LOC, directo)
- `src/components/suppliers/SupplierComparator.tsx` (135 LOC, directo)
- `src/components/twinPhysics/TwinPhysicsScene.tsx` (104 LOC, directo)
- `src/components/twinScene/TwinIntegrationPanel.tsx` (153 LOC, directo)
- `src/components/twinScene/TwinSceneInstanced.tsx` (430 LOC, transitivo)
- `src/components/twinScene/TwinSceneInstancedLazy.tsx` (30 LOC, directo)
- `src/components/workerReadiness/WorkerReadinessCard.tsx` (120 LOC, directo)
- `src/components/zones/ZoneEntryGate.tsx` (255 LOC, transitivo)
- `src/hooks/useAdminBurden.ts` (75 LOC, directo)
- `src/hooks/useAdoption.ts` (130 LOC, directo)
- `src/hooks/useArPlacement.ts` (187 LOC, transitivo)
- `src/hooks/useBbs.ts` (89 LOC, directo)
- `src/hooks/useClimateAwareScheduling.ts` (82 LOC, directo)
- `src/hooks/useConsistency.ts` (79 LOC, directo)
- `src/hooks/useControlComparator.ts` (166 LOC, directo)
- `src/hooks/useCostCalculator.ts` (69 LOC, transitivo)
- `src/hooks/useDeduplication.ts` (79 LOC, directo)
- `src/hooks/useDocumentVersioning.ts` (180 LOC, directo)
- `src/hooks/useDriving.ts` (89 LOC, directo)
- `src/hooks/useEfficacyVerification.ts` (79 LOC, directo)
- `src/hooks/useEscalation.ts` (157 LOC, directo)
- `src/hooks/useEventReplay.ts` (104 LOC, directo)
- `src/hooks/useExpirations.ts` (102 LOC, directo)
- `src/hooks/useExpressBundle.ts` (78 LOC, directo)
- `src/hooks/useFiveS.ts` (92 LOC, directo)
- `src/hooks/useJsa.ts` (100 LOC, directo)
- `src/hooks/useLoto.ts` (92 LOC, directo)
- `src/hooks/useMultiProject.ts` (96 LOC, directo)
- `src/hooks/useMultiRoleSummary.ts` (98 LOC, directo)
- `src/hooks/usePrivacyShield.ts` (97 LOC, directo)
- `src/hooks/useProjectFirestoreCollection.ts` (157 LOC, transitivo)
- `src/hooks/useProtocols.ts` (86 LOC, directo)
- `src/hooks/useReputationalAlerts.ts` (76 LOC, directo)
- `src/hooks/useRetaliationProtection.ts` (76 LOC, directo)
- `src/hooks/useReturnToWork.ts` (98 LOC, directo)
- `src/hooks/useRoiScenario.ts` (53 LOC, directo)
- `src/hooks/useRoleViews.ts` (59 LOC, directo)
- `src/hooks/useRouteScoring.ts` (80 LOC, directo)
- `src/hooks/useRouting.ts` (77 LOC, directo)
- `src/hooks/useSif.ts` (108 LOC, directo)
- `src/hooks/useStreamedGuardian.ts` (176 LOC, directo)
- `src/hooks/useSubmit.ts` (26 LOC, directo)
- `src/hooks/useUpsell.ts` (44 LOC, directo)
- `src/hooks/useVulnerability.ts` (84 LOC, directo)
- `src/hooks/useWaste.ts` (90 LOC, directo)
- `src/hooks/useWorkerHistory.ts` (99 LOC, directo)

### Cadenas transitivas notables (huérfano → sólo importado por huérfano)
- **Cost calculator completo muerto:** `useCostCalculator` → `usePreventionCost` → `CostScenarioCard`/`CostSimulator` (928 LOC) — toda la UI de simulación de costos está desconectada.
- **EPP purchase-order flow:** `PurchaseOrderSignModal` ← `PendingPurchaseOrdersPanel` (ambos huérfanos).
- **Twin instanced scene:** `TwinSceneInstanced` ← `TwinSceneInstancedLazy`/`TwinIntegrationPanel` (todos huérfanos).
- **AR placement:** `useArPlacement` ← `RePositionConfirmDialog` (huérfano).
- **Zonas restringidas:** `ZoneEntryGate` ← `RestrictedZonesMapOverlay` (sin importador no-test).
- **Project-scoped scaffold:** `useProjectFirestoreCollection` ← `ProjectScopedPage` (huérfano; era el patrón "Plan 2026-05-23 Fase B.2" de migración project-scoped, no adoptado).

## 3. Cross-cutting / layout (legítimamente sin bloque)

Infraestructura compartida transversal — NO son huérfanos ni asignables a un bloque. Estado ✅.

- `src/components/LocalePicker.tsx` (1 importers)
- `src/components/layout/PendingInvitesBanner.tsx` (1 importers)
- `src/components/layout/ProjectSelector.tsx` (1 importers)
- `src/components/layout/RootLayout.tsx` (1 importers)
- `src/components/layout/Sidebar.tsx` (1 importers)
- `src/components/layout/sidebarMenuGroups.ts` (1 importers)
- `src/components/shared/Card.tsx` (59 importers)
- `src/components/shared/ConfirmDialog.tsx` (9 importers)
- `src/components/shared/ConsciousnessLoader.tsx` (1 importers)
- `src/components/shared/DataLoadErrorBanner.tsx` (5 importers)
- `src/components/shared/DeepLinkHandler.tsx` (2 importers)
- `src/components/shared/EmptyState.tsx` (6 importers)
- `src/components/shared/ErrorBoundary.tsx` (2 importers)
- `src/components/shared/ErrorFallback.tsx` (1 importers)
- `src/components/shared/GuardianMascot.tsx` (1 importers)
- `src/components/shared/GuestSaveModal.tsx` (1 importers)
- `src/components/shared/KnowledgeGraph.tsx` (2 importers)
- `src/components/shared/Modal.tsx` (2 importers)
- `src/components/shared/ModeSwitcher.tsx` (1 importers)
- `src/components/shared/PWAUpdateToast.tsx` (1 importers)
- `src/components/shared/PremiumFeatureGuard.tsx` (16 importers)
- `src/components/shared/Skeleton.tsx` (2 importers)
- `src/components/shared/SyncCenterModal.tsx` (1 importers)
- `src/components/shared/SyncConflictBanner.tsx` (1 importers)
- `src/components/shared/ToastContainer.tsx` (31 importers)
- `src/components/shared/Tooltip.tsx` (13 importers)
- `src/components/shared/WisdomCapsule.tsx` (3 importers)
- `src/components/shared/WisdomCapsuleWatcher.tsx` (1 importers)
- `src/components/shared/syncConflictRoutes.ts` (1 importers)
- `src/components/shared/withGlossary.tsx` (1 importers)
- `src/hooks/_fetchUtils.ts` (28 importers)
- `src/hooks/useAutoLogout.ts` (1 importers)
- `src/hooks/useGeoCountry.ts` (1 importers)
- `src/hooks/useOnlineStatus.ts` (94 importers)
- `src/hooks/usePushNotifications.ts` (3 importers)
- `src/hooks/useReducedMotion.ts` (1 importers)
- `src/hooks/useToast.ts` (32 importers)
- `src/hooks/useWakeLock.ts` (3 importers)

Destacados: `useOnlineStatus` (94 importers), `Card` (59), `useToast`/`ToastContainer` (32/31), `_fetchUtils` (28), `PremiumFeatureGuard` (16, gating UX), `Tooltip` (13). Layout: `RootLayout`, `Sidebar`, `sidebarMenuGroups`, `ProjectSelector`, `PendingInvitesBanner`, `LocalePicker` — cada uno con 1 importer (montados en el shell de la app).

## 4. Tabla por archivo

| src/components/BunkerManager.tsx | B1-Emergencia | ✅ | sí (1) | 197 |  |
| src/components/FastCheckModal.tsx | ❓unclear | ✅ | sí (1) | 229 |  |
| src/components/GeolocationTracker.tsx | ❓unclear | 🟡 | sí (1) | 11 |  |
| src/components/LocalePicker.tsx | cross-cutting (infra) | ✅ | sí (1) | 61 | infra compartida |
| src/components/QRScannerModal.tsx | ❓unclear | ✅ | sí (2) | 103 |  |
| src/components/SunTrackerContainer.tsx | ❓unclear | ✅ | sí (1) | 250 |  |
| src/components/SurvivalPing.tsx | B1-Emergencia | 🟡 | sí (1) | 7 |  |
| src/components/WeatherBulletin.tsx | ❓unclear | ✅ | sí (2) | 462 |  |
| src/components/WeatherSafetyRecommendations.tsx | ❓unclear | ✅ | sí (1) | 265 |  |
| src/components/adoption/ChurnRiskPanel.tsx | B2-RiesgoIPER | 🏚️ | NO | 117 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/ai/AiResponseCard.tsx | B14-IA | ✅ | sí (1) | 385 |  |
| src/components/ai/EthicsGuardian.tsx | B14-IA | ✅ | sí (1) | 158 |  |
| src/components/ai/GuardianVoiceAssistant.tsx | B14-IA | ✅ | sí (1) | 525 |  |
| src/components/ai/PredictiveAnalysis.tsx | B14-IA | ✅ | sí (1) | 334 |  |
| src/components/ai/ResilientAiAssistantPanel.tsx | B14-IA | ✅ | sí (1) | 262 |  |
| src/components/ai/SafetyForecast.tsx | B14-IA | ✅ | sí (1) | 198 |  |
| src/components/ai/VisionAnalyzer.tsx | B14-IA | ✅ | sí (1) | 501 |  |
| src/components/annualReview/AnnualReviewSummary.tsx | B7-Salud | 🏚️ | NO | 146 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/annualReview/PreventiveObjectivesPanel.tsx | B7-Salud | 🏚️ | NO | 129 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/ar/ARMachineryScene.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 374 |  |
| src/components/ar/ARPosterScanner.tsx | B6-Capacitacion | ✅ | sí (1) | 728 |  |
| src/components/ar/ARWarehouseScene.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 394 |  |
| src/components/ar/ArQuickLookButton.tsx | B?-DigitalTwin/AR | ✅ | sí (2) | 150 |  |
| src/components/ar/ArViewLink.tsx | B?-DigitalTwin/AR | ✅ | sí (3) | 151 |  |
| src/components/audit/AuditExpressButton.tsx | B9-Inspecciones | 🏚️ | NO | 98 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/audits/AddAuditModal.tsx | B9-Inspecciones | ✅ | sí (2) | 239 |  |
| src/components/audits/AuditDetailModal.tsx | B9-Inspecciones | ✅ | sí (2) | 367 |  |
| src/components/audits/ISOAudit.tsx | B9-Inspecciones | ✅ | sí (2) | 497 |  |
| src/components/audits/ISOManagement.tsx | B9-Inspecciones | ✅ | sí (1) | 656 |  |
| src/components/audits/ISOManagementFilters.tsx | B9-Inspecciones | ✅ | sí (1) | 133 |  |
| src/components/audits/ISOManagementHeader.tsx | B9-Inspecciones | ✅ | sí (1) | 131 |  |
| src/components/bio/CompensatoryExercisesModal.tsx | B3-Ergonomia | ✅ | sí (1) | 166 |  |
| src/components/blueprints/BlueprintViewer.tsx | B?-DigitalTwin/AR | ✅ | sí (2) | 344 |  |
| src/components/calendar/AddEventModal.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 300 |  |
| src/components/calendar/EventDetailsModal.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 385 |  |
| src/components/cargo/CargoCogPanel.tsx | B3-Ergonomia | 🏚️ | NO | 227 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/climateAware/ClimatePlanAdjustment.tsx | B11-Contratistas | 🏚️ | NO | 141 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/consistency/ConsistencyAuditCard.tsx | B5-Cumplimiento | ✅ | sí (1) | 149 |  |
| src/components/cost/CostScenarioCard.tsx | B15-Billing | 🏚️ | NO | 194 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/cost/CostSimulator.tsx | B15-Billing | 🏚️ | NO | 928 | huérfano transitivo (importer es huérfano) |
| src/components/costCalculator/PreventionROIWidget.tsx | B15-Billing | 🏚️ | NO | 105 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/dataQuality/DataQualityCard.tsx | B5-Cumplimiento | ✅ | sí (1) | 93 |  |
| src/components/digital-twin/ARObjectOverlay.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 321 |  |
| src/components/digital-twin/GaussianSplatViewer.tsx | B?-DigitalTwin/AR | 🏚️ | NO | 322 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/digital-twin/NormativaWarningsBanner.tsx | B5-Cumplimiento | ✅ | sí (1) | 101 |  |
| src/components/digital-twin/PlaceObjectMenu.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 96 |  |
| src/components/digital-twin/PlacedObjectsLayer.tsx | B4-Incidentes | ✅ | sí (3) | 215 |  |
| src/components/digital-twin/RePositionConfirmDialog.tsx | B?-DigitalTwin/AR | 🏚️ | NO | 194 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/digital-twin/ReconstructionArLink.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 111 |  |
| src/components/digital-twin/RiskNodeMarkers.tsx | B2-RiesgoIPER | ✅ | sí (1) | 191 |  |
| src/components/digital-twin/Site25DPanel.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 414 |  |
| src/components/digital-twin/TwinAccessGuard.tsx | B?-DigitalTwin/AR | ✅ | sí (2) | 173 |  |
| src/components/documents/AddDocumentModal.tsx | ❓unclear | ✅ | sí (1) | 321 |  |
| src/components/documents/EditDocumentModal.tsx | ❓unclear | ✅ | sí (1) | 242 |  |
| src/components/documents/LegalDocGeneratorForm.tsx | B5-Cumplimiento | 🏚️ | NO | 161 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/driving/DrivingSuggestion.tsx | B11-Contratistas | ✅ | sí (1) | 125 |  |
| src/components/drivingSafety/DriverScoreCard.tsx | B11-Contratistas | 🏚️ | NO | 99 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/engineering/ConfinedSpacePanel.tsx | ❓unclear | ✅ | sí (1) | 160 |  |
| src/components/engineering/HidranteFireNetworkPanel.tsx | ❓unclear | ✅ | sí (1) | 121 |  |
| src/components/engineering/SlopeStabilityPanel.tsx | B18-Analitica | ✅ | sí (1) | 143 |  |
| src/components/engineering/StructuralCalculator.tsx | ❓unclear | ✅ | sí (1) | 605 |  |
| src/components/eppFlow/PendingPurchaseOrdersPanel.tsx | B10-EPP | 🏚️ | NO | 178 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/eppFlow/PurchaseOrderSignModal.tsx | B10-EPP | 🏚️ | NO | 292 | huérfano transitivo (importer es huérfano) |
| src/components/escalation/SlaWatchPanel.tsx | B4-Incidentes | 🏚️ | NO | 268 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/etl/CsvImportExportModal.tsx | B18-Analitica | ✅ | sí (3) | 416 |  |
| src/components/euler/BucklingCalculatorCard.tsx | B3-Ergonomia | 🏚️ | NO | 214 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/evidenceChain/CustodyChainTimelineCard.tsx | ❓unclear | 🏚️ | NO | 149 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/excelImport/ExcelImportPreview.tsx | ❓unclear | 🏚️ | NO | 131 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/expirations/ExpirationsListPanel.tsx | B9-Inspecciones | 🏚️ | NO | 146 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/exposure/HeatStressCard.tsx | B3-Ergonomia | 🏚️ | NO | 111 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/external-events/CalmRecommendationCard.tsx | ❓unclear | 🏚️ | NO | 106 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/external-events/ExternalEventsPanel.tsx | ❓unclear | ✅ | sí (1) | 240 |  |
| src/components/fiveS/FiveSAuditForm.tsx | B9-Inspecciones | 🏚️ | NO | 159 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/games/gameScore.ts | B6-Capacitacion | ✅ | sí (2) | 91 |  |
| src/components/glossary/GlossarySearchPanel.tsx | B6-Capacitacion | 🏚️ | NO | 337 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/governance/DeviationRadarPanel.tsx | B13-MOC | 🏚️ | NO | 134 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/hvac/AirQualityPanel.tsx | B9-Inspecciones | 🏚️ | NO | 134 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/identity/TaxIdInput.tsx | ❓unclear | 🏚️ | NO | 100 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/inbox/InboxPrevencionistaPanel.tsx | B12-CPHS | ✅ | sí (1) | 161 |  |
| src/components/industry/IndustryNormsSummary.tsx | ❓unclear | ✅ | sí (1) | 149 |  |
| src/components/industry/IndustrySelectorWizard.tsx | ❓unclear | 🏚️ | NO | 620 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/knowledge/SmartConnectionsPanel.tsx | B6-Capacitacion | ✅ | sí (2) | 202 |  |
| src/components/knowledgeBase/KnowledgeBaseSearch.tsx | B6-Capacitacion | 🏚️ | NO | 149 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/layout/PendingInvitesBanner.tsx | cross-cutting (infra) | ✅ | sí (1) | 86 | infra compartida |
| src/components/layout/ProjectSelector.tsx | cross-cutting (infra) | ✅ | sí (1) | 102 | infra compartida |
| src/components/layout/RootLayout.tsx | cross-cutting (infra) | ✅ | sí (1) | 471 | infra compartida |
| src/components/layout/Sidebar.tsx | cross-cutting (infra) | ✅ | sí (1) | 315 | infra compartida |
| src/components/layout/sidebarMenuGroups.ts | cross-cutting (infra) | ✅ | sí (1) | 341 | infra compartida |
| src/components/leadership/LeadershipTrailCard.tsx | B12-CPHS | ✅ | NO | 113 | ref débil; importer reachable |
| src/components/legal/CookieConsent.tsx | B5-Cumplimiento | ✅ | sí (1) | 156 |  |
| src/components/lineOfFire/LineOfFireValidationCard.tsx | B2-RiesgoIPER | 🏚️ | NO | 118 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/maps/mapConfig.ts | ❓unclear | ✅ | sí (10) | 51 |  |
| src/components/measurements/MeasurementQualityCard.tsx | B9-Inspecciones | 🏚️ | NO | 109 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/normativa/NormativaSwitch.tsx | B5-Cumplimiento | ✅ | sí (4) | 231 |  |
| src/components/operationalState/FaenaStateBanner.tsx | ❓unclear | 🏚️ | NO | 106 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/pdca/PdcaSummaryCard.tsx | ❓unclear | 🏚️ | NO | 89 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/pinSign/PinSignModal.tsx | B8-PermisosLOTO | 🏚️ | NO | 238 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/predictive/AlertSchedulerMount.tsx | B14-IA | ✅ | sí (1) | 183 |  |
| src/components/privacy/PrivacyRegimeCard.tsx | B5-Cumplimiento | 🏚️ | NO | 135 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/processes/CloseProcessModal.tsx | ❓unclear | ✅ | sí (2) | 184 |  |
| src/components/processes/CreateCrewModal.tsx | ❓unclear | ✅ | sí (1) | 169 |  |
| src/components/processes/ProcessDetailModal.tsx | ❓unclear | ✅ | sí (1) | 310 |  |
| src/components/processes/StartProcessModal.tsx | ❓unclear | ✅ | sí (1) | 252 |  |
| src/components/projectClosure/ProjectClosureCard.tsx | B13-MOC | 🏚️ | NO | 162 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/projects/GanttProjectView.tsx | ❓unclear | ✅ | sí (2) | 440 |  |
| src/components/projects/MaquinariaManager.tsx | ❓unclear | ✅ | sí (2) | 281 |  |
| src/components/projects/PredictedActivityModal.tsx | B18-Analitica | ✅ | sí (1) | 292 |  |
| src/components/projects/ProjectDocuments.tsx | ❓unclear | ✅ | sí (1) | 289 |  |
| src/components/protocols/IperMatrixCard.tsx | B2-RiesgoIPER | 🏚️ | NO | 149 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/psychosocial/AIPsychosocialAnalysisModal.tsx | B7-Salud | ✅ | sí (1) | 142 |  |
| src/components/psychosocial/AddPsychosocialModal.tsx | B7-Salud | ✅ | sí (1) | 407 |  |
| src/components/readReceipts/DocumentReadConfirmCard.tsx | B8-PermisosLOTO | ✅ | sí (1) | 175 |  |
| src/components/risk-network/RiskNetworkExplorer.tsx | B2-RiesgoIPER | ✅ | sí (2) | 255 |  |
| src/components/risk-network/RiskNetworkManager.tsx | B2-RiesgoIPER | ✅ | sí (2) | 512 |  |
| src/components/risks/IPERCAnalysis.tsx | B2-RiesgoIPER | ✅ | sí (2) | 521 |  |
| src/components/risks/IPERCMatrix.tsx | B2-RiesgoIPER | ✅ | sí (1) | 148 |  |
| src/components/risks/PresentationMode.tsx | B2-RiesgoIPER | ✅ | sí (1) | 130 |  |
| src/components/roleViews/RoleViewCards.tsx | ❓unclear | 🏚️ | NO | 111 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/safety/SafetyCapsules.tsx | ❓unclear | 🏚️ | NO | 148 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/security/KekRotationPanel.tsx | ❓unclear | ✅ | sí (1) | 388 |  |
| src/components/settings/WebAuthnKeysSection.tsx | B17-Admin | ✅ | sí (1) | 320 |  |
| src/components/shared/Card.tsx | cross-cutting (infra) | ✅ | sí (59) | 164 | infra compartida |
| src/components/shared/ConfirmDialog.tsx | cross-cutting (infra) | ✅ | sí (9) | 74 | infra compartida |
| src/components/shared/ConsciousnessLoader.tsx | cross-cutting (infra) | ✅ | sí (1) | 37 | infra compartida |
| src/components/shared/DataLoadErrorBanner.tsx | cross-cutting (infra) | ✅ | sí (5) | 89 | infra compartida |
| src/components/shared/DeepLinkHandler.tsx | cross-cutting (infra) | ✅ | sí (2) | 60 | infra compartida |
| src/components/shared/EmptyState.tsx | cross-cutting (infra) | ✅ | sí (6) | 59 | infra compartida |
| src/components/shared/ErrorBoundary.tsx | cross-cutting (infra) | ✅ | sí (2) | 135 | infra compartida |
| src/components/shared/ErrorFallback.tsx | cross-cutting (infra) | ✅ | sí (1) | 93 | infra compartida |
| src/components/shared/GuardianMascot.tsx | cross-cutting (infra) | ✅ | sí (1) | 65 | infra compartida |
| src/components/shared/GuestSaveModal.tsx | cross-cutting (infra) | ✅ | sí (1) | 141 | infra compartida |
| src/components/shared/KnowledgeGraph.tsx | cross-cutting (infra) | ✅ | sí (2) | 1189 | infra compartida |
| src/components/shared/Modal.tsx | cross-cutting (infra) | ✅ | sí (2) | 62 | infra compartida |
| src/components/shared/ModeSwitcher.tsx | cross-cutting (infra) | ✅ | sí (1) | 127 | infra compartida |
| src/components/shared/PWAUpdateToast.tsx | cross-cutting (infra) | ✅ | sí (1) | 52 | infra compartida |
| src/components/shared/PremiumFeatureGuard.tsx | cross-cutting (infra) | ✅ | sí (16) | 60 | infra compartida |
| src/components/shared/ProjectScopedPage.tsx | cross-cutting (infra) | 🏚️ | solo-test | 136 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/shared/Skeleton.tsx | cross-cutting (infra) | ✅ | sí (2) | 49 | infra compartida |
| src/components/shared/SyncCenterModal.tsx | cross-cutting (infra) | ✅ | sí (1) | 345 | infra compartida |
| src/components/shared/SyncConflictBanner.tsx | cross-cutting (infra) | ✅ | sí (1) | 180 | infra compartida |
| src/components/shared/ToastContainer.tsx | cross-cutting (infra) | ✅ | sí (31) | 68 | infra compartida |
| src/components/shared/Tooltip.tsx | cross-cutting (infra) | ✅ | sí (13) | 72 | infra compartida |
| src/components/shared/WisdomCapsule.tsx | cross-cutting (infra) | ✅ | sí (3) | 120 | infra compartida |
| src/components/shared/WisdomCapsuleWatcher.tsx | cross-cutting (infra) | 🟡 | sí (1) | 20 | infra compartida |
| src/components/shared/syncConflictRoutes.ts | cross-cutting (infra) | ✅ | sí (1) | 61 | infra compartida |
| src/components/shared/withGlossary.tsx | cross-cutting (infra) | ✅ | sí (1) | 129 | infra compartida |
| src/components/sif/SIFAlert.tsx | B2-RiesgoIPER | 🏚️ | NO | 141 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/suppliers/SupplierComparator.tsx | B11-Contratistas | 🏚️ | NO | 135 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/sync/ConflictResolutionDrawer.tsx | B16-Offline | ✅ | solo-test | 394 | ref débil; importer reachable |
| src/components/twinPhysics/TwinPhysicsScene.tsx | B?-DigitalTwin/AR | 🏚️ | solo-test | 104 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/twinScene/TwinIntegrationPanel.tsx | B17-Admin | 🏚️ | solo-test | 153 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/twinScene/TwinSceneInstanced.tsx | B?-DigitalTwin/AR | 🏚️ | solo-test | 430 | huérfano transitivo (importer es huérfano) |
| src/components/twinScene/TwinSceneInstancedLazy.tsx | B?-DigitalTwin/AR | 🏚️ | solo-test | 30 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/workerReadiness/WorkerReadinessCard.tsx | ❓unclear | 🏚️ | NO | 120 | huérfano 0-importer (Wire-UI sin montar) |
| src/components/workers/AIEPPScannerModal.tsx | ❓unclear | ✅ | sí (1) | 269 |  |
| src/components/workers/AccessControlModal.tsx | ❓unclear | ✅ | sí (1) | 152 |  |
| src/components/workers/AddWorkerModal.tsx | ❓unclear | ✅ | sí (1) | 316 |  |
| src/components/workers/DocsModal.tsx | ❓unclear | ✅ | sí (1) | 311 |  |
| src/components/workers/EPPModal.tsx | ❓unclear | ✅ | sí (1) | 223 |  |
| src/components/workers/EditWorkerModal.tsx | ❓unclear | ✅ | sí (1) | 231 |  |
| src/components/workers/LaborManagementModal.tsx | ❓unclear | ✅ | sí (1) | 309 |  |
| src/components/workers/MassImportModal.tsx | ❓unclear | ✅ | sí (1) | 215 |  |
| src/components/workers/PersonalizedSafetyPlan.tsx | ❓unclear | ✅ | sí (1) | 228 |  |
| src/components/workers/QRCodeModal.tsx | ❓unclear | ✅ | sí (1) | 99 |  |
| src/components/workers/TraceabilityModal.tsx | ❓unclear | ✅ | sí (1) | 182 |  |
| src/components/workers/UserProfileModal.tsx | B17-Admin | ✅ | sí (1) | 469 |  |
| src/components/zettelkasten/NlQueryPanel.tsx | B6-Capacitacion | ✅ | sí (1) | 158 |  |
| src/components/zones/ZoneEntryGate.tsx | B8-PermisosLOTO | 🏚️ | solo-test | 255 | huérfano transitivo (importer es huérfano) |
| src/hooks/_fetchUtils.ts | cross-cutting (infra) | ✅ | sí (28) | 76 | infra compartida |
| src/hooks/useAccelerometer.ts | ❓unclear | ✅ | sí (2) | 124 |  |
| src/hooks/useAcousticSOS.ts | B1-Emergencia | ✅ | sí (2) | 54 |  |
| src/hooks/useAdminBurden.ts | B17-Admin | 🏚️ | NO | 75 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useAdoption.ts | ❓unclear | 🏚️ | NO | 130 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useAmbientNoise.ts | ❓unclear | ✅ | sí (3) | 77 |  |
| src/hooks/useAnnualReview.ts | B7-Salud | ✅ | sí (1) | 162 |  |
| src/hooks/useArPlacement.ts | B?-DigitalTwin/AR | 🏚️ | solo-test | 187 | huérfano transitivo (importer es huérfano) |
| src/hooks/useAutoCalendarEvents.ts | ❓unclear | ✅ | sí (1) | 80 |  |
| src/hooks/useAutoLogout.ts | cross-cutting (infra) | ✅ | sí (1) | 61 | infra compartida |
| src/hooks/useAutonomousAlerts.ts | B14-IA | ✅ | sí (1) | 103 |  |
| src/hooks/useBbs.ts | B12-CPHS | 🏚️ | NO | 89 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useBluetoothMesh.ts | B1-Emergencia | ✅ | sí (2) | 137 |  |
| src/hooks/useCalendarPredictions.ts | B18-Analitica | ✅ | sí (1) | 161 |  |
| src/hooks/useClimateAwareScheduling.ts | B11-Contratistas | 🏚️ | NO | 82 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useConsistency.ts | B5-Cumplimiento | 🏚️ | NO | 79 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useControlComparator.ts | ❓unclear | 🏚️ | NO | 166 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useCostCalculator.ts | B15-Billing | 🏚️ | NO | 69 | huérfano transitivo (importer es huérfano) |
| src/hooks/useCphsMinute.ts | B12-CPHS | 🟡 | sí (1) | 18 |  |
| src/hooks/useDataQuality.ts | B5-Cumplimiento | ✅ | sí (1) | 88 |  |
| src/hooks/useDeadReckoning.ts | B1-Emergencia | ✅ | sí (1) | 82 |  |
| src/hooks/useDeduplication.ts | B16-Offline | 🏚️ | NO | 79 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useDocumentVersioning.ts | ❓unclear | 🏚️ | NO | 180 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useDriving.ts | B11-Contratistas | 🏚️ | NO | 89 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useDrivingSafety.ts | B11-Contratistas | ✅ | sí (1) | 225 |  |
| src/hooks/useEfficacyVerification.ts | ❓unclear | 🏚️ | NO | 79 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useEppFlow.ts | ❓unclear | ✅ | sí (3) | 195 |  |
| src/hooks/useEscalation.ts | B4-Incidentes | 🏚️ | NO | 157 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useEventReplay.ts | B16-Offline | 🏚️ | NO | 104 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useExpirations.ts | B9-Inspecciones | 🏚️ | NO | 102 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useExpressBundle.ts | ❓unclear | 🏚️ | NO | 78 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useFirestoreCollection.ts | ❓unclear | ✅ | sí (31) | 90 |  |
| src/hooks/useFiveS.ts | B9-Inspecciones | 🏚️ | NO | 92 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useFrequencyAnalysis.ts | B3-Ergonomia | ✅ | NO | 83 | ref débil; importer reachable |
| src/hooks/useGeoAnchor.ts | B?-DigitalTwin/AR | ✅ | sí (1) | 93 |  |
| src/hooks/useGeoAnchoredNodes.ts | B?-DigitalTwin/AR | ✅ | sí (1) | 175 |  |
| src/hooks/useGeoCountry.ts | cross-cutting (infra) | ✅ | sí (1) | 109 | infra compartida |
| src/hooks/useGeolocationTracking.ts | ❓unclear | ✅ | sí (1) | 192 |  |
| src/hooks/useInbox.ts | B12-CPHS | ✅ | sí (1) | 88 |  |
| src/hooks/useIndustryIntegration.ts | B17-Admin | ✅ | sí (4) | 182 |  |
| src/hooks/useInsights.ts | B14-IA | ✅ | NO | 185 | ref débil; importer reachable |
| src/hooks/useJsa.ts | B8-PermisosLOTO | 🏚️ | NO | 100 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useKnowledgeBase.ts | B6-Capacitacion | ✅ | sí (1) | 142 |  |
| src/hooks/useLeadership.ts | B12-CPHS | ✅ | sí (1) | 99 |  |
| src/hooks/useLoto.ts | B8-PermisosLOTO | 🏚️ | NO | 92 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useMultiProject.ts | ❓unclear | 🏚️ | NO | 96 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useMultiRoleSummary.ts | ❓unclear | 🏚️ | NO | 98 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useObjectLifecycle.ts | ❓unclear | ✅ | sí (2) | 159 |  |
| src/hooks/useOnlineStatus.ts | cross-cutting (infra) | 🟡 | sí (94) | 21 | infra compartida |
| src/hooks/usePdca.ts | ❓unclear | ✅ | sí (1) | 198 |  |
| src/hooks/usePendingActions.ts | B16-Offline | ✅ | sí (3) | 34 |  |
| src/hooks/usePinSign.ts | B8-PermisosLOTO | ✅ | sí (1) | 129 |  |
| src/hooks/usePrivacyShield.ts | B5-Cumplimiento | 🏚️ | NO | 97 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useProjectArAnchors.ts | ❓unclear | ✅ | sí (2) | 92 |  |
| src/hooks/useProjectCapacity.ts | B6-Capacitacion | ✅ | NO | 84 | ref débil; importer reachable |
| src/hooks/useProjectClosure.ts | B13-MOC | ✅ | sí (1) | 168 |  |
| src/hooks/useProjectFirestoreCollection.ts | ❓unclear | 🏚️ | solo-test | 157 | huérfano transitivo (importer es huérfano) |
| src/hooks/useProtocols.ts | ❓unclear | 🏚️ | NO | 86 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/usePushNotifications.ts | cross-cutting (infra) | ✅ | sí (3) | 275 | infra compartida |
| src/hooks/useReadReceipts.ts | B8-PermisosLOTO | ✅ | NO | 155 | ref débil; importer reachable |
| src/hooks/useReconciliationStatus.ts | B16-Offline | ✅ | solo-test | 106 | ref débil; importer reachable |
| src/hooks/useReducedMotion.ts | cross-cutting (infra) | 🟡 | sí (1) | 14 | infra compartida |
| src/hooks/useRepeatingRisks.ts | B2-RiesgoIPER | 🟡 | sí (1) | 19 |  |
| src/hooks/useReputationalAlerts.ts | B14-IA | 🏚️ | NO | 76 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useResilientAi.ts | B14-IA | ✅ | sí (1) | 223 |  |
| src/hooks/useRetaliationProtection.ts | B5-Cumplimiento | 🏚️ | NO | 76 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useReturnToWork.ts | B7-Salud | 🏚️ | NO | 98 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useRiskEngine.ts | B2-RiesgoIPER | ✅ | sí (72) | 359 |  |
| src/hooks/useRoiScenario.ts | B15-Billing | 🏚️ | NO | 53 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useRoleViews.ts | ❓unclear | 🏚️ | NO | 59 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useRouteScoring.ts | B11-Contratistas | 🏚️ | NO | 80 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useRouting.ts | B11-Contratistas | 🏚️ | NO | 77 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useSeismicMonitor.ts | B1-Emergencia | ✅ | sí (5) | 74 |  |
| src/hooks/useSif.ts | B2-RiesgoIPER | 🏚️ | NO | 108 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useSlmAcquisition.ts | ❓unclear | ✅ | sí (3) | 451 |  |
| src/hooks/useStreamedGuardian.ts | B14-IA | 🏚️ | solo-test | 176 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useSubmit.ts | cross-cutting (infra) | 🏚️ | NO | 26 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useSuppliers.ts | B11-Contratistas | ✅ | sí (1) | 198 |  |
| src/hooks/useSurvivalPing.ts | B1-Emergencia | ✅ | sí (1) | 63 |  |
| src/hooks/useSyncState.ts | B16-Offline | ✅ | sí (1) | 30 |  |
| src/hooks/useToast.ts | cross-cutting (infra) | ✅ | sí (32) | 33 | infra compartida |
| src/hooks/useTwinAccess.ts | B?-DigitalTwin/AR | ✅ | sí (1) | 184 |  |
| src/hooks/useUpsell.ts | B15-Billing | 🏚️ | NO | 44 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useVulnerability.ts | ❓unclear | 🏚️ | NO | 84 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useWakeLock.ts | cross-cutting (infra) | ✅ | sí (3) | 68 | infra compartida |
| src/hooks/useWaste.ts | ❓unclear | 🏚️ | NO | 90 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useWebXRSupport.ts | B?-DigitalTwin/AR | ✅ | sí (2) | 126 |  |
| src/hooks/useWisdomCapsules.ts | B6-Capacitacion | ✅ | sí (2) | 66 |  |
| src/hooks/useWorkerHistory.ts | ❓unclear | 🏚️ | NO | 99 | huérfano 0-importer (Wire-UI sin montar) |
| src/hooks/useWorkerReadiness.ts | ❓unclear | ✅ | sí (1) | 29 |  |
| src/hooks/useZettelkastenIntelligence.ts | B6-Capacitacion | ✅ | sí (2) | 373 |  |
| src/pages/AIHub.tsx | ❓unclear | ✅ | sí (1) | 287 |  |
| src/pages/AcademicProcessor.tsx | B6-Capacitacion | ✅ | sí (1) | 134 |  |
| src/pages/Accessibility.tsx | B17-Admin | ✅ | sí (2) | 240 |  |
| src/pages/AfichesSeguridad.tsx | B6-Capacitacion | ✅ | sí (1) | 471 |  |
| src/pages/AnnualReview.tsx | B7-Salud | ✅ | sí (1) | 870 |  |
| src/pages/Attendance.tsx | B12-CPHS | ✅ | sí (1) | 758 |  |
| src/pages/Audits.tsx | B9-Inspecciones | ✅ | sí (2) | 266 |  |
| src/pages/AutoCADViewer.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 373 |  |
| src/pages/B2dAdminPanel.tsx | B17-Admin | ✅ | sí (1) | 474 |  |
| src/pages/BioAnalysis.tsx | B3-Ergonomia | ✅ | sí (1) | 907 |  |
| src/pages/BlueprintViewer.tsx | B?-DigitalTwin/AR | ✅ | sí (2) | 230 |  |
| src/pages/CQRSArchitecture.tsx | B18-Analitica | ✅ | sí (1) | 367 |  |
| src/pages/CalculatorHub.tsx | ❓unclear | ✅ | sí (1) | 720 |  |
| src/pages/Calendar.tsx | ❓unclear | ✅ | sí (2) | 619 |  |
| src/pages/ClimateRoutes.tsx | B11-Contratistas | ✅ | sí (1) | 402 |  |
| src/pages/ConsistencyAudit.tsx | B5-Cumplimiento | ✅ | sí (1) | 247 |  |
| src/pages/ControlsAndMaterials.tsx | ❓unclear | ✅ | sí (1) | 190 |  |
| src/pages/CphsDraftMinute.tsx | B12-CPHS | ✅ | sí (1) | 357 |  |
| src/pages/CphsModule.tsx | B12-CPHS | ✅ | sí (1) | 827 |  |
| src/pages/CustodyChain.tsx | ❓unclear | ✅ | sí (1) | 352 |  |
| src/pages/DEAZones.tsx | B1-Emergencia | ✅ | sí (1) | 642 |  |
| src/pages/DevPosterSeeder.tsx | B6-Capacitacion | ✅ | sí (1) | 475 |  |
| src/pages/Diagnostico.tsx | ❓unclear | ✅ | sí (1) | 368 |  |
| src/pages/DigitalTwinAR.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 246 |  |
| src/pages/DigitalTwinFaena.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 1122 |  |
| src/pages/DocumentOCRManager.tsx | ❓unclear | ✅ | sí (1) | 327 |  |
| src/pages/DocumentReadConfirm.tsx | ❓unclear | ✅ | sí (1) | 371 |  |
| src/pages/DocumentViewer.tsx | ❓unclear | ✅ | sí (1) | 173 |  |
| src/pages/Documents.tsx | ❓unclear | ✅ | sí (2) | 363 |  |
| src/pages/Driving.tsx | B11-Contratistas | ✅ | sí (1) | 385 |  |
| src/pages/DrivingSafety.tsx | B11-Contratistas | ✅ | sí (1) | 1419 |  |
| src/pages/ERPIntegration.tsx | B17-Admin | ✅ | sí (1) | 230 |  |
| src/pages/Glossary.tsx | B6-Capacitacion | ✅ | sí (1) | 194 |  |
| src/pages/GoogleDriveIntegrationManager.tsx | B17-Admin | ✅ | sí (1) | 222 |  |
| src/pages/Help.tsx | B17-Admin | ✅ | sí (1) | 109 |  |
| src/pages/History.tsx | ❓unclear | ✅ | sí (2) | 239 |  |
| src/pages/HumanBodyViewer.tsx | B3-Ergonomia | ✅ | sí (3) | 113 |  |
| src/pages/ImmutableRender.tsx | ❓unclear | ✅ | sí (1) | 584 |  |
| src/pages/ImportData.tsx | ❓unclear | ✅ | sí (1) | 488 |  |
| src/pages/Inbox.tsx | B12-CPHS | ✅ | sí (1) | 272 |  |
| src/pages/InhospitableGuide.tsx | B1-Emergencia | ✅ | sí (1) | 189 |  |
| src/pages/InviteAccept.tsx | ❓unclear | ✅ | sí (1) | 226 |  |
| src/pages/IoTEdgeFiltering.tsx | B18-Analitica | ✅ | sí (1) | 489 |  |
| src/pages/KnowledgeBase.tsx | B6-Capacitacion | ✅ | sí (1) | 841 |  |
| src/pages/KnowledgeIngestion.tsx | B6-Capacitacion | ✅ | sí (1) | 217 |  |
| src/pages/LandingPage.tsx | ❓unclear | ✅ | sí (1) | 543 |  |
| src/pages/LeadershipDecisions.tsx | B12-CPHS | ✅ | sí (1) | 767 |  |
| src/pages/LightPollutionAudit.tsx | B9-Inspecciones | ✅ | sí (1) | 242 |  |
| src/pages/Matrix.tsx | B2-RiesgoIPER | ✅ | sí (1) | 826 |  |
| src/pages/MinsalProtocols.tsx | B5-Cumplimiento | ✅ | sí (1) | 213 |  |
| src/pages/ModuleHub.tsx | ❓unclear | ✅ | sí (1) | 617 |  |
| src/pages/MuralDinamico.tsx | ❓unclear | ✅ | sí (1) | 305 |  |
| src/pages/MyData.tsx | B7-Salud | ✅ | sí (1) | 504 |  |
| src/pages/NormativeDetail.tsx | B5-Cumplimiento | ✅ | sí (1) | 277 |  |
| src/pages/Normatives.tsx | B5-Cumplimiento | ✅ | sí (1) | 405 |  |
| src/pages/Notifications.tsx | B17-Admin | ✅ | sí (2) | 135 |  |
| src/pages/OcSugerida.tsx | B10-EPP | ✅ | sí (1) | 304 |  |
| src/pages/PTSGenerator.tsx | B8-PermisosLOTO | ✅ | sí (1) | 994 |  |
| src/pages/PdcaModule.tsx | ❓unclear | ✅ | sí (1) | 819 |  |
| src/pages/Pizarra.tsx | ❓unclear | ✅ | sí (3) | 277 |  |
| src/pages/PoolGame.tsx | B6-Capacitacion | ✅ | sí (1) | 251 |  |
| src/pages/PredictiveGuard.tsx | B14-IA | ✅ | sí (1) | 532 |  |
| src/pages/PrivacyPolicy.tsx | B5-Cumplimiento | ✅ | sí (1) | 165 |  |
| src/pages/Profile.tsx | ❓unclear | ✅ | sí (3) | 235 |  |
| src/pages/ProjectClosure.tsx | B13-MOC | ✅ | sí (1) | 646 |  |
| src/pages/Projects.tsx | ❓unclear | ✅ | sí (2) | 768 |  |
| src/pages/ProjectsCompare.tsx | ❓unclear | ✅ | sí (1) | 324 |  |
| src/pages/Psychosocial.tsx | B7-Salud | ✅ | sí (1) | 224 |  |
| src/pages/PublicDemo.tsx | ❓unclear | ✅ | sí (1) | 453 |  |
| src/pages/PublicNodeView.tsx | ❓unclear | ✅ | sí (1) | 252 |  |
| src/pages/RefereeAccept.tsx | ❓unclear | ✅ | sí (1) | 252 |  |
| src/pages/Reglamentos.tsx | B5-Cumplimiento | ✅ | sí (2) | 74 |  |
| src/pages/RepeatingRisks.tsx | B2-RiesgoIPER | ✅ | sí (1) | 150 |  |
| src/pages/RiskNetwork.tsx | B2-RiesgoIPER | ✅ | sí (1) | 414 |  |
| src/pages/Risks.tsx | B2-RiesgoIPER | ✅ | sí (2) | 136 |  |
| src/pages/SSOConfig.tsx | B17-Admin | ✅ | sí (1) | 528 |  |
| src/pages/SafeDriving.tsx | B11-Contratistas | ✅ | sí (1) | 415 |  |
| src/pages/SafeDrivingMode.tsx | B11-Contratistas | ✅ | sí (1) | 184 |  |
| src/pages/SafetyCoach.tsx | B14-IA | ✅ | sí (1) | 237 |  |
| src/pages/SafetyFeed.tsx | ❓unclear | ✅ | sí (1) | 673 |  |
| src/pages/SecurityShield.tsx | ❓unclear | ✅ | sí (1) | 589 |  |
| src/pages/Settings.tsx | B17-Admin | ✅ | sí (2) | 876 |  |
| src/pages/SiteMap.tsx | B17-Admin | ✅ | sí (1) | 741 |  |
| src/pages/SloErrorBudget.tsx | B18-Analitica | ✅ | sí (1) | 290 |  |
| src/pages/Splash.tsx | ❓unclear | ✅ | sí (1) | 37 |  |
| src/pages/SunTracker.tsx | ❓unclear | ✅ | sí (2) | 224 |  |
| src/pages/SupplierQuality.tsx | B11-Contratistas | ✅ | sí (1) | 527 |  |
| src/pages/Terms.tsx | B5-Cumplimiento | ✅ | sí (1) | 107 |  |
| src/pages/VolcanicEruptionMap.tsx | B1-Emergencia | ✅ | sí (1) | 450 |  |
| src/pages/WebXR.tsx | B?-DigitalTwin/AR | ✅ | sí (1) | 279 |  |
| src/pages/WorkerReadiness.tsx | ❓unclear | ✅ | sí (1) | 550 |  |
| src/pages/Workers.tsx | ❓unclear | ✅ | sí (3) | 540 |  |
| src/pages/Zettelkasten.tsx | B6-Capacitacion | ✅ | sí (10) | 34 |  |
| src/routes/AIRoutes.tsx | ❓unclear | ✅ | sí (1) | 29 |  |
| src/routes/OperationsRoutes.tsx | ❓unclear | ✅ | sí (1) | 62 |  |
| src/routes/RiskRoutes.tsx | B2-RiesgoIPER | ✅ | sí (1) | 36 | montado en src/App.tsx:40,272+ |

## 5. Para decisión del usuario

- ❓ **86 huérfanos** son código completo "Wire UI" / hooks-cliente nunca cableados. ¿Cablear (montar en su page destino) o eliminar? Recomendación: triage por bloque — varios apuntan a features con services ya tests-cubiertos (euler/buckling B3, sif B2, pdca, fiveS B9). El doc del bloque correspondiente debe decidir wire-vs-delete.
- ⚠️ **Cost calculator (928+194+69 LOC) y EPP purchase-order flow** son subsistemas completos muertos — alto valor si se cablean, alto ruido si se dejan.
- ⚠️ `ProjectScopedPage` + `useProjectFirestoreCollection` (Plan 2026-05-23 Fase B.2): scaffold de migración project-scoped abandonado. Confirmar si la migración sigue viva o se descarta.
- ❓ `TwinSceneInstancedLazy.tsx` (30 LOC) y `useSubmit.ts` (26 LOC) son los únicos candidatos a stub por tamaño; el resto son implementaciones reales.
- ✅ **0 pages sin rutear** — ruteo limpio. Las 3 `routes/*Routes.tsx` están importadas y montadas en `src/App.tsx:37-43,272+`.
- ⚠️ La heurística de bloque dejó ~100 `❓unclear`; si se requiere atribución 1:1 a B1-B18 hace falta una pasada manual por carpeta (la vista contenedora suele resolverlo).
