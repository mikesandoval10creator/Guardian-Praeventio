# DEEP-EX-37 — Lote #37 · B-DigitalTwin (FEAT*) · gemelo digital 3D/AR/CAD/fotogrametría on-device

**Atestación:** 55/55 archivos leídos COMPLETOS línea por línea.
**Deriva:** `ledger.json` filtrado `category` startsWith "FEAT" && `block==="B-DigitalTwin"`,
ordenado por `path`, slice `[0:55]` (de 61 que matchean).
**Base de no-repetición:** `DEEP-NH-services-infra.md` (DigitalTwin on-device MiDaS real,
COLMAP/cloud-photogrammetry muerto, AR posterEmbeddings vacío, 4 módulos AR huérfanos,
Math.random IDs cliente, usdz cast). **Solo se reportan hallazgos NUEVOS.**

Leyenda: 🔴 grave (acción) · 🟡 deuda/parcial · 🔵 nota/limpio-con-matiz.

---

## 1. Hallazgos NUEVOS (no cubiertos por DEEP-NH)

### 🔴 N1 — `pages/BlueprintViewer.tsx` es un MOCK hardcodeado y ESTÁ RUTEADO al usuario (#13)
`src/pages/BlueprintViewer.tsx:146-218` renderiza **"Simulated Blueprint Content"**:
paredes/salas falsas + DOS nodos de riesgo fijos hardcoded ("Riesgo Químico"
`:184`, "Riesgo Eléctrico" `:207`) con tooltips inventados. Sin upload, sin
Firestore, sin datos reales. **Está ruteado** en
`src/routes/OperationsRoutes.tsx:15,51` → `/blueprint-viewer` (alcanzable por el
usuario). Stub-disfrazado clásico: sin `// TODO(sprint-N)`, sin feature-flag, sin
503, NO en `docs/stubs-inventory.md`. Confusión añadida: existe un SEGUNDO
BlueprintViewer REAL y funcional (`src/components/blueprints/BlueprintViewer.tsx`
— upload a Storage + markers + Firestore `blueprints/`) pero solo se embebe en
`AIHub.tsx`, NO en la ruta. El usuario que entra a `/blueprint-viewer` ve el fake.

### 🔴 N2 — `verifyTwinStepUp.ts` (gate biométrico server-side ADR 0011) NO está cableado → gate es UX-only
`src/server/middleware/verifyTwinStepUp.ts` existe pero `grep` confirma **cero
consumidores** (solo su test). El "triple-gate" del Digital Twin
(`useTwinAccess.ts` + `TwinAccessGuard.tsx`) es 100% client-side: `runBiometric`
corre en el dispositivo y solo togglea state React. El boundary real de privacidad
es `firestore.rules` (`match /tenants/{tenantId}` + `site_geometry`/`ar_anchors`),
que **no contiene ningún check biométrico**. Conclusión: la "verificación biométrica
para abrir el twin" no impide que un atacante con token válido lea la geometría vía
SDK directo. El comentario de `useTwinAccess.ts:122-128` ("Real implementation in
Sprint 26 will lazy-load…") quedó parcialmente implementado (cliente sí, server no).

### 🟡 N3 — `StructuralCalculator.tsx`: efectos secundarios DURANTE el render (impureza React + writes espurios)
`src/components/engineering/StructuralCalculator.tsx:99-112` llama
`writeNodesDebounced(...)` / `saveScratchCalculation(...)` **en el cuerpo del
componente** (no en useEffect/useMemo) — se ejecuta en CADA render, persistiendo un
nodo Zettelkasten de scaffold-uplift repetidamente. `:132-141` repite el patrón
DENTRO de un `useMemo` (side-effect en memo, anti-patrón). Bajo StrictMode/re-render
genera writes Firestore duplicados. Comparar con `CalculatorHub.tsx:151-158`
(`usePersistNode` correcto vía useEffect) — el patrón bueno ya existe en el repo.

### 🟡 N4 — Reconstrucción on-device NO escribe `audit_logs` (#3/#14)
El flujo VIDEO→MESH (`DigitalTwinFaena.handleSubmit:448`) crea jobs en Firestore
(`onDeviceAdapter`), emite nodos ZK (`useObjectLifecycle`) y eventos
`calendar_events`, pero `grep audit` en `onDeviceAdapter.ts` +
`reconstructionJobStore.ts` = 0. Igual `ar_anchors` (ARMachineryScene/Warehouse
`setDoc` directo) y `placedObjects`/`blueprints`/`events` (calendar modals) — ningún
write de este bloque toca `audit_logs`. Son writes client-side (la invariante #3
stampa identidad server-side y no aplica literal), pero geometría de faena +
inventario de seguridad + capturas 3D son state-changing relevantes para
cumplimiento; conviene un trigger Firestore o ruta server con audit.

### 🟡 N5 — `RiskMarkers`/leyenda "Riesgos detectados" en DigitalTwinFaena: leyenda decorativa sin datos
`src/pages/DigitalTwinFaena.tsx:986` renderiza `<RiskMarkers />` SIN prop `markers`
(→ lista vacía, no pinta nada, honesto `:162-174`). Pero `:1080-1097` muestra una
leyenda fija "Caída de altura / Atropello / EPP faltante" como si el twin detectara
esos riesgos. La leyenda implica detección que no ocurre. Honestidad parcial: el
header tiene badge "Vista previa" `:536` y disclaimer `:955` ("resultado
ilustrativo… no representa la reconstrucción real"). Aun así, mezcla copy honesto
con leyenda engañosa.

### 🟡 N6 — `PointCloudViewer` fallback usa `Math.random()` como nube de puntos "ilustrativa"
`src/pages/DigitalTwinFaena.tsx:111-113,119-124` genera la nube procedural con
`Math.random()` cuando un job completado NO tiene `resultUrl` (GLB real). Es ruido
decorativo presentado en el visor 3D. Cubierto por el disclaimer `:955` ("ilustrativo")
y badge preview, pero el path se dispara para cualquier job `completed` sin mesh.
Cliente → regla #15 no aplica literal; smell de "stub semi-disfrazado".

### 🟡 N7 — Modo GPU del twin: stub deshabilitado con copy COLMAP muerto (doc-drift runtime)
`src/pages/DigitalTwinFaena.tsx:625` el botón "GPU Cloud" muestra toast
`"GPU Modal.run pendiente de habilitar; usando CPU COLMAP."` — COLMAP/cloud
fue **descartado** (§2.28, confirmado por DEEP-NH §2.4-2.6) y el pipeline real es
on-device three.js, no COLMAP. Mensaje de error stale visible al usuario. El botón
es `aria-disabled` (invisible-ish), aceptable como stub, pero el copy miente.

### 🟡 N8 — `dwgDocumentValidator.ts` HUÉRFANO + endpoint `/api/cad/upload-url` INEXISTENTE → flujo DWG muerto
`src/services/cad/dwgDocumentValidator.ts` (398 LOC, validador puro real con SHA-256
inline) tiene **cero consumidores** (header `:15` afirma "Wired into
src/server/routes/cad.ts upload endpoint when present" — NO lo está; `cad.ts` ni lo
importa ni tiene upload endpoint). `dwgAdapter.ts` documenta depender de
`/api/cad/upload-url` (`:152`) que **no existe** en `cad.ts` ni `server.ts`. Y
`convertDwgToDxf`/`uploadAndConvertDwg` no tienen consumidor real (`AutoCADViewer.tsx`
rechaza DWG de plano `:63-67`, solo procesa DXF). Resultado: el único path DWG→DXF
del producto es un dead-end — la ruta `cad.ts:/convert-dwg` existe pero ningún
cliente la alcanza y su prerequisito (upload-url) falta.

### 🟡 N9 — Componentes huérfanos NUEVOS (solo test, sin consumidor prod)
- `components/twinPhysics/TwinPhysicsScene.tsx` — Rapier physics demo, cero
  consumidores (`grep` solo su test). "Base para refactor futuro" que nunca aterrizó.
- `components/twinScene/TwinSceneInstancedLazy.tsx` — wrapper lazy creado para
  ahorrar ~150KB (`:1-5`), pero `TwinIntegrationPanel.tsx` importa
  `TwinSceneInstanced` **directo**, saltándose el lazy → el ahorro de bundle no se
  materializa y el wrapper es huérfano.
- `components/digital-twin/RePositionConfirmDialog.tsx` — huérfano; su header dice
  "la orquestación está en `useArPlacement.confirmPlacement`" pero `useArPlacement`
  NO lo renderiza; ningún `.tsx` lo monta.

### 🟡 N10 — Spanish-AR (voseo) en copy user-facing, viola convención #2 (es-CL)
Copy con voseo argentino en vez de es-CL:
- `PlaceObjectMenu.tsx:65-67` "Arrastrá", "marcalo", "Después marcalo".
- `ARWarehouseScene.tsx` (header/UI heredan patrón AR).
- `TwinAccessGuard.tsx:108` "reenviá", `:148` "Podés intentar", `:165` "Podés
  registrar".
Convención #2 exige Spanish-CL. Cosmético pero sistemático en el bloque AR.

### 🔵 N11 — Doc-drift de paths/deps (interno y cross-file)
- Path `ar_anchors`: el header de `arAnchorService.ts:64-66`,
  `arAnchorFirestoreAdapter.ts:5-6`, `useArPlacement.ts`, `useGeoAnchor.ts` y
  `useProjectArAnchors.ts` comentarios dicen 4 niveles
  `tenants/{tid}/projects/{pid}/ar_anchors/{id}`, pero el CÓDIGO (y `firestore.rules:1033`)
  usa 3 niveles `tenants/{tid}/ar_anchors`. Drift documentado a medias por "Codex fix".
- `@mlightcad/three-renderer`: referenciado como dep de ingest en
  `dxfAdapter.ts:5`, `cad.ts:17` y `AutoCADViewer` comments, pero **no está en
  package.json** (revertido por GPL, ADR 0002). `AutoCADViewer.tsx` renderiza SVG
  inline. Las menciones son tombstones.
- `GaussianSplatViewer.tsx:293-308` rama "playcanvas no instalado" es ahora código
  muerto: `playcanvas` + `@playcanvas/react` SÍ están en package.json, así que el
  fallback `unavailable` nunca se mostrará.
- `mockAdapter.ts:13-14` header apunta a "Meshroom Cloud Run worker pool" muerto.

### 🔵 N12 — `Site25DPanel.tsx`: fallback `tenantId='default'` (aislamiento multi-tenant débil)
`src/components/digital-twin/Site25DPanel.tsx:191`
`auth.currentUser?.tenantId ?? 'default'` — si el claim de tenant falta, la geometría
del sitio se persiste/lee del tenant literal `'default'`, mezclando faenas de clientes
sin claim en un cubo compartido. Mismo patrón que ARMachineryScene resolvió vía
`useTenantId()` (custom claim). Smell de leakage cross-tenant en el edge case.

### 🔵 N13 — IDs por `Date.now()` con colisión potencial (cliente)
`Site25DPanel.tsx:238` `geom_${Date.now()}`, `BlueprintViewer (component):128`
marker `Date.now().toString()`, `AddEventModal` implícito. Dos polígonos/markers
creados en el mismo ms colisionan. Cliente → regla #15 (Math.random/server) no aplica
literal, pero `crypto.randomUUID()`/`randomId()` sería robusto. (Ya conocido para AR
ids en DEEP-NH §9; se extiende a geometry/markers.)

---

## 2. Limpios / reales confirmados (sin hallazgo nuevo)

| Archivo | Veredicto |
|---|---|
| `ar/ArQuickLookButton.tsx` | ✅ Detección `relList.supports('ar')` + HEAD probe del .usdz; honesto. |
| `ar/ArViewLink.tsx` | ✅ iOS QuickLook / Android Scene Viewer intent real; UA override para tests. |
| `ar/ARMachineryScene.tsx` | ✅ WebXR real + setDoc `ar_anchors` gateado por rules (createdByUid==auth.uid). Limitación cross-session honesta `:121-140`. |
| `ar/ARWarehouseScene.tsx` | ✅ Funcional (no "en construcción" pese a comment DigitalTwinAR). findProximityPairs real. |
| `digital-twin/ARObjectOverlay.tsx` | ✅ WebXR/QuickLook branch real; preview mesh primitivo honesto `:56-60`. |
| `digital-twin/GaussianSplatViewer.tsx` | ✅ Lazy playcanvas + canvas real (ver N11 sobre fallback muerto). |
| `digital-twin/PlaceObjectMenu.tsx` | ✅ DnD chips puro (ver N10 voseo). |
| `digital-twin/RePositionConfirmDialog.tsx` | 🟡 Real pero huérfano (N9). |
| `digital-twin/ReconstructionArLink.tsx` | ✅ AR launcher mesh on-device; privacy note correcto. |
| `digital-twin/TwinAccessGuard.tsx` | 🟡 Real client-side; gate server ausente (N2) + voseo (N10). |
| `digital-twin/Site25DPanel.tsx` | ✅ GoogleMaps 2.5D + DrawingManager real (ver N12 tenant 'default'). |
| `twinPhysics/TwinPhysicsScene.tsx` | 🟡 Real, huérfano (N9). |
| `twinScene/TwinSceneInstanced.tsx` | ✅ InstancedMesh + LOD + Rapier real; consumido por TwinIntegrationPanel. |
| `twinScene/TwinSceneInstancedLazy.tsx` | 🟡 Real, huérfano + ahorro bundle no aplicado (N9). |
| `engineering/StructuralCalculator.tsx` | 🟡 Cálculos Euler/Bernoulli reales; side-effects en render (N3). |
| `blueprints/BlueprintViewer.tsx` (component) | ✅ Real (upload+markers+Firestore); pero solo en AIHub, no ruteado (ver N1). |
| `calendar/AddEventModal.tsx` | ✅ Conflict-check cross-proyecto + addDoc real. |
| `calendar/EventDetailsModal.tsx` | ✅ CRUD evento real + ConfirmDialog. |
| `pages/AutoCADViewer.tsx` | ✅ Parser DXF MIT real client-side; rechaza DWG honestamente (ver N8/N11). |
| `pages/BlueprintViewer.tsx` (page) | 🔴 MOCK ruteado (N1). |
| `pages/CalculatorHub.tsx` | ✅ 12 generadores + paneles; persistencia correcta vía useEffect. |
| `pages/DigitalTwinAR.tsx` | ✅ 3 modos AR con capability gate honesto; comment "en construcción" stale. |
| `pages/DigitalTwinFaena.tsx` | 🟡 Pipeline on-device real; N4/N5/N6/N7. |
| `pages/WebXR.tsx` | ✅ Honesto (ADR-0018: NO es WebXR real, checklist 2D estático + audit `:131`). `console.error:139` (usar logger). |
| `hooks/useArPlacement.ts` | ✅ Pure runner + React wrapper; delta-threshold real. |
| `hooks/useGeoAnchor.ts` | ✅ Mesh↔geo local-tangent-plane real; honesto sobre aproximación. |
| `hooks/useGeoAnchoredNodes.ts` | ✅ Bounding-box + Haversine refine real; índice documentado. |
| `hooks/useObjectLifecycle.ts` | ✅ Lifecycle→ZK+calendar+/api/calendar/sync real (sin audit, ver N4). |
| `hooks/useProjectArAnchors.ts` | ✅ onSnapshot tenant-scoped; limpia anchors al cambiar proyecto. |
| `hooks/useTwinAccess.ts` | 🟡 Gate client real; server ausente (N2). |
| `hooks/useWebXRSupport.ts` | ✅ Feature-detect `isSessionSupported` real + SSR-safe. |
| `server/routes/cad.ts` | ✅ verifyAuth + 503/400/502 + no leak; pero proxy sin cliente real (N8). |
| `services/ar/arAnchorService.ts` | ✅ Tipos + lógica pura; Math.random id (DEEP-NH §9) + doc-drift path (N11). |
| `services/ar/arAnchorFirestoreAdapter.ts` | ✅ CRUD + queries; header path drift (N11). |
| `services/ar/posterEmbeddings.generated.ts` | 🟡 `{}` vacío por diseño (DEEP-NH §7); no en stubs-inventory. |
| `services/cad/dwgAdapter.ts` | 🟡 Cliente real pero sin consumidor + endpoint prereq ausente (N8). |
| `services/cad/dwgDocumentValidator.ts` | 🟡 Validador puro real, huérfano (N8). |
| `services/cad/dxfAdapter.ts` | ✅ Adapter puro determinístico; doc-drift mlightcad (N11). |
| `services/digitalTwin/gaussianSplatFirestoreAdapter.ts` | ✅ CRUD; `setCanonical:53-72` get+update sin txn (cliente, smell menor). |
| `.../onDeviceReconstruction/frameExtractor.ts` | ✅ HTMLVideoElement+canvas, no upload, abort/timeout robusto. |
| `.../onDeviceReconstruction/glbExporter.ts` | ✅ three.js GLTFExporter POINTS real. |
| `.../onDeviceReconstruction/index.ts` | ✅ Orquesta pipeline real (MiDaS-or-heuristic→GLB→USDZ); privacy garantizada. |
| `.../onDeviceReconstruction/midasDepthEstimator.ts` | ✅ ONNX MiDaS real + fallback HEAD-404 (DEEP-NH). |
| `.../onDeviceReconstruction/pointCloudBuilder.ts` | ✅ Heurística monocular real (no SfM, header honesto). |
| `.../onDeviceReconstruction/usdzExporter.ts` | ✅ Quad-mesh USDZ + gamma real para iOS QuickLook. |
| `.../photogrammetry/mockAdapter.ts` | 🟡 Mock huérfano prod (DEEP-NH §3); header Meshroom stale (N11). |

---

## 3. Acciones sugeridas (prioridad)

1. **N1 (🔴):** decidir ruta `/blueprint-viewer` → apuntar al componente real o
   borrar el mock + registrar en `stubs-inventory.md` mientras tanto.
2. **N2 (🔴):** cablear `verifyTwinStepUp` a las rutas/lecturas de geometría O
   documentar explícitamente que el gate biométrico es UX y que rules es el boundary
   (ajustar ADR 0011 a la realidad).
3. **N3 (🟡):** mover persistencia de `StructuralCalculator` a useEffect
   (patrón `usePersistNode`).
4. **N4 (🟡):** añadir audit (trigger o ruta server) a reconstruction jobs +
   ar_anchors + site_geometry.
5. **N7/N11 (🟡/🔵):** limpiar copy COLMAP/Meshroom/mlightcad muerto; corregir
   doc-drift path ar_anchors (3 vs 4 niveles); eliminar rama playcanvas-unavailable.
6. **N8/N9 (🟡):** decidir destino de dwgValidator+dwgAdapter+upload-url y de los 3
   componentes huérfanos (TwinPhysicsScene, TwinSceneInstancedLazy, RePositionConfirmDialog).
7. **N10 (🟡):** normalizar voseo→es-CL en bloque AR/Twin.

---

**Resumen (atestación 55/55):** Lote #37 confirma que el núcleo del pipeline
gemelo-digital es REAL y on-device (frameExtractor→pointCloud→GLB/USDZ, MiDaS opcional,
Site25D, AR anchors gateados por rules) — coincide con DEEP-NH. Lo NUEVO: un mock
hardcodeado RUTEADO al usuario (`pages/BlueprintViewer.tsx` con riesgos falsos, 🔴 N1);
el gate biométrico "triple-gate" del Digital Twin es UX-only porque su middleware
server `verifyTwinStepUp` quedó sin cablear (🔴 N2); `StructuralCalculator` persiste
nodos Firestore durante el render (impureza React, N3); ni la reconstrucción ni
ar_anchors/geometry escriben `audit_logs` (N4); leyenda de "riesgos detectados" y nube
`Math.random` decorativas con disclaimer parcial (N5/N6); botón GPU con copy COLMAP
muerto (N7); el flujo DWG completo es un dead-end (validador huérfano + endpoint
upload-url inexistente, N8); tres componentes huérfanos nuevos (N9); voseo es-AR en
copy (N10); y abundante doc-drift de paths/deps tombstone (mlightcad, Meshroom,
playcanvas, ar_anchors 3-vs-4-niveles, N11). Sin egress de cámara/imágenes detectado
(el video nunca sube — directiva #12 respetada). Sin secretos, sin Math.random en
src/server, sin 5xx-leak. Doc-only, sin commit.
