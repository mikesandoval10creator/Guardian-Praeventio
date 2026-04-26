import { useState, useEffect, useCallback } from 'react';
import { BleClient, BleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { saveBreadcrumb, getBreadcrumbs } from '../utils/offlineStorage';

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

  // Save a breadcrumb ping for a discovered BLE peer and record locally
  const registerPeerContact = useCallback(async (deviceId: string, deviceName: string) => {
    // Use 0,0 coords as placeholder — real position comes from inertial nav or GPS if available
    const pos = (navigator.geolocation)
      ? await new Promise<{lat: number, lng: number}>(resolve => {
          navigator.geolocation.getCurrentPosition(
            p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => resolve({ lat: 0, lng: 0 }),
            { timeout: 1000, maximumAge: 30000 }
          );
        })
      : { lat: 0, lng: 0 };

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
        console.error("BLE Initialization failed", e);
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
        await BleClient.requestLEScan({}, (result) => {
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
        // User cancelled or no devices found
      } else {
        setError(err.message || 'Error al escanear dispositivos Bluetooth.');
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
