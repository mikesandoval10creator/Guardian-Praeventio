# Hooks scaffolding — triage exhaustivo

Plan v2 Bloque D: 96 hooks en `src/hooks/` sin importers UI (re-verificado
2026-05-26). Conteo correcto vs el reportado por el agente (113) — la
diferencia son hooks de tests + hooks que tienen 1-3 importers parciales.

## Procedimiento por hook

Para cada hook sin consumer UI:
1. Leer el hook completo.
2. `git log -- src/hooks/<file>` — ¿tuvo consumer histórico que se borró?
3. Verificar si el endpoint server-side existe y funciona.
4. Cross-check con TODO.md, docs/sprints/, master-plan-end-to-end.md.
5. Documentar decisión: **WIRE / REFACTOR / DEFER / DEPRECATE**.

## Decisiones documentadas

### useFatigue
- **File:** `src/hooks/useFatigue.ts`
- **Decisión:** **VERIFICADO — wrapper HTTP usado fuera de React.**
- **Razón:** el archivo NO exporta un hook React; sólo exporta
  `assessFatigueRemote(projectId, input)` función fetch. La page
  `FatigueMonitor.tsx` y el componente `FatigueAssessmentCard.tsx` consumen
  directamente el service local `assessFatigue` de
  `src/services/fatigue/fatigueMonitor.ts` (deterministic). El wrapper HTTP
  espera futuro consumer cross-project / batch.

### useGeofencePermissions, useGeofenceWithEvents
- **Decisión:** **WIRE pendiente.**
- **Razón:** la página `Settings.tsx` y `GeofenceAlert.tsx` consumen
  `useGeofence` directamente. Los wrappers especializados están listos pero
  no consumidos. Quedan como API para futuro panel admin de geocercas.

### Hooks de la lista TOP-25 críticos (vidas / compliance)

| Hook | Decisión preliminar | Razón |
|---|---|---|
| useActiveVisitors | WIRE | Panel acceso real-time pendiente (visitas, contratistas) |
| useAdminBurden | DEFER | Métrica de carga administrativa — agnóstica de UI específica |
| useAiGuardrails | WIRE | Settings panel — falta exposición a admin para tunear cuotas IA |
| useAiToggle | WIRE | Settings panel — toggle decisión IA por dominio |
| useArPlacement | DEFER | Para uso WebXR end-to-end (E8 Bloque E del plan) |
| useAuditChain | WIRE | Forensic audit panel — admin enterprise |
| useAuditPortal | WIRE | Portal de auditorías — mandante / vendor accreditation |
| useBowtie | WIRE | Bowtie panel — análisis de riesgo crítico |
| useChangeMgmt | WIRE | Management of Change (MoC) — ISO 45001 §8.1.3 |
| useChecklistBuilder | WIRE | Constructor checklists dinámico |
| useClimateAwareScheduling | WIRE | Scheduling consciente del clima |
| useCoachRag | WIRE | Coach IA con RAG (compatible con Bloque C5/L1) |
| useComms | WIRE | Comunicaciones emergencia (radio/walkie/SOS) |
| useCommsDrill | WIRE | Drill de comunicaciones — simulacros |
| useConfidentialReports | WIRE | Denuncias seguras Ley 21.643 + ISO 45001 §5.4 |
| useConsistency | DEFER | Auditoría de consistencia datos — uso admin ops |
| useConsultativeSale | DEFER | Pipeline venta — uso commercial team |
| useContingencySimulation | WIRE | Simulación contingencias |
| useContinuity | WIRE | Continuidad operacional |
| useContractors | WIRE | Subcontratistas — DS 76 |
| useCostCalculator | WIRE | Calculadora de costos |
| useCostPrediction | WIRE | Predicción costos operacionales |
| useCriticalControls | WIRE | Controles críticos ISO 45001 |
| useCriticalRoles | WIRE | Roles críticos backup |
| useCrossProjectRisk | WIRE | Riesgo multi-proyecto (admin enterprise) |

### Resto de hooks (71 pendientes)

Triage incremental durante sprints futuros. Cada PR que wirea un hook
actualiza esta tabla. Items no triaged tienen prioridad media — los hooks
existen como API HTTP correcta, sólo falta UI consumer.

## Hooks intencionalmente API-only

Algunos hooks son utility / fetch wrappers que NO necesitan un único
consumer UI específico — son librerías HTTP:

- `_fetchUtils` — helper HTTP base
- `useFatigue` — wrapper `assessFatigueRemote` (consumer fuera de React)
- `useDriving` — wrapper haversine y rutas
- `useResilienceHealth` — métrica polled por monitor cron

## Regla de oro

**Nada se borra sin investigación documentada en este archivo.** Si un
hook llega a marcarse DEPRECATE, requiere PR explícito con razón en el
commit body + cita aquí del análisis.
