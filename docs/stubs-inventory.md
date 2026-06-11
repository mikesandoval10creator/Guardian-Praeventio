# Stubs Inventory

> Inventario de stubs/mocks/NotImplementedError en código productivo. CLAUDE.md regla 13 requiere que cada uno aparezca aquí con owner + sprint target + gate de visibilidad.

## SLM ONNX inference returns mock
- **File**: `src/services/slm/worker/slmWorker.ts:58`
- **Owner**: Brecha B (SLM offline real)
- **Sprint target**: TBD (post-PR #511-513)
- **User-visible?**: NO — gated by `slmTokenWindowOpen` check + 5-tier orchestrator fallback (Gemini cloud takes over)
- **Why stub**: ONNX runtime integration pendiente. Opensource refs: `onnxruntime-web`, `@xenova/transformers`.
- **Removal criteria**: cuando ONNX se integre, `slmWorker.generate()` retorna real tokens del modelo Phi-3/Qwen/Gemma.

## Vertex AI Trainer descartado oficialmente
- **File**: `src/services/ml/vertexTrainer.ts:1-30`
- **Owner**: producto (decisión usuario 2026-05-27)
- **Sprint target**: opt-in gated mega-enterprise (Sprint D futuro)
- **User-visible?**: NO — función devuelve shape determinístico pero NUNCA gasta cuota Vertex
- **Why stub**: Vertex AutoML Tabular solo aplica a tier mega-enterprise + budget USD/node-hour. Para PYMEs LATAM target, flujo IA real vive en `resilientAiOrchestrator.ts` (5-tier) + `vertexAdapter.ts` (inferencia, NO trainer).
- **Removal criteria**: cuando se construya opt-in feature flag + tier check + budget cap per tenant.

## CloudErrorReporting adapter noops (3 methods)
- **File**: `src/services/observability/cloudErrorReportingAdapter.ts:43, 47, 55`
- **Owner**: B12 (catalog observability)
- **Sprint target**: TBD
- **User-visible?**: NO — Sentry handles error reporting productivamente
- **Why stub**: adapter Cloud Error Reporting scaffolding, no se activó porque Sentry cubre el caso
- **Removal criteria**: si se decide migrar de Sentry a GCP-native, implementar real. Sino, documentar como noop intencional.

## Metrics adapter noops (6 methods)
- **File**: `src/services/observability/metricsAdapter.ts:62, 66, 70, 94, 98, 102`
- **Owner**: B12 + K6 (OpenTelemetry future)
- **Sprint target**: TBD (Sprint observability futuro)
- **User-visible?**: NO — métricas actuales vía Sentry breadcrumbs + Cloud Run stdout
- **Why stub**: catalog adapter para futura integración OTel/Prometheus/Datadog
- **Removal criteria**: cuando K6 active OpenTelemetry, implementar real.

## criticalPermitValidators — ✅ WIRED 2026-05-29 (ya no es huérfano)
- **File**: `src/services/workPermits/criticalPermitValidators.ts` (481 LOC + 36 unit tests)
- **Estado**: **CABLEADO** vía `POST /:projectId/work-permits/validate-critical` en `src/server/routes/workPermits.ts` (cobertura real-router en `workPermits.criticalValidate.test.ts`). Los 3 validadores implementados (izaje_critico/excavacion/loto, los del dispatcher `validateCriticalPermit`) ahora son alcanzables desde la API.
- **User-visible?**: SÍ ahora — endpoint advisory (devuelve issues blocking/advisory/info; NUNCA bloquea la emisión — el supervisor resuelve/override). Metadata incompleta → 400 honesto (no 500).
- **Pendiente (no-stub, feature futura)**: validadores deep para los otros 3 kinds (confined/hot_work/altura) no existen aún como funciones; el endpoint los rechaza vía enum. Cuando se implementen, agregarlos al dispatcher + al enum.

## B2D MRR snapshot job Sprint E deferido
- **File**: `src/server/jobs/runB2dMrrSnapshot.ts:15`
- **Owner**: G7
- **Sprint target**: TBD (Sprint B2D)
- **User-visible?**: NO — job no programado en `scheduler.tf`
- **Why stub**: B2D billing flujo pendiente — depende de mercado B2D maduro
- **Removal criteria**: cuando B2D billing se active productivamente.

## SystemEngineProvider orphan (no mounted)
- **File**: `src/contexts/SystemEngineProvider.tsx` (3 context adapters REALES: emergency, subscription, sensor + executor.ts + decisionEngine + 2 policies: geofenceToSos, tierChangeReactivity)
- **Owner**: D3
- **Sprint target**: post-PR #513
- **User-visible?**: NO — triggers system engine no llegan al frontend
- **Why orphan**: provider definido pero `AppProviders.tsx` no lo envuelve.
- **Blocker real (verificado 2026-05-29, sin asumir)**: el provider exige un prop `tenantId` ("usually fetched from the verified user claim" per su docstring) PERO el claim NO lo lleva — `tenantId` es server-resolved per-project (`resolveTenantId()` en `workPermits.ts:59` lee `projects/{id}.tenantId`). NO existe client-side: ni en el `User` de FirebaseContext (`tenantId` ahí es el campo Firebase-Auth nativo = null) ni en el `Project` type. **Montarlo requiere PRIMERO una fuente client-side de tenantId** (custom claim nuevo + `getIdTokenResult().claims`, o endpoint `/api/me`, o añadir `tenantId` al fetch del project doc).
- **Bug FIXED 2026-05-29 (PR fix/system-engine-active-emergency-bug)**: `hasActiveEmergency` estaba hardcoded `() => false` (líneas 129+147 del decide-context), lo que anulaba el anti-cascade guard de geofenceToSos (re-disparaba un SOS aun con emergencia activa). Ahora lee el estado real vía `emergencyActiveRef` ← `useEmergency().isEmergencyActive`. El guard en sí ya está tested en `__tests__/policies/geofenceToSos.test.ts`.
- **Removal criteria (WIRE)**: (1) resolver fuente client-side de `tenantId`, (2) envolver en `AppProviders.tsx` dentro de `SensorProvider` (junto a `MeshProvider` — ahí todos los deps: emergency/subscription/notification/sensor/project/firebase están presentes), (3) integration test del provider montado. O DEPRECATE si se decide.

## useGeofenceWithEvents wire pendiente
- **File**: `src/hooks/useGeofenceWithEvents.ts`
- **Owner**: HOOKS_TRIAGE B10
- **Sprint target**: TBD (Sprint admin)
- **User-visible?**: NO — wrapper especializado sin consumer
- **Why orphan**: documentado en `docs/audits/HOOKS_TRIAGE.md` como "WIRE pendiente — futuro panel admin de geocercas"
- **Removal criteria (WIRE)**: cuando se construya el admin panel de geocercas.

## capacitor-mesh Android/iOS stubs
- **File**: `packages/capacitor-mesh/android/src/main/java/.../MeshPlugin.kt:552` + `packages/capacitor-mesh/ios/Sources/.../Plugin.swift:350`
- **Owner**: H2 (Sprint 31 BLE GATT) + H3 (Sprint 32 Wi-Fi Direct)
- **Sprint target**: Sprint 31 (BLE) + Sprint 32 (Wi-Fi Direct)
- **User-visible?**: PARTIAL — web simulator (240 LOC) funciona productivo via BroadcastChannel; native (902 LOC stubs) solo loggea + fake events
- **Why stub**: BLE GATT real requiere Android `BluetoothLeAdvertiser/Scanner/GattServer` + iOS `CBPeripheralManager/CBCentralManager`. Wi-Fi Direct requiere Android `WifiP2pManager` + iOS `MultipeerConnectivity`. Trabajo no trivial.
- **Removal criteria**: ADR 0013 cubre split engine/transport. Sprint 31/32 implementan.

## Componentes huérfanos en src/components/ root (audit F2 RE-VERIFICADO ×2 2026-05-27)

**Audit F2 fue corregido dos veces.** Codex P2 3309059273 (PR #516 revisión 2)
detectó que mi grep `from.*components/X` MISS dynamic imports
`lazy(() => import('./components/X'))` — `SurvivalPing` y
`OfflineSyncManager` SÍ están wired vía `lazy` en `App.tsx:26-27,554-555`,
no orphan.

### Wired vía lazy() en App.tsx (audit miss de batch grep original)
- `OfflineSyncManager.tsx` → `App.tsx:26,554` — escucha onlineStatus y
  sincroniza outbox pending actions con Firebase. Background side-effect.
- `SurvivalPing.tsx` → `App.tsx:27,555` — wrapper null-renderer de
  `useSurvivalPing()` hook. Lone-worker / SOS heartbeat background.

### Wired en PR #514 (mergeado 2026-05-27)
- `WeatherSafetyRecommendations.tsx` → `Dashboard.tsx` (boletín climático
  directiva usuario). Renders DS 594 / Ley 16.744 contextual safety
  recommendations + Codex P2 fixes (unavailable gate, uv field map, auth header).

### Wired en PR #516 (este, pendiente merge)
- `SunTrackerContainer.tsx` → `Dashboard.tsx` (visual companion al
  WeatherBulletin, sun/moon tracker 24h + fase lunar + elevación solar).
  Reads `selectedProject.coordinates.lat` (canonical project geo field) con
  fallback Santiago.

### Ya estaban wired (audit F2 mis-classification original)
| Componente | Consumer real |
|---|---|
| `OfflineIndicator.tsx` | 1 consumer (RootLayout-style) |
| `ProjectHealthCheck.tsx` | 1 consumer |
| `FastCheckModal.tsx` | 1 consumer (Dashboard probablemente) |
| `QRScannerModal.tsx` | 2 consumers |
| `BunkerManager.tsx` | 1 consumer |
| `GeolocationTracker.tsx` | 1 consumer |
| `LocalePicker.tsx` | `Settings.tsx:571` — language picker ya activo |
| `WeatherBulletin.tsx` (root) | `SafeDrivingMode.tsx:10` (variante separada de la versión dashboard) |

### Orphans reales actualmente en main: 0 (post #514 + #516 merge)

La deuda fantasma F2 era **100%** — los 12 listados originalmente o ya
estaban wired (10 estáticos + 2 lazy) o quedan wired por PRs en curso
(2 vía #514 y #516). Audit F2 completamente refutado. Para futuro: usar
herramienta tipo `knip` o `ts-unused-exports` que entienda dynamic
imports en vez de batch-grep.

## ✅ "Próximamente" UI placeholders — ERRADICADOS 2026-05-30
- **MuralDinamico.tsx**: NO era placeholder — es feature REAL (mural de seguridad estilo Instagram: Firestore `safety_posts` + onSnapshot + posts/likes/moderación). La entrada anterior estaba desactualizada.
- **AutoCADViewer.tsx**: visor DXF REAL vía `dxf-parser` (MIT/OSS) + `dxfAdapter`. Se removió el "Próximamente lo convertiremos server-side" + la mención a "Autodesk DWG TrueView" (herramienta de tercero). Copy honesto: DXF es el formato abierto soportado; para DWG → exportar a DXF. DWG OSS no aplica (solo libredwg GPL, incompatible con SaaS comercial).
- **Directiva usuario 2026-05-30**: la app NUNCA debe decir "próximamente"/"en mantenimiento"/"futuras actualizaciones". Todo real al lanzar. Sin licencias de terceros (OSS-first).

## Settings.tsx hardcoded aria-disabled
- **File**: `src/pages/Settings.tsx:397` (toggle emergencia)
- **Owner**: D6
- **Sprint target**: TBD
- **User-visible?**: YES — toggle visible pero disabled
- **Why stub**: confirmar si intencional (feature gate) o pendiente wire
- **Removal criteria**: si intencional, documentar reason inline + remover de inventory. Si pendiente wire, implementar.

## ERP adapters sin implementación (oracle/dynamics/odoo → 501 honesto)
- **File**: `src/server/routes/misc.ts:76` (schema) + `src/server/routes/misc.ts:241` (handler 501)
- **Owner**: B14 (integraciones ERP)
- **Sprint target**: TBD — se implementa el adapter cuando un cliente enterprise lo requiera
- **User-visible?**: NO como éxito simulado — `oracle`/`dynamics`/`odoo` devuelven HTTP 501 `ErpNotImplementedError` con mensaje claro y audit log del intento; `mock` es el adapter de pruebas documentado. Adapters reales: `sap`/`buk`/`talana`.
- **Why stub**: compatibilidad de schema (clientes pueden enviar el erpType y recibir un error honesto en vez de 400 confuso); evita simular éxito.
- **Removal criteria**: implementar el adapter real correspondiente en `src/services/erp/` y moverlo a `SUPPORTED_ERP_ADAPTERS`.

## Proximity event bridge ausente en @capgo/capacitor-proximity (D1 wiring)
- **File**: `src/services/proximitySensor/proximityPluginAdapter.ts:49-67` (`loadProximityPlugin()` retorna `null` en toda plataforma)
- **Owner**: mobile (D1 islands follow-up — `TODO(sprint-D1-followup)` inline)
- **Sprint target**: TBD — requiere trabajo nativo (extender `packages/capacitor-mesh` o fork de @capgo con `notifyListeners('proximityChanged')` + `getCurrent()`)
- **User-visible?**: NO — sin fuente de proximidad, `useProximityMode` queda en modo `normal` con política neutra (multiplier 1.0): el umbral de caída sigue siendo exactamente 25 m/s², cero cambio de comportamiento.
- **Why stub**: `@capgo/capacitor-proximity` v8.1.2 solo expone `enable()/disable()/getStatus()`; Android atenúa la ventana nativamente e iOS togglea `UIDevice.isProximityMonitoringEnabled` — NINGUNO puentea near/far a JS (cero `notifyListeners` en el fuente del plugin). Se rechazó usar `visibilitychange` como proxy: alimentaría un umbral de vida-seguridad con señal ambigua y el monitoreo nativo puede apagar la pantalla y pausar el stream DeviceMotion del que depende la detección de caídas.
- **Removal criteria**: cuando exista el bridge nativo, retornar el plugin adaptado en `loadProximityPlugin()`; los pin-tests de `proximityPluginAdapter.test.ts` fallan ruidosamente para forzar el retiro de esta entrada. El resto de la cadena TS (engine → `useProximityMode` → sensorBus `device_mode` → threshold de `FallDetectionMonitor`) ya está cableada y testeada vía el contrato DI.
