# TypeScript Strict Mode — Roadmap incremental

> Sprint E backend debt cleanup (2026-05-16). El plan integral marca
> "TypeScript NO strict" como **deuda estructural #1**. Este documento
> traquea el camino incremental para llegar a strict completo.

## Baseline actual (commit post-Wave 2)

`tsconfig.json` tiene activadas las siguientes flags strict-family:

| Flag | Estado | Errores activación |
| --- | --- | --- |
| `alwaysStrict` | ✅ activado | 0 |
| `noFallthroughCasesInSwitch` | ✅ activado | 0 |
| `strictBindCallApply` | ✅ activado | 0 |
| `noImplicitOverride` | ✅ activado | 13 fixed |
| `strictFunctionTypes` | ✅ activado (Wave 1) | 7 fixed |
| `noUnusedParameters` | ✅ activado (Wave 2) | 33 fixed |
| `noImplicitReturns` | ✅ activado (Wave 3) | 240 fixed |
| `strictNullChecks` | ✅ activado (Wave 4) | 336 fixed |

## Siguientes ondas (recomendación priorizada)

Cada onda debería ser un PR separado. NO mergeear varias en el mismo PR
— cada activación es una semántica distinta y el reviewer necesita
context limpio para evaluar los fixes.

### ✅ Onda 1 — `strictFunctionTypes` (7 errores) — COMPLETADA

**Resultado**: 7 errores fixed, todos por mismatch entre tipos
locales narrow y tipos de librerías más anchos (recharts, react-force-graph,
WebXR DOM, MessageEvent shape).

Fix approach aplicado: type narrowing + signature alignment con las
definiciones de las libs. En tres casos (recharts × 2 + slmRuntimeWorker)
se alineó la signature del callsite. En tres casos (XRSession + KnowledgeGraph
× 2) se castó al boundary porque las libs upstream tipan demasiado loose.

Archivos modificados:
- `src/components/admin/MrrChart.tsx` — Formatter signature coerce
- `src/components/admin/RevenueByTierChart.tsx` — idem
- `src/components/ar/XRSession.tsx` — cast XRSession → XRSessionInstance
- `src/components/shared/KnowledgeGraph.tsx` — cast ref, onNodeClick, nodeThreeObject
- `src/services/slm/worker/slmRuntimeWorkerProxy.ts` — overloads removeEventListener

### ✅ Onda 2 — `noUnusedParameters` (33 errores) — COMPLETADA

**Resultado**: 33 errores fixed mediante prefijo `_` (convención TS
para "intencionalmente no usado"). Distribuidos por:

- 3 callbacks de Google Maps `onUnmount(map)` (Evacuation, SafeDriving,
  SiteMap) — Maps API exige la signature pero no usamos el ref
- 5 callbacks `(item, index)` cuando solo se usa `item`
- 4 callbacks `(item, op)`, `(_, s)`, `(a, b)` en tests cuando solo
  parte de la signature es necesaria
- 8 fakes de Firestore/Storage/Auth donde el param existe por
  contrato pero el test no lo verifica
- 3 funciones de geminiBackend con params legacy `glossary` /
  `projectId` que ya no se usan tras refactors anteriores
- 2 functions con opts/payload "futuro use" (deactivateUser, buildNotConfiguredResult)
- Resto: errors handlers `(error)` / `(reject)` / `(cause)` no usados
  por diseño (catch-all que solo loguea).

**Sin cambios funcionales** — todos los params siguen presentes en la
signature (algunos son requeridos por contrato externo). Solo cambia
el name visible para que TS sepa que la intención es ignorarlos.

### ✅ Onda 3 — `noImplicitReturns` (240 errores) — COMPLETADA

**Resultado**: 240 errores fixed en 6 sub-PRs (#287-#292 + final).
Distribución por categoría:

- **Wave 3a server routes** (95 errores, PR #290): convertir `return;`
  bare a `return undefined;` y agregar `return` antes de
  `res.status(...).json(...)` cuando Express middleware esperaba que
  la función retorne para señalar "respondí". Files: sprintK.ts (13),
  admin.ts (12), organic.ts (8), b2dAdmin.ts (8), dte.ts (6),
  projects.ts (6), oauthGoogle.ts (5), compliance.ts (5),
  curriculum.ts (4), gemini.ts (4), wisdomCapsule.ts (3), misc.ts (3),
  billing.ts (3), ds67ds76.ts (2), suseso.ts (2), aiFeedback.ts (2),
  insights.ts (3), audit.ts (1), gamification.ts (1), push.ts (1),
  telemetry.ts (1), verifySchedulerToken.ts (1),
  verifyTwinStepUp.ts (1).
- **Wave 3b tests** (34 errores, PR #291): test-server.ts (17),
  askGuardian.test.ts (2), auditCoverage.test.ts (3),
  coachChatTenant.test.ts (2), commute.test.ts (4),
  emergency.test.ts (1), push.test.ts (1),
  telemetryCanonical.test.ts (1), telemetryRotation.test.ts (3),
  zettelkastenNlQuery.test.ts (1).
- **Wave 3c partial** (21 errores, PR #292): 9 test files + 2
  components (ARPosterScanner.tsx, server.ts:757 `_req`).
- **Wave 3d final** (79 errores, this PR): componentes useEffect
  early-return + contexts + hooks + pages + services. Pattern
  dominante: `useEffect(() => { if (!x) return; ... return cleanup; })`
  → `if (!x) return undefined;`. Files (parcial): AlertSchedulerMount,
  ProcessDetailModal, ProjectHealthCheck, QRScannerModal,
  QrSignatureModal, AsesorChat, AsesorChatLazy, Card, KnowledgeGraph,
  OfflineSLMBanner, ReconciliationStatusToast, SLMProvider,
  ConflictResolutionDrawer, DocsModal, AppModeContext,
  NotificationContext, ProjectContext, SensorContext,
  SystemEngineProvider, UniversalKnowledgeContext, useAutoLogout,
  useBiometricAuth, useDeadReckoning, useFirestoreCollection,
  useGeoAnchoredNodes, useGeofence, useGeolocationTracking,
  useHealthMetrics, useInsights, useInvoicePolling,
  useManDownDetection, useProjectArAnchors,
  useReconciliationStatus, useResilientAsesorFlag, useRiskEngine,
  useSensoryFatigue, useSlmAcquisition, useSprintK, useSurvivalPing,
  useTenantId, useTwinAccess, useWebXRSupport, useWisdomCapsules,
  ClawMachine, ControlsAndMaterials, CuadrillasDashboard,
  DigitalTwinFaena, Driving, EmergenciaAvanzada, Emergency,
  HealthVaultShare, History, IoTEdgeFiltering, MuralDinamico,
  PortableCurriculum, Telemetry, MeshProvider, speedTrigger,
  ragService, subscriber, pwa-offline.

Flag activado en `tsconfig.json` tras los 240 fixes. Sin bugs
funcionales revelados — todos los casos eran del patrón
"early-return en useEffect retorna `undefined` implícito en lugar de
una cleanup function".

### Onda 4 — `strictNullChecks` (337 errores) ⚠️ deuda estructural mayor

**Prioridad**: CRÍTICA — captura toda una clase de bugs (NPE-equivalent
en TypeScript). Pero también la onda más costosa.

Estrategia recomendada: NO activar global. En su lugar:

1. Crear `tsconfig.strict.json` con `strictNullChecks: true` + extends del base.
2. Agregar `npm run type-check:strict` que usa el config strict.
3. Listar archivos sin errores → marcar como "strict-compatible" en CI.
4. Migrar archivo por archivo (típicamente domain-by-domain):
   - Wave 4a: `src/services/billing/**` (~30 errores)
   - Wave 4b: `src/services/health/**` (~40 errores)
   - Wave 4c: `src/services/ar/**` (~10 errores, ya casi limpio)
   - Wave 4d: `src/components/**` (~150 errores, hardest)
   - Wave 4e: `src/pages/**` (~60 errores, depende de components)
   - Wave 4f: `server.ts` + `src/server/**` (~45 errores)

Cuando todos los archivos pasen strict, mover el flag al `tsconfig.json`
principal y borrar el archivo extra.

Estimado: 4-6 PRs separados, 1 por wave, ~6-10h cada uno.

### Onda 5 — `noUnusedLocals` (684 errores)

**Prioridad**: BAJA (cleanup-only, no captura bugs).

Mayoritariamente: imports unused, variables declaradas y no usadas.
Algunos pueden ser bugs (developer olvidó el callsite) pero la mayoría
son safe deletes.

Estrategia: ESLint con `no-unused-vars` ya cubre la mayoría. Probable
que activar este flag no agregue valor real sobre el linter. Considerar
si vale la pena.

### Onda 6 — `noPropertyAccessFromIndexSignature` (1832 errores)

**Prioridad**: MUY BAJA.

Este flag fuerza a usar `obj['key']` en lugar de `obj.key` cuando la
type tiene index signature. Es defensive pero verbose. 1832 errores es
mucho ruido por poca ganancia de safety.

Recomendación: **NO ACTIVAR** salvo que un audit muestre que es
necesario. Mantener en este roadmap como tracking pero sin compromiso.

## Cómo verificar localmente

```bash
# Verificar que el baseline actual pasa
npx tsc --noEmit

# Probar un flag específico sin commit
npx tsc --noEmit --strictNullChecks

# Contar errores para una flag
npx tsc --noEmit --strictNullChecks 2>&1 | grep -cE "^src.*error TS"
```

## Por qué incremental y no big-bang

El plan original sugería big-bang strict mode pero:

1. **Reviewability**: 1832 errores en un PR es imposible de revisar.
2. **Risk**: cada strict flag tiene semántica distinta — mezclar fixes
   de strictNullChecks con fixes de noUnusedLocals oculta el por qué.
3. **Continuidad**: bloquear merges hasta strict 100% ralentiza el
   resto de la feature work.

El approach incremental cierra cada onda como un commit limpio,
mantiene CI verde, y deja la deuda visible en este doc.

## Tracking

Items abiertos:
- [x] Onda 1: `strictFunctionTypes` (7 errores) — COMPLETADA
- [x] Onda 2: `noUnusedParameters` (33 errores) — COMPLETADA
- [x] Onda 3: `noImplicitReturns` (240 errores) — COMPLETADA
- [x] Onda 4: `strictNullChecks` (336 errores, 15 sub-PRs) — COMPLETADA
- [ ] Onda 5: `noUnusedLocals` (684 errores) — opcional
- [ ] Onda 6: `noPropertyAccessFromIndexSignature` (1832) — **NO recomendado**

Cuando una onda se cierre, marcar el checkbox + actualizar la tabla
del baseline arriba.
