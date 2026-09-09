import { useState, useEffect, useCallback, useRef } from 'react';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { saveBreadcrumb } from '../utils/offlineStorage';
import { logger } from '../utils/logger';
// §16.2.1 sensorBus wiring: BLE peer visibility is correlation evidence for
// man-down (fall + inactivity + BLE disconnected → critical). This hook has
// no auth context, so events publish under the LOCAL_DEVICE_UID sentinel —
// the correlation engine attributes them to the local worker.
import { publishSensorEvent } from '../services/sensorBus/publishSensorEvent';
import { humanErrorMessage } from '../lib/humanError';


interface ScanSession {
  cancelled: boolean;
  native: boolean;
  found: number;
  timer?: ReturnType<typeof setTimeout>;
}

// BleClient has one scanner shared by hook instances. Serialize start/stop so
// a delayed native start cannot outlive cleanup or stop a newer owner's scan.
let nativeOwner: ScanSession | null = null;
let nativeOperations = Promise.resolve();
function runNativeOperation(operation: () => Promise<void>): Promise<void> {
  const pending = nativeOperations.then(operation);
  nativeOperations = pending.catch(() => { /* Caller handles the error; keep the queue usable. */ });
  return pending;
}

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

  const sessionRef = useRef<ScanSession | null>(null);
  const mountedRef = useRef(false);

  const stopScanning = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    if (session.timer !== undefined) clearTimeout(session.timer);
    sessionRef.current = null;
    if (mountedRef.current) setIsScanning(false);
    if (!session.native) return;
    try {
      await runNativeOperation(async () => {
        if (nativeOwner !== session) return;
        await BleClient.stopLEScan();
        nativeOwner = null;
      });
    } catch (err) {
      // Retain the cancelled native owner: a later start retries cleanup first.
      logger.error('BLE scan cleanup failed', err);
      if (mountedRef.current) setError(humanErrorMessage(err));
    }
  }, []);

  // Save a breadcrumb ping for a discovered BLE peer and record locally
  const registerPeerContact = useCallback(async (deviceId: string, deviceName: string, session: ScanSession) => {
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

    if (session.cancelled || !mountedRef.current) return;
    await saveBreadcrumb(deviceId, pos.lat, pos.lng).catch(() => {});
    if (session.cancelled || !mountedRef.current) return;
    setPeerBreadcrumbs(prev => {
      const exists = prev.find(p => p.peerId === deviceId);
      if (exists) return prev.map(p => p.peerId === deviceId ? { ...p, timestamp: Date.now() } : p);
      return [{ peerId: deviceId, peerName: deviceName, timestamp: Date.now() }, ...prev].slice(0, 50);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const initBle = async () => {
      try {
        await BleClient.initialize();
        if (!disposed) setIsSupported(true);
      } catch (e) {
        logger.error("BLE Initialization failed", e);
        if (!disposed) setIsSupported(false);
      }
    };
    void initBle();
    return () => {
      disposed = true;
      mountedRef.current = false;
      void stopScanning();
    };
  }, [stopScanning]);

  const startScanning = useCallback(async () => {
    if (!mountedRef.current || sessionRef.current) return;
    if (!isSupported) {
      setError('Bluetooth LE no soportado o inicializado.');
      return;
    }
    const session: ScanSession = {
      cancelled: false, native: Capacitor.isNativePlatform(), found: 0,
    };
    sessionRef.current = session;
    const isCurrent = () => !session.cancelled && mountedRef.current && sessionRef.current === session;
    const seen = new Set<string>();
    const recordDevice = (id: string, name: string) => {
      if (!isCurrent()) return;
      session.found += 1;
      if (!seen.has(id)) {
        seen.add(id);
        void registerPeerContact(id, name, session);
      }
      setNearbyDevices(prev => prev.some(d => d.id === id)
        ? prev.map(d => d.id === id ? { ...d, lastSeen: Date.now() } : d)
        : [...prev, { id, name, lastSeen: Date.now() }]);
    };
    setIsScanning(true);
    setError(null);
    try {
      if (session.native) {
        await runNativeOperation(async () => {
          if (!isCurrent()) return;
          // Retry a previously failed cleanup before issuing another start.
          if (nativeOwner?.cancelled) {
            await BleClient.stopLEScan();
            nativeOwner = null;
          }
          if (nativeOwner) throw new Error('BLE_SCAN_BUSY');
          nativeOwner = session;
          // Keep ownership on rejection: partial native setup still needs cleanup.
          await BleClient.requestLEScan({}, result => {
            recordDevice(result.device.deviceId, result.device.name || 'Dispositivo Desconocido');
          });
        });
        if (!isCurrent()) return;
        session.timer = setTimeout(() => {
          if (!isCurrent()) return;
          // Only a complete window is evidence of isolation, never cancellation.
          if (session.found === 0) {
            publishSensorEvent({ kind: 'ble_proximity', severity: 'warning', meta: { reason: 'scan_empty' } });
          }
          void stopScanning();
        }, 10000);
      } else {
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['battery_service']
        });
        if (!isCurrent()) return;
        if (device) recordDevice(device.id, device.name || 'Dispositivo Desconocido');
        // No OS cancellation API for the web picker. Its late results are ignored.
        sessionRef.current = null;
        setIsScanning(false);
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      if (err.name !== 'NotFoundError') {
        setError(humanErrorMessage(err.message || 'Error al escanear dispositivos Bluetooth.'));
        // A scanner owned by another view is not evidence of radio isolation.
        if (err.message !== 'BLE_SCAN_BUSY') {
          publishSensorEvent({ kind: 'ble_proximity', severity: 'warning', meta: { reason: 'scan_error' } });
        }
      }
      await stopScanning();
    }
  }, [isSupported, registerPeerContact, stopScanning]);

  return {
    isSupported,
    isScanning,
    nearbyDevices,
    peerBreadcrumbs,
    error,
    startScanning,
    stopScanning
  };
}
