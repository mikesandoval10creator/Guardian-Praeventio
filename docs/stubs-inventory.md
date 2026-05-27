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

## criticalPermitValidators orphan
- **File**: `src/services/workPermits/criticalPermitValidators.ts` (481 LOC, 0 imports producción — solo `.test.ts` + `TODO.md`)
- **Owner**: A6 (workPermitEngine integration)
- **Sprint target**: post-PR #513
- **User-visible?**: NO — código no se ejecuta en runtime
- **Why orphan**: 6 validadores regulatorios (izaje, excavación, LOTO, confined spaces, hot work, alturas) listos pero `workPermitEngine.ts` no los invoca
- **Removal criteria (WIRE)**: agregar invocación en `workPermitEngine.evaluatePermit()`. NO eliminar — son compliance Chile DS 132 (minería) + altura.

## B2D MRR snapshot job Sprint E deferido
- **File**: `src/server/jobs/runB2dMrrSnapshot.ts:15`
- **Owner**: G7
- **Sprint target**: TBD (Sprint B2D)
- **User-visible?**: NO — job no programado en `scheduler.tf`
- **Why stub**: B2D billing flujo pendiente — depende de mercado B2D maduro
- **Removal criteria**: cuando B2D billing se active productivamente.

## SystemEngineProvider orphan (no mounted)
- **File**: `src/contexts/SystemEngineProvider.tsx:65-76` (5 adapters definidos: themeContext, sensorContext, subscriptionContext, languageProvider, emergencyContext + executor.ts + README)
- **Owner**: D3
- **Sprint target**: post-PR #513
- **User-visible?**: NO — triggers system engine no llegan al frontend
- **Why orphan**: provider definido pero `App.tsx`/`AppProviders.tsx` no lo envuelven
- **Removal criteria (WIRE)**: envolver en `AppProviders.tsx` después de `EmergencyProvider`. O DEPRECATE si se decide.

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

## Componentes huérfanos en src/components/ root (audit F2 corregido 2026-05-27)
- **Confirmed orphan (no imports anywhere)** — ~10 files pending wire:
  `OfflineIndicator.tsx`, `ProjectHealthCheck.tsx`, `SurvivalPing.tsx`,
  `FastCheckModal.tsx`, `QRScannerModal.tsx`, `BunkerManager.tsx`,
  `SunTrackerContainer.tsx`, `GeolocationTracker.tsx`,
  `OfflineSyncManager.tsx`, `LocalePicker.tsx`.
- **Not actually orphan** (audit F2 mis-classification, verified 2026-05-27):
  - `WeatherBulletin.tsx` (root version) → wired in `SafeDrivingMode.tsx:10`.
    There is ALSO a `src/components/dashboard/WeatherBulletin.tsx` wired in
    `Dashboard.tsx:43` — two intentional variants for different audiences.
- **Wired by Sprint A PR #514** (this PR, 2026-05-27):
  - `WeatherSafetyRecommendations.tsx` → wired in `Dashboard.tsx` next to
    `WeatherBulletin`. Renders DS 594 / Ley 16.744 contextual safety
    recommendations from `environment?.weather`. Uses Gemini AI fallback
    pattern with deterministic baseline.
- **Owner**: F2 (remaining 10)
- **Sprint target**: Sprint A incremental (one PR per bucket of related components)
- **User-visible?**: NO for remaining orphans — shipped in bundle but 0 imports
- **Removal criteria (WIRE)**: per-component placement decided by domain bucket
  in plan Sprint A (e.g., `OfflineIndicator` → `RootLayout` header,
  `BunkerManager` → SettingsAdvanced, `QRScannerModal` → AccessControl/Visitors).

## "Próximamente" UI placeholders
- **Files**: `src/pages/MuralDinamico.tsx:42`, `src/pages/AutoCADViewer.tsx`
- **Owner**: D5
- **Sprint target**: TBD
- **User-visible?**: YES — usuario ve "Próximamente" message
- **Why stub**: features parciales con UI honesta
- **Removal criteria**: convertir en feature flag gates (ocultar entrada sidebar hasta listo) o implementar la feature.

## Settings.tsx hardcoded aria-disabled
- **File**: `src/pages/Settings.tsx:397` (toggle emergencia)
- **Owner**: D6
- **Sprint target**: TBD
- **User-visible?**: YES — toggle visible pero disabled
- **Why stub**: confirmar si intencional (feature gate) o pendiente wire
- **Removal criteria**: si intencional, documentar reason inline + remover de inventory. Si pendiente wire, implementar.
