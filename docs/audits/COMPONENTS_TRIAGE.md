# Components — triage de huérfanos

Plan v2 Bloque J: componentes implementados en `src/components/` que no
tienen importer. Verificado 2026-05-26.

## Críticos (vidas / compliance)

### EmergencyBrigadePanel
- **File:** `src/components/emergencyBrigade/EmergencyBrigadePanel.tsx`
- **Decisión:** **DEFER (cubierto por page dedicada).**
- **Razón:** `src/pages/EmergencyBrigade.tsx` ya implementa su propia
  vista detallada de readiness de brigada (1085 LOC). El panel reusable
  vive para futuros widgets resumen (e.g. en Dashboard o Emergency
  overview). Mantener como API para próximo Dashboard widget.

### Ds67Modal
- **File:** `src/components/medicine/Ds67Modal.tsx`
- **Decisión:** **WIRE en Bloque I3.**
- **Razón:** Modal completo para notificar accidente del trabajo a la
  mutual. Pendiente abrir desde `src/pages/Medicine.tsx` o nuevo page
  DiatDiep. Compatible con WebAuthn assertion (B9).

### PymeMaturityWizard, PymeOnboardingPlanPanel
- **Files:** `src/components/pymeOnboarding/PymeMaturityWizard.tsx`,
  `src/components/pymeWizard/PymeOnboardingPlanPanel.tsx`
- **Decisión:** **WIRE en Bloque I2.**
- **Razón:** Endpoint backend `/api/onboarding/complete` listo. Wizard
  maturity calcula plan 30 días. Faltan páginas `Onboarding/Pyme.tsx` que
  inserten estos componentes en el wizard flow.

### HazmatCompatibilityPanel
- **File:** `src/components/hazmat/HazmatCompatibilityPanel.tsx`
- **Decisión:** **WIRE — integrar con HazmatStorageDesigner.**
- **Razón:** Panel audita compatibilidad química entre items almacenados.
  HazmatStorageDesigner ya tiene contexto de almacenamiento; falta input
  array de items para mostrar warnings/incompatibles. M 1d.

### TwinIntegrationPanel
- **File:** `src/components/twinScene/TwinIntegrationPanel.tsx`
- **Decisión:** **DEFER hasta Bloque C3-C4 completos.**
- **Razón:** Depende del triple-gate auth (ADR 0011) wirado globalmente
  + Twin pipeline depth-sensing real (MiDaS/Marigold TFLite).

## Operacionales (cumplimiento / governance)

### PreventiveObjectivesPanel
- **File:** `src/components/annualReview/PreventiveObjectivesPanel.tsx`
- **Decisión:** **WIRE.**
- **Razón:** Annual review de objetivos preventivos — debe estar en
  Dashboard o Compliance reports. M 1d.

### SpofPanel
- **File:** `src/components/continuity/SpofPanel.tsx`
- **Decisión:** **WIRE.**
- **Razón:** Single Point of Failure analysis — admin enterprise. Wire en
  nuevo page `BusinessContinuity.tsx`. M 1d.

### DeviationRadarPanel
- **File:** `src/components/governance/DeviationRadarPanel.tsx`
- **Decisión:** **WIRE.**
- **Razón:** Radar de desviaciones para governance. Wire en
  `B2dAdminPanel.tsx` o nuevo Governance page. M 1d.

### NonConformityListPanel
- **File:** `src/components/nonConformity/NonConformityListPanel.tsx`
- **Decisión:** **WIRE.**
- **Razón:** ISO 45001 §10.2 — lista no conformidades + corrective
  actions. Wire en Compliance dashboard. M 1d.

## Resto (15)

Triage incremental durante sprints futuros. Cada componente vive listo
para usar; lo que falta es la page contenedora con el state management
apropiado:

- Adoption/ChurnRisk
- ClientReporting/MonthlyReport
- DocumentHygiene
- DrillsCompliance
- Environmental/WasteInventory
- Escalation/SlaWatch
- Expirations
- FirstResponderDispatch
- Glossary/Search
- HVAC/AirQuality
- LOTO/Status
- Cargo/Cog
- SLM/Status
- SoftBlocking/RequirementGate
- RoleOnboarding/TrackProgress

## Regla de oro

Mismo principio que hooks: **ningún componente se borra sin
investigación documentada**. Si llega a marcarse DEPRECATE, PR
explícito con razón.
