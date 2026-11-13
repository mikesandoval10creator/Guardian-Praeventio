# Stubs Inventory

> Inventario de stubs/mocks y marcadores de código productivo. Cada entrada debe tener owner + sprint target + gate de visibilidad. El CI revisa el árbol rastreado completo (src, packages, wasm, android, ios y server.ts) y compara los conteos por archivo con `docs/stubs-inventory-baseline.json`; una subida requiere revisión explícita junto con su inventario/owner.
>
> **Revalidación 2026-11-12:** el triage fechado 2026-06-19 se conserva
> como historia, no como estado actual. Las secciones revalidadas reflejan
> código y provisioning versionado; no implican que Cloud Scheduler esté
> habilitado en GCP ni que BLE haya pasado un lab físico.

## CL/safety_inspection — PDF server-side generator ✅ RESUELTO 2026-09-04
- **File**: `src/services/compliance/registry.ts` — `clSafetyInspectionAdapter.generate()` + `renderSafetyInspectionPdf()`
- **Owner**: Guardian implementation
- **Implementation**: `pdfkit` genera bytes PDF server-side desde el checklist validado; el resultado se devuelve como `pdfBase64` mediante `POST /api/compliance/emit/safety_inspection`.
- **User-visible**: SÍ — el endpoint devuelve HTTP 200, JSON canónico y PDF real; no inventa observaciones ni resultados de cumplimiento.
- **Evidence**: `src/__tests__/server/complianceEmit.router.test.ts` valida 200, contenido del checklist, cabecera `%PDF-` y auditoría `result: generated`.
- **Resolution criteria**: cumplidos; mantener prueba de bytes PDF y trazabilidad legal DS 594/1999 + DS 44/2024 + NCh ISO 45001 §9.1.

> **TRIAGE 2026-06-19** (verificado contra el código, no contra este doc): de las 86 entradas, **~9 accionables**.
> - **REAL-NEEDED (3, construir):** `src/server/jobs/runB2dMrrSnapshot.ts:15` (cron B2D MRR; backend listo) · `src/hooks/useGeofenceWithEvents.ts` (hook real sin consumer) · Wi-Fi Direct nativo `packages/capacitor-mesh/android/.../MeshPlugin.kt:552` + `ios/.../Plugin.swift:350` (BLE ya real).
> - **FAIL-SOFT LEGÍTIMO (3, no son deuda):** `vertexTrainer.ts` (descartado por producto) · `cloudErrorReportingAdapter.ts` (Sentry cubre) · `metricsAdapter.ts` (OTel futuro).
> - **RESUELTO 2026-07-13:** proximidad ahora usa `packages/capacitor-proximity` y expone `near/far` + `getCurrent()` con lifecycle auditable; validación física Android/iOS sigue como gate de release.
> - **STALE — estas 3 entradas describen stubs YA RESUELTOS, ignorar/quitar:** "SLM ONNX returns mock" (runtime real desde 2026-06-11) · "criticalPermitValidators orphan" (ya ruteado en `workPermits.ts`) · "SystemEngineProvider orphan" (ya montado en `AppProviders.tsx`).
> Detalle y plan en `docs/PENDIENTE.md` (dimensión C + fase T5).

## SLM ONNX inference returns mock — ✅ RESUELTO 2026-06-11 (B14, stub ELIMINADO)
- **File (histórico)**: `src/services/slm/worker/slmWorker.ts:58` — **archivo borrado**, junto con `workerProxy.ts` (Comlink).
- **Resolución**: runtime unificado. `slmAdapter.ts` ahora delega al runtime REAL (`src/services/slm/workerRuntime.ts` → `worker/slmRuntimeWorker.ts` → `slmRuntime.ts`): registry-aware (Qwen 0.5B pre-empaquetado por defecto), SHA-256 integrity, tokenizer BPE real por handle (`worker/slmRuntimeWorkerCore.ts` — `tokenizers` map), ORT WebGPU/WASM.
- **Anti-stub**: ya no existe fallback mock — los fallos rechazan honesto (`infer_failure` / `integrity_failure`) y la escalera resiliente (`resilientAiOrchestrator.ts`) cae a RAG corpus → mensaje de respaldo con disclaimer. Tests: `src/services/slm/slmAdapter.test.ts` ("no mock fallback"), `worker/slmRuntimeWorkerCore.test.ts` ("no gibberish byte-level").

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

## SII PSE provider scaffolds — typed failure, no real DTE provider call
- **Files**: `src/services/sii/libredteAdapter.ts`; `src/services/sii/openfacturaAdapter.ts`; `src/services/sii/simpleApiAdapter.ts`
- **Owner**: Guardian implementation — Chile compliance/DTE integration
- **Sprint target**: Round 2; blocked until a PSE is selected and its contract, sandbox credentials, and product owner are confirmed.
- **User-visible?**: YES, only as typed unsupported-provider errors (`SiiNotImplementedError`); these adapters do not return successful DTE results. The success-shaped `noopSiiAdapter` is for dev/test; `getSiiAdapter()` fails closed in production when the selected PSE is missing, invalid, or `noop`.
- **Evidence**: `src/services/sii/siiAdapter.test.ts` covers adapter dispatch and typed failures; `src/services/sii/index.ts:52-80` rejects the noop adapter in production.
- **Removal criteria**: implement the selected provider against its sandbox and verify auth, request/response mapping, audit, idempotency, and failure handling before any release decision.

## International jurisdiction adapter scaffolds — AU, CA, IN, JP, KR, UK
- **Files**: `src/services/compliance/adapters/au/index.ts`; `src/services/compliance/adapters/ca/index.ts`; `src/services/compliance/adapters/in/index.ts`; `src/services/compliance/adapters/jp/index.ts`; `src/services/compliance/adapters/kr/index.ts`; `src/services/compliance/adapters/uk/index.ts`
- **Owner**: Guardian implementation — Block 7 international compliance
- **Sprint target**: blocked until jurisdiction-specific product scope, legal review, and implementation owner are approved; international expansion remains in backlog.
- **User-visible?**: If a scaffolded generator is invoked, it throws typed `AdapterNotImplementedError`; it must not be presented as a completed compliance document. `ADAPTER_STATUS` remains `scaffold` for these countries.
- **Evidence**: `src/services/compliance/adapters/index.ts:42-50, 94-114` declares the scaffold status; each exported generator/signature throws rather than fabricating output.
- **Removal criteria**: implement and validate each jurisdiction separately against authoritative legal sources, approved contracts, and tests before exposing its generator.

## criticalPermitValidators — ✅ WIRED 2026-05-29 (ya no es huérfano)
- **File**: `src/services/workPermits/criticalPermitValidators.ts` (481 LOC + 36 unit tests)
- **Estado**: **CABLEADO** vía `POST /:projectId/work-permits/validate-critical` en `src/server/routes/workPermits.ts` (cobertura real-router en `workPermits.criticalValidate.test.ts`). Los 3 validadores implementados (izaje_critico/excavacion/loto, los del dispatcher `validateCriticalPermit`) ahora son alcanzables desde la API.
- **User-visible?**: SÍ ahora — endpoint advisory (devuelve issues blocking/advisory/info; NUNCA bloquea la emisión — el supervisor resuelve/override). Metadata incompleta → 400 honesto (no 500).
- **Pendiente (no-stub, feature futura)**: validadores deep para los otros 3 kinds (confined/hot_work/altura) no existen aún como funciones; el endpoint los rechaza vía enum. Cuando se implementen, agregarlos al dispatcher + al enum.

## B2D MRR snapshot — código y provisioning versionado (revalidado 2026-11-12)
- **Código/ruta**: `src/server/jobs/runB2dMrrSnapshot.ts` y `POST
  /api/maintenance/run-b2d-mrr-snapshot` en
  `src/server/routes/maintenance.ts`.
- **Programación versionada**: `.github/workflows/deploy.yml:782-789`
  provisiona `b2d-mrr-snapshot` con `30 0 1 * *` en `America/Santiago`; el
  helper `ensure_job` aplica esa zona. `scripts/validate-scheduler-crons.cjs:16-24`
  valida nombre, cron y endpoint, pero no el timezone. También figura en
  `docs/runbooks/SCHEDULER_INVENTORY.md:55`.
- **Alcance**: el código y la configuración de despliegue existen; no es un stub
  por falta de cron. `infrastructure/terraform/scheduler.tf` define solo
  `firestore-nightly-backup` y `firestore-backup-integrity-weekly`; el B2D HTTP
  job se provisiona en `deploy.yml`.
- **Límite de evidencia**: no se leyó el estado real de GCP
  (ENABLED/lastAttempt/status); el ticket P1 de reconciliación operativa sigue
  `In-progress`. No afirmar ejecución real ni que el chart esté poblado.
- **Histórico**: “no existe en scheduler.tf” era una observación estrecha; la programación actual vive en `deploy.yml`.

## SystemEngineProvider — montado, con feature flag apagada por defecto (revalidado 2026-11-12)
- **Archivo**: `src/providers/AppProviders.tsx:55-71, 152-159` monta el
  provider dentro de `MeshProvider`.
- **Activación**: `VITE_SYSTEM_ENGINE_ENABLED` queda en `false` si no se
  configura explícitamente; `SystemEngineProvider.tsx:77` devuelve los children
  sin ejecutar el motor mientras está deshabilitado. Ya no es huérfano, pero
  no activa triggers por defecto.
- **Scope**: `tenantId='default'` es metadata informativa; el bus A4 toma el
  proyecto seleccionado desde el contexto. El bloqueo de tenant client-side
  de mayo 2026 quedó supersedido por ese re-scope.
- **Límite de evidencia**: el cableado existe, pero no demuestra automatización
  activa, comportamiento en dispositivo ni readiness de producción. Mantener
  el flag apagado salvo autorización y validación separadas.
- **Histórico**: el diagnóstico previo de “no montado / tenantId ausente”
  describía el estado pre-A4; se conserva como historia, no como clasificación
  vigente del stub.

## useGeofenceWithEvents — RESUELTO 2026-06-14
- **File**: `src/hooks/useGeofenceWithEvents.ts`
- **Owner**: HOOKS_TRIAGE B10
- **User-visible?**: SÍ — `GeofenceAlert` lo usa para la protección activa del trabajador.
- **Wiring real**: `src/components/emergency/GeofenceAlert.tsx` importa y monta `useGeofenceWithEvents`; el wrapper alimenta eventos `geofence_crossed` al SystemEngine.
- **Evidence**: `src/components/emergency/GeofenceAlert.test.tsx`, `src/hooks/useGeofenceWithEvents.test.ts` y `src/services/systemEngine/__tests__/policies/geofenceToSos.test.ts` cubren consumidor, emisión y política de escalamiento.
- **Resolution**: ya no es stub ni huérfano; conservar esta entrada como registro histórico evita que auditorías futuras intenten volver a cablearlo.

## capacitor-mesh — BLE nativo presente; Wi-Fi Direct aún no implementado (revalidado 2026-11-12)
- **Archivos**: `packages/capacitor-mesh/android/src/main/java/com/praeventio/mesh/MeshPlugin.kt`
  y `packages/capacitor-mesh/ios/Plugin.swift` contienen implementación BLE
  GATT/CoreBluetooth; `MeshWireProtocol` transporta frames PRM1.
- **Slice integrado**: PR #1652 añadió framing, segmentación/reensamblaje por
  MTU y ACK/requeue de aplicación. No demuestra recepción por radio.
- **Aceptación pendiente**: el ticket P0 Mesh BLE permanece `In-progress` para
  lab Android↔Android / Android↔iOS, MTU efectivo, backpressure, desconexión,
  retry y medidas de round-trip. `writeWithoutResponse` no demuestra recepción
  remota. No declarar listo para campo.
- **Wi-Fi Direct**: no existe implementación `WifiP2pManager` ni
  `MultipeerConnectivity` en el código nativo. Las declaraciones del
  Manifest/Info.plist no son implementación; el fallback sigue planificado.
- **Histórico**: la descripción anterior de “902 LOC native stubs que solo
  loggean/fingen eventos” fue supersedida por PR #1652. El `BroadcastChannel`
  web es un simulador, no equivale a BLE.

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

## ERP SAP/Buk/Talana — typed stubs honestos
- **File**: `src/services/erp/erpAdapter.ts` — `SapAdapter`, `BukAdapter`, `TalanaAdapter`
- **Owner**: B14 (integraciones ERP)
- **Sprint target**: bloqueado hasta recibir credenciales sandbox y contratos API confirmados del cliente
- **User-visible?**: SÍ, pero fail-closed: sin credenciales devuelve `missing_credentials`; con configuración completa, cada método aún no cableado devuelve `ErpNotImplementedError`/HTTP 501. Nunca fabrica nómina, organigrama, estado laboral ni capacitación.
- **Why stub**: el contrato tipado (`manualSync`, `fetchEmployees`, `fetchOrgChart`, `pushWorkerStatus`, `pushTrainingRecord`) permite integrar proveedores sin fingir conectividad. `isConfigured()` sólo comprueba presencia de credenciales; no afirma handshake ni conexión real.
- **Evidence**: `src/services/erp/erpAdapter.test.ts` y `src/__tests__/server/misc.test.ts` cubren selección, credenciales, despacho por acción, errores honestos y ruta HTTP.
- **Removal criteria**: implementar y probar cada proveedor contra su sandbox; validar aislamiento tenant/project, paginación, idempotencia, PII y auditoría; sólo entonces habilitar `mode: real`.

## Evacuation.tsx "Estado Crítico" panel — sin fuente real de sensores de campo
- **File**: `src/pages/Evacuation.tsx` (panel "Estado Crítico", debajo de "Rutas Disponibles")
- **Owner**: TBD (requiere integración IoT de sensores de humo/red de incendio)
- **Sprint target**: TODO(sprint-N) — bloqueado hasta que exista una fuente de telemetría de campo (no hay ingestión de sensores de humo/incendio en el repo hoy)
- **User-visible?**: YES pero honesto — antes mostraba 'Online' hardcodeado para Sensores de Humo/Luces de Emergencia/Red de Incendio (fabricado, cero fuente real). Ahora cada ítem muestra 'Sin telemetría' en gris + nota inline explicando que la integración está pendiente. No se inventa un hook nuevo grande (directiva del bloque de remediación 2026-07-02).
- **Why stub**: no existe pipeline de ingestión IoT para sensores de incendio/humo en el repo (`telemetry_events` cubre wearables/machinery, no sensores fijos de faena).
- **Removal criteria**: cuando exista una colección/endpoint real de telemetría de sensores de campo, cablear el panel a esa fuente y quitar esta entrada. Ver auditoría `docs/audits/AUDITORIA-END-TO-END-2026-07-02.md` §3.1 bug 8.

## Proximity event bridge — ✅ RESUELTO 2026-07-13
- **Implementación**: `packages/capacitor-proximity` conserva `enable()/disable()/getStatus()/getPluginVersion()` y el comportamiento de pantalla previo; agrega `proximityChanged` + `getCurrent()` en Android/iOS.
- **Wiring**: `proximityPluginAdapter.ts` devuelve el plugin únicamente en plataforma nativa con sensor disponible. `useProximityMode` habilita, espera el handle asíncrono de Capacitor y libera listener + monitoreo incluso si el setup termina después del unmount.
- **Evidencia automatizada**: `proximityPluginAdapter.test.ts`, `useProximityMode.test.tsx`, `FallDetectionMonitor.proximity.test.tsx`, `proximityNativeContract.test.ts`, `androidBuildWiring.test.ts` y el clasificador Java SDK-free/JUnit.
- **Sin evidencia fabricada**: web y hardware no disponible continúan en política neutral. Estados nativos malformados se descartan.
- **Gate físico pendiente**: las pruebas automatizadas no sustituyen dispositivo real. Antes de release móvil se debe ejecutar la matriz documentada en `packages/capacitor-proximity/README.md` sobre al menos un Android con sensor y un iPhone compatible, verificando además que DeviceMotion/fall detection continúa activo con la pantalla atenuada/apagada.
