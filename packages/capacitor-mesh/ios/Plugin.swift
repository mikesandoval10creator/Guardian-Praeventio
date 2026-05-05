// SPDX-License-Identifier: MIT
//
// @praeventio/capacitor-mesh — iOS Plugin (Sprint 30 SCAFFOLD).
//
// This is a STUB. It registers the plugin with Capacitor, accepts the
// JS calls (start/stop/send/getState), logs them, and emits a synthetic
// peer-discovered event so the JS-side wire can be smoke-tested via
// `cap run ios` before the real CoreBluetooth stack lands.
//
// Sprint 31 will REPLACE this body with the real implementation:
//   - CBPeripheralManager advertising service UUID
//     00001234-PRAE-VENTI-O123-456789ABCDEF
//   - CBCentralManager scanning with CBCentralManagerScanOptionAllowDuplicatesKey
//   - CBService + CBMutableCharacteristic for `mesh-data`
//   - Background advertising via Info.plist UIBackgroundModes
//     bluetooth-central + bluetooth-peripheral

import Foundation
import Capacitor

@objc(MeshPlugin)
public class MeshPlugin: CAPPlugin {
    static let serviceUUID = "00001234-PRAE-VENTI-O123-456789ABCDEF"

    private var active: Bool = false
    private var peerId: String?
    private var projectId: String?
    private var packetsRelayed: Int = 0

    @objc func start(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId"),
              let projectId = call.getString("projectId") else {
            call.reject("peerId and projectId are required")
            return
        }
        self.peerId = peerId
        self.projectId = projectId
        self.active = true
        self.packetsRelayed = 0
        NSLog("[PraeventioMesh] start(peerId=\(peerId), projectId=\(projectId)) — Sprint 30 stub")

        // Synthetic peer-discovered after 1s so JS wire can be exercised.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self, self.active else { return }
            self.notifyListeners("mesh:peer-discovered", data: [
                "id": "stub-peer-ios",
                "rssi": -65
            ])
        }

        call.resolve(["ok": true])
    }

    @objc func stop(_ call: CAPPluginCall) {
        NSLog("[PraeventioMesh] stop() — Sprint 30 stub")
        self.active = false
        self.peerId = nil
        self.projectId = nil
        self.packetsRelayed = 0
        call.resolve(["ok": true])
    }

    @objc func send(_ call: CAPPluginCall) {
        let packetId = (call.options["id"] as? String) ?? "<unknown>"
        NSLog("[PraeventioMesh] send() — Sprint 30 stub — packetId=\(packetId)")
        self.packetsRelayed += 1
        // Sprint 31: real GATT WRITE_NO_RESPONSE ack tracking populates
        // deliveredTo / queued.
        call.resolve([
            "deliveredTo": [],
            "queued": []
        ])
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve([
            "active": self.active,
            "peers": [],
            "packetsRelayed": self.packetsRelayed
        ])
    }
}
