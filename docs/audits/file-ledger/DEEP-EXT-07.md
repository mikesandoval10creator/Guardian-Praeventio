# DEEP-EXT-07 — Auditoría exhaustiva de tests (Lote #7)

**Deriva:** `ledger.json` → `category === "I-TEST"`, orden por `path`, slice `[330:385]`.
**Total I-TEST en ledger:** 1247. **Slice leído:** 55 archivos (índices 330–384).
**Modo:** lectura línea por línea, caza de falsos-verdes / tests débiles.

## Atestación 55/55

Los 55 archivos del slice fueron leídos completos. Salvo 4 archivos de
servicio/lógica pura (`syncConflictRoutes.test.ts`, `twinStateMapper.test.ts`,
`webhookCommand.test.ts`, `r3fTestRenderer.smoke.test.ts`), todos son **tests de
componentes React** (`@vitest-environment jsdom`, `@testing-library/react`).
Patrón dominante y sano: el componente recibe el output del **motor/servicio
real** (o un factory tipado) por props y el test verifica render + interacción +
callbacks vía `data-testid`. Varios consumen el servicio de dominio real sin
mockearlo, lo que **eleva la calidad** (no son test-del-mock):
`getTrackForRole`/`evaluateProgress`, `buildSafetyMetricsReport`, `startShift`/
`addHandoverNote`, `createInitialCard`, `buildEmptyChecklist`,
`getOrCreateDeviceKek`/`setEncrypted` (crypto real + fake-indexeddb),
`mapIoTEventsToTwinState`, y el cálculo COG/thermal del `TwinIntegrationPanel`.

Dos joyas: `sceneGraph.r3f.test.tsx` (test-renderer r3f real montando
`THREE.InstancedMesh`/`THREE.LOD` y verificando 1-mesh-por-status/kind, niveles
LOD, slots de `instanceMatrix`) y `KekRotationPanel.test.tsx` (rotación KEK real
end-to-end con lock recovery, edad fresh/aging/stale, abort `no_records`).

No se hallaron: rules-tests con Admin SDK, "ID crypto contract" tautológico,
reimplementación-disfrazada de handlers, `validate` mockeado a `next()`,
snapshot-only, `it()` vacío, skip/todo/fixme. Mocks recurrentes legítimos:
`react-i18next` (fallback), y en los modales de `workers/` mocks de
`framer-motion`/`firebase/firestore`/`react-qr-code` (dependencias de entorno,
no la lógica bajo prueba). `Math.random()` aparece en helpers de test
(`ReconciliationStatusToast`, `twinStateMapper`) — permitido por directiva #15.

## Hallazgos (débiles / falsos-verdes parciales)

| Test:línea | Módulo-sujeto | Tipo | Por qué |
|---|---|---|---|
| 🟡 `AsesorChatRouter.test.tsx:57-69` (`resilientProps se pasan al panel`) | AsesorChatRouter | Falso-verde de intención | El mock de `ResilientAsesorPanel` **ignora props** (`() => <div/>`). El test dice verificar el forwarding de `resilientProps={tenantId,userUid}` pero solo re-comprueba que el panel renderiza. El spread `{...(resilientProps ?? {})}` (fuente línea 50) podría romperse y el test pasaría igual. |
| 🟡 `DocsModal.test.tsx:92-98` (`renders empty-state when snapshot returns no docs`) | DocsModal | Falso-verde / nombre engañoso | Dispara `lastSnapshotCb({docs:[]})` pero solo asserta que el nombre del worker sigue visible. NO asserta el elemento "No hay documentos cargados" (existe en fuente línea 284). El empty-state podría desaparecer del todo y el test seguiría verde. |
| 🟡 `TwinSceneInstancedLazy.test.tsx:12-18` | TwinSceneInstancedLazy | Assert tautológico | `expect(fallback ?? real).toBeTruthy()` acepta **cualquiera de los dos estados** (loading o cargado). Por construcción no puede distinguir Suspense-pending de resuelto; pasaría aunque ni el fallback ni el real renderizaran si... de hecho solo falla si NINGUNO aparece. Smoke ínfimo. |
| 🟡 `WeatherAndSeismicPanels.test.tsx:52-64` (`renders offline indicator`) | WeatherAndSeismicPanels | Assert vacío | Único assert: `container.textContent.length > 0`. No verifica indicador offline alguno (icono WifiOff ni copy). Pasaría con casi cualquier render no vacío; el nombre del test promete más de lo que valida. |
| 🟡 `VisitorCheckInForm.test.tsx:20-33` (`muestra error si faltan campos`) | VisitorCheckInForm | Falso-verde / nombre engañoso | El nombre dice "muestra error" pero solo asserta `onSubmit not.toHaveBeenCalled`. El comentario admite que el `required` HTML5 puede bloquear el submit. No verifica `visitor-error`; un form completamente roto (que no renderiza nada) también pasaría. |
| 🟡 `KekRotationPanel.test.tsx:271-290` (`rotación con record-fail`) | KekRotationPanel | Test mal etiquetado | El nombre promete cubrir `failures` en `details`, pero el comentario admite que "en este flujo standard NO hay failures" y el único assert es `queryByTestId('kek-rotation-failures')` **null**. No ejercita el path de fallo real; es el caso feliz disfrazado de caso-fallo. |
| 🔵 `SyncQueueBadge.test.tsx:20-50` | SyncQueueBadge | Cobertura parcial | El `badge` (color/label/count) se inyecta por prop ya calculado; el test NO ejercita la lógica de color/umbral del `syncQueueTracker` — solo el render del badge dado. Aceptable (esa lógica vive en el servicio), pero el componente recibe el gate pre-resuelto. |
| 🔵 `ConflictResolutionDrawer.test.tsx:14-24` | ConflictResolutionDrawer | Gate mockeado a approver | `useFirebase` se mockea con `isAdmin:true, userRole:'admin'` para llegar al UI de resolución. El test del **flujo** es fuerte (verifica payload del evento resuelto), pero el **gate de rol** (no-approver → UI "pending approval") no se prueba en este archivo. |
| 🔵 `VulnerabilityHeatmap.test.tsx:59-72` (`badges por severidad`) | VulnerabilityHeatmap | Assert por substring | `toHaveTextContent('2')`/`('1')` sobre todo el heatmap; substring laxo que podría matchear otros números del DOM. El conteo correcto no queda pineado a un `data-testid` específico. |
| 🔵 `r3fTestRenderer.smoke.test.ts:9-18` | (dependencia) | Library-test | Solo verifica que `@react-three/test-renderer` es importable y expone `create()`. Testea una dependencia de terceros, no código del proyecto. Inofensivo; valor cercano a cero (el smoke real lo cubre `sceneGraph.r3f.test.tsx`). |
| 🔵 `AccessControlModal.test.tsx:74-86` / `EditWorkerModal.test.tsx:69-79` | Access/EditWorkerModal | Smoke sin payload | Ambos verifican `updateDoc toHaveBeenCalledTimes(1)` pero NO el payload escrito. Un escritura con datos basura pasaría. Etiquetados explícitamente "smoke"; aceptable pero no pinea el contrato de datos. |

## Notas que NO son hallazgos (aclaraciones)

- `TwinIntegrationPanel.test.tsx` — **excelente**: asserta valores numéricos
  computados reales (COG `(3.0,1.0,1.0)`, thermal steady-state 24/36/26 °C con
  severidad 0%/100%/62%). Modelo a seguir para HUD derivado de cálculo.
- `twinStateMapper.test.ts` — robusto: función pura, no-mutación de defaults,
  no-downgrade critical→warning, flags `isFallen` por umbral, fallback de índice.
- `MassImportModal.test.tsx` — sano: asserta 2 `addNode` para 2 filas CSV (ejerce
  el parser real, no un número arbitrario).
- `RootCauseClassifierCard` / `SafetyMetricsDashboard` / `SpiDashboard` /
  `PermitChecklistRenderer` — pinean porcentajes/scores computados (67%, 100,
  pct exacto), no solo presencia.
- Los stubs r3f de `TwinPhysicsScene`/`TwinSceneInstanced` están **justificados
  con comentario** (Rapier WASM no carga en jsdom) y la cobertura real del
  scene-graph se delega a `sceneGraph.r3f.test.tsx`.

## Conteo

- **Sólidos:** 45 / 55
- **Débiles (🟡, falso-verde parcial / assert vacío / test mal etiquetado):** 6
- **Observaciones menores (🔵, cobertura parcial / library-test / smoke sin payload):** 4
- **Falsos-verdes graves (🔴):** 0
- **Skip/todo/empty/snapshot-only/reimplementación/Admin-SDK-bypass:** 0
