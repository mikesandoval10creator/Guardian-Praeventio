import Capacitor
import Foundation

@objc(CapacitorProximityPlugin)
public class CapacitorProximityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapacitorProximityPlugin"
    public let jsName = "CapacitorProximity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPluginVersion", returnType: CAPPluginReturnPromise)
    ]

    private let implementation = CapacitorProximity()

    deinit {
        implementation.disable()
    }

    @objc func enable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let enabled = self.implementation.enable { [weak self] isNear, timestamp in
                self?.notifyListeners("proximityChanged", data: [
                    "state": isNear ? "near" : "far",
                    "timestamp": timestamp
                ])
            }
            enabled ? call.resolve() : call.reject("Proximity sensor not available on this device.")
        }
    }

    @objc func disable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.implementation.disable()
            call.resolve()
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve([
                "available": self.implementation.isAvailable(),
                "enabled": self.implementation.isEnabled(),
                "platform": "ios"
            ])
        }
    }

    @objc func getCurrent(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let state = self.implementation.currentState() else {
                call.reject("No proximity reading is available while monitoring is disabled.")
                return
            }
            call.resolve([
                "state": state.boolValue ? "near" : "far",
                "timestamp": Date().timeIntervalSince1970 * 1_000
            ])
        }
    }

    @objc func getPluginVersion(_ call: CAPPluginCall) {
        call.resolve(["version": implementation.getPluginVersion()])
    }
}
