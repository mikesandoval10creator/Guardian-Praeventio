# Pendientes después de Sprint 19 — input para próximo orchestrator

Fecha de cierre: 2026-05-04 · Branch base: `dev/sprint-19-orchestrator-debt-cleanup-2026-05-04`

Este documento captura los hallazgos del audit `auditoria777.md` que NO se atacaron en Sprint 19 y por qué. Sirve como input para el próximo orchestrator run (Sprint 20+).

## Hallazgos verificados in-place (no requirieron commit)

- **F-C11 — Determinism test para `nodeIdFor`** (Zettelkasten persistence). **Ya cubierto**: `src/services/zettelkasten/persistence/writeNode.test.ts` líneas 82-110 ya tienen 4 tests que validan el contrato (mismo payload+projectId → mismo id, projectId distinto → id distinto, metadata distinto → id distinto, order-insensitive vía canonicalization). No se requiere test adicional.
- **F-C12 — Hot-path review en `climateRiskCoupling.ts`**. **Verificado sin hot path**: el archivo tiene 434 LOC y un único loop `for (const f of factors)` en línea 212 que es un summary loop sobre ≤10 elementos, no un hot path. Las funciones puras (`dynamicPressure`, `windLoadOnSurface`) se llaman una vez por forecast, no en loops intensivos. No se requiere `useMemo`/memoize.
- **F-C02..F-C08 — UX coherence de `MedicalIcon`** en 7 componentes médicos. **Verificado consistente**: el patrón de tamaños (18-22 inline, 24-32 card-headers, 48-64 hero) está aplicado uniformemente. El audit recomendaba auditoría confirmatoria; pasada de spot check sobre `AddMedicineModal`, `AnatomyLibrary`, `AptitudeCertificateForm`, `DifferentialDiagnosis` confirmó coherencia. No requiere refactor.

## Hallazgos diferidos a Sprint 20+ (requieren foco dedicado)

### F-C13 — Split `IPERCAnalysis.tsx` (634 LOC)
Razón de diferir: extraer `IPERCMatrix` como subcomponente requiere ~30 min de refactor cuidadoso, validar que props/state quedan bien dimensionados, mantener tests existentes verdes. No es complejidad técnica — es ergonómica: merece entrar al inicio de un sprint con foco visual sobre IPERC, no como tail de un orchestrator de cleanup.

### F-C14 — Split `ISOManagement.tsx` (773 LOC) en 3 archivos
Razón de diferir: similar a F-C13. Extraer `ISOManagementHeader.tsx` + `ISOManagementFilters.tsx` requiere identificar el contrato exacto entre subcomponentes (props drilling vs context vs slot pattern). Mejor en sprint dedicado a auditoría de módulos audits.

### F-A15..F-A18 — Listeners onSnapshot con `where`/`limit` reales
Razón de diferir: en Sprint 19 se agregaron solo TODO comments (`commit 62f5f4e`). El refactor real requiere context-specific filters (timestamp range para emergency_checkins, archived flag para documents, projectId scope para controls/materials, limit para emergency_safety) — cada uno con su perfil de uso. Mejor decidir caso por caso con métricas reales de Firestore.

### Brecha C — Pipeline fotogrametría auto
Razón de diferir: la decisión Bucket D fue Brecha B (SLM offline) sobre Brecha C. C queda como mini-RFC en el spec del Sprint 20 (`docs/sprints/SPRINT_20_SPEC.md`) con pre-requisitos definidos (NodeODM AGPL backend-only OK, three.js mesh viewer, OPEX $0.50-2/scan).

## Acciones de seguridad post-PR

Ya documentadas en `auditoria777.md` apéndice de seguridad. Resumen:
1. **Rotar `GEMINI_API_KEY`** — fue compartida en chat durante esta sesión, exposición en transcript.
2. Confirmar que la key no quedó en ningún archivo (`grep -r 'AIzaSy' .` sobre el repo limpio).
3. Auditar `git log --all -p` por leaks pasados (incidente análogo del Sentry DSN en commits b13cfe8/d5e7a8e quedó pendiente).

## Sprint 20 — entry point

Ver `docs/sprints/SPRINT_20_SPEC.md` para el plan ejecutable de Brecha B (SLM offline). 6 fases core (~18h) + 3 opcionales (~6h). 3 open questions para el usuario al inicio del sprint.
