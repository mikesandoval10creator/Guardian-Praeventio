# @praeventio/capacitor-mesh

Capacitor plugin SCAFFOLD for the Praeventio BLE / Wi-Fi Direct information
relay mesh (ADR 0013).

Status: **0.1.0-scaffold** — types + web simulator only. Native code is
stubbed (logs only). Real BLE GATT stack lands in **Sprint 31**.

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
   - `web.ts` — `MeshWeb` simulator using `BroadcastChannel` for
     local-multi-tab dev (no device required)
   - `android/` — Kotlin `MeshPlugin.kt` STUB (logs + emits test events)
   - `ios/` — Swift `Plugin.swift` STUB
   - The real BLE GATT advertising/scanning is the Sprint 31 deliverable.

The wire between the two halves lives in
`src/services/mesh/transportFacade.ts` (also in this PR).

## Sprint 31 TODO

- Replace `MeshPlugin.kt` stub with real implementation:
  - `BluetoothLeAdvertiser` advertising service UUID
    `00001234-PRAE-VENTI-O123-456789ABCDEF`
  - `BluetoothLeScanner` scanning with the same UUID filter, background
    via `JobScheduler`
  - `BluetoothGattServer` exposing the `mesh-data` characteristic
    (READ + WRITE_NO_RESPONSE, 512-byte chunks)
  - `BluetoothGatt` client connect on peer discovery
  - Permission flow for `BLUETOOTH_SCAN` / `BLUETOOTH_ADVERTISE` /
    `BLUETOOTH_CONNECT` / `ACCESS_FINE_LOCATION`
- Replace `Plugin.swift` stub:
  - `CBPeripheralManager` advertising
  - `CBCentralManager` scanning with `AllowDuplicates`
  - `CBService` + `CBMutableCharacteristic` for `mesh-data`
  - `Info.plist` background modes `bluetooth-central` +
    `bluetooth-peripheral`
- Wire `notifyListeners('mesh:packet', packet)` from native discovery
  callbacks (signature already defined in `definitions.ts`).
- Sprint 32+: Wi-Fi Direct (`WifiP2pManager` Android,
  `MultipeerConnectivity` iOS) for chunks > 100 KB.

## Local development

The web simulator wires multiple tabs of the same origin via
`BroadcastChannel('praeventio-mesh-${projectId}')`, so two tabs running
`npm run dev` will exchange packets just like two phones would over BLE.
This lets the engine and UI be exercised end-to-end without a device.
