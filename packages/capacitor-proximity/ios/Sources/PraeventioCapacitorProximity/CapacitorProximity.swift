import Foundation
import UIKit

@objc public final class CapacitorProximity: NSObject {
    public static let pluginVersion = "0.1.0"
    public typealias ReadingHandler = (_ isNear: Bool, _ timestamp: Double) -> Void

    private var observer: NSObjectProtocol?
    private var readingHandler: ReadingHandler?

    public func enable(readingHandler: @escaping ReadingHandler) -> Bool {
        self.readingHandler = readingHandler
        if !UIDevice.current.isProximityMonitoringEnabled {
            UIDevice.current.isProximityMonitoringEnabled = true
        }
        guard UIDevice.current.isProximityMonitoringEnabled else {
            self.readingHandler = nil
            return false
        }

        if observer == nil {
            observer = NotificationCenter.default.addObserver(
                forName: UIDevice.proximityStateDidChangeNotification,
                object: UIDevice.current,
                queue: .main
            ) { [weak self] _ in
                self?.emitCurrent()
            }
        }
        emitCurrent()
        return true
    }

    @objc public func disable() {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
            self.observer = nil
        }
        readingHandler = nil
        UIDevice.current.isProximityMonitoringEnabled = false
    }

    @objc public func isAvailable() -> Bool {
        if UIDevice.current.isProximityMonitoringEnabled {
            return true
        }
        UIDevice.current.isProximityMonitoringEnabled = true
        let available = UIDevice.current.isProximityMonitoringEnabled
        UIDevice.current.isProximityMonitoringEnabled = false
        return available
    }

    @objc public func isEnabled() -> Bool {
        UIDevice.current.isProximityMonitoringEnabled
    }

    @objc public func currentState() -> NSNumber? {
        guard UIDevice.current.isProximityMonitoringEnabled else {
            return nil
        }
        return NSNumber(value: UIDevice.current.proximityState)
    }

    @objc public func getPluginVersion() -> String {
        Self.pluginVersion
    }

    private func emitCurrent() {
        readingHandler?(
            UIDevice.current.proximityState,
            Date().timeIntervalSince1970 * 1_000
        )
    }

    deinit {
        disable()
    }
}
