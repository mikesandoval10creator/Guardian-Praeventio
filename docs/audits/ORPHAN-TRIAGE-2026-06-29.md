# Triaje de huérfanas — connectivity + render ratchet (2026-06-29)

Fuente: `scripts/connectivity-ratchet-baseline.json` (37) ∪
`scripts/render-ratchet-baseline.json` (56). Objetivo: cablear lo real,
**no eliminar**. Principio CLAUDE.md: huérfanos→montar; duplicados→consolidar
preservando capacidad; decisiones ya tomadas→documentar supersesión, no
re-cablear; falsos positivos→omitir.

## Hallazgo crítico (2026-06-29)

El bucket "MONTAR" del triaje automático **no es confiable**: clasifica por
nombre de dominio sin comparar modelos de datos. Verificación manual de los 2
candidatos "más claros":

- `shiftHandover/ShiftHandoverPanel` + `ShiftHandoverHistoryList` →
  `pages/ShiftHandover.tsx` **ya implementa todo inline** (iniciar/log/notas/
  ack/historial) con `shiftHandoverService` + `shiftHandoverStore`. Los
  componentes son una implementación **alternativa/superada**. Montarlos =
  UI duplicada. → **SUPERSEDED**, no montar.
- `knowledgeBase/KnowledgeBaseSearch` → `pages/KnowledgeBase.tsx` **ya
  implementa búsqueda+filtros+tarjetas+modales inline** con modelo
  server-backed (`useKnowledgeBase` → `KnowledgeEntry`). El huérfano usa otro
  servicio client-side (`searchArticles` → `KnowledgeArticle`) y pide una
  `library` que la página no tiene. → **SUPERSEDED**, no montar.

**Conclusión:** una fracción significativa de las ~40 "MONTAR" son duplicados
superados (componente construido primero, página re-implementada inline después,
normalmente con mejor modelo de datos). Cada huérfana exige verificación
individual: *¿la página de su dominio ya hace la función inline?* Antes de
montar cualquiera hay que responder eso.

## Buckets

### FALSO POSITIVO — sin acción (≈9)
Primitivas / wrappers / ya usados que el heurístico mal-marca:
`shared/Badge`, `shared/Input`, `shared/ProjectScopedPage`,
`shared/AsesorChatRouter`, `shared/ResilientAsesorLauncher`,
`hooks/useStreamedGuardian`, `hooks/useSubmit`, `hygiene/FloraFaunaCatalog`
(ya renderizado en Hygiene), `twinScene/TwinSceneInstancedLazy` (lazy wrapper),
`dashboard/RoleAwareDashboard` (consumido en Dashboard).

### SUPERSEDED — documentar, no montar (crece con la verificación)
- `dashboard/QuickActions` → reemplazado por `DashboardQuickActions` (montado).
- `dashboard/AdviceBanner` → reemplazado por `RotatingAdviceBanner` (montado).
- `shiftHandover/ShiftHandoverPanel` + `ShiftHandoverHistoryList` → inline en `ShiftHandover.tsx`.
- `knowledgeBase/KnowledgeBaseSearch` → inline en `KnowledgeBase.tsx`.
- (verificar el resto del bucket "MONTAR" contra su página antes de actuar)

### DIFERIR — 3D pesado / experimental (2)
`digital-twin/GaussianSplatViewer`, `twinPhysics/TwinPhysicsScene`.

### Verificado 2026-06-29 (progreso del barrido)
MONTADAS (commits):
- `incidentFlow/{InvestigationPanel,LessonPublishForm,PDCAClosePanel}` → IncidentFlowHub
  (sección "Gestión PDCA" colapsable; InvestigationPanel mejorado: `onConcluded`
  expone la conclusión → encadena la lección). render-ratchet 56→53.
- `drillsManager/DrillsCompliancePanel` → DrillsManager (cumplimiento DS 132 por
  tipo; "Agendar" preselecciona el tipo). render-ratchet 53→52.
- `exposure/HeatStressCard` → PreShiftRisk (protocolo WBGT trabajo/descanso sobre
  clima real de UniversalKnowledgeContext + selector de intensidad).
  connectivity 37→36, render 52→51.
- `coach/DomainPromptCatalog` → AIHub (sección "Transparencia del Coach IA":
  5 system prompts + ejemplos + normativas; catálogo estático).
  connectivity 36→35, render 51→50.

REQUIERE PIPELINE de datos antes de montar (no hay fuente — montar con datos
falsos violaría "no fabricar datos"):
- `measurements/MeasurementQualityCard` (score de calidad de mediciones
  ocupacionales) → NINGUNA página/hook produce `ChainValidationResult[]`. El
  servicio `measurementChain` existe pero nunca se conectó a ingesta real.
  Construir el flujo ingesta→validación primero (feature, no cableado).

SUPERSEDED confirmados (verificación inline, NO montar):
- `pricingCalculator/{ROICalculatorWidget,TierComparatorWidget}` → PricingCalculator
  ya implementa ROI + comparación de tiers + comparador de escenarios (server) + EPP
  + OC PDF inline, con `services/pricing/*` + `services/financialAnalytics/roiCalculator`.
  Los widgets usan el servicio paralelo más simple `services/pricingCalculator/*` →
  superados. (Servicio paralelo candidato a consolidación futura.)

REQUIERE PLOMERÍA antes de montar (genuinos, pero su página no tiene los datos):
- `exposure/HeatStressCard` (WBGT trabajo/descanso) → necesita clima crudo
  (tempC/humidity) + selector de intensidad. PreShiftRisk solo tiene factores
  abstractos; el clima crudo vive en el hook de clima del Dashboard. Montar con
  fuente de clima + intensity.

### MONTAR (candidato — REQUIERE verificación inline-vs-componente individual)
adoption/ChurnRiskPanel, agenda/AgendaDigestCard, cargo/CargoCogPanel,
clientReporting/MonthlyClientReportPanel, climateAware/ClimatePlanAdjustment,
coach/DomainPromptCatalog, continuity/SpofPanel, costCalculator/PreventionROIWidget,
culturePulse/CulturePulseDashboard, digital-twin/RePositionConfirmDialog,
drillsManager/DrillsCompliancePanel, excelImport/ExcelImportPreview,
explainability/ExplainedRecommendationCard, exposure/HeatStressCard,
governance/DeviationRadarPanel, health/OccupationalContextBundleCard,
horometro/MaintenanceCompleteForm, hvac/AirQualityPanel, identity/TaxIdInput,
incidentFlow/{InvestigationPanel,LessonPublishForm,PDCAClosePanel},
leadership/LeadershipTrailCard, measurements/MeasurementQualityCard,
medical/MedicalIconAttribution, microtraining/LightningTrainingPlayer,
monthlyClientReport/MonthlyClientReportCard,
pricingCalculator/{ROICalculatorWidget,TierComparatorWidget},
pymeOnboarding/PymeMaturityWizard, pymeWizard/PymeOnboardingPlanPanel,
reportsAutomation/ReportTemplatePreview, roleOnboarding/OnboardingTrackProgressPanel,
safety/SafetyCapsules, slm/SlmAcquisitionPromptHost,
spacedRepetition/SpacedRepetitionReviewQueue, suseso/SusesoDeadlineBadge,
sync/ConflictResolutionDrawer, twinScene/TwinIntegrationPanel,
workPermits/PermitChecklistRenderer.

## Procedimiento por huérfana (antes de montar)
1. ¿Existe página de su dominio? Si no → montar = crear página (scope mayor).
2. Si existe → ¿implementa la función inline? Si sí → SUPERSEDED (no montar).
3. Si la página NO la implementa y el componente es autocontenido con props
   derivables de los datos/hook que la página ya tiene → **MONTAR** (import +
   `<Tag>` + props), typecheck, regenerar baselines (`--write`) cuando vuelva bash.
4. Cada montaje: un commit acotado, verificado.

## Nota técnica
Con el VM de bash caído no se regeneran baselines, pero montar baja el conteo
real por debajo del baseline → el gate pasa igual. Regenerar al volver bash para
fijar el progreso.
