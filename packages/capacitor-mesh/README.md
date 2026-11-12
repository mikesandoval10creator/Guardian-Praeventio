# @praeventio/capacitor-mesh

Capacitor plugin for the Praeventio BLE / Wi-Fi Direct mesh transport (ADR 0013).

Status: package version `0.1.0-scaffold` (not a production release). Android
and iOS source include BLE GATT/CoreBluetooth implementations; Wi-Fi Direct
fallback remains unimplemented. Native/device acceptance remains open; this is
source-level status, not field-readiness evidence.

## Layers

The mesh is split in two halves on purpose:

1. **Pure engine** (lives in the main app at `src/services/mesh/`):
   - `meshPacket.ts` — content-addressed packet model + sign/verify/dedup
   - `meshRelayQueue.ts` — store-carry-forward queue
   - `meshRequestRouter.ts` — file request lifecycle
   - `fileChunker.ts` — chunk/reconstruct blobs
   - 100% testable, no Capacitor, no native.
2. **Transport plugin** (this package):
   - `definitions.ts` — `MeshPlugin` interface
   - `web.ts` — `MeshWeb` simulator using `BroadcastChannel` for local multi-tab
     development only
   - `android/` — Kotlin `MeshPlugin.kt` implements BLE advertising/scanning
     and GATT transport with PRM1 framing
   - `ios/` — Swift `Plugin.swift` implements CoreBluetooth peripheral/central
     transport with PRM1 framing
   - Wi-Fi Direct (`WifiP2pManager` / `MultipeerConnectivity`) is not
     implemented; manifest/Info.plist declarations do not make it available.

The wire between the two halves lives in `src/services/mesh/transportFacade.ts`.

## Remaining acceptance — native lab and Wi-Fi Direct fallback

- **Physical BLE acceptance remains open** in the P0 Mesh BLE ticket. It needs
  Android↔Android and Android↔iOS round-trip, effective MTU/wire-byte budget,
  backpressure, loss/reordering, disconnect/reconnect, ACK/retry and delivery
  measurements. `writeWithoutResponse` is local queue acceptance, not remote
  receipt. Source presence and unit tests do not establish field readiness.
- **Wi-Fi Direct is not implemented.** `WifiP2pManager` (Android) and
  `MultipeerConnectivity` (iOS) remain planned; permission strings alone do
  not implement the fallback.
- The valid radio service UUID is derived in the native implementations; do
  not pass the non-hex brand string directly to CoreBluetooth/GATT APIs.

## Local development

The web simulator exchanges events between same-origin tabs using
`BroadcastChannel('praeventio-mesh-${projectId}')`. It exercises the engine/UI
path only; it does not emulate BLE radio, MTU, permissions, background behavior,
or the Android/iOS transport.
