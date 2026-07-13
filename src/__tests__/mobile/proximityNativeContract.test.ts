import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('first-party proximity plugin native contract', () => {
  it('Android emits real state changes, exposes current state, and tears down the sensor', () => {
    const implementation = read(
      'packages/capacitor-proximity/android/src/main/java/com/praeventio/proximity/CapacitorProximity.java',
    );
    const plugin = read(
      'packages/capacitor-proximity/android/src/main/java/com/praeventio/proximity/CapacitorProximityPlugin.java',
    );

    expect(implementation).toContain('Sensor.TYPE_PROXIMITY');
    expect(implementation).toContain('ProximityStateMapper.isNear');
    expect(implementation).toContain('sensorManager.unregisterListener');
    expect(implementation).toContain('restoreWindowState');
    expect(plugin).toContain('notifyListeners("proximityChanged", reading)');
    expect(plugin).toContain('public void getCurrent(PluginCall call)');
    expect(plugin).toContain('implementation.stopMonitoring()');
  });

  it('iOS observes proximity notifications, exposes current state, and removes the observer', () => {
    const implementation = read(
      'packages/capacitor-proximity/ios/Sources/PraeventioCapacitorProximity/CapacitorProximity.swift',
    );
    const plugin = read(
      'packages/capacitor-proximity/ios/Sources/PraeventioCapacitorProximity/CapacitorProximityPlugin.swift',
    );

    expect(implementation).toContain('.proximityStateDidChangeNotification');
    expect(implementation).toContain('if observer == nil');
    expect(implementation).toContain('removeObserver');
    expect(implementation).toContain('isProximityMonitoringEnabled = false');
    expect(plugin).toContain('notifyListeners("proximityChanged"');
    expect(plugin).toContain('@objc func getCurrent(_ call: CAPPluginCall)');
    expect(plugin).toContain('implementation.disable()');
  });

  it('ships both Capacitor package managers for generated iOS projects', () => {
    expect(read('packages/capacitor-proximity/Package.swift')).toContain(
      'PraeventioCapacitorProximity',
    );
    expect(
      read('packages/capacitor-proximity/PraeventioCapacitorProximity.podspec'),
    ).toContain("s.dependency 'Capacitor'");
  });
});
