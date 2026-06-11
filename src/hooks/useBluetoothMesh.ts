import { useState, useEffect, useCallback, useRef } from 'react';
import { BleClient, BleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { saveBreadcrumb, getBreadcrumbs } from '../utils/offlineStorage';
import { logger } from '../utils/logger';
// §16.2.1 sensorBus wiring: BLE peer visibility is correlation evidence for
// man-down (fall + inactivity + BLE disconnected → critical). This hook has
// no auth context, so events publish under the LOCAL_DEVICE_UID sentinel —
// the correlation engine attributes them to the local worker.
import { publishSensorEvent } from '../services/sensorBus/publishSensorEvent';

interface BluetoothDevice {
  id: string;
  name?: string;
  lastSeen: number;
}

interface PeerBreadcrumb {
  peerId: string;
  peerName: string;
  timestamp: number;
}

export function useBluetoothMesh() {
  const [isSupported, setIsSupported] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [nearbyDevices, setNearbyDevices] = useState<BluetoothDevice[]>([]);
  const [peerBreadcrumbs, setPeerBreadcrumbs] = useState<PeerBreadcrumb[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Peers discovered during the CURRENT scan window — used to decide whether
  // the scan ended "isolated" (zero peers → disconnection evidence).
  const scanFoundCountRef = useRef(0);

  // Save a breadcrumb ping for a discovered BLE peer and record locally
  const registerPeerContact = useCallback(async (deviceId: string, deviceName: string) => {
    // §16.2.1: a visible peer = BLE connectivity OK. Published synchronously
    // (before the async GPS/breadcrumb work) so the bus sees it immediately.
    publishSensorEvent({
      kind: 'ble_proximity',
      severity: 'info',
      meta: { deviceId, deviceName },
    });
    const lastKnown = (() => {
      try {
        const raw = localStorage.getItem('guardian_last_gps');
        return raw ? JSON.parse(raw) as { lat: number; lng: number } : null;
      } catch { return null; }
    })();

    const pos = navigator.geolocation
      ? await new Promise<{ lat: number; lng: number }>(resolve => {
          navigator.geolocation.getCurrentPosition(
            p => {
              const coords = { lat: p.coords.latitude, lng: p.coords.longitude };
              try { localStorage.setItem('guardian_last_gps', JSON.stringify(coords)); } catch {}
              resolve(coords);
            },
            // GPS timed out — fall back to last-known position rather than (0,0)
            () => resolve(lastKnown ?? { lat: 0, lng: 0 }),
            { timeout: 8000, maximumAge: 30000 }
          );
        })
      : (lastKnown ?? { lat: 0, lng: 0 });

    await saveBreadcrumb(deviceId, pos.lat, pos.lng).catch(() => {});
    setPeerBreadcrumbs(prev => {
      const exists = prev.find(p => p.peerId === deviceId);
      if (exists) return prev.map(p => p.peerId === deviceId ? { ...p, timestamp: Date.now() } : p);
      return [{ peerId: deviceId, peerName: deviceName, timestamp: Date.now() }, ...prev].slice(0, 50);
    });
  }, []);

  useEffect(() => {
    const initBle = async () => {
      try {
        await BleClient.initialize();
        setIsSupported(true);
      } catch (e) {
        logger.error("BLE Initialization failed", e);
        setIsSupported(false);
      }
    };
    initBle();
  }, []);

  const startScanning = useCallback(async () => {
    if (!isSupported) {
      setError('Bluetooth LE no soportado o inicializado.');
      return;
    }

    try {
      setIsScanning(true);
      setError(null);

      if (Capacitor.isNativePlatform()) {
        scanFoundCountRef.current = 0;
        await BleClient.requestLEScan({}, (result) => {
          scanFoundCountRef.current += 1;
          const deviceName = result.device.name || 'Dispositivo Desconocido';
          setNearbyDevices(prev => {
            const existing = prev.find(d => d.id === result.device.deviceId);
            if (existing) {
              return prev.map(d => d.id === result.device.deviceId ? { ...d, lastSeen: Date.now() } : d);
            }
            registerPeerContact(result.device.deviceId, deviceName);
            return [...prev, { id: result.device.deviceId, name: deviceName, lastSeen: Date.now() }];
          });
        });
        
        setTimeout(async () => {
          await BleClient.stopLEScan();
          setIsScanning(false);
          // §16.2.1: a full scan window with ZERO peers = the worker is out
          // of BLE range of every beacon/companion — disconnection evidence
          // for the man-down correlation. A found peer already published
          // 'info' above, which supersedes any earlier warning on the bus.
          if (scanFoundCountRef.current === 0) {
            publishSensorEvent({
              kind: 'ble_proximity',
              severity: 'warning',
              meta: { reason: 'scan_empty' },
            });
          }
        }, 10000);
      } else {
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['battery_service']
        });

        if (device) {
          const deviceName = device.name || 'Dispositivo Desconocido';
          registerPeerContact(device.id, deviceName);
          setNearbyDevices(prev => {
            const existing = prev.find(d => d.id === device.id);
            if (existing) {
              return prev.map(d => d.id === device.id ? { ...d, lastSeen: Date.now() } : d);
            }
            return [...prev, { id: device.id, name: deviceName, lastSeen: Date.now() }];
          });
        }
        setIsScanning(false);
      }

    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        // User cancelled or no devices found — NOT disconnection evidence
        // (web picker dismissal is a user gesture, not radio state).
      } else {
        setError(err.message || 'Error al escanear dispositivos Bluetooth.');
        // §16.2.1: a failed scan (adapter off/unavailable) means we cannot
        // see peers — counts as disconnection evidence on the bus.
        publishSensorEvent({
          kind: 'ble_proximity',
          severity: 'warning',
          meta: { reason: 'scan_error' },
        });
      }
      setIsScanning(false);
    }
  }, [isSupported]);

  return {
    isSupported,
    isScanning,
    nearbyDevices,
    peerBreadcrumbs,
    error,
    startScanning
  };
}
