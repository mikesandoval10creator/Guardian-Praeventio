import { useState, useEffect, useCallback } from 'react';
import { BleClient, BleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

interface BluetoothDevice {
  id: string;
  name?: string;
  lastSeen: number;
}

export function useBluetoothMesh() {
  const [isSupported, setIsSupported] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [nearbyDevices, setNearbyDevices] = useState<BluetoothDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

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
          setNearbyDevices(prev => {
            const existing = prev.find(d => d.id === result.device.deviceId);
            if (existing) {
              return prev.map(d => d.id === result.device.deviceId ? { ...d, lastSeen: Date.now() } : d);
            }
            return [...prev, { id: result.device.deviceId, name: result.device.name || 'Dispositivo Desconocido', lastSeen: Date.now() }];
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
          setNearbyDevices(prev => {
            const existing = prev.find(d => d.id === device.id);
            if (existing) {
              return prev.map(d => d.id === device.id ? { ...d, lastSeen: Date.now() } : d);
            }
            return [...prev, { id: device.id, name: device.name || 'Dispositivo Desconocido', lastSeen: Date.now() }];
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
    error,
    startScanning
  };
}
