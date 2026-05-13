// SPDX-License-Identifier: MIT
//
// @praeventio/capacitor-mesh — iOS Plugin (Sprint 46 REAL CoreBluetooth).
//
// Real CoreBluetooth implementation. Replaces the Sprint 30 STUB.
//
//   - CBPeripheralManager advertising service UUID
//     00001234-PRAE-VENTI-O123-456789ABCDEF
//   - CBCentralManager scanning with CBCentralManagerScanOptionAllowDuplicatesKey
//     for continuous RSSI tracking
//   - CBMutableService + CBMutableCharacteristic for `mesh-data`
//     (writeWithoutResponse, max 512 bytes)
//   - 30s peer-lost timeout
//   - Background advertising via Info.plist UIBackgroundModes
//     bluetooth-central + bluetooth-peripheral
//
// Contract (do NOT change):
//   start(peerId, projectId) -> ok
//   stop()                   -> ok
//   send(packet)             -> { deliveredTo: string[], queued: string[] }
//   getState()               -> { active, peers, packetsRelayed }
// Events:
//   mesh:peer-discovered { id, rssi }
//   mesh:peer-lost       { id }
//   mesh:packet          { ...MeshPacket }

import Foundation
import CoreBluetooth
import Capacitor

@objc(MeshPlugin)
public class MeshPlugin: CAPPlugin, CBPeripheralManagerDelegate, CBCentralManagerDelegate, CBPeripheralDelegate {

    static let serviceUUIDString = "00001234-PRAE-VENTI-O123-456789ABCDEF"
    static let meshDataCharUUIDString = "00001235-PRAE-VENTI-O123-456789ABCDEF"
    static let peerLostTimeout: TimeInterval = 30.0

    private let serviceUUID = CBUUID(string: MeshPlugin.serviceUUIDString)
    private let meshDataCharUUID = CBUUID(string: MeshPlugin.meshDataCharUUIDString)

    private var peripheralManager: CBPeripheralManager?
    private var centralManager: CBCentralManager?
    private var meshDataChar: CBMutableCharacteristic?

    private var connectedPeripherals: [String: CBPeripheral] = [:]
    private var peerCharacteristics: [String: CBCharacteristic] = [:]
    private var lastSeen: [String: Date] = [:]
    private var peerRssi: [String: Int] = [:]
    private var peerLostTimer: Timer?

    private var active: Bool = false
    private var peerId: String?
    private var projectId: String?
    private var packetsRelayed: Int = 0

    private var advertisingPending: Bool = false

    // MARK: - JS API

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

        NSLog("[PraeventioMesh] start(peerId=\(peerId), projectId=\(projectId)) — Sprint 46 CoreBluetooth")

        // Initialize managers lazily here, not in init, so BLE doesn't spin up
        // before the JS-side actually asks for the mesh.
        if self.peripheralManager == nil {
            self.peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
        }
        if self.centralManager == nil {
            self.centralManager = CBCentralManager(delegate: self, queue: nil)
        }

        self.advertisingPending = true
        // If peripheral already powered on, kick advertising now; else delegate handles it.
        if self.peripheralManager?.state == .poweredOn {
            self.setupServiceAndAdvertise()
        }
        // Likewise for central scanning.
        if self.centralManager?.state == .poweredOn {
            self.startScanning()
        }

        // Start peer-lost sweeper.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.peerLostTimer?.invalidate()
            self.peerLostTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
                self?.sweepLostPeers()
            }
        }

        call.resolve(["ok": true])
    }

    @objc func stop(_ call: CAPPluginCall) {
        NSLog("[PraeventioMesh] stop() — Sprint 46")
        self.active = false
        self.advertisingPending = false

        self.peripheralManager?.stopAdvertising()
        self.peripheralManager?.removeAllServices()

        if self.centralManager?.isScanning == true {
            self.centralManager?.stopScan()
        }

        // Disconnect peers.
        for (_, peripheral) in self.connectedPeripherals {
            self.centralManager?.cancelPeripheralConnection(peripheral)
        }
        self.connectedPeripherals.removeAll()
        self.peerCharacteristics.removeAll()
        self.lastSeen.removeAll()
        self.peerRssi.removeAll()

        self.peerLostTimer?.invalidate()
        self.peerLostTimer = nil

        self.peerId = nil
        self.projectId = nil
        self.packetsRelayed = 0
        call.resolve(["ok": true])
    }

    @objc func send(_ call: CAPPluginCall) {
        let packetId = (call.options["id"] as? String) ?? "<unknown>"

        // Serialize the whole packet (call.options is JS-compatible JSON).
        var deliveredTo: [String] = []
        var queued: [String] = []

        let payload: [String: Any] = call.options as? [String: Any] ?? [:]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            call.reject("packet not JSON-serializable")
            return
        }

        // 512 byte cap per BLE write-without-response payload contract.
        let capped: Data = data.count > 512 ? data.subdata(in: 0..<512) : data

        for (id, peripheral) in self.connectedPeripherals {
            guard let characteristic = self.peerCharacteristics[id] else {
                queued.append(id)
                continue
            }
            if peripheral.state == .connected {
                peripheral.writeValue(capped, for: characteristic, type: .withoutResponse)
                deliveredTo.append(id)
            } else {
                queued.append(id)
            }
        }

        self.packetsRelayed += 1
        NSLog("[PraeventioMesh] send() packetId=\(packetId) delivered=\(deliveredTo.count) queued=\(queued.count)")

        call.resolve([
            "deliveredTo": deliveredTo,
            "queued": queued
        ])
    }

    @objc func getState(_ call: CAPPluginCall) {
        let peers: [[String: Any]] = self.lastSeen.keys.map { id in
            return [
                "id": id,
                "rssi": self.peerRssi[id] ?? 0
            ]
        }
        call.resolve([
            "active": self.active,
            "peers": peers,
            "packetsRelayed": self.packetsRelayed
        ])
    }

    // MARK: - Peripheral role (advertising + GATT server)

    private func setupServiceAndAdvertise() {
        guard let peripheralManager = self.peripheralManager else { return }
        guard peripheralManager.state == .poweredOn else { return }
        guard let peerId = self.peerId else { return }

        peripheralManager.removeAllServices()

        let characteristic = CBMutableCharacteristic(
            type: self.meshDataCharUUID,
            properties: [.writeWithoutResponse],
            value: nil,
            permissions: [.writeable]
        )
        let service = CBMutableService(type: self.serviceUUID, primary: true)
        service.characteristics = [characteristic]
        self.meshDataChar = characteristic
        peripheralManager.add(service)

        let localName = "praeventio-\(String(peerId.prefix(8)))"
        peripheralManager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [self.serviceUUID],
            CBAdvertisementDataLocalNameKey: localName
        ])
        self.advertisingPending = false
        NSLog("[PraeventioMesh] advertising as \(localName)")
    }

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        NSLog("[PraeventioMesh] peripheralManager state=\(peripheral.state.rawValue)")
        if peripheral.state == .poweredOn && self.advertisingPending {
            self.setupServiceAndAdvertise()
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let value = request.value else { continue }
            self.handleIncomingPacket(data: value)
            peripheral.respond(to: request, withResult: .success)
        }
    }

    private func handleIncomingPacket(data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
            NSLog("[PraeventioMesh] dropping malformed inbound packet")
            return
        }
        self.packetsRelayed += 1
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("mesh:packet", data: json)
        }
    }

    // MARK: - Central role (scanning + connecting)

    private func startScanning() {
        guard let centralManager = self.centralManager else { return }
        guard centralManager.state == .poweredOn else { return }
        centralManager.scanForPeripherals(
            withServices: [self.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
        )
        NSLog("[PraeventioMesh] scanning for serviceUUID \(self.serviceUUID.uuidString)")
    }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        NSLog("[PraeventioMesh] centralManager state=\(central.state.rawValue)")
        if central.state == .poweredOn && self.active {
            self.startScanning()
        }
    }

    public func centralManager(_ central: CBCentralManager,
                               didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any],
                               rssi RSSI: NSNumber) {
        let id = peripheral.identifier.uuidString
        let rssi = RSSI.intValue
        let isNew = self.lastSeen[id] == nil

        self.lastSeen[id] = Date()
        self.peerRssi[id] = rssi

        if isNew {
            NSLog("[PraeventioMesh] discovered new peer \(id) rssi=\(rssi)")
            self.connectedPeripherals[id] = peripheral
            peripheral.delegate = self
            central.connect(peripheral, options: nil)

            DispatchQueue.main.async { [weak self] in
                self?.notifyListeners("mesh:peer-discovered", data: [
                    "id": id,
                    "rssi": rssi
                ])
            }
        }
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        NSLog("[PraeventioMesh] connected to \(peripheral.identifier.uuidString)")
        peripheral.discoverServices([self.serviceUUID])
    }

    public func centralManager(_ central: CBCentralManager,
                               didDisconnectPeripheral peripheral: CBPeripheral,
                               error: Error?) {
        let id = peripheral.identifier.uuidString
        NSLog("[PraeventioMesh] disconnected from \(id) error=\(String(describing: error))")
        self.peerCharacteristics.removeValue(forKey: id)
        // Keep in connectedPeripherals briefly; peer-lost sweep handles removal.
    }

    public func centralManager(_ central: CBCentralManager,
                               didFailToConnect peripheral: CBPeripheral,
                               error: Error?) {
        let id = peripheral.identifier.uuidString
        NSLog("[PraeventioMesh] failed to connect to \(id) error=\(String(describing: error))")
        self.peerCharacteristics.removeValue(forKey: id)
    }

    // MARK: - CBPeripheralDelegate (service/characteristic discovery on remote peers)

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let services = peripheral.services else { return }
        for service in services where service.uuid == self.serviceUUID {
            peripheral.discoverCharacteristics([self.meshDataCharUUID], for: service)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didDiscoverCharacteristicsFor service: CBService,
                           error: Error?) {
        guard error == nil, let characteristics = service.characteristics else { return }
        let id = peripheral.identifier.uuidString
        for characteristic in characteristics where characteristic.uuid == self.meshDataCharUUID {
            self.peerCharacteristics[id] = characteristic
            NSLog("[PraeventioMesh] characteristic ready for \(id)")
        }
    }

    // MARK: - Peer-lost sweeper

    private func sweepLostPeers() {
        let now = Date()
        let lostIds = self.lastSeen.compactMap { (id, seen) -> String? in
            return now.timeIntervalSince(seen) > MeshPlugin.peerLostTimeout ? id : nil
        }
        for id in lostIds {
            NSLog("[PraeventioMesh] peer-lost \(id)")
            if let peripheral = self.connectedPeripherals[id] {
                self.centralManager?.cancelPeripheralConnection(peripheral)
            }
            self.connectedPeripherals.removeValue(forKey: id)
            self.peerCharacteristics.removeValue(forKey: id)
            self.lastSeen.removeValue(forKey: id)
            self.peerRssi.removeValue(forKey: id)

            DispatchQueue.main.async { [weak self] in
                self?.notifyListeners("mesh:peer-lost", data: ["id": id])
            }
        }
    }
}
